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

  // OpenAI model for transcript analysis + OKR mapping.
  // gpt-4o is strongly recommended — gpt-4o-mini struggles to match tasks against
  // large KR lists (137 entries) while simultaneously extracting action items.
  OPENAI_MODEL: 'gpt-4o',

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
  MEET_TITLE_PATTERNS: ['Notes by Gemini', 'Meeting transcript', 'Meet transcript'],

  // Name of the OKR Registry sheet tab in your spreadsheet
  // Import okr_registry.csv into this tab — see apps-script-meet-sync/okr_registry.csv
  // Leave empty ('') to skip OKR mapping (tasks will show "Unmapped")
  OKR_TAB_NAME: 'OKR Registry'
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
// INBOX FILENAME HELPERS
// The copy name format we write is: "[HM YYYY-MM-DD] Original Title"
// These helpers extract meeting date and clean title from that prefix.
// ============================================================

/**
 * Extract the meeting date from an inbox copy filename.
 * Expects format: "[HM YYYY-MM-DD] ..."
 * Returns YYYY-MM-DD or empty string if not found.
 */
function parseDateFromInboxName(fileName) {
  var m = String(fileName || '').match(/^\[HM (\d{4}-\d{2}-\d{2})\]/);
  return m ? m[1] : '';
}

/**
 * Strip the "[HM YYYY-MM-DD] " prefix from an inbox copy filename.
 * Returns the original meeting title.
 */
function parseTitleFromInboxName(fileName) {
  return String(fileName || '').replace(/^\[HM \d{4}-\d{2}-\d{2}\]\s*/, '');
}

// ============================================================
// OKR CONTEXT — Fetched once per processInbox() run
// ============================================================

/**
 * Read OKR context from the OKR Registry sheet tab.
 *
 * The tab is populated from apps-script-meet-sync/okr_registry.csv.
 * Columns: section(A), obj_num(B), objective(C), kr_num(D), kr_label(E), kr_text(F), active(G)
 *
 * Returns a prompt-ready string of "kr_label: kr_text" lines,
 * or empty string if OKR_TAB_NAME is not set or the tab is missing.
 */
function fetchOKRContext() {
  if (!CONFIG.OKR_TAB_NAME) return '';
  try {
    var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CONFIG.OKR_TAB_NAME);
    if (!sheet || sheet.getLastRow() <= 1) return '';

    var rows  = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    var lines = rows
      .filter(function(r) { return String(r[6]).toUpperCase() !== 'FALSE'; }) // G: active
      .map(function(r)    { return r[4] + ': ' + r[5]; });                   // E: kr_label + F: kr_text

    if (!lines.length) return '';

    return [
      'COMPANY OKRs — each line is "kr_label: kr_description". The kr_label is the value to use in okr_link.',
      'Example: if a task advances "Onboard 50% of the top 30 US debt buyers", write okr_link = "TS Group > O1 > KR1".',
      lines.join('\n')
    ].join('\n');

  } catch (e) {
    logSyncActivity('okr_fetch_error', '', '', 'OKR fetch failed: ' + e.message);
    return '';
  }
}

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

// ============================================================
// DISCOVERY — Find Meet artifact docs in Calendar and Drive
// ============================================================

/**
 * Classify a document title as a Meet artifact type.
 * Returns 'gemini_notes', 'meet_transcript', or null if not a Meet artifact.
 */
function classifyDoc(title) {
  var t = (title || '').toLowerCase();
  if (t.indexOf('notes by gemini') !== -1) return 'gemini_notes';
  if (t.indexOf('meet transcript') !== -1) return 'meet_transcript';
  if (t.indexOf('transcript')      !== -1) return 'meet_transcript';
  return null;
}

/**
 * Discover Meet artifact docs from Google Calendar event attachments.
 *
 * REQUIREMENT: Enable "Google Calendar API" under Services in Apps Script
 * (Resources → Advanced Google Services → Calendar API → Enable).
 * If not available, this function throws and syncMeetArtifacts() skips it gracefully.
 *
 * Returns array of: { eventId, fileId, fileName, meetingDate, meetingTitle, sourceType }
 */
