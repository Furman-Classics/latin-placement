'use strict';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz8_sa2xM-jJm8BrwTlgiAg4rZ8iaMXJoOgkTOZYJf5WcZ78rEg1YoYW5ZOqHyg4UISoQ/exec';
const SUBMIT_TOKEN = 'placent-2026';
const PAYLOAD_VERSION = '2026-sheet-v1';

const DEV_MODE = new URLSearchParams(location.search).has('dev');
const FORM_OVERRIDE = (new URLSearchParams(location.search).get('form') || '').toUpperCase();
const STORAGE_KEY = DEV_MODE ? 'placent_dev_session_v2' : 'placent_session_v2';
const TIMER_MS = 45 * 60 * 1000;
const EXAM_VERSION = '2026-fixed-forms-v1';
const FORM_IDS = ['A', 'B', 'C'];
const FORM_URLS = {
  A: 'data/form-a.json',
  B: 'data/form-b.json',
  C: 'data/form-c.json',
};

const PLACEMENT_RULES = {
  'LATN 325': {
    total: 34,
    gates: {
      reading: 9,
      advanced_syntax: 6,
      sentence_meaning: 7,
    },
  },
  'LATN 201': {
    total: 24,
    gates: {
      morphology_vocab: 8,
      reading_plus_sentence_meaning: 12,
      advanced_syntax: 3,
    },
  },
};

let state = {
  screen: 'info',
  formId: null,
  version: EXAM_VERSION,
  studentInfo: null,
  passages: [],
  questions: [],
  part1Questions: [],
  part2Questions: [],
  answers: {},
  optionOrder: {},
  p1Index: 0,
  p2Index: 0,
  submissionId: null,
  timerStart: null,
  timerHandle: null,
  submitted: false,
};

function $(id) {
  return document.getElementById(id);
}

function renderHTML(raw) {
  return String(raw || '').replace(/\[underline:\s*([^\]]+)\]/g, '<span class="hl">$1</span>');
}

function trimPromptLead(raw) {
  const cleaned = String(raw || '').replace(/^[\s,.:;!?-]+/, '').trim();
  return cleaned.replace(/^[a-z]/, letter => letter.toUpperCase());
}

function splitPrompt(prompt) {
  const rawPrompt = String(prompt || '');
  const match = rawPrompt.match(/^(.*?)<em>(.*?)<\/em>(.*)$/s);
  if (!match) {
    return {
      focusHtml: '',
      promptHtml: renderHTML(rawPrompt),
    };
  }

  const [, rawBefore, rawFocus, rawAfter] = match;
  const before = rawBefore.trim();
  const after = rawAfter.trim();
  let questionText = null;

  if (/^In(?: the sentence)?$/i.test(before) || /^Read the sentence$/i.test(before)) {
    questionText = trimPromptLead(rawAfter);
  } else if (/^What is the best translation of$/i.test(before)) {
    questionText = 'What is the best translation?';
  } else if (/^What is the best sense of$/i.test(before)) {
    questionText = 'What is the best sense?';
  } else if (/^Identify the type of condition in$/i.test(before)) {
    questionText = 'Identify the type of condition.';
  } else if (/^Identify the construction in$/i.test(before)) {
    questionText = 'Identify the construction.';
  } else if (/^In the passage, what does$/i.test(before) && /^mean\?$/i.test(after)) {
    questionText = 'In the passage, what does this mean?';
  } else if (/^In the final sentence, what does$/i.test(before) && /^imply\?$/i.test(after)) {
    questionText = 'In the final sentence, what does this imply?';
  } else if (/^What does the sentence$/i.test(before) && /^imply\?$/i.test(after)) {
    questionText = 'What does this sentence imply?';
  } else if (/^What does$/i.test(before) && /^imply in context\?$/i.test(after)) {
    questionText = 'What does this imply in context?';
  } else if (/^What fear is expressed by$/i.test(before) && /^\?$/i.test(after)) {
    questionText = 'What fear is expressed here?';
  }

  if (!questionText) {
    return {
      focusHtml: '',
      promptHtml: renderHTML(rawPrompt),
    };
  }

  return {
    focusHtml: `<em>${renderHTML(rawFocus)}</em>`,
    promptHtml: renderHTML(questionText),
  };
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function showScreen(name) {
  const ids = ['screen-info', 'screen-interstitial1', 'screen-interstitial2', 'screen-part1', 'screen-part2', 'screen-done'];
  for (const id of ids) {
    const el = document.getElementById(id);
    el.hidden = (id !== `screen-${name}`);
  }
  window.scrollTo(0, 0);
}

function generateSubmissionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function setDoneSubmission(submissionId) {
  const el = $('done-submission');
  if (!el) return;
  if (!submissionId) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = `Submission ID: ${submissionId}`;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      screen: state.screen,
      formId: state.formId,
      version: state.version,
      studentInfo: state.studentInfo,
      passages: state.passages,
      questions: state.questions,
      answers: state.answers,
      optionOrder: state.optionOrder,
      p1Index: state.p1Index,
      p2Index: state.p2Index,
      submissionId: state.submissionId,
      timerStart: state.timerStart,
    }));
  } catch (_) {}
}

