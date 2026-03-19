require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { scoreSubmission } = require('./scoring');
const { appendResult } = require('./tsv');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/font', express.static(path.join(__dirname, 'font')));
app.use(express.json({ limit: '100kb' }));

// Log requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Load question banks once at startup
const part1Bank = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'questions-part1.json'), 'utf8'));
const part2Bank = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'questions-part2.json'), 'utf8'));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

// GET /api/questions — returns 60 questions with `correct` stripped
app.get('/api/questions', (req, res) => {
  const p1 = stratifiedSample(part1Bank, 14, 13, 8);
  const p2 = stratifiedSample(part2Bank, 10, 9, 6);
  const combined = shuffle([...p1, ...p2]);
  const client = combined.map(({ correct, ...rest }) => rest); // strip answer
  res.json({ questions: client });
});

// POST /api/submit
app.post('/api/submit', async (req, res) => {
  const { studentInfo, questionIds, answers } = req.body;
  if (!studentInfo || !questionIds || !answers) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Build a lookup map from both banks
  const allQuestions = {};
  for (const q of [...part1Bank, ...part2Bank]) allQuestions[q.id] = q;

  const scores = scoreSubmission({ questionIds, answers, studentInfo, allQuestions });

  try {
    await appendResult({ studentInfo, questionIds, answers, scores });
  } catch (err) {
    console.error('TSV write error:', err);
    // Don't fail the submission — still return success to the student
  }

  res.json({ success: true });
});

// GET /api/review?key=SECRET — full question bank with correct answers (for review tool)
app.get('/api/review', (req, res) => {
  if (req.query.key !== process.env.RESULTS_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({ questions: [...part1Bank, ...part2Bank] });
});

// GET /results?key=SECRET — download TSV
app.get('/results', (req, res) => {
  if (req.query.key !== process.env.RESULTS_KEY) {
    return res.status(403).send('Forbidden');
  }
  const filePath = path.join(__dirname, 'data', 'results.tsv');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('No results yet.');
  }
  res.download(filePath, 'latin-placement-results.tsv');
});

app.listen(PORT, () => {
  console.log(`placent running at http://localhost:${PORT}`);
  console.log(`Results: http://localhost:${PORT}/results?key=${process.env.RESULTS_KEY}`);
});