function discoverFromCalendar(from, to) {
  var results = [];
  var events = Calendar.Events.list('primary', {
    timeMin:             from.toISOString(),
    timeMax:             to.toISOString(),
    supportsAttachments: true,
    singleEvents:        true,
    maxResults:          50
  });

  if (!events || !events.items) return results;

  events.items.forEach(function(event) {
    if (!event.attachments || !event.attachments.length) return;

    var meetingDate = '';
    if (event.start && event.start.dateTime) {
      meetingDate = event.start.dateTime.split('T')[0];
    } else if (event.start && event.start.date) {
      meetingDate = event.start.date;
    }

    event.attachments.forEach(function(att) {
      if (att.mimeType !== 'application/vnd.google-apps.document') return;
      var sourceType = classifyDoc(att.title || '');
      if (!sourceType) return; // Not a Meet artifact

      results.push({
        eventId:      event.id,
        fileId:       att.fileId,
        fileName:     att.title || 'Untitled',
        meetingDate:  meetingDate,
        meetingTitle: event.summary || att.title || 'Untitled Meeting',
        sourceType:   sourceType
      });
    });
  });

  return results;
}

/**
 * Discover Meet artifact docs from Drive using title-pattern search.
 * Works without Advanced Calendar Service — always runs as fallback.
 *
 * Returns array of: { eventId, fileId, fileName, meetingDate, meetingTitle, sourceType }
 */
function discoverFromDrive(from) {
  var results = [];
  // Drive search requires ISO date without the time component
  var fromDateStr = Utilities.formatDate(from, 'UTC', 'yyyy-MM-dd');

  CONFIG.MEET_TITLE_PATTERNS.forEach(function(pattern) {
    var query = [
      'title contains "' + pattern + '"',
      'mimeType = "application/vnd.google-apps.document"',
      'modifiedDate > "' + fromDateStr + '"'
    ].join(' and ');

    try {
      var files = DriveApp.searchFiles(query);
      while (files.hasNext()) {
        var file = files.next();
        var sourceType = classifyDoc(file.getName()) || 'unknown_meet_doc';
        results.push({
          eventId:      '',
          fileId:       file.getId(),
          fileName:     file.getName(),
          meetingDate:  Utilities.formatDate(file.getLastUpdated(), 'UTC', 'yyyy-MM-dd'),
          meetingTitle: file.getName(),
          sourceType:   sourceType
        });
      }
    } catch (e) {
      // Log but continue — one bad pattern should not stop others
      logSyncActivity('drive_search_error', '', '', 'Pattern "' + pattern + '" failed: ' + e.message);
    }
  });

  return results;
}

// ============================================================
// INBOX COPY — Stage 1b: copy qualifying docs to shared inbox
// ============================================================

/**
 * Copy a single Meet artifact doc to the shared Drive inbox.
 * Skips without error if the file has already been logged in Processed Sources.
 * Returns true if copied, false if skipped.
 */
function copyToInbox(artifact) {
  // Idempotency check — ALWAYS runs first
  if (isAlreadyProcessed(artifact.fileId, artifact.eventId)) {
    logSyncActivity('skip', artifact.fileId, artifact.fileName, 'Already in Processed Sources — skipped');
    return false;
  }

  var inboxFolder = DriveApp.getFolderById(CONFIG.INBOX_FOLDER_ID);
  var sourceFile  = DriveApp.getFileById(artifact.fileId);

  // Name the copy so it is easy to identify in the inbox
  var copyName = '[HM ' + (artifact.meetingDate || 'unknown-date') + '] ' + artifact.fileName;
  sourceFile.makeCopy(copyName, inboxFolder);

  // Log as "copied" in Processed Sources — processed_at stays empty until Stage 2
  logProcessedSource(
    artifact.eventId,
    artifact.fileId,
    artifact.fileName,
    artifact.sourceType,
    artifact.meetingDate,
    artifact.meetingTitle || artifact.fileName,
    'copied'
  );

  logSyncActivity('copied', artifact.fileId, artifact.fileName, 'Copied to inbox as: ' + copyName);
  return true;
}