function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

function chooseFormId() {
  if (FORM_IDS.includes(FORM_OVERRIDE)) return FORM_OVERRIDE;
  return FORM_IDS[Math.floor(Math.random() * FORM_IDS.length)];
}

function normalizeQuestion(formId, rawQuestion) {
  const question = {
    ...rawQuestion,
    formId,
    correctIndices: Array.isArray(rawQuestion.correctIndices)
      ? rawQuestion.correctIndices.map(Number)
      : [Number(rawQuestion.correct)],
    minSelections: Number(rawQuestion.minSelections || 1),
    maxSelections: Number(rawQuestion.maxSelections || 1),
    topicTags: Array.isArray(rawQuestion.topicTags) ? rawQuestion.topicTags : [],
    pureLabel: Boolean(rawQuestion.pureLabel),
  };
  return question;
}

function prepareFormPayload(rawForm, selectedFormId) {
  const formId = rawForm.formId || selectedFormId;
  const questions = (rawForm.questions || []).map(q => normalizeQuestion(formId, q));
  const passages = Array.isArray(rawForm.passages) ? rawForm.passages : [];
  if (!DEV_MODE) {
    return {
      formId,
      version: rawForm.version || EXAM_VERSION,
      passages,
      questions,
    };
  }

  const devPart1 = questions.filter(q => q.part === 1).slice(0, 2);
  const devPart2 = questions.filter(q => q.part === 2).slice(0, 2);
  const kept = [...devPart1, ...devPart2];
  const passageIds = new Set(kept.map(q => q.passageId).filter(Boolean));
  return {
    formId,
    version: rawForm.version || EXAM_VERSION,
    passages: passages.filter(p => passageIds.has(p.passageId)),
    questions: kept,
  };
}

async function loadSelectedForm() {
  const formId = chooseFormId();
  const response = await fetch(FORM_URLS[formId]);
  if (!response.ok) throw new Error('Could not load form.');
  const rawForm = await response.json();
  return prepareFormPayload(rawForm, formId);
}

function buildOptionOrder(question) {
  const base = [...Array(question.options.length).keys()];
  return question.maxSelections > 1 ? base : shuffle(base);
}

function getPassage(passageId) {
  return state.passages.find(p => p.passageId === passageId) || null;
}

function isMultiSelect(question) {
  return question.maxSelections > 1 || question.minSelections > 1 || question.correctIndices.length > 1;
}

function getSelections(questionId) {
  const saved = state.answers[questionId];
  return Array.isArray(saved) ? [...saved] : [];
}

function setSelections(question, selections) {
  state.answers[question.id] = [...new Set(selections)].sort((a, b) => a - b);
  saveState();
}

