const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FORM_FILES = ['form-a.json', 'form-b.json', 'form-c.json'].map(name =>
  path.join(ROOT, 'docs', 'data', name)
);

const EXPECTED_SUBSCORES = {
  morphology_vocab: 16,
  sentence_meaning: 12,
  reading: 4,
  advanced_syntax: 8,
};

const PLACEMENT_RULES = {
  'LATN 325': {
    total: 31,
    gates: {
      reading: 3,
      advanced_syntax: 6,
      sentence_meaning: 8,
    },
  },
  'LATN 201': {
    total: 22,
    gates: {
      morphology_vocab: 9,
      reading_plus_sentence_meaning: 9,
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
      total: 16,
      subscores: { morphology_vocab: 6, sentence_meaning: 6, reading: 1, advanced_syntax: 3 },
      expected: 'LATN 110',
    },
    {
      label: 'borderline 110/201 stays 110',
      total: 21,
      subscores: { morphology_vocab: 9, sentence_meaning: 8, reading: 1, advanced_syntax: 3 },
      expected: 'LATN 110',
    },
    {
      label: 'clear 201',
      total: 24,
      subscores: { morphology_vocab: 10, sentence_meaning: 7, reading: 2, advanced_syntax: 5 },
      expected: 'LATN 201',
    },
    {
      label: 'borderline 201/325 stays 201',
      total: 30,
      subscores: { morphology_vocab: 12, sentence_meaning: 9, reading: 2, advanced_syntax: 7 },
      expected: 'LATN 201',
    },
    {
      label: 'clear 325',
      total: 33,
      subscores: { morphology_vocab: 12, sentence_meaning: 8, reading: 3, advanced_syntax: 6 },
      expected: 'LATN 325',
    },
  ];

  for (const fixture of fixtures) {
    const actual = determinePlacement(fixture.total, fixture.subscores);
    assert(actual === fixture.expected, `placement fixture failed: ${fixture.label}`);
  }
}

function validateForm(form) {
  assert(form.version === '2026-fixed-forms-v2', `${form.formId}: unexpected version`);
  assert(Array.isArray(form.passages) && form.passages.length === 1, `${form.formId}: expected 1 passage`);
  assert(Array.isArray(form.questions) && form.questions.length === 40, `${form.formId}: expected 40 questions`);

  const [passage] = form.passages;
  assert(passage.difficultyRole === 'upper-intermediate', `${form.formId}: passage should be upper-intermediate`);
  assert(wordCount(passage.text) >= 120, `${form.formId}: passage too short`);

  const part1 = form.questions.filter(q => q.part === 1);
  const part2 = form.questions.filter(q => q.part === 2);
  assert(part1.length === 24, `${form.formId}: part 1 should have 24 questions`);
  assert(part2.length === 16, `${form.formId}: part 2 should have 16 questions`);

  const typeCountsP1 = part1.reduce((acc, q) => {
    acc[q.type] = (acc[q.type] || 0) + 1;
    return acc;
  }, {});
  assert(typeCountsP1['morphology-in-context'] === 6, `${form.formId}: wrong morphology count`);
  assert((typeCountsP1['vocab-la-en'] || 0) + (typeCountsP1['vocab-en-la'] || 0) === 6, `${form.formId}: wrong vocab count`);
  assert(typeCountsP1['syntax-function'] === 4, `${form.formId}: wrong syntax-function count`);
  assert(typeCountsP1['sentence-meaning'] === 8, `${form.formId}: wrong sentence-meaning count in part 1`);
  assert(part1.every(q => q.countsToward === 'morphology_vocab' || q.countsToward === 'sentence_meaning'), `${form.formId}: unexpected part 1 bucket`);
  assert(form.questions.filter(q => q.maxSelections > 1).length === 0, `${form.formId}: expected no multi-select items`);

  const part2Passage = part2.filter(q => q.passageId);
  const part2Standalone = part2.filter(q => !q.passageId);
  assert(part2Passage.length === 4, `${form.formId}: expected 4 passage-based part 2 items`);
  assert(part2Standalone.length === 12, `${form.formId}: expected 12 standalone part 2 items`);
  assert(part2.slice(0, 12).every(q => !q.passageId), `${form.formId}: only final 4 part 2 questions should use the passage`);
  assert(part2.slice(12).every(q => q.passageId === passage.passageId), `${form.formId}: final 4 questions should share the same passage`);

  const typeCountsP2 = part2.reduce((acc, q) => {
    acc[q.type] = (acc[q.type] || 0) + 1;
    return acc;
  }, {});
  assert((typeCountsP2['syntax-id'] || 0) + (typeCountsP2['advanced-syntax'] || 0) === 8, `${form.formId}: wrong syntax/construction count in part 2`);
  assert(typeCountsP2['sentence-meaning'] === 4, `${form.formId}: wrong standalone sentence-meaning count in part 2`);
  assert(typeCountsP2.reading === 4, `${form.formId}: wrong reading count in part 2`);

  const badSequenceQuestions = form.questions.filter(q =>
    q.skill === 'infinitive-tense' ||
    /tense relationship/i.test(String(q.prompt || ''))
  );
  assert(badSequenceQuestions.length === 0, `${form.formId}: sequence-of-tenses item still present`);

  const countsToward = form.questions.reduce((acc, q) => {
    acc[q.countsToward] = (acc[q.countsToward] || 0) + 1;
    return acc;
  }, {});
  for (const [bucket, count] of Object.entries(EXPECTED_SUBSCORES)) {
    assert(countsToward[bucket] === count, `${form.formId}: wrong subscore count for ${bucket}`);
  }

  for (const question of form.questions) {
    assert(question.formId === form.formId, `${form.formId}: ${question.id} has mismatched formId`);
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