// ============================================================
// SYNC — Stage 1: Main entry point for recurring 15-minute trigger
// ============================================================

/**
 * RECURRING SYNC — Set this as the time-driven trigger target (every 15 minutes).
 *
 * Discovers Google Meet artifacts created/modified in the last LOOKBACK_MINUTES,
 * copies qualifying docs to the shared Drive inbox, and logs all activity.
 * Does NOT process docs — call processInbox() separately (or chain it below if desired).
 */
function syncMeetArtifacts() {
  var now  = new Date();
  var from = new Date(now.getTime() - CONFIG.LOOKBACK_MINUTES * 60 * 1000);

  logSyncActivity('sync_start', '', '', 'Window: ' + from.toISOString() + ' → ' + now.toISOString());

  var found = [];

  // Try Calendar first (requires Advanced Calendar Service)
  try {
    var calResults = discoverFromCalendar(from, now);
    found = found.concat(calResults);
    logSyncActivity('calendar_scan', '', '', 'Found ' + calResults.length + ' Calendar candidates');
  } catch (e) {
    logSyncActivity('calendar_skip', '', '', 'Calendar API unavailable — skipped: ' + e.message);
  }

  // Drive search always runs as fallback/supplement
  var driveResults = discoverFromDrive(from);
  found = found.concat(driveResults);
  logSyncActivity('drive_scan', '', '', 'Found ' + driveResults.length + ' Drive candidates');

  // Deduplicate by fileId (Calendar and Drive may find the same doc)
  var seen = {};
  var unique = found.filter(function(a) {
    if (seen[a.fileId]) return false;
    seen[a.fileId] = true;
    return true;
  });

  logSyncActivity('dedup', '', '', unique.length + ' unique candidates after dedup');

  var copied = 0;
  unique.forEach(function(artifact) {
    try {
      if (copyToInbox(artifact)) copied++;
    } catch (e) {
      logSyncActivity('copy_error', artifact.fileId, artifact.fileName, e.message);
    }
  });

  logSyncActivity('sync_done', '', '', 'Sync complete. Copied ' + copied + ' new file(s).');
}

// ============================================================
// HIVE MIND — AI analysis via OpenAI
// ============================================================

/**
 * Send transcript text to OpenAI using the Hive Mind system prompt.
 * Returns { actionItems: [...], insights: [...], keyTopicsSummary: '' }
 * Throws on API error or JSON parse failure — caller must handle.
 *
 * @param {string} transcriptText  Full text of the meeting document
 * @param {string} meetingDate     YYYY-MM-DD anchor date for relative deadlines
 * @param {string=} okrContext     Optional OKR list to inject (from fetchOKRContext())
 */
