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
 */
function parseWithHiveMind(transcriptText, meetingDate) {
  var today = meetingDate || Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');

  var systemPrompt = [
    'You are Hive Mind, an AI operations assistant. Extract structured action items from this meeting transcript.',
    'Reference date for resolving relative deadlines: ' + today + '.',
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
    '      "okr_link": "OKR name or Unmapped",',
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
