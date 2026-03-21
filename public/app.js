'use strict';

// ===== CONFIG =====
// Set APPS_SCRIPT_URL to your deployed Google Apps Script web app URL.
// Set SUBMIT_TOKEN to match the SUBMIT_TOKEN constant in your Apps Script.
const APPS_SCRIPT_URL = '';        // TODO: paste deployment URL here
const SUBMIT_TOKEN    = 'placent-2026';

const DEV_MODE    = new URLSearchParams(location.search).has('dev');
const STORAGE_KEY = DEV_MODE ? 'placent_dev_session' : 'placent_session';
const TIMER_MS    = 45 * 60 * 1000; // 45 minutes

// ===== STATE =====
let state = {
  screen: 'info',
  studentInfo: null,
  questions: [],          // all 60 questions (no `correct` field)
  part1Questions: [],     // slice with part===1
  part2Questions: [],     // slice with part===2
  answers: {},            // { questionId: originalOptionIndex }
  optionOrder: {},        // { questionId: shuffledOriginalIndices[] }
  p1Index: 0,
  p2Index: 0,
  timerStart: null,       // Unix ms
  timerHandle: null,
  submitted: false,
};

// ===== HELPERS =====

function $(id) { return document.getElementById(id); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderHTML(raw) {
  return raw.replace(/\[underline:\s*([^\]]+)\]/g, '<span class="hl">$1</span>');
}

function showScreen(name) {
  const ids = ['screen-info', 'screen-interstitial1', 'screen-interstitial2', 'screen-part1', 'screen-part2', 'screen-done'];
  for (const id of ids) {
    const el = document.getElementById(id);
    el.hidden = (id !== 'screen-' + name);
  }
  window.scrollTo(0, 0);
}