function parseWithHiveMind(transcriptText, meetingDate, okrContext) {
  var today = meetingDate || Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');

  var systemPrompt = [
    'You are Hive Mind, an AI operations assistant. Extract structured action items from this meeting transcript.',
    'Reference date for resolving relative deadlines: ' + today + '.',
    '',
    okrContext ? okrContext + '\n' : '',
    'For okr_link: write the kr_label (the part before the colon) of the single most relevant KR from the list above.',
    'Map even indirect or supporting tasks — a pricing analysis task maps to a revenue KR, a hiring task maps to a team-scaling KR.',
    'Use "Unmapped" ONLY when the task has zero connection to any listed KR.',
    '',
    'Return ONLY valid JSON in exactly this format (no markdown fences):',
    '{',
    '  "actionItems": [',
    '    {',
    '      "task": "specific actionable description",',
    '      "owner": "name or role (Unassigned if unclear)",',
    '      "status": "open | pending | blocked | done",',
    '      "urgency": 5,',
    '      "due_date": "YYYY-MM-DD or empty string",',
    '      "next_step": "immediate next action or context",',
    '      "blockers": "what is blocking this, or None noted",',
    '      "dependencies": "comma-separated related tasks, or None noted",',
    '      "okr_link": "TS Group > O1 > KR2",',
    '      "risk_flag": "high | medium | low or empty"',
    '    }',
    '  ],',
    '  "insights": ["string insight"],',
    '  "keyTopicsSummary": "one paragraph"',
    '}',
    '',
    'Urgency scale: 9=immediate crisis, 7-8=critical, 5-6=high priority, 3-4=moderate, 1-2=low, 0=trivial.',
    'Extract every action item explicitly or clearly implied. Omit discussion with no follow-up.'
  ].join('\n');

  var payload = {
    model:       CONFIG.OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: 'Transcript:\n\n' + transcriptText }
    ]
  };

  var response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method:          'post',
    contentType:     'application/json',
    headers:         { 'Authorization': 'Bearer ' + CONFIG.OPENAI_API_KEY },
    payload:         JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('OpenAI ' + code + ': ' + response.getContentText().slice(0, 300));
  }

  var body    = JSON.parse(response.getContentText());
  var content = body.choices[0].message.content;

  // Strip accidental markdown code fences
  content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

  return JSON.parse(content);
}

// ============================================================
// MASTER ACTION BOARD — Helpers
// ============================================================

/**
 * Normalize text for dedup comparison.
 * Mirrors normalizeForMatch() in lib/taskMerge.js:29–36.
 * Lowercase + strip punctuation + collapse whitespace.
 */
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Clamp urgency to an integer 0–9. Defaults to 5 if invalid.
 */
function clampUrgency(val) {
  var n = parseInt(val, 10);
  if (isNaN(n)) return 5;
  return Math.min(9, Math.max(0, n));
}

/**
 * Generate the next HM-#### Task ID by scanning the TASK_ID column of existingRows.
 * Mirrors getNextTaskId() in lib/taskMerge.js:19–27.
 */
function generateTaskId(existingRows) {
  var maxNum = 0;
  existingRows.forEach(function(row) {
    var id    = String(row[MASTER_COLS.TASK_ID] || '');
    var match = id.match(/^HM-(\d+)$/);
    if (match) {
      var num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });
  var next = String(maxNum + 1);
  while (next.length < 4) next = '0' + next;
  return 'HM-' + next;
}

/**
 * Build a 16-element array for a Master Action Board row.
 * Mirrors buildMasterRow() in lib/taskMerge.js:90–110.
 */
function buildMasterRow(item, meta, taskId, createdAt, updatedAt) {
  return [
    taskId,                                  // A task_id
    item.task        || '(unspecified task)', // B task
    item.owner       || 'Unassigned',        // C owner
    item.status      || 'open',              // D status
    clampUrgency(item.urgency),              // E urgency
    item.due_date    || '',                  // F due_date
    item.next_step   || '',                  // G next_step
    item.blockers    || 'None noted',        // H blockers
    item.dependencies|| 'None noted',        // I dependencies
    item.okr_link    || 'Unmapped',          // J okr_link
    item.risk_flag   || '',                  // K risk_flag
    meta.fileId      || '',                  // L source_transcript_id (Drive file ID)
    meta.fileName    || '',                  // M meeting_title
    meta.meetingDate || '',                  // N meeting_date
    createdAt,                               // O created_at
    updatedAt                                // P updated_at
  ];
}

/**
 * Ensure the Master Action Board has the 16-column header row.
 * Does nothing if the sheet already has rows.
 */
function ensureMasterHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'task_id','task','owner','status','urgency','due_date',
      'next_step','blockers','dependencies','okr_link','risk_flag',
      'source_transcript_id','meeting_title','meeting_date','created_at','updated_at'
    ]);
  }
}

