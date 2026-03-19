'use strict';

const fs = require('fs');
const path = require('path');

const TSV_PATH = path.join(__dirname, 'data', 'results.tsv');

const BASE_HEADERS = [
  'timestamp',
  'first_name',
  'last_name',
  'student_id',
  'terms_taken',
  'textbooks',
  'authors',
  'part1_score',
  'part1_total',
  'part2_score',
  'part2_total',
  'raw_score',
  'experience_score',
  'total_score',
  'recommended_level',
];

function escapeTsv(value) {
  return String(value == null ? '' : value)
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ');
}

function buildHeaderRow(questionIds) {
  const qIdHeaders = questionIds.map((_, i) => `q${i + 1}_id`);
  const qAnsHeaders = questionIds.map((_, i) => `q${i + 1}_answer`);
  return [...BASE_HEADERS, ...qIdHeaders, ...qAnsHeaders].join('\t') + '\n';
}

function buildDataRow({ studentInfo, questionIds, answers, scores }) {
  const ts = new Date().toISOString();

  const textbooks = Array.isArray(studentInfo.textbooks)
    ? studentInfo.textbooks.join('; ')
    : String(studentInfo.textbooks || '');
  const authors = Array.isArray(studentInfo.authorsRead)
    ? studentInfo.authorsRead.join('; ')
    : String(studentInfo.authorsRead || '');

  const baseFields = [
    ts,
    escapeTsv(studentInfo.firstName),
    escapeTsv(studentInfo.lastName),
    escapeTsv(studentInfo.studentId),
    escapeTsv(studentInfo.termsTaken),
    escapeTsv(textbooks),
    escapeTsv(authors),
    scores.part1Score,
    scores.part1Total,
    scores.part2Score,
    scores.part2Total,
    scores.rawScore,
    scores.experienceScore,
    scores.totalScore,
    escapeTsv(scores.recommendedLevel),
  ];

  const qIdFields = questionIds.map(id => escapeTsv(id));
  const qAnsFields = questionIds.map(id => {
    const ans = answers[id];
    return ans !== undefined && ans !== null ? String(ans) : '';
  });

  return [...baseFields, ...qIdFields, ...qAnsFields].join('\t') + '\n';
}

async function appendResult({ studentInfo, questionIds, answers, scores }) {
  const dataRow = buildDataRow({ studentInfo, questionIds, answers, scores });

  try {
    await fs.promises.access(TSV_PATH);
    await fs.promises.appendFile(TSV_PATH, dataRow, 'utf8');
  } catch {
    // File doesn't exist yet — write with header
    const header = buildHeaderRow(questionIds);
    await fs.promises.writeFile(TSV_PATH, header + dataRow, 'utf8');
  }
}

module.exports = { appendResult };
