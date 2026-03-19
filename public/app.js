'use strict';

const STORAGE_KEY = 'placent_session';
const TIMER_MS = 45 * 60 * 1000; // 45 minutes

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
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderHTML(raw) {
  // Replace [underline: word] with a highlighted span (colored border-bottom)
  return raw.replace(/\[underline:\s*([^\]]+)\]/g, '<span class="hl">$1</span>');
}

function showScreen(name) {
  const ids = ['screen-info', 'screen-part1', 'screen-part2', 'screen-done'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (id === 'screen-' + name) {
      el.hidden = false;
    } else {
      el.hidden = true;
    }
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
  } catch (_) { /* storage full or private — ignore */ }
}

function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

// ===== TIMER =====

function startTimer(remainingMs) {
  if (state.timerHandle) clearTimeout(state.timerHandle);
  state.timerHandle = setTimeout(() => {
    if (!state.submitted) submitTest(true);
  }, remainingMs);
}

// ===== RENDER PART 1 =====

function renderP1() {
  const qs = state.part1Questions;
  const i = state.p1Index;
  const q = qs[i];

  $('p1-counter').textContent = `Question ${i + 1} of ${qs.length}`;
  $('p1-prompt').innerHTML = renderHTML(q.prompt);

  const opts = $('p1-options');
  opts.innerHTML = '';
  const order1 = state.optionOrder[q.id];
  for (let di = 0; di < order1.length; di++) {
    const j = order1[di];
    const btn = document.createElement('button');
    btn.className = 'option-btn' + (state.answers[q.id] === j ? ' selected' : '');
    btn.innerHTML = renderHTML(q.options[j]);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', state.answers[q.id] === j ? 'true' : 'false');
    btn.dataset.idx = j;
    btn.addEventListener('click', () => {
      state.answers[q.id] = j;
      saveState();
      renderP1();
    });
    opts.appendChild(btn);
  }

  $('p1-prev').disabled = (i === 0);
  const isLast = (i === qs.length - 1);
  const nextBtn = $('p1-next');
  nextBtn.textContent = isLast ? 'Continue to Part 2 →' : 'Next →';
  nextBtn.onclick = isLast ? goToPart2 : () => { state.p1Index++; renderP1(); saveState(); };
  $('p1-prev').onclick = () => { state.p1Index--; renderP1(); saveState(); };

  updateP1Progress();
}

function updateP1Progress() {
  const answered = state.part1Questions.filter(q => state.answers[q.id] !== undefined).length;
  $('p1-progress').textContent = `Answered: ${answered} / ${state.part1Questions.length}`;
}

function goToPart2() {
  state.screen = 'part2';
  state.p2Index = 0;
  saveState();
  showScreen('part2');
  renderP2();
}

// ===== RENDER PART 2 =====

function renderP2() {
  const qs = state.part2Questions;
  const i = state.p2Index;
  const q = qs[i];

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

  const opts = $('p2-options');
  opts.innerHTML = '';
  const order2 = state.optionOrder[q.id];
  for (let di = 0; di < order2.length; di++) {
    const j = order2[di];
    const btn = document.createElement('button');
    btn.className = 'option-btn' + (state.answers[q.id] === j ? ' selected' : '');
    btn.innerHTML = renderHTML(q.options[j]);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', state.answers[q.id] === j ? 'true' : 'false');
    btn.dataset.idx = j;
    btn.addEventListener('click', () => {
      state.answers[q.id] = j;
      saveState();
      renderP2();
    });
    opts.appendChild(btn);
  }

  $('p2-prev').disabled = (i === 0);
  const isLast = (i === qs.length - 1);
  const nextBtn = $('p2-next');
  nextBtn.textContent = isLast ? 'Submit Test' : 'Next →';
  nextBtn.onclick = isLast ? confirmSubmit : () => { state.p2Index++; renderP2(); saveState(); };
  $('p2-prev').onclick = () => { state.p2Index--; renderP2(); saveState(); };

  updateP2Progress();
}

function updateP2Progress() {
  const answered = state.part2Questions.filter(q => state.answers[q.id] !== undefined).length;
  $('p2-progress').textContent = `Answered: ${answered} / ${state.part2Questions.length}`;
}