function saveState() {
  try {
    const toSave = {
      screen: state.screen,
      studentInfo: state.studentInfo,
      questions: state.questions,
      answers: state.answers,
      optionOrder: state.optionOrder,
      p1Index: state.p1Index,
      p2Index: state.p2Index,
      timerStart: state.timerStart,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (_) {}
}

function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

// ===== QUESTION LOADING =====

function stratifiedSample(bank, easyN, medN, hardN) {
  const easy   = bank.filter(q => q.chapter <= 10);
  const medium = bank.filter(q => q.chapter >= 11 && q.chapter <= 20);
  const hard   = bank.filter(q => q.chapter >= 21);
  return [
    ...shuffle(easy).slice(0, easyN),
    ...shuffle(medium).slice(0, medN),
    ...shuffle(hard).slice(0, hardN),
  ];
}

async function loadQuestions() {
  const [p1Bank, p2Bank] = await Promise.all([
    fetch('data/questions-part1.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    fetch('data/questions-part2.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
  ]);
  const p1 = DEV_MODE ? stratifiedSample(p1Bank, 1, 1, 0) : stratifiedSample(p1Bank, 14, 13, 8);
  const p2 = DEV_MODE ? stratifiedSample(p2Bank, 1, 1, 0) : stratifiedSample(p2Bank, 10, 9, 6);
  return shuffle([...p1, ...p2]);
}

// ===== SCORING =====

function calcExperienceScore(studentInfo) {
  let score = 0;
  const raw = String(studentInfo.termsTaken || '0');
  const terms = raw === '8+' ? 8 : parseInt(raw, 10) || 0;
  if (terms >= 7)      score += 3;
  else if (terms >= 5) score += 2;
  else if (terms >= 3) score += 1;
  const authors = Array.isArray(studentInfo.authorsRead) ? studentInfo.authorsRead : [];
  const meaningful = authors.filter(a => a !== 'None' && !a.startsWith('Other'));
  if (meaningful.length >= 2)      score += 2;
  else if (meaningful.length >= 1) score += 1;
  return Math.min(score, 5);
}

function scoreSubmission(answerKey) {
  let part1Score = 0, part1Total = 0;
  let part2Score = 0, part2Total = 0;
  for (const q of state.questions) {
    const userAnswer = state.answers[q.id];
    const correct    = answerKey[q.id];
    const isCorrect  = userAnswer !== undefined && userAnswer !== null && Number(userAnswer) === correct;
    if (q.part === 1) { part1Total++; if (isCorrect) part1Score++; }
    else if (q.part === 2) { part2Total++; if (isCorrect) part2Score++; }
  }
  const rawScore         = part1Score + part2Score;
  const experienceScore  = calcExperienceScore(state.studentInfo);
  const totalScore       = rawScore + experienceScore;
  const recommendedLevel = totalScore >= 48 ? 'LATN 325' : totalScore >= 28 && rawScore >= 15 ? 'LATN 201' : 'LATN 110';
  return { part1Score, part1Total, part2Score, part2Total, rawScore, experienceScore, totalScore, recommendedLevel };
}

// ===== TIMER =====

function startTimer(remainingMs) {
  if (state.timerHandle) clearTimeout(state.timerHandle);
  state.timerHandle = setTimeout(() => {
    if (!state.submitted) submitTest(true);
  }, remainingMs);
}

// ===== RENDER PART 1 =====

function renderP1(moveFocus = false, focusOptionIndex = -1) {
  const qs = state.part1Questions;
  const i  = state.p1Index;
  const q  = qs[i];

  $('p1-counter').textContent = `Question ${i + 1} of ${qs.length}`;
  $('p1-prompt').innerHTML = renderHTML(q.prompt);

  const opts      = $('p1-options');
  opts.innerHTML  = '';
  const order1    = state.optionOrder[q.id];
  const hasAnswer = state.answers[q.id] !== undefined;
  for (let di = 0; di < order1.length; di++) {
    const j          = order1[di];
    const isSelected = state.answers[q.id] === j;
    const btn        = document.createElement('button');
    btn.className    = 'option-btn' + (isSelected ? ' selected' : '');
    btn.innerHTML    = renderHTML(q.options[j]);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    btn.tabIndex     = (isSelected || (!hasAnswer && di === 0)) ? 0 : -1;
    btn.dataset.idx  = j;
    btn.addEventListener('click', () => {
      state.answers[q.id] = j;
      saveState();
      renderP1(false, di);
    });
    btn.addEventListener('keydown', (e) => {
      const btns = [...opts.querySelectorAll('.option-btn')];
      const cur  = btns.indexOf(btn);
      let next = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); next = (cur + 1) % btns.length; }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); next = (cur - 1 + btns.length) % btns.length; }
      if (next !== -1) {
        state.answers[q.id] = parseInt(btns[next].dataset.idx);
        saveState();
        renderP1(false, next);
      }
    });
    opts.appendChild(btn);
  }

  const isLast     = (i === qs.length - 1);
  const hasAnswered = state.answers[q.id] !== undefined;
  const nextBtn    = $('p1-next');
  nextBtn.textContent = isLast ? 'Continue to Part 2 →' : 'Submit and move to next question';
  nextBtn.disabled    = !hasAnswered;
  nextBtn.onclick = isLast ? goToPart2 : () => { state.p1Index++; saveState(); renderP1(true); };

  updateP1Progress();
  if (moveFocus) $('p1-counter').focus();
  else if (focusOptionIndex >= 0) {
    const allBtns = opts.querySelectorAll('.option-btn');
    if (allBtns[focusOptionIndex]) allBtns[focusOptionIndex].focus();
  }
}

function updateP1Progress() {
  const answered = state.part1Questions.filter(q => state.answers[q.id] !== undefined).length;
  $('p1-progress').textContent = `Answered: ${answered} / ${state.part1Questions.length}`;
}

function goToPart2() {
  const remainingMs = TIMER_MS - (Date.now() - state.timerStart);
  const mins = Math.floor(Math.max(0, remainingMs) / 60000);
  const secs = Math.floor((Math.max(0, remainingMs) % 60000) / 1000);
  let timeStr;
  if (mins === 0)       timeStr = `${secs} second${secs !== 1 ? 's' : ''}`;
  else if (secs === 0)  timeStr = `${mins} minute${mins !== 1 ? 's' : ''}`;
  else                  timeStr = `${mins} minute${mins !== 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''}`;
  $('interstitial2-time').textContent = timeStr;
  showScreen('interstitial2');
}

