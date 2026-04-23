// ============================================================
// CONFIG — Edit these values before running the script
// ============================================================
var CONFIG = {
  // ID of the "Raw Meet Artifacts" Drive folder
  // Find it in the Drive URL: drive.google.com/drive/folders/FOLDER_ID
  INBOX_FOLDER_ID: 'REPLACE_WITH_RAW_MEET_ARTIFACTS_FOLDER_ID',

  // ID of the founder command-center Google Sheet (same sheet as Fireflies system)
  // Find it in the Sheet URL: docs.google.com/spreadsheets/d/SHEET_ID/edit
  SPREADSHEET_ID: 'REPLACE_WITH_YOUR_SPREADSHEET_ID',

  // OpenAI API key for Hive Mind analysis
  OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OPENAI_API_KEY',

  // OpenAI model — gpt-4o-mini is fast and cheap; gpt-4o is more accurate
  OPENAI_MODEL: 'gpt-4o-mini',

  // Sheet tab names — must match what exists in your spreadsheet
  TAB_MASTER:    'Master Action Board',
  TAB_PROCESSED: 'Processed Sources',
  TAB_SYNC_LOG:  'Sync Log',

  // How far back to look when the 15-minute sync trigger runs (minutes)
  LOOKBACK_MINUTES: 60,

  // How many days back to scan during a one-time backfill
  BACKFILL_DAYS: 7,

  // Title fragments that identify a doc as a Meet artifact
  // Add your own patterns if Gemini/Meet uses different naming in your Workspace
  MEET_TITLE_PATTERNS: ['Notes by Gemini', 'Meeting transcript', 'Meet transcript']
};

// ============================================================
// MASTER_COLS — Column indexes for the 16-column Master Action Board
// Must match lib/sheetSchema.js in the Fireflies Node.js system
// ============================================================
var MASTER_COLS = {
  TASK_ID:       0,  // A
  TASK:          1,  // B
  OWNER:         2,  // C
  STATUS:        3,  // D
  URGENCY:       4,  // E
  DUE_DATE:      5,  // F
  NEXT_STEP:     6,  // G
  BLOCKERS:      7,  // H
  DEPENDENCIES:  8,  // I
  OKR_LINK:      9,  // J
  RISK_FLAG:    10,  // K
  SOURCE_ID:    11,  // L — source_transcript_id (we store Drive file ID here)
  MEETING_TITLE:12,  // M
  MEETING_DATE: 13,  // N
  CREATED_AT:   14,  // O
  UPDATED_AT:   15   // P
};

// ============================================================
// SYNC LOG — Audit trail for every pipeline action
// ============================================================

/**
 * Append one row to the Sync Log tab.
 * Auto-creates the tab with headers if it does not exist.
 */
function logSyncActivity(step, fileId, fileName, message) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_SYNC_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.TAB_SYNC_LOG);
    sheet.appendRow(['timestamp', 'step', 'source_file_id', 'source_file_name', 'message']);
  }
  sheet.appendRow([
    new Date().toISOString(),
    step       || '',
    fileId     || '',
    fileName   || '',
    message    || ''
  ]);
}

// ============================================================
// PROCESSED SOURCES — Idempotency log
// Columns: source_event_id(A), source_file_id(B), source_file_name(C),
//          source_type(D), meeting_date(E), meeting_title(F),
//          copied_to_inbox_at(G), processed_at(H), status(I)
// ============================================================

/**
 * Ensure Processed Sources tab exists with the correct header row.
 */
function ensureProcessedHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'source_event_id', 'source_file_id', 'source_file_name', 'source_type',
      'meeting_date', 'meeting_title', 'copied_to_inbox_at', 'processed_at', 'status'
    ]);
  }
}

/**
 * Return all data rows from Processed Sources (header row excluded).
 */
function getProcessedSourcesRows() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_PROCESSED);
  if (!sheet) return [];
  ensureProcessedHeaders(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, 9).getValues();
}

/**
 * Returns true if fileId OR eventId already appears in Processed Sources.
 * Called BEFORE copying or processing any file.
 */
function isAlreadyProcessed(fileId, eventId) {
  var rows = getProcessedSourcesRows();
  return rows.some(function(row) {
    var rowFileId  = String(row[1] || '');
    var rowEventId = String(row[0] || '');
    return (fileId  && rowFileId  === fileId)  ||
           (eventId && eventId !== '' && rowEventId === eventId);
  });
}

/**
 * Returns true if fileId has a row in Processed Sources with the given status.
 */
function isProcessedStatus(fileId, status) {
  var rows = getProcessedSourcesRows();
  return rows.some(function(row) {
    return String(row[1]) === fileId && String(row[8]) === status;
  });
}

/**
 * Return the metadata object for a given fileId, or null if not found.
 */
function getSourceMetadata(fileId) {
  var rows = getProcessedSourcesRows();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) === fileId) {
      return {
        source_event_id: rows[i][0],
        source_file_id:  rows[i][1],
        source_file_name:rows[i][2],
        source_type:     rows[i][3],
        meeting_date:    rows[i][4],
        meeting_title:   rows[i][5]
      };
    }
  }
  return null;
}

/**
 * Append a new row to Processed Sources.
 * status is 'copied' when a file is first moved to the inbox,
 * then updated to 'processed' after Hive Mind writes to the board.
 */
function logProcessedSource(eventId, fileId, fileName, sourceType, meetingDate, meetingTitle, status) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_PROCESSED);
  if (!sheet) sheet = ss.insertSheet(CONFIG.TAB_PROCESSED);
  ensureProcessedHeaders(sheet);

  var now = new Date().toISOString();
  sheet.appendRow([
    eventId      || '',                          // A source_event_id
    fileId       || '',                          // B source_file_id
    fileName     || '',                          // C source_file_name
    sourceType   || '',                          // D source_type
    meetingDate  || '',                          // E meeting_date
    meetingTitle || '',                          // F meeting_title
    status === 'copied'    ? now : '',           // G copied_to_inbox_at
    status === 'processed' ? now : '',           // H processed_at
    status       || ''                           // I status
  ]);
}

/**
 * Update the status (and processed_at) of an existing row in Processed Sources.
 * If no row matches, does nothing (logProcessedSource handles inserts).
 */
function updateProcessedStatus(fileId, newStatus) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_PROCESSED);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]) === fileId) {
      var sheetRow = i + 2; // +1 for header, +1 for 1-based indexing
      sheet.getRange(sheetRow, 8).setValue(new Date().toISOString()); // H processed_at
      sheet.getRange(sheetRow, 9).setValue(newStatus);                 // I status
      return;
    }
  }
}
