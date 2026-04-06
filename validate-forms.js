const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FORM_FILE = path.join(ROOT, 'docs', 'data', 'form.json');

const PLACEMENT_RULES = {
  'LATN 325': { totalMin: 32, p1Min: 14, p2Min: 11, p3Min: 7 },
  'LATN 201': { totalMin: 20, p1Min: 11, p2Min: 7 },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadForm(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function wordCount(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[underline:\s*[^\]]+\]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function determinePlacement(totalScore, p1Score, p2Score, p3Score) {
  const r325 = PLACEMENT_RULES['LATN 325'];
  if (
    totalScore >= r325.totalMin &&
    p1Score >= r325.p1Min &&
    p2Score >= r325.p2Min &&
    p3Score >= r325.p3Min
  ) {
    return 'LATN 325';
  }
  const r201 = PLACEMENT_RULES['LATN 201'];
  if (
    totalScore >= r201.totalMin &&
    p1Score >= r201.p1Min &&
    p2Score >= r201.p2Min
  ) {
    return 'LATN 201';
  }
  return 'LATN 110';
}

function validatePlacementFixtures() {
  const fixtures = [
    {
      label: 'clear 110',
      total: 10, p1: 5, p2: 3, p3: 2,
      expected: 'LATN 110',
    },
    {
      label: 'borderline 110/201 stays 110 (vocab gate)',
      total: 22, p1: 10, p2: 7, p3: 5,
      expected: 'LATN 110',
    },
    {
      label: 'clear 201',
      total: 24, p1: 12, p2: 8, p3: 4,
      expected: 'LATN 201',
    },
    {
      label: 'borderline 201/325 stays 201 (reading gate)',
      total: 34, p1: 14, p2: 13, p3: 6,
      expected: 'LATN 201',
    },
    {
      label: 'clear 325',
      total: 35, p1: 15, p2: 12, p3: 8,
      expected: 'LATN 325',
    },
  ];

  for (const fixture of fixtures) {
    const actual = determinePlacement(fixture.total, fixture.p1, fixture.p2, fixture.p3);
    assert(actual === fixture.expected, `placement fixture failed: ${fixture.label} (got ${actual})`);
  }
}

function validateForm(form) {
  assert(form.version === '2026-3part-v1', `unexpected version: ${form.version}`);
  assert(Array.isArray(form.passages) && form.passages.length === 1, 'expected exactly 1 passage');
  assert(Array.isArray(form.questions) && form.questions.length === 45, `expected 45 questions, got ${form.questions.length}`);

  const [passage] = form.passages;
  assert(passage.passageId, 'passage must have a passageId');
  assert(passage.usedInPart === 3, 'passage must be used in part 3');
  assert(wordCount(passage.text) >= 120, `passage too short (${wordCount(passage.text)} words)`);

  const part1 = form.questions.filter(q => q.part === 1);
  const part2 = form.questions.filter(q => q.part === 2);
  const part3 = form.questions.filter(q => q.part === 3);
  assert(part1.length === 20, `part 1 should have 20 questions, got ${part1.length}`);
  assert(part2.length === 15, `part 2 should have 15 questions, got ${part2.length}`);
  assert(part3.length === 10, `part 3 should have 10 questions, got ${part3.length}`);

  // Part 1: all vocab types
  const p1Types = part1.map(q => q.type);
  assert(p1Types.every(t => t === 'vocab-la-en' || t === 'vocab-en-la'), 'part 1 should have only vocab question types');

  // Part 2: multi-select questions have correctIndices.length >= 2
  const p2Multi = part2.filter(q => (q.maxSelections || 1) > 1);
  for (const q of p2Multi) {
    const indices = Array.isArray(q.correctIndices) ? q.correctIndices : [];
    assert(indices.length >= 2, `multi-select question ${q.id} should have >= 2 correct indices`);
    assert(indices.length === q.maxSelections, `multi-select question ${q.id}: correctIndices.length must equal maxSelections`);
  }

  // Part 3: all questions reference the passage
  assert(
    part3.every(q => q.passageId === passage.passageId),
    `all part 3 questions must reference passage ${passage.passageId}`
  );

  // Per-question validation
  const ids = new Set();
  for (const question of form.questions) {
    assert(question.id, `question missing id`);
    assert(!ids.has(question.id), `duplicate question id: ${question.id}`);
    ids.add(question.id);
    assert(Array.isArray(question.options) && question.options.length >= 4, `${question.id}: must have at least 4 options`);

    const correctIndices = Array.isArray(question.correctIndices)
      ? question.correctIndices.map(Number)
      : [Number(question.correct)];
    assert(correctIndices.length >= 1, `${question.id}: missing correct indices`);

    const minSel = Number(question.minSelections || 1);
    const maxSel = Number(question.maxSelections || 1);
    assert(minSel >= 1 && maxSel >= minSel, `${question.id}: invalid selection bounds (min=${minSel}, max=${maxSel})`);

    for (const idx of correctIndices) {
      assert(
        Number.isInteger(idx) && idx >= 0 && idx < question.options.length,
        `${question.id}: invalid correct index ${idx}`
      );
    }

    if (maxSel === 1) {
      assert(correctIndices.length === 1, `${question.id}: single-select must have exactly 1 correct answer`);
    } else {
      assert(correctIndices.length === maxSel, `${question.id}: multi-select correctIndices.length must equal maxSelections`);
    }
  }
}

function main() {
  const form = loadForm(FORM_FILE);
  validateForm(form);
  validatePlacementFixtures();
  console.log('Validated form.json and placement fixtures. All checks passed.');
}

main();