function startPart2() {
  state.screen = 'part2';
  state.p2Index = 0;
  saveState();
  showScreen('part2');
  renderP2(true);
}

// ===== RENDER PART 2 =====

function renderP2(moveFocus = false, focusOptionIndex = -1) {
  const qs = state.part2Questions;
  const i  = state.p2Index;
  const q  = qs[i];

  $('p2-counter').textContent = `Question ${i + 1} of ${qs.length}`;
  $('p2-prompt').innerHTML = renderHTML(q.prompt);

  const passageEl = $('p2-passage');
  if (q.passage) {
    passageEl.innerHTML = renderHTML(q.passage);
    passageEl.hidden = false;
  } else {
    passageEl.hidden = true;
    passageEl.innerHTML = '';
  }

  const opts      = $('p2-options');
  opts.innerHTML  = '';
  const order2    = state.optionOrder[q.id];
  const hasAnswer = state.answers[q.id] !== undefined;
  for (let di = 0; di < order2.length; di++) {
    const j          = order2[di];
    const isSelected = state.answers[q.id] === j;
    const btn        = document.createElement('button');
    btn.className    = 'option-btn' + (isSelected ? ' selected' : '');
    btn.innerHTML    = renderHTML(q.options[j]);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    btn.tabIndex     = (isSelected || (!hasAnswer && di === 0)) ? 0 : -1;
    btn.dataset.idx  = j;
    btn.addEventListener('click', () => {
      state.answers[q.id] = j;
      saveState();
      renderP2(false, di);
    });
    btn.addEventListener('keydown', (e) => {
      const btns = [...opts.querySelectorAll('.option-btn')];
      const cur  = btns.indexOf(btn);
      let next = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); next = (cur + 1) % btns.length; }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); next = (cur - 1 + btns.length) % btns.length; }
      if (next !== -1) {
        state.answers[q.id] = parseInt(btns[next].dataset.idx);
        saveState();
        renderP2(false, next);
      }
    });
    opts.appendChild(btn);
  }

  const isLast      = (i === qs.length - 1);
  const hasAnswered  = state.answers[q.id] !== undefined;
  const nextBtn     = $('p2-next');
  const submitBtn   = $('p2-submit');
  nextBtn.hidden    = isLast;
  submitBtn.hidden  = !isLast;
  nextBtn.disabled  = !hasAnswered;
  submitBtn.disabled = !hasAnswered;
  nextBtn.onclick   = () => { state.p2Index++; saveState(); renderP2(true); };
  submitBtn.onclick = () => submitTest(false);

  updateP2Progress();
  if (moveFocus) $('p2-counter').focus();
  else if (focusOptionIndex >= 0) {
    const allBtns = opts.querySelectorAll('.option-btn');
    if (allBtns[focusOptionIndex]) allBtns[focusOptionIndex].focus();
  }
}

function updateP2Progress() {
  const answered = state.part2Questions.filter(q => state.answers[q.id] !== undefined).length;
  $('p2-progress').textContent = `Answered: ${answered} / ${state.part2Questions.length}`;
}

// ===== SUBMIT =====

async function submitTest(autoSubmit) {
  if (state.submitted) return;
  state.submitted = true;

  if (state.timerHandle) { clearTimeout(state.timerHandle); state.timerHandle = null; }
  window.removeEventListener('beforeunload', onBeforeUnload);

  try {
    const answerKey = await fetch('data/answers.json').then(r => r.json());
    const scores    = scoreSubmission(answerKey);

    if (APPS_SCRIPT_URL) {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ token: SUBMIT_TOKEN, studentInfo: state.studentInfo, scores }),
      });
    }
  } catch (err) {
    console.error('Submit error:', err);
  }

  clearState();
  showScreen('done');
}

// ===== INFO FORM =====