/**
 * Write extracted action items to the Master Action Board.
 * Uses rule-based dedup: normalizes task+owner+due_date and compares against
 * existing rows before deciding to INSERT a new row or UPDATE an existing one.
 * Preserves Task IDs (HM-####) and created_at on updates.
 *
 * @param {Array}  actionItems  Array of action item objects from parseWithHiveMind
 * @param {Object} meta         { fileId, fileName, meetingDate, sourceType }
 */
function writeTasksToMasterBoard(actionItems, meta) {
  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_MASTER);
  if (!sheet) throw new Error('Tab "' + CONFIG.TAB_MASTER + '" not found in spreadsheet');

  ensureMasterHeaders(sheet);

  // Read all existing data rows into memory (skip header row 1)
  var lastRow      = sheet.getLastRow();
  var existingRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 16).getValues()
    : [];

  var now = new Date().toISOString();

  actionItems.forEach(function(item) {
    var normTask  = normalizeText(item.task  || '');
    if (!normTask) return; // Skip empty tasks

    var normOwner = normalizeText(item.owner    || '');
    var normDue   = normalizeText(item.due_date || '');

    // Find matching existing row (task + owner + due_date all match)
    var matchIdx = -1;
    for (var i = 0; i < existingRows.length; i++) {
      var r = existingRows[i];
      if (
        normalizeText(String(r[MASTER_COLS.TASK]     || '')) === normTask &&
        normalizeText(String(r[MASTER_COLS.OWNER]    || '')) === normOwner &&
        normalizeText(String(r[MASTER_COLS.DUE_DATE] || '')) === normDue
      ) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx >= 0) {
      // UPDATE: preserve task_id and created_at
      var existing   = existingRows[matchIdx];
      var taskId     = String(existing[MASTER_COLS.TASK_ID]    || generateTaskId(existingRows));
      var createdAt  = String(existing[MASTER_COLS.CREATED_AT] || now);
      var updatedRow = buildMasterRow(item, meta, taskId, createdAt, now);

      var sheetRowNum = matchIdx + 2; // +1 header + 1-based
      sheet.getRange(sheetRowNum, 1, 1, 16).setValues([updatedRow]);
      existingRows[matchIdx] = updatedRow;

    } else {
      // INSERT: allocate next HM-#### Task ID
      var newTaskId = generateTaskId(existingRows);
      var newRow    = buildMasterRow(item, meta, newTaskId, now, now);
      sheet.appendRow(newRow);
      existingRows.push(newRow); // keep in-memory snapshot current
    }
  });
}

// ============================================================
// DOCUMENT TEXT EXTRACTION — Multi-tab aware
// ============================================================

/**
 * Extract all text from a Google Doc, reading every tab.
 *
 * DocumentApp.getBody().getText() only reads tab 1. Gemini meeting notes
 * typically put the summary on tab 1 and the full transcript on tab 2+.
 * This function reads ALL tabs (and their children) so Hive Mind sees the
 * complete transcript, not just the predigested summary.
 *
 * Falls back to single-body read if getTabs() is unavailable.
 *
 * @param  {string} fileId  Google Drive file ID of the Doc to read
 * @return {string}         Full text of all tabs, separated by newlines
 */
function getAllTabsText(fileId) {
  var doc     = DocumentApp.openById(fileId);
  var allText = '';

  try {
    var tabs = doc.getTabs();
    if (tabs && tabs.length > 0) {
      tabs.forEach(function(tab) {
        try { allText += tab.asDocumentTab().getBody().getText() + '\n\n'; } catch(e) {}
        try {
          tab.getChildTabs().forEach(function(child) {
            try { allText += child.asDocumentTab().getBody().getText() + '\n\n'; } catch(e) {}
          });
        } catch(e) {}
      });
    }
  } catch(e) {
    // getTabs() not available — fall back to single body (tab 1 only)
  }

  // Fallback: single-tab doc or getTabs() threw
  if (!allText) allText = doc.getBody().getText();

  return allText.trim();
}

// ============================================================
// PROCESS — Stage 2: Process inbox docs into Master Action Board
// ============================================================

