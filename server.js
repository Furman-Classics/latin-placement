'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const ROOT = __dirname;
const DOCS_DIR = path.join(ROOT, 'docs');
const FORM_FILES = ['form-a.json', 'form-b.json', 'form-c.json'].map(name =>
  path.join(DOCS_DIR, 'data', name)
);
const RESULTS_KEY = process.env.RESULTS_KEY || '';
const PORT = Number(process.env.PORT || 3000);

function loadForms() {
  return FORM_FILES.map(filename => JSON.parse(fs.readFileSync(filename, 'utf8')));
}

app.use(express.static(DOCS_DIR));

app.get('/api/review', (req, res) => {
  const key = String(req.query.key || '');
  if (!RESULTS_KEY || key !== RESULTS_KEY) {
    return res.status(403).json({ ok: false, error: 'bad key' });
  }

  try {
    const forms = loadForms();
    return res.json({ ok: true, forms });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(DOCS_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Placent server listening on http://localhost:${PORT}`);
});