function toggleSelection(question, optionIndex) {
  const current = getSelections(question.id);
  if (!isMultiSelect(question)) {
    setSelections(question, [optionIndex]);
    return;
  }

  if (current.includes(optionIndex)) {
    setSelections(question, current.filter(idx => idx !== optionIndex));
    return;
  }

  if (current.length >= question.maxSelections) return;
  current.push(optionIndex);
  setSelections(question, current);
}

function hasValidAnswer(question) {
  const count = getSelections(question.id).length;
  return count >= question.minSelections && count <= question.maxSelections;
}

function selectionsMatch(question) {
  const current = getSelections(question.id).sort((a, b) => a - b);
  const correct = [...question.correctIndices].sort((a, b) => a - b);
  if (current.length !== correct.length) return false;
  return current.every((value, index) => value === correct[index]);
}

function getNamedAuthorCount(studentInfo) {
  const authors = Array.isArray(studentInfo?.authorsRead) ? studentInfo.authorsRead : [];
  return authors.filter(author => author !== 'None' && !String(author).startsWith('Other')).length;
}

function getTermsCount(studentInfo) {
  const raw = String(studentInfo?.termsTaken || '0');
  return raw === '8+' ? 8 : parseInt(raw, 10) || 0;
}

function placementGap(targetPlacement, totalScore, subscores) {
  const rule = PLACEMENT_RULES[targetPlacement];
  if (!rule) return null;
  const gates = [];
  for (const [key, minimum] of Object.entries(rule.gates)) {
    const actual = key === 'reading_plus_sentence_meaning'
      ? subscores.reading + subscores.sentence_meaning
      : subscores[key];
    gates.push({ key, deficit: Math.max(0, minimum - actual) });
  }
  return {
    totalDeficit: Math.max(0, rule.total - totalScore),
    gates,
  };
}

function buildAdvisoryFlags(placement, totalScore, subscores) {
  const terms = getTermsCount(state.studentInfo);
  const namedAuthors = getNamedAuthorCount(state.studentInfo);
  const flags = [];

  const target = placement === 'LATN 110'
    ? 'LATN 201'
    : placement === 'LATN 201'
      ? 'LATN 325'
      : null;

  if (target && (terms >= 5 || namedAuthors >= 2)) {
    const gap = placementGap(target, totalScore, subscores);
    const allOtherMet = gap.gates.every(g => g.deficit === 0);
    const strong325Reading = target === 'LATN 325'
      && gap.totalDeficit <= 2
      && subscores.reading >= PLACEMENT_RULES['LATN 325'].gates.reading
      && subscores.sentence_meaning >= PLACEMENT_RULES['LATN 325'].gates.sentence_meaning
      && subscores.advanced_syntax >= PLACEMENT_RULES['LATN 325'].gates.advanced_syntax - 1;
    if (gap.totalDeficit <= 2 && (allOtherMet || strong325Reading)) {
      flags.push('possible_move_up');
    }
  }

  if (terms <= 2 && namedAuthors === 0 && placement !== 'LATN 110') {
    flags.push('possible_drop_backer');
  }

  return flags;
}

function determinePlacement(totalScore, subscores) {
  if (
    totalScore >= PLACEMENT_RULES['LATN 325'].total &&
    subscores.reading >= PLACEMENT_RULES['LATN 325'].gates.reading &&
    subscores.advanced_syntax >= PLACEMENT_RULES['LATN 325'].gates.advanced_syntax &&
    subscores.sentence_meaning >= PLACEMENT_RULES['LATN 325'].gates.sentence_meaning
  ) {
    return 'LATN 325';
  }

  if (
    totalScore >= PLACEMENT_RULES['LATN 201'].total &&
    subscores.morphology_vocab >= PLACEMENT_RULES['LATN 201'].gates.morphology_vocab &&
    (subscores.reading + subscores.sentence_meaning) >= PLACEMENT_RULES['LATN 201'].gates.reading_plus_sentence_meaning &&
    subscores.advanced_syntax >= PLACEMENT_RULES['LATN 201'].gates.advanced_syntax
  ) {
    return 'LATN 201';
  }

  return 'LATN 110';
}

