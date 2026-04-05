const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FORM_FILES = ['form-a.json', 'form-b.json', 'form-c.json'].map(name =>
  path.join(ROOT, 'docs', 'data', name)
);

const EXPECTED_PASSAGES = {
  aeneid: 'intermediate',
  pliny: 'intermediate-high',
  agrippina: 'upper-intermediate',
};

const EXPECTED_SUBSCORES = {
  morphology_vocab: 14,
  sentence_meaning: 10,
  reading: 12,
  advanced_syntax: 8,
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadForm(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function wordCount(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
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

function validatePlacementFixtures() {
  const fixtures = [
    {
      label: 'clear 110',
      total: 18,
      subscores: { morphology_vocab: 7, sentence_meaning: 4, reading: 5, advanced_syntax: 2 },
      expected: 'LATN 110',
    },
    {
      label: 'borderline 110/201 stays 110',
      total: 23,
      subscores: { morphology_vocab: 8, sentence_meaning: 5, reading: 7, advanced_syntax: 2 },
      expected: 'LATN 110',
    },
    {
      label: 'clear 201',
      total: 27,
      subscores: { morphology_vocab: 9, sentence_meaning: 6, reading: 7, advanced_syntax: 5 },
      expected: 'LATN 201',
    },
    {
      label: 'borderline 201/325 stays 201',
      total: 33,
      subscores: { morphology_vocab: 12, sentence_meaning: 7, reading: 8, advanced_syntax: 6 },
      expected: 'LATN 201',
    },
    {
      label: 'clear 325',
      total: 37,
      subscores: { morphology_vocab: 13, sentence_meaning: 8, reading: 10, advanced_syntax: 6 },
      expected: 'LATN 325',
    },
  ];

  for (const fixture of fixtures) {
    const actual = determinePlacement(fixture.total, fixture.subscores);
    assert(actual === fixture.expected, `placement fixture failed: ${fixture.label}`);
  }
}

function validateForm(form) {
  assert(form.version === '2026-fixed-forms-v1', `${form.formId}: unexpected version`);
  assert(Array.isArray(form.passages) && form.passages.length === 3, `${form.formId}: expected 3 passages`);
  assert(Array.isArray(form.questions) && form.questions.length === 44, `${form.formId}: expected 44 questions`);

  const themeMap = Object.fromEntries(form.passages.map(p => [p.theme, p]));
  for (const [theme, difficultyRole] of Object.entries(EXPECTED_PASSAGES)) {
    assert(themeMap[theme], `${form.formId}: missing ${theme} passage`);
    assert(themeMap[theme].difficultyRole === difficultyRole, `${form.formId}: wrong difficulty for ${theme}`);
    const words = wordCount(themeMap[theme].text);
    if (theme === 'agrippina') {
      assert(words >= 120, `${form.formId}: agrippina passage too short (${words} words)`);
    } else {
      assert(words >= 110, `${form.formId}: ${theme} passage too short (${words} words)`);
    }
  }

  const part1 = form.questions.filter(q => q.part === 1);
  const part2 = form.questions.filter(q => q.part === 2);
  assert(part1.length === 22, `${form.formId}: part 1 should have 22 questions`);
  assert(part2.length === 22, `${form.formId}: part 2 should have 22 questions`);

  const typeCountsP1 = part1.reduce((acc, q) => {
    acc[q.type] = (acc[q.type] || 0) + 1;
    return acc;
  }, {});
  assert(typeCountsP1['morphology-in-context'] === 6, `${form.formId}: wrong morphology count`);
  assert(typeCountsP1['vocab-in-context'] === 4, `${form.formId}: wrong vocab count`);
  assert(typeCountsP1['syntax-function'] === 4, `${form.formId}: wrong syntax-function count`);
  assert(typeCountsP1['sentence-meaning'] === 8, `${form.formId}: wrong sentence-meaning count in part 1`);
  const p1Multi = part1.filter(q => q.maxSelections > 1);
  assert(p1Multi.length === 2, `${form.formId}: expected 2 multi-select items in part 1`);
  assert(form.questions.filter(q => q.maxSelections > 1).length === 2, `${form.formId}: expected 2 multi-select items overall`);

  const part2Passage = part2.filter(q => q.passageId);
  const part2Standalone = part2.filter(q => !q.passageId);
  assert(part2Passage.length === 16, `${form.formId}: expected 16 passage-based part 2 items`);
  assert(part2Standalone.length === 6, `${form.formId}: expected 6 standalone part 2 items`);

  const passagesUsed = new Set(part2Passage.map(q => q.passageId));
  assert(passagesUsed.size === 3, `${form.formId}: expected questions on all 3 passages`);

  const pureLabelCount = part2.filter(q => q.pureLabel).length;
  assert(pureLabelCount <= 4, `${form.formId}: too many pure label questions`);

  const impersonal = form.questions.filter(q => Array.isArray(q.topicTags) && q.topicTags.includes('impersonal-construction'));
  assert(impersonal.length === 2, `${form.formId}: expected exactly 2 impersonal-construction items`);
  assert(impersonal.some(q => q.passageId), `${form.formId}: expected at least 1 passage-based impersonal item`);

  const passageThemeCounts = {
    aeneid: part2Passage.filter(q => q.passageId === form.passages.find(p => p.theme === 'aeneid').passageId).length,
    pliny: part2Passage.filter(q => q.passageId === form.passages.find(p => p.theme === 'pliny').passageId).length,
    agrippina: part2Passage.filter(q => q.passageId === form.passages.find(p => p.theme === 'agrippina').passageId).length,
  };
  assert(passageThemeCounts.aeneid === 5, `${form.formId}: aeneid should have 5 questions`);
  assert(passageThemeCounts.pliny === 5, `${form.formId}: pliny should have 5 questions`);
  assert(passageThemeCounts.agrippina === 6, `${form.formId}: agrippina should have 6 questions`);

  const countsToward = form.questions.reduce((acc, q) => {
    acc[q.countsToward] = (acc[q.countsToward] || 0) + 1;
    return acc;
  }, {});
  for (const [bucket, count] of Object.entries(EXPECTED_SUBSCORES)) {
    assert(countsToward[bucket] === count, `${form.formId}: wrong subscore count for ${bucket}`);
  }

  for (const question of form.questions) {
    assert(Array.isArray(question.options) && question.options.length >= 4, `${form.formId}: ${question.id} must have at least 4 options`);
    assert(Array.isArray(question.correctIndices) && question.correctIndices.length >= 1, `${form.formId}: ${question.id} missing correct indices`);
    assert(question.minSelections >= 1 && question.maxSelections >= question.minSelections, `${form.formId}: ${question.id} has invalid selection bounds`);
    for (const idx of question.correctIndices) {
      assert(Number.isInteger(idx) && idx >= 0 && idx < question.options.length, `${form.formId}: ${question.id} has invalid correct index`);
    }
    if (question.maxSelections === 1) {
      assert(question.correctIndices.length === 1, `${form.formId}: ${question.id} single-select must have one correct answer`);
    } else {
      assert(question.correctIndices.length === question.maxSelections, `${form.formId}: ${question.id} multi-select must match max selections`);
    }
  }
}

function main() {
  const forms = FORM_FILES.map(loadForm);
  forms.forEach(validateForm);
  validatePlacementFixtures();
  console.log(`Validated ${forms.length} forms and placement fixtures.`);
}

main();