// ===== SUBMIT =====

function confirmSubmit() {
  const total = state.questions.length;
  const answered = Object.keys(state.answers).length;
  const unanswered = total - answered;

  $('modal-body').textContent = unanswered > 0
    ? `You have answered ${answered} of ${total} questions (${unanswered} unanswered). Submit now?`
    : `You have answered all ${total} questions. Submit now?`;

  $('modal-overlay').hidden = false;
  $('modal-confirm').focus();
}

$('modal-cancel').addEventListener('click', () => {
  $('modal-overlay').hidden = true;
});
$('modal-confirm').addEventListener('click', () => {
  $('modal-overlay').hidden = true;
  submitTest(false);
});
$('modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('modal-overlay')) $('modal-overlay').hidden = true;
});

async function submitTest(autoSubmit) {
  if (state.submitted) return;
  state.submitted = true;

  // Clear timer
  if (state.timerHandle) { clearTimeout(state.timerHandle); state.timerHandle = null; }
  // Remove beforeunload warning
  window.removeEventListener('beforeunload', onBeforeUnload);

  const questionIds = state.questions.map(q => q.id);

  try {
    await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentInfo: state.studentInfo,
        questionIds,
        answers: state.answers,
      }),
    });
  } catch (err) {
    // Network failure: keep going, show done screen
    console.error('Submit error:', err);
  }

  clearState();
  showScreen('done');
}

// ===== INFO FORM =====

// Toggle "Other" text inputs
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
  const lastName = $('lastName').value.trim();
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
    const resp = await fetch('/api/questions');
    if (!resp.ok) throw new Error('Server error');
    const data = await resp.json();
    state.questions = data.questions;
    state.part1Questions = data.questions.filter(q => q.part === 1);
    state.part2Questions = data.questions.filter(q => q.part === 2);
    state.optionOrder = {};
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
  state.screen = 'part1';
  state.p1Index = 0;
  saveState();

  window.addEventListener('beforeunload', onBeforeUnload);
  startTimer(TIMER_MS);
  showScreen('part1');
  renderP1();
});

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

  if (elapsed >= TIMER_MS) {
    // Time has expired while offline — restore state and auto-submit
    state.screen = saved.screen || 'part1';
    state.studentInfo = saved.studentInfo;
    state.questions = saved.questions;
    state.part1Questions = saved.questions.filter(q => q.part === 1);
    state.part2Questions = saved.questions.filter(q => q.part === 2);
    state.answers = saved.answers || {};
    state.optionOrder = saved.optionOrder || {};
    state.p1Index = saved.p1Index || 0;
    state.p2Index = saved.p2Index || 0;
    state.timerStart = saved.timerStart;
    submitTest(true);
    return true;
  }

  // Restore normally
  state.screen = saved.screen || 'part1';
  state.studentInfo = saved.studentInfo;
  state.questions = saved.questions;
  state.part1Questions = saved.questions.filter(q => q.part === 1);
  state.part2Questions = saved.questions.filter(q => q.part === 2);
  state.answers = saved.answers || {};
  state.optionOrder = saved.optionOrder || {};
  state.p1Index = saved.p1Index || 0;
  state.p2Index = saved.p2Index || 0;
  state.timerStart = saved.timerStart;

  startTimer(TIMER_MS - elapsed);
  window.addEventListener('beforeunload', onBeforeUnload);

  if (state.screen === 'part2') {
    showScreen('part2');
    renderP2();
    $('p2-restore-notice') && (() => {})(); // part2 doesn't have a restore notice element; show on part1 screen if needed
  } else {
    showScreen('part1');
    // Show restore notice on part1 only (part2 doesn't need it since user navigated there)
    const notice = $('p1-restore-notice');
    if (notice) {
      notice.hidden = false;
      setTimeout(() => { notice.hidden = true; }, 5000);
    }
    renderP1();
  }

  return true;
}

// ===== INIT =====
(function init() {
  if (!tryRestoreSession()) {
    showScreen('info');
  }
})();
