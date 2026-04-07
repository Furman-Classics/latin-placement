'use strict';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz8_sa2xM-jJm8BrwTlgiAg4rZ8iaMXJoOgkTOZYJf5WcZ78rEg1YoYW5ZOqHyg4UISoQ/exec';
const SUBMIT_TOKEN = 'placent-2026';
const PAYLOAD_VERSION = '2026-sheet-v4';
const EXAM_URL = 'data/exam.json';
const DEV_MODE = new URLSearchParams(location.search).has('dev');
const STORAGE_KEY = DEV_MODE ? 'placent_session_v4_dev' : 'placent_session_v4';
const TIMER_MS = 40 * 60 * 1000;

let state = {
  screen: 'info',
  version: null,
  totals: { part1: 0, part2: 0, overall: 0 },
  studentInfo: null,
  selfEval: null,
  questions: [],
  part1Questions: [],
  part2Questions: [],
  answers: {},
  optionOrder: {},
  p1Index: 0,
  p2Index: 0,
  submissionId: null,
  timerStart: null,
  timerVisible: false,
  timerHandle: null,
  tickHandle: null,
  submitted: false,
};

function $(id) {
  return document.getElementById(id);
}

function renderHTML(raw) {
  return String(raw || '')
    .replace(/\[underline:\s*([^\]]+)\]/g, '<span class="hl">$1</span>');
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
  const ids = [
    'screen-info',
    'screen-selfeval',
    'screen-interstitial1',
    'screen-interstitial2',
    'screen-part1',
    'screen-part2',
    'screen-done',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.hidden = (id !== `screen-${name}`);
  }
  updateTimerUI();
  window.scrollTo(0, 0);
}

function generateSubmissionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      screen: state.screen,
      version: state.version,
      totals: state.totals,
      studentInfo: state.studentInfo,
      selfEval: state.selfEval,
      questions: state.questions,
      answers: state.answers,
      optionOrder: state.optionOrder,
      p1Index: state.p1Index,
      p2Index: state.p2Index,
      submissionId: state.submissionId,
      timerStart: state.timerStart,
      timerVisible: state.timerVisible,
    }));
  } catch (_) {}
}

function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

function showTermsZeroModal() {
  const modal = $('terms-zero-modal');
  if (!modal) return;
  modal.hidden = false;
  $('terms-zero-close')?.focus();
}

function hideTermsZeroModal() {
  const modal = $('terms-zero-modal');
  if (!modal) return;
  modal.hidden = true;
}

async function loadExam() {
  const response = await fetch(EXAM_URL);
  if (!response.ok) throw new Error('Could not load exam data.');
  const raw = await response.json();
  const allQuestions = Array.isArray(raw.questions) ? raw.questions : [];

  let questions = allQuestions;
  if (DEV_MODE) {
    const devP1 = allQuestions.filter(q => q.part === 1).slice(0, 3);
    const devP2 = allQuestions.filter(q => q.part === 2).slice(0, 3);
    questions = [...devP1, ...devP2];
  }

  const totals = {
    part1: questions.filter(q => q.part === 1).reduce((sum, q) => sum + Number(q.weight || 0), 0),
    part2: questions.filter(q => q.part === 2).reduce((sum, q) => sum + Number(q.weight || 0), 0),
  };
  totals.overall = totals.part1 + totals.part2;

  return {
    version: raw.version || '2026-2part-v1',
    totals,
    questions,
  };
}

function buildOptionOrder(question) {
  return shuffle([...Array(question.options.length).keys()]);
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
  setSelections(question, [optionIndex]);
}

function hasValidAnswer(question) {
  return getSelections(question.id).length === 1;
}

function selectionsMatch(question) {
  const current = getSelections(question.id);
  return current.length === 1 && current[0] === Number(question.correctIndex);
}

function scoreSubmission() {
  let part1Score = 0;
  let part2Score = 0;

  for (const question of state.questions) {
    if (!selectionsMatch(question)) continue;
    if (question.part === 1) part1Score += Number(question.weight || 0);
    if (question.part === 2) part2Score += Number(question.weight || 0);
  }

  return {
    part1Score,
    part2Score,
    totalScore: part1Score + part2Score,
  };
}