function scoreSubmission() {
  const totals = {
    morphology_vocab: 0,
    sentence_meaning: 0,
    reading: 0,
    advanced_syntax: 0,
  };
  const subscores = {
    morphology_vocab: 0,
    sentence_meaning: 0,
    reading: 0,
    advanced_syntax: 0,
  };

  for (const question of state.questions) {
    totals[question.countsToward] += 1;
    if (selectionsMatch(question)) {
      subscores[question.countsToward] += 1;
    }
  }

  const totalScore =
    subscores.morphology_vocab +
    subscores.sentence_meaning +
    subscores.reading +
    subscores.advanced_syntax;

  const placement = determinePlacement(totalScore, subscores);
  const advisoryFlags = buildAdvisoryFlags(placement, totalScore, subscores);

  return {
    totals,
    subscores,
    totalScore,
    placement,
    advisoryFlags,
    percentages: {
      morphology_vocab: subscores.morphology_vocab / Math.max(1, totals.morphology_vocab),
      sentence_meaning: subscores.sentence_meaning / Math.max(1, totals.sentence_meaning),
      reading: subscores.reading / Math.max(1, totals.reading),
      advanced_syntax: subscores.advanced_syntax / Math.max(1, totals.advanced_syntax),
    },
  };
}

function buildTiming(autoSubmit) {
  const elapsedMs = Math.min(TIMER_MS, Math.max(0, Date.now() - state.timerStart));
  return {
    allowedMs: TIMER_MS,
    elapsedMs,
    remainingMs: Math.max(0, TIMER_MS - elapsedMs),
    autoSubmitted: Boolean(autoSubmit),
    startedAtMs: state.timerStart,
    submittedAtMs: Date.now(),
  };
}

function buildSubmissionPayload(autoSubmit) {
  const scores = scoreSubmission();
  return {
    submissionId: state.submissionId || generateSubmissionId(),
    payloadVersion: PAYLOAD_VERSION,
    token: SUBMIT_TOKEN,
    version: state.version,
    formId: state.formId,
    studentInfo: state.studentInfo,
    answers: state.answers,
    subscores: scores.subscores,
    totals: scores.totals,
    totalScore: scores.totalScore,
    placement: scores.placement,
    advisoryFlags: scores.advisoryFlags,
    percentages: scores.percentages,
    timing: buildTiming(autoSubmit),
  };
}

async function postSubmission(payload) {
  if (!APPS_SCRIPT_URL) return;
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    keepalive: true,
    redirect: 'manual',
    body: JSON.stringify(payload),
  });

  if (response.type === 'opaqueredirect') return;
  if (response.status >= 200 && response.status < 400) return;

  let detail = '';
  try {
    detail = (await response.text()).trim();
  } catch (_) {}

  throw new Error(detail || `Submission failed with status ${response.status}.`);
}

function themeLabel(theme) {
  return {
    aeneid: 'Aeneas, leader of Trojans',
    pliny: 'Pliny the Younger’s letter',
    agrippina: 'Agrippina, mother of Nero',
  }[theme] || 'Passage';
}

function updateQuestionHeader(partPrefix, question) {
  const instructionEl = $(`${partPrefix}-instructions`);
  if (!instructionEl) return;
  if (isMultiSelect(question)) {
    instructionEl.textContent = `Select ${question.maxSelections} answers.`;
    instructionEl.hidden = false;
    return;
  }
  instructionEl.hidden = true;
  instructionEl.textContent = '';
}

function renderPrompt(partPrefix, question) {
  const promptEl = $(`${partPrefix}-prompt`);
  const focusEl = $(`${partPrefix}-focus`);
  const { focusHtml, promptHtml } = splitPrompt(question.prompt);

  promptEl.innerHTML = promptHtml;
  promptEl.classList.toggle('has-focus', Boolean(focusHtml));

  if (!focusEl) return;
  if (focusHtml) {
    focusEl.hidden = false;
    focusEl.innerHTML = focusHtml;
    return;
  }

  focusEl.hidden = true;
  focusEl.innerHTML = '';
}

