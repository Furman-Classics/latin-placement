'use strict';

/**
 * Score a submission and produce a placement recommendation.
 *
 * @param {object} opts
 * @param {string[]} opts.questionIds  - ordered array of IDs the student received
 * @param {object}  opts.answers       - { questionId: answerIndex (0-3) }
 * @param {object}  opts.studentInfo   - Part 0 data
 * @param {object}  opts.allQuestions  - Map/plain object: id → full question (with `correct`)
 * @returns {object} scores
 */
function scoreSubmission({ questionIds, answers, studentInfo, allQuestions }) {
  let part1Score = 0, part1Total = 0;
  let part2Score = 0, part2Total = 0;

  for (const id of questionIds) {
    const q = allQuestions[id];
    if (!q) continue;
    const userAnswer = answers[id];
    const isCorrect = userAnswer !== undefined && userAnswer !== null && Number(userAnswer) === q.correct;

    if (q.part === 1) {
      part1Total++;
      if (isCorrect) part1Score++;
    } else if (q.part === 2) {
      part2Total++;
      if (isCorrect) part2Score++;
    }
  }

  const rawScore = part1Score + part2Score;
  const experienceScore = calcExperienceScore(studentInfo);
  const totalScore = rawScore + experienceScore;
  const recommendedLevel = recommendLevel(rawScore, totalScore);

  return {
    part1Score,
    part1Total,
    part2Score,
    part2Total,
    rawScore,
    experienceScore,
    totalScore,
    recommendedLevel,
  };
}

/**
 * Calculate experience score (0–5) from Part 0 data.
 */
function calcExperienceScore(studentInfo) {
  let score = 0;

  // Terms taken
  const raw = String(studentInfo.termsTaken || '0');
  const terms = raw === '8+' ? 8 : parseInt(raw, 10) || 0;

  if (terms >= 7)      score += 3;
  else if (terms >= 5) score += 2;
  else if (terms >= 3) score += 1;
  // 1-2 → 0

  // Authors read (exclude 'None' and 'Other' entries)
  const authors = Array.isArray(studentInfo.authorsRead) ? studentInfo.authorsRead : [];
  const meaningfulAuthors = authors.filter(a => a !== 'None' && !a.startsWith('Other'));
  const authorCount = meaningfulAuthors.length;

  if (authorCount >= 2)     score += 2;
  else if (authorCount >= 1) score += 1;
  // 0 → 0

  return Math.min(score, 5);
}

/**
 * Recommend a placement level.
 */
function recommendLevel(rawScore, totalScore) {
  if (rawScore < 15) return 'LATN 110';
  if (totalScore < 28) return 'LATN 110';
  if (totalScore < 48) return 'LATN 201';
  return 'LATN 325';
}

module.exports = { scoreSubmission };