function buildTiming(autoSubmit) {
  const startedAtMs = state.timerStart || Date.now();
  const elapsedMs = Math.min(TIMER_MS, Math.max(0, Date.now() - startedAtMs));
  return {
    allowedMs: TIMER_MS,
    timeTakenMin: Math.round((elapsedMs / 60000) * 10) / 10,
    autoSubmitted: Boolean(autoSubmit),
    startedAtMs,
    submittedAtMs: Date.now(),
  };
}

function buildSubmissionPayload(autoSubmit) {
  const scored = scoreSubmission();
  return {
    submissionId: state.submissionId || generateSubmissionId(),
    payloadVersion: PAYLOAD_VERSION,
    token: SUBMIT_TOKEN,
    version: state.version,
    studentInfo: state.studentInfo,
    selfEval: state.selfEval,
    scores: {
      part1: scored.part1Score,
      part2: scored.part2Score,
      total: scored.totalScore,
    },
    totals: state.totals,
    timing: buildTiming(autoSubmit),
  };
}

async function postSubmission(payload) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('REPLACE_WITH_DEPLOYED_URL')) {
    if (DEV_MODE) return;
    throw new Error('Apps Script URL is not configured.');
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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

function formatRemainingMinutes() {
  const remainingMs = state.timerStart ? Math.max(0, TIMER_MS - (Date.now() - state.timerStart)) : TIMER_MS;
  const minutes = Math.max(0, Math.ceil(remainingMs / 60000));
  return `${minutes} min left`;
}

function showTimeRemaining(elementId) {
  const el = $(elementId);
  if (!el) return;
  const remainingMs = state.timerStart ? Math.max(0, TIMER_MS - (Date.now() - state.timerStart)) : TIMER_MS;
  const minutes = Math.max(0, Math.ceil(remainingMs / 60000));
  el.textContent = `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function updateTimerUI() {
  const part1Active = state.screen === 'part1';
  const part2Active = state.screen === 'part2';
  const visible = state.timerVisible && (part1Active || part2Active) && Boolean(state.timerStart);
  const label = formatRemainingMinutes();

  for (const id of ['p1-timer', 'p2-timer']) {
    const el = $(id);
    if (!el) continue;
    el.textContent = label;
    el.hidden = !visible || !((id === 'p1-timer' && part1Active) || (id === 'p2-timer' && part2Active));
  }

  for (const id of ['p1-timer-toggle', 'p2-timer-toggle']) {
    const el = $(id);
    if (!el) continue;
    el.setAttribute('aria-expanded', visible ? 'true' : 'false');
  }

  if (state.screen === 'interstitial2') {
    showTimeRemaining('interstitial2-time');
  }
}

function startTimer() {
  stopTimer();
  if (!state.timerStart) return;
  const remainingMs = Math.max(0, TIMER_MS - (Date.now() - state.timerStart));
  state.timerHandle = setTimeout(() => submitTest(true), remainingMs);
  state.tickHandle = setInterval(updateTimerUI, 1000);
  updateTimerUI();
}

function stopTimer() {
  if (state.timerHandle) clearTimeout(state.timerHandle);
  if (state.tickHandle) clearInterval(state.tickHandle);
  state.timerHandle = null;
  state.tickHandle = null;
}

function onBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = '';
}

function toggleTimerVisible() {
  if (!state.timerStart) return;
  state.timerVisible = !state.timerVisible;
  saveState();
  updateTimerUI();
}

function updateQuestionHeader(partPrefix, question, index, total) {
  $(`${partPrefix}-counter`).textContent = `Question ${index + 1} of ${total}`;
  const focusEl = $(`${partPrefix}-focus`);
  const promptEl = $(`${partPrefix}-prompt`);

  if (question.focusText) {
    focusEl.hidden = false;
    focusEl.innerHTML = renderHTML(question.focusText);
  } else {
    focusEl.hidden = true;
    focusEl.innerHTML = '';
  }
  promptEl.innerHTML = renderHTML(question.promptText);
}

function renderOptions(partPrefix, question, focusOptionIndex = -1) {
  const container = $(`${partPrefix}-options`);
  container.innerHTML = '';
  const order = state.optionOrder[question.id];
  const current = getSelections(question.id);

  order.forEach((optionIndex, displayIndex) => {
    const selected = current.includes(optionIndex);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn' + (selected ? ' selected' : '');
    btn.innerHTML = renderHTML(question.options[optionIndex]);
    btn.dataset.idx = String(optionIndex);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    btn.addEventListener('click', () => {
      toggleSelection(question, optionIndex);
      if (partPrefix === 'p1') renderP1(false, displayIndex);
      else renderP2(false, displayIndex);
    });
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
      if (nextIndex === -1) return;
      const nextOptionIndex = Number(buttons[nextIndex].dataset.idx);
      setSelections(question, [nextOptionIndex]);
      if (partPrefix === 'p1') renderP1(false, nextIndex);
      else renderP2(false, nextIndex);
    });
    container.appendChild(btn);
  });

  if (focusOptionIndex >= 0) {
    const buttons = container.querySelectorAll('.option-btn');
    if (buttons[focusOptionIndex]) buttons[focusOptionIndex].focus();
  }
}

function updateProgress(partPrefix, questions) {
  const answered = questions.filter(q => hasValidAnswer(q)).length;
  $(`${partPrefix}-progress`).textContent = `Answered: ${answered} / ${questions.length}`;
}

function renderP1(moveFocus = false, focusOptionIndex = -1) {
  const question = state.part1Questions[state.p1Index];
  updateQuestionHeader('p1', question, state.p1Index, state.part1Questions.length);
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

  updateProgress('p1', state.part1Questions);
  updateTimerUI();
  if (moveFocus) $('p1-counter').focus();
}

function renderP2(moveFocus = false, focusOptionIndex = -1) {
  const question = state.part2Questions[state.p2Index];
  updateQuestionHeader('p2', question, state.p2Index, state.part2Questions.length);
  renderOptions('p2', question, focusOptionIndex);

  const nextBtn = $('p2-next');
  const isLast = state.p2Index === state.part2Questions.length - 1;
  nextBtn.textContent = isLast ? 'Submit and finish placement test (takes a few seconds)' : 'Submit and move to next question';
  nextBtn.disabled = !hasValidAnswer(question);
  nextBtn.onclick = isLast
    ? () => submitTest(false)
    : () => {
        state.p2Index += 1;
        saveState();
        renderP2(true);
      };

  updateProgress('p2', state.part2Questions);
  updateTimerUI();
  if (moveFocus) $('p2-counter').focus();
}

function startPart1() {
  if (!state.timerStart) {
    state.timerStart = Date.now();
    window.addEventListener('beforeunload', onBeforeUnload);
    startTimer();
  }
  state.screen = 'part1';
  saveState();
  showScreen('part1');
  renderP1(true);
}

function goToPart2() {
  state.screen = 'interstitial2';
  saveState();
  showTimeRemaining('interstitial2-time');
  showScreen('interstitial2');
}

function startPart2() {
  state.screen = 'part2';
  saveState();
  showScreen('part2');
  renderP2(true);
}

function setDoneScreen(autoSubmitted, submissionId) {
  $('done-message-primary').textContent = autoSubmitted
    ? 'Your time has elapsed, and your current answers have been submitted.'
    : 'Your placement test has been submitted.';
  const submissionEl = $('done-submission');
  if (submissionId) {
    submissionEl.hidden = false;
    submissionEl.textContent = `Submission ID: ${submissionId}`;
  } else {
    submissionEl.hidden = true;
    submissionEl.textContent = '';
  }
}

async function submitTest(autoSubmit) {
  if (state.submitted) return;
  state.submitted = true;
  stopTimer();
  window.removeEventListener('beforeunload', onBeforeUnload);

  try {
    const payload = buildSubmissionPayload(autoSubmit);
    state.submissionId = payload.submissionId;
    await postSubmission(payload);
  } catch (err) {
    console.error('Submit error:', err);
    state.submitted = false;
    saveState();
    if (state.timerStart) {
      window.addEventListener('beforeunload', onBeforeUnload);
      startTimer();
    }
    alert('Your test could not be submitted. Please check your connection and try again.');
    return;
  }

  setDoneScreen(autoSubmit, state.submissionId);
  clearState();
  state.screen = 'done';
  showScreen('done');
}

function setCheckedValues(name, values) {
  const wanted = new Set(values || []);
  document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
    input.checked = wanted.has(input.value);
  });
}

function updateOtherInput(checkId, inputId) {
  const check = $(checkId);
  const input = $(inputId);
  if (!check || !input) return;
  input.disabled = !check.checked;
}

function collectStudentInfo() {
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

  return {
    firstName: $('firstName').value.trim(),
    lastName: $('lastName').value.trim(),
    studentId: $('studentId').value.trim(),
    termsTaken: $('termsTaken').value,
    textbooks,
    authorsRead,
  };
}

function populateStudentInfoForm() {
  const info = state.studentInfo;
  if (!info) return;
  $('firstName').value = info.firstName || '';
  $('lastName').value = info.lastName || '';
  $('studentId').value = info.studentId || '';
  $('termsTaken').value = info.termsTaken || '';

  setCheckedValues('textbook', (info.textbooks || []).map(value => value.startsWith('Other: ') ? '__other_textbook__' : value));
  const otherTextbook = (info.textbooks || []).find(value => value.startsWith('Other: '));
  $('textbook-other-text').value = otherTextbook ? otherTextbook.replace(/^Other:\s*/, '') : '';
  updateOtherInput('textbook-other-check', 'textbook-other-text');

  setCheckedValues('author', (info.authorsRead || []).map(value => value.startsWith('Other: ') ? '__other_author__' : value));
  const otherAuthor = (info.authorsRead || []).find(value => value.startsWith('Other: '));
  $('author-other-text').value = otherAuthor ? otherAuthor.replace(/^Other:\s*/, '') : '';
  updateOtherInput('author-other-check', 'author-other-text');
}

function collectSelfEval() {
  return {
    vocabEval: document.querySelector('input[name="vocabEval"]:checked')?.value || '',
    grammarEval: document.querySelector('input[name="grammarEval"]:checked')?.value || '',
    topicsConfidence: [...document.querySelectorAll('input[name="topicConfidence"]:checked')].map(input => input.value),
    expectedPlacement: $('expectedPlacement').value,
  };
}

function populateSelfEvalForm() {
  const info = state.selfEval;
  if (!info) return;
  document.querySelectorAll('input[name="vocabEval"]').forEach(input => { input.checked = input.value === String(info.vocabEval || ''); });
  document.querySelectorAll('input[name="grammarEval"]').forEach(input => { input.checked = input.value === String(info.grammarEval || ''); });
  setCheckedValues('topicConfidence', info.topicsConfidence || []);
  $('expectedPlacement').value = info.expectedPlacement || '';
}

function initializeExam(form) {
  state.version = form.version;
  state.totals = form.totals;
  state.questions = form.questions;
  state.part1Questions = form.questions.filter(q => q.part === 1);
  state.part2Questions = form.questions.filter(q => q.part === 2);
  state.answers = {};
  state.optionOrder = {};
  for (const question of state.questions) {
    state.optionOrder[question.id] = buildOptionOrder(question);
  }
  state.p1Index = 0;
  state.p2Index = 0;
  state.submissionId = generateSubmissionId();
  state.timerStart = null;
  state.timerVisible = false;
  state.submitted = false;
}

async function bootstrapDevShortcut() {
  const exam = await loadExam();
  state.studentInfo = {
    firstName: 'Dev',
    lastName: 'User',
    studentId: '999999',
    termsTaken: '4',
    textbooks: [],
    authorsRead: [],
  };
  state.selfEval = {
    vocabEval: '3',
    grammarEval: '3',
    topicsConfidence: [],
    expectedPlacement: 'Intermediate',
  };
  initializeExam(exam);
  state.screen = 'part2';
  state.p2Index = 0;
  state.timerStart = Date.now();
  saveState();
  window.addEventListener('beforeunload', onBeforeUnload);
  startTimer();
  showScreen('part2');
  renderP2(true);
}

$('textbook-other-check').addEventListener('change', function () {
  updateOtherInput('textbook-other-check', 'textbook-other-text');
  if (this.checked) $('textbook-other-text').focus();
});

$('author-other-check').addEventListener('change', function () {
  updateOtherInput('author-other-check', 'author-other-text');
  if (this.checked) $('author-other-text').focus();
});

$('author-none-check').addEventListener('change', function () {
  if (!this.checked) return;
  document.querySelectorAll('input[name="author"]').forEach(cb => {
    if (cb !== this) cb.checked = false;
  });
  updateOtherInput('author-other-check', 'author-other-text');
});

document.querySelectorAll('input[name="author"]').forEach(cb => {
  if (cb.id !== 'author-none-check') {
    cb.addEventListener('change', () => {
      if (cb.checked) $('author-none-check').checked = false;
    });
  }
});

$('info-form').addEventListener('submit', event => {
  event.preventDefault();
  const errorEl = $('info-error');
  errorEl.textContent = '';
  const info = collectStudentInfo();
  if (!info.firstName || !info.lastName || !info.studentId || !info.termsTaken) {
    errorEl.textContent = 'Please fill in all required fields.';
    return;
  }
  if (!/^\d+$/.test(info.studentId)) {
    errorEl.textContent = 'Student ID must contain numerals only.';
    return;
  }
  if (info.termsTaken === '0') {
    showTermsZeroModal();
    return;
  }
  state.studentInfo = info;
  state.screen = 'selfeval';
  saveState();
  showScreen('selfeval');
  populateSelfEvalForm();
});

$('selfeval-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = $('selfeval-error');
  errorEl.textContent = '';
  const selfEval = collectSelfEval();
  if (!selfEval.vocabEval || !selfEval.grammarEval || !selfEval.expectedPlacement) {
    errorEl.textContent = 'Please fill in all required fields.';
    return;
  }

  const submitBtn = event.submitter || document.querySelector('#selfeval-form .btn-primary');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Loading…';

  try {
    const exam = await loadExam();
    state.selfEval = selfEval;
    initializeExam(exam);
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'Could not load the placement exam. Please try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Continue to Test Instructions →';
    return;
  }

  state.screen = 'interstitial1';
  saveState();
  submitBtn.disabled = false;
  submitBtn.textContent = 'Continue to Test Instructions →';
  showScreen('interstitial1');
});

$('interstitial1-begin').addEventListener('click', startPart1);
$('interstitial2-begin').addEventListener('click', startPart2);
$('p1-timer-toggle').addEventListener('click', toggleTimerVisible);
$('p2-timer-toggle').addEventListener('click', toggleTimerVisible);
$('terms-zero-close').addEventListener('click', hideTermsZeroModal);
$('terms-zero-modal').addEventListener('click', event => {
  if (event.target === $('terms-zero-modal')) hideTermsZeroModal();
});

function tryRestoreSession() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return false;
  }

  if (!saved) return false;

  state.screen = saved.screen || 'info';
  state.version = saved.version || null;
  state.totals = saved.totals || { part1: 0, part2: 0, overall: 0 };
  state.studentInfo = saved.studentInfo || null;
  state.selfEval = saved.selfEval || null;
  state.questions = saved.questions || [];
  state.part1Questions = state.questions.filter(q => q.part === 1);
  state.part2Questions = state.questions.filter(q => q.part === 2);
  state.answers = saved.answers || {};
  state.optionOrder = saved.optionOrder || {};
  state.p1Index = saved.p1Index || 0;
  state.p2Index = saved.p2Index || 0;
  state.submissionId = saved.submissionId || generateSubmissionId();
  state.timerStart = saved.timerStart || null;
  state.timerVisible = Boolean(saved.timerVisible);
  state.submitted = false;

  populateStudentInfoForm();
  populateSelfEvalForm();

  if (!state.questions.length && ['interstitial1', 'part1', 'interstitial2', 'part2'].includes(state.screen)) {
    clearState();
    return false;
  }

  if (state.timerStart) {
    const elapsed = Date.now() - state.timerStart;
    if (elapsed >= TIMER_MS) {
      submitTest(true);
      return true;
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    startTimer();
  }

  if (state.screen === 'selfeval') {
    showScreen('selfeval');
    return true;
  }
  if (state.screen === 'interstitial1') {
    showScreen('interstitial1');
    return true;
  }
  if (state.screen === 'part1') {
    showScreen('part1');
    const notice = $('p1-restore-notice');
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 5000);
    renderP1(true);
    return true;
  }
  if (state.screen === 'interstitial2') {
    showTimeRemaining('interstitial2-time');
    showScreen('interstitial2');
    return true;
  }
  if (state.screen === 'part2') {
    showScreen('part2');
    renderP2(true);
    return true;
  }

  showScreen('info');
  return true;
}

(async function init() {
  if (DEV_MODE) {
    const banner = $('dev-banner');
    banner.hidden = false;
    banner.textContent = 'DEV MODE — shortcut to Part 2';
  }
  if (!tryRestoreSession()) {
    if (DEV_MODE) {
      try {
        await bootstrapDevShortcut();
        return;
      } catch (err) {
        console.error('DEV shortcut load failed:', err);
      }
    }
    showScreen('info');
  }
})();