function renderOptions(partPrefix, question, focusOptionIndex = -1) {
  const container = $(`${partPrefix}-options`);
  container.innerHTML = '';
  const order = state.optionOrder[question.id];
  const multi = isMultiSelect(question);
  const selections = getSelections(question.id);

  container.setAttribute('role', multi ? 'group' : 'radiogroup');

  order.forEach((optionIndex, displayIndex) => {
    const selected = selections.includes(optionIndex);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn' + (selected ? ' selected' : '');
    btn.innerHTML = renderHTML(question.options[optionIndex]);
    btn.dataset.idx = String(optionIndex);
    btn.setAttribute('role', multi ? 'checkbox' : 'radio');
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    btn.tabIndex = 0;
    btn.addEventListener('click', () => {
      toggleSelection(question, optionIndex);
      if (partPrefix === 'p1') renderP1(false, displayIndex);
      else renderP2(false, displayIndex);
    });
    if (!multi) {
      btn.addEventListener('keydown', event => {
        const buttons = [...container.querySelectorAll('.option-btn')];
        const currentIndex = buttons.indexOf(btn);
        let nextIndex = -1;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          nextIndex = (currentIndex + 1) % buttons.length;
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault();
          nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
        }
        if (nextIndex !== -1) {
          const nextOptionIndex = Number(buttons[nextIndex].dataset.idx);
          setSelections(question, [nextOptionIndex]);
          if (partPrefix === 'p1') renderP1(false, nextIndex);
          else renderP2(false, nextIndex);
        }
      });
    }
    container.appendChild(btn);
  });

  if (focusOptionIndex >= 0) {
    const buttons = container.querySelectorAll('.option-btn');
    if (buttons[focusOptionIndex]) buttons[focusOptionIndex].focus();
  }
}

function updateP1Progress() {
  const answered = state.part1Questions.filter(question => hasValidAnswer(question)).length;
  $('p1-progress').textContent = `Answered: ${answered} / ${state.part1Questions.length}`;
}

function updateP2Progress() {
  const answered = state.part2Questions.filter(question => hasValidAnswer(question)).length;
  $('p2-progress').textContent = `Answered: ${answered} / ${state.part2Questions.length}`;
}

function renderP1(moveFocus = false, focusOptionIndex = -1) {
  const question = state.part1Questions[state.p1Index];
  $('p1-counter').textContent = `Question ${state.p1Index + 1} of ${state.part1Questions.length}`;
  renderPrompt('p1', question);
  updateQuestionHeader('p1', question);
  renderOptions('p1', question, focusOptionIndex);

  const nextBtn = $('p1-next');
  const isLast = state.p1Index === state.part1Questions.length - 1;
  nextBtn.textContent = isLast ? 'Continue to Part 2 →' : 'Submit and move to next question';
  nextBtn.disabled = !hasValidAnswer(question);
  nextBtn.onclick = isLast
    ? goToPart2
    : () => {
        state.p1Index += 1;
        saveState();
        renderP1(true);
      };

  updateP1Progress();
  if (moveFocus) $('p1-counter').focus();
}

