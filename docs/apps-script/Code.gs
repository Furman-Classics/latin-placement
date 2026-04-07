const SUBMIT_TOKEN = 'placent-2026';
const SHEET_NAME = 'Results';
const HEADERS = [
  'YYYYMMDD taken',
  'ID',
  'Last',
  'First',
  'Score',
  'Score part 1',
  'Score part 2',
  'Expected placement',
  'Time to complete in minutes',
  'Vocab eval',
  'Grammar eval',
  'Topics',
  'Terms of Latin',
  'Textbook',
  'Authors',
];

function ensureHeaders_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(HEADERS);
    return;
  }

  const existing = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const needsUpdate = HEADERS.some((value, index) => existing[index] !== value);
  if (needsUpdate) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');

    if (payload.token !== SUBMIT_TOKEN) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'bad token' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw new Error(`Sheet not found: ${SHEET_NAME}`);
    }
    ensureHeaders_(sheet);

    const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/New_York';
    const info = payload.studentInfo || {};
    const selfEval = payload.selfEval || {};
    const scores = payload.scores || {};
    const timing = payload.timing || {};

    const row = [
      Utilities.formatDate(new Date(), tz, 'yyyyMMdd'),
      info.studentId || '',
      info.lastName || '',
      info.firstName || '',
      scores.total || 0,
      scores.part1 || 0,
      scores.part2 || 0,
      selfEval.expectedPlacement || '',
      timing.timeTakenMin || '',
      selfEval.vocabEval || '',
      selfEval.grammarEval || '',
      (selfEval.topicsConfidence || []).join(', '),
      info.termsTaken || '',
      (info.textbooks || []).join(', '),
      (info.authorsRead || []).join(', '),
    ];

    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
