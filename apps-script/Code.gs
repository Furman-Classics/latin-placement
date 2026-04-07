const SUBMIT_TOKEN = 'placent-2026';
const SHEET_NAME = 'Results';

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

    const info = payload.studentInfo || {};
    const scores = payload.scores || {};
    const timing = payload.timing || {};

    const row = [
      new Date(),                                      // submitted_at
      info.studentId || '',                            // student_id
      info.lastName || '',                             // last_name
      info.firstName || '',                            // first_name
      payload.totalScore || 0,                         // total_score
      payload.placement || '',                         // suggested_placement
      payload.bumpUpDown || 'neither',                 // bump_up_down
      info.termsTaken || '',                           // terms_taken
      (info.textbooks || []).join(', '),               // textbooks (comma list)
      (info.authorsRead || []).join(', '),             // authors_read (comma list)
      scores.part1 || 0,                               // part1_score/20
      scores.part2 || 0,                               // part2_score/20
      scores.part3 || 0,                               // part3_score/12
      payload.version || '',                           // version
      timing.timeTakenMin || '',                       // time_taken_min
      Boolean(timing.autoSubmitted),                   // auto_submitted
      timing.startedAtMs || '',                        // started_at_ms
      timing.submittedAtMs || '',                      // submitted_at_ms
      JSON.stringify(payload.answers || {}),           // answers_json
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