function renderP2(moveFocus = false, focusOptionIndex = -1) {
  const question = state.part2Questions[state.p2Index];
  $('p2-counter').textContent = `Question ${state.p2Index + 1} of ${state.part2Questions.length}`;
  renderPrompt('p2', question);
  updateQuestionHeader('p2', question);

  const passageEl = $('p2-passage');
  const passage = question.passageId ? getPassage(question.passageId) : null;
  if (passage) {
    passageEl.hidden = false;
    passageEl.innerHTML = `
      <div class="passage-kicker">${themeLabel(passage.theme)}</div>
      <div>${renderHTML(passage.text)}</div>
    `;
  } else {
    passageEl.hidden = true;
    passageEl.innerHTML = '';
  }

  renderOptions('p2', question, focusOptionIndex);

  const isLast = state.p2Index === state.part2Questions.length - 1;
  const nextBtn = $('p2-next');
  const submitBtn = $('p2-submit');
  nextBtn.hidden = isLast;
  submitBtn.hidden = !isLast;
  nextBtn.disabled = !hasValidAnswer(question);
  submitBtn.disabled = !hasValidAnswer(question);
  nextBtn.onclick = () => {
    state.p2Index += 1;
    saveState();
    renderP2(true);
  };
  submitBtn.onclick = () => submitTest(false);

  updateP2Progress();
  if (moveFocus) $('p2-counter').focus();
}

function startTimer(remainingMs) {
  if (state.timerHandle) clearTimeout(state.timerHandle);
  state.timerHandle = setTimeout(() => {
    if (!state.submitted) submitTest(true);
  }, remainingMs);
}

function showTimeRemaining() {
  const remainingMs = TIMER_MS - (Date.now() - state.timerStart);
  const minutes = Math.floor(Math.max(0, remainingMs) / 60000);
  const seconds = Math.floor((Math.max(0, remainingMs) % 60000) / 1000);
  let text;
  if (minutes === 0) text = `${seconds} second${seconds !== 1 ? 's' : ''}`;
  else if (seconds === 0) text = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  else text = `${minutes} minute${minutes !== 1 ? 's' : ''} and ${seconds} second${seconds !== 1 ? 's' : ''}`;
  $('interstitial2-time').textContent = text;
}

function goToPart2() {
  state.screen = 'interstitial2';
  saveState();
  showTimeRemaining();
  showScreen('interstitial2');
}

function startPart1() {
  state.screen = 'part1';
  saveState();
  showScreen('part1');
  renderP1(true);
}

function startPart2() {
  state.screen = 'part2';
  saveState();
  showScreen('part2');
  renderP2(true);
}

async function submitTest(autoSubmit) {
  if (state.submitted) return;
  state.submitted = true;

  if (state.timerHandle) {
    clearTimeout(state.timerHandle);
    state.timerHandle = null;
  }
  window.removeEventListener('beforeunload', onBeforeUnload);

  try {
    const payload = buildSubmissionPayload(autoSubmit);
    state.submissionId = payload.submissionId;
    await postSubmission(payload);
  } catch (err) {
    console.error('Submit error:', err);
    state.submitted = false;
    saveState();
    window.addEventListener('beforeunload', onBeforeUnload);
    alert('Your test could not be submitted. Please check your connection and try again.');
    return;
  }

  setDoneSubmission(state.submissionId);
  clearState();
  state.screen = 'done';
  showScreen('done');
}

function onBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = '';
}

$('textbook-other-check').addEventListener('change', function () {
  $('textbook-other-text').disabled = !this.checked;
  if (this.checked) $('textbook-other-text').focus();
});

$('author-other-check').addEventListener('change', function () {
  $('author-other-text').disabled = !this.checked;
  if (this.checked) $('author-other-text').focus();
});

$('author-none-check').addEventListener('change', function () {
  if (!this.checked) return;
  document.querySelectorAll('input[name="author"]').forEach(cb => {
    if (cb !== this) cb.checked = false;
  });
  $('author-other-text').disabled = true;
});

document.querySelectorAll('input[name="author"]').forEach(cb => {
  if (cb.id !== 'author-none-check') {
    cb.addEventListener('change', () => {
      if (cb.checked) $('author-none-check').checked = false;
    });
  }
});