/**
 * INBOX PROCESSOR — Run after syncMeetArtifacts() to extract action items.
 *
 * Reads every Google Doc in the shared inbox folder, runs Hive Mind analysis,
 * and writes structured rows into the Master Action Board.
 * Safe to run multiple times — already-processed files are skipped.
 */
function processInbox() {
  var inboxFolder = DriveApp.getFolderById(CONFIG.INBOX_FOLDER_ID);
  var files       = inboxFolder.getFiles();
  var processed   = 0;

  logSyncActivity('process_start', '', '', 'Scanning inbox for unprocessed docs...');

  // Fetch OKR context once for the whole run (avoids one Doc open per file)
  var okrContext = fetchOKRContext();
  if (okrContext) {
    logSyncActivity('okr_context', '', '', 'OKR context loaded (' + okrContext.length + ' chars)');
  }

  while (files.hasNext()) {
    var file     = files.next();
    var fileId   = file.getId();
    var fileName = file.getName();

    // Only handle Google Docs
    if (file.getMimeType() !== 'application/vnd.google-apps.document') continue;

    // Idempotency: skip if already fully processed.
    // NOTE: We check by the COPY's file ID (inbox file ID), not the source ID.
    // The copy ID is logged into Processed Sources at the end of this loop.
    if (isProcessedStatus(fileId, 'processed')) {
      logSyncActivity('skip', fileId, fileName, 'Status = processed — skipped');
      continue;
    }

    try {
      var text = getAllTabsText(fileId);
      if (!text || text.trim().length < 50) {
        logSyncActivity('skip', fileId, fileName, 'Document is empty or too short');
        continue;
      }

      // Extract meeting date and title from the "[HM YYYY-MM-DD] Original Title" filename.
      // This is more reliable than metadata lookup because the copy has a different file ID
      // than the source file that was logged in Processed Sources during Stage 1.
      var meetingDate  = parseDateFromInboxName(fileName)
                         || Utilities.formatDate(file.getLastUpdated(), 'UTC', 'yyyy-MM-dd');
      var meetingTitle = parseTitleFromInboxName(fileName) || fileName;
      var sourceType   = classifyDoc(meetingTitle) || 'unknown_meet_doc';

      // Run Hive Mind analysis
      var result = parseWithHiveMind(text, meetingDate, okrContext);

      if (!result || !result.actionItems || result.actionItems.length === 0) {
        logSyncActivity('no_tasks', fileId, fileName, 'Hive Mind returned 0 action items');
      } else {
        writeTasksToMasterBoard(result.actionItems, {
          fileId:      fileId,
          fileName:    meetingTitle,
          meetingDate: meetingDate,
          sourceType:  sourceType
        });
        logSyncActivity('processed', fileId, fileName, 'Wrote ' + result.actionItems.length + ' tasks to Master board');
      }

      // Log the COPY's file ID as processed so future runs skip it.
      // (We use logProcessedSource rather than updateProcessedStatus because the copy ID
      // was never added to Processed Sources — only the source ID was, during Stage 1.)
      logProcessedSource('', fileId, meetingTitle, sourceType, meetingDate, meetingTitle, 'processed');
      processed++;

    } catch (e) {
      logSyncActivity('process_error', fileId, fileName, 'Error: ' + e.message);
    }
  }

  logSyncActivity('process_done', '', '', 'Processing complete. ' + processed + ' file(s) processed.');
}

// ============================================================
// BACKFILL — One-time historical hydration
// ============================================================

/**
 * BACKFILL / HYDRATION — Run ONCE to seed the system from historical transcripts.
 *
 * This is NOT part of the recurring sync. Run it manually from the Apps Script IDE
 * after initial setup to populate the command center with recent meeting history.
 *
 * Because it logs every source into Processed Sources, the recurring
 * syncMeetArtifacts() trigger will automatically skip backfilled files going forward.
 *
 * @param {number} daysBack  How many days of history to include (default: CONFIG.BACKFILL_DAYS)
 *
 * Usage in Apps Script IDE:
 *   backfillRecentTranscripts()        — uses CONFIG.BACKFILL_DAYS
 *   backfillRecentTranscripts(14)      — last 14 days
 *   backfillRecentTranscripts(3)       — last 3 days (for a quick test)
 */