$('textbook-other-check').addEventListener('change', function () {
  $('textbook-other-text').disabled = !this.checked;
  if (this.checked) $('textbook-other-text').focus();
});
$('author-other-check').addEventListener('change', function () {
  $('author-other-text').disabled = !this.checked;
  if (this.checked) $('author-other-text').focus();
});

$('info-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('info-error');
  errEl.textContent = '';

  const firstName = $('firstName').value.trim();
  const lastName  = $('lastName').value.trim();
  const studentId = $('studentId').value.trim();
  const termsTaken = $('termsTaken').value;

  if (!firstName || !lastName || !studentId || !termsTaken) {
    errEl.textContent = 'Please fill in all required fields.';
    return;
  }

  const textbooks = [];
  document.querySelectorAll('input[name="textbook"]:checked').forEach(cb => {
    if (cb.value === '__other_textbook__') {
      const txt = $('textbook-other-text').value.trim();
      if (txt) textbooks.push('Other: ' + txt);
    } else {
      textbooks.push(cb.value);
    }
  });

  const authorsRead = [];
  document.querySelectorAll('input[name="author"]:checked').forEach(cb => {
    if (cb.value === '__other_author__') {
      const txt = $('author-other-text').value.trim();
      if (txt) authorsRead.push('Other: ' + txt);
    } else {
      authorsRead.push(cb.value);
    }
  });

  state.studentInfo = { firstName, lastName, studentId, termsTaken, textbooks, authorsRead };

  const submitBtn = e.submitter || document.querySelector('#info-form .btn-primary');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Loading…';

  try {
    state.questions      = await loadQuestions();
    state.part1Questions = state.questions.filter(q => q.part === 1);
    state.part2Questions = state.questions.filter(q => q.part === 2);
    state.optionOrder    = {};
    for (const q of state.questions) {
      state.optionOrder[q.id] = shuffle([...Array(q.options.length).keys()]);
    }
  } catch (err) {
    errEl.textContent = 'Could not load questions. Please check your connection and try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Begin Test →';
    return;
  }

  state.timerStart = Date.now();
  state.screen     = 'part1';
  state.p1Index    = 0;
  saveState();

  window.addEventListener('beforeunload', onBeforeUnload);
  startTimer(TIMER_MS);
  showScreen('interstitial1');
});

// ===== INTERSTITIAL BUTTONS =====
$('interstitial1-begin').addEventListener('click', () => { showScreen('part1'); renderP1(true); });
$('interstitial2-begin').addEventListener('click', startPart2);

// ===== BEFOREUNLOAD =====
function onBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
}

// ===== SESSION RESTORE =====
function tryRestoreSession() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) { return false; }
  if (!saved || !saved.timerStart || !saved.questions || !saved.studentInfo) return false;

  const elapsed = Date.now() - saved.timerStart;

  state.screen         = saved.screen || 'part1';
  state.studentInfo    = saved.studentInfo;
  state.questions      = saved.questions;
  state.part1Questions = saved.questions.filter(q => q.part === 1);
  state.part2Questions = saved.questions.filter(q => q.part === 2);
  state.answers        = saved.answers || {};
  state.optionOrder    = saved.optionOrder || {};
  state.p1Index        = saved.p1Index || 0;
  state.p2Index        = saved.p2Index || 0;
  state.timerStart     = saved.timerStart;

  if (elapsed >= TIMER_MS) {
    submitTest(true);
    return true;
  }

  startTimer(TIMER_MS - elapsed);
  window.addEventListener('beforeunload', onBeforeUnload);

  if (state.screen === 'part2') {
    showScreen('part2');
    renderP2(true);
  } else {
    showScreen('part1');
    const notice = $('p1-restore-notice');
    if (notice) { notice.hidden = false; setTimeout(() => { notice.hidden = true; }, 5000); }
    renderP1(true);
  }

  return true;
}

// ===== INIT =====
(function init() {
  if (DEV_MODE) $('dev-banner').hidden = false;
  if (!tryRestoreSession()) showScreen('info');
})();