$('info-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = $('info-error');
  errorEl.textContent = '';

  const firstName = $('firstName').value.trim();
  const lastName = $('lastName').value.trim();
  const studentId = $('studentId').value.trim();
  const termsTaken = $('termsTaken').value;

  if (!firstName || !lastName || !studentId || !termsTaken) {
    errorEl.textContent = 'Please fill in all required fields.';
    return;
  }

  const textbooks = [];
  document.querySelectorAll('input[name="textbook"]:checked').forEach(cb => {
    if (cb.value === '__other_textbook__') {
      const text = $('textbook-other-text').value.trim();
      if (text) textbooks.push(`Other: ${text}`);
    } else {
      textbooks.push(cb.value);
    }
  });

  const authorsRead = [];
  document.querySelectorAll('input[name="author"]:checked').forEach(cb => {
    if (cb.value === '__other_author__') {
      const text = $('author-other-text').value.trim();
      if (text) authorsRead.push(`Other: ${text}`);
    } else {
      authorsRead.push(cb.value);
    }
  });

  state.studentInfo = { firstName, lastName, studentId, termsTaken, textbooks, authorsRead };

  const submitBtn = event.submitter || document.querySelector('#info-form .btn-primary');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Loading…';

  try {
    const form = await loadSelectedForm();
    state.formId = form.formId;
    state.version = form.version || EXAM_VERSION;
    state.passages = form.passages;
    state.questions = form.questions;
    state.part1Questions = form.questions.filter(q => q.part === 1);
    state.part2Questions = form.questions.filter(q => q.part === 2);
    state.answers = {};
    state.optionOrder = {};
    for (const question of state.questions) {
    state.optionOrder[question.id] = buildOptionOrder(question);
  }
  } catch (err) {
    errorEl.textContent = 'Could not load the placement form. Please try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Begin Test →';
    return;
  }

  state.p1Index = 0;
  state.p2Index = 0;
  state.submissionId = generateSubmissionId();
  state.timerStart = Date.now();
  state.submitted = false;
  state.screen = 'interstitial1';
  saveState();

  window.addEventListener('beforeunload', onBeforeUnload);
  startTimer(TIMER_MS);
  showScreen('interstitial1');
});

$('interstitial1-begin').addEventListener('click', startPart1);
$('interstitial2-begin').addEventListener('click', startPart2);

function tryRestoreSession() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return false;
  }

  if (!saved || !saved.timerStart || !saved.questions || !saved.studentInfo || !saved.formId) return false;

  const elapsed = Date.now() - saved.timerStart;
  state.screen = saved.screen || 'part1';
  state.formId = saved.formId;
  state.version = saved.version || EXAM_VERSION;
  state.studentInfo = saved.studentInfo;
  state.passages = saved.passages || [];
  state.questions = saved.questions || [];
  state.part1Questions = state.questions.filter(q => q.part === 1);
  state.part2Questions = state.questions.filter(q => q.part === 2);
  state.answers = saved.answers || {};
  state.optionOrder = saved.optionOrder || {};
  state.p1Index = saved.p1Index || 0;
  state.p2Index = saved.p2Index || 0;
  state.submissionId = saved.submissionId || generateSubmissionId();
  state.timerStart = saved.timerStart;
  state.submitted = false;

  if (elapsed >= TIMER_MS) {
    submitTest(true);
    return true;
  }

  startTimer(TIMER_MS - elapsed);
  window.addEventListener('beforeunload', onBeforeUnload);

  if (state.screen === 'interstitial1') {
    showScreen('interstitial1');
  } else if (state.screen === 'part1') {
    showScreen('part1');
    const notice = $('p1-restore-notice');
    if (notice) {
      notice.hidden = false;
      setTimeout(() => {
        notice.hidden = true;
      }, 5000);
    }
    renderP1(true);
  } else if (state.screen === 'interstitial2') {
    showTimeRemaining();
    showScreen('interstitial2');
  } else if (state.screen === 'part2') {
    showScreen('part2');
    renderP2(true);
  } else {
    showScreen('info');
  }

  return true;
}

(function init() {
  if (DEV_MODE) $('dev-banner').hidden = false;
  setDoneSubmission(null);
  if (!tryRestoreSession()) showScreen('info');
})();