function backfillRecentTranscripts(daysBack) {
  daysBack = (typeof daysBack === 'number' && daysBack > 0) ? daysBack : CONFIG.BACKFILL_DAYS;

  var now  = new Date();
  var from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

  logSyncActivity('backfill_start', '', '', 'Backfill: last ' + daysBack + ' days (from ' + from.toISOString() + ')');

  var found = [];

  // Calendar scan
  try {
    var calResults = discoverFromCalendar(from, now);
    found = found.concat(calResults);
    logSyncActivity('backfill_calendar', '', '', 'Calendar found ' + calResults.length + ' candidates');
  } catch (e) {
    logSyncActivity('backfill_calendar_skip', '', '', 'Calendar unavailable: ' + e.message);
  }

  // Drive scan
  var driveResults = discoverFromDrive(from);
  found = found.concat(driveResults);
  logSyncActivity('backfill_drive', '', '', 'Drive found ' + driveResults.length + ' candidates');

  // Deduplicate by fileId
  var seen   = {};
  var unique = found.filter(function(a) {
    if (seen[a.fileId]) return false;
    seen[a.fileId] = true;
    return true;
  });

  logSyncActivity('backfill_dedup', '', '', unique.length + ' unique candidates after dedup');

  var copied = 0;
  unique.forEach(function(artifact) {
    try {
      if (copyToInbox(artifact)) copied++;
    } catch (e) {
      logSyncActivity('backfill_copy_error', artifact.fileId, artifact.fileName, e.message);
    }
  });

  logSyncActivity('backfill_done', '', '',
    'Backfill complete. Copied ' + copied + ' file(s). Run processInbox() to extract action items.');
}

// ============================================================
// DEBUG UTILITIES — Run manually from the Apps Script IDE
// ============================================================

/**
 * diagnosConfig() — Run this from the IDE to verify CONFIG values are wired up correctly.
 * Logs results to the Sync Log tab AND prints to the Apps Script execution log.
 * Safe to run at any time — read-only, no side effects.
 */
function diagnoseConfig() {
  var results = [];

  // 1. Spreadsheet
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var tabNames = ss.getSheets().map(function(s) { return '"' + s.getName() + '"'; }).join(', ');
    results.push('SPREADSHEET: OK — tabs found: ' + tabNames);
  } catch(e) {
    results.push('SPREADSHEET: ERROR — ' + e.message);
  }

  // 2. OKR Registry tab
  try {
    var ss2   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var okrSheet = ss2.getSheetByName(CONFIG.OKR_TAB_NAME);
    if (!okrSheet) {
      results.push('OKR_TAB_NAME: NOT FOUND — looking for tab named "' + CONFIG.OKR_TAB_NAME + '"');
    } else {
      results.push('OKR_TAB_NAME: OK — ' + (okrSheet.getLastRow() - 1) + ' KR rows found');
    }
  } catch(e) {
    results.push('OKR_TAB_NAME: ERROR — ' + e.message);
  }

  // 3. Inbox folder
  try {
    var folder = DriveApp.getFolderById(CONFIG.INBOX_FOLDER_ID);
    var fileCount = 0;
    var files = folder.getFiles();
    while (files.hasNext()) { files.next(); fileCount++; }
    results.push('INBOX_FOLDER: OK — "' + folder.getName() + '" contains ' + fileCount + ' file(s)');
  } catch(e) {
    results.push('INBOX_FOLDER: ERROR — ' + e.message);
  }

  // 4. OKR context load test
  var ctx = fetchOKRContext();
  results.push('OKR_CONTEXT: ' + (ctx ? ctx.length + ' chars loaded' : 'EMPTY — tab missing or no active rows'));

  // Print to execution log and Sync Log
  results.forEach(function(r) {
    Logger.log(r);
    logSyncActivity('diagnose', '', '', r);
  });
}
