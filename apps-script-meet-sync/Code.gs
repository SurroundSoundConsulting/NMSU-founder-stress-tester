// ============================================================
// CONFIG — Hardcoded defaults + Script-Properties-backed secrets
// ============================================================
//
// The 4 instance-specific values below are read from Script Properties so
// they survive code replacements. Set them once via:
//   Apps Script editor → Project Settings → Script Properties → Add property
//
// Required properties:
//   INBOX_FOLDER_ID             — Drive folder ID of "Raw Meet Artifacts"
//   SPREADSHEET_ID              — Founder command-center Sheet ID
//   OPENAI_API_KEY              — OpenAI API key
//   EXECUTION_OUTPUT_FOLDER_ID  — Drive folder ID for execution output Docs
//
// Everything else is hardcoded below; edit in code if you need to change it.
// Run diagnoseConfig() to verify the 4 properties are set and the IDs resolve.

function loadConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return {
    // --- Script Properties (instance-specific; set once per deployment) ---
    INBOX_FOLDER_ID:            p.INBOX_FOLDER_ID            || '',
    SPREADSHEET_ID:             p.SPREADSHEET_ID             || '',
    OPENAI_API_KEY:             p.OPENAI_API_KEY             || '',
    EXECUTION_OUTPUT_FOLDER_ID: p.EXECUTION_OUTPUT_FOLDER_ID || '',

    // --- Hardcoded defaults ---

    // OpenAI model for transcript analysis + OKR mapping.
    // gpt-5 uses the Responses API (/v1/responses); gpt-4o uses Chat Completions.
    // The code auto-selects the correct endpoint and response parsing based on this value.
    OPENAI_MODEL: 'gpt-5',

    // Sheet tab names — must match what exists in your spreadsheet
    TAB_MASTER:    'Master Action Board',
    TAB_PROCESSED: 'Processed Sources',
    TAB_SYNC_LOG:  'Sync Log',

    // How far back to look when the 15-minute sync trigger runs (minutes)
    LOOKBACK_MINUTES: 60,

    // How many days back to scan during a one-time backfill
    BACKFILL_DAYS: 7,

    // Title fragments that identify a doc as a Meet artifact
    MEET_TITLE_PATTERNS: ['Notes by Gemini', 'Meeting transcript', 'Meet transcript'],

    // Name of the OKR Registry sheet tab. Import okr_registry.csv into this tab.
    // Leave empty ('') to skip OKR mapping (tasks will show "Unmapped").
    OKR_TAB_NAME: 'OKR Registry',

    // Max candidate rows the execution workbench processes per pass.
    // Apps Script time triggers die at 6 min; with 2 gpt-5 calls/row at ~10–30s each,
    // 10 rows is the safe ceiling. Excess candidates wait for the next pass.
    EXECUTION_BATCH_LIMIT: 10,

    // Max inbox Docs processInbox() will chew through in one pass.
    // Each Doc = 1 OpenAI call (~10–30s) + Sheet reads/writes. Apps Script
    // time-based triggers die at 30 min. Keep this well under the ceiling
    // so a growing backlog doesn't cause hourly timeout emails — the next
    // trigger picks up what's left.
    INBOX_BATCH_LIMIT: 5,

    // Soft wall-clock budget for processInbox() in ms. If we've been running
    // longer than this at the top of a loop iteration, we log a partial and
    // return cleanly. Set below the 30-min hard limit with headroom.
    INBOX_MAX_RUN_MS: 22 * 60 * 1000,

    // Default lookback window for processInbox(), in days. Only meetings dated
    // on/after (today - this) are eligible. The inbox holds hundreds of
    // archived transcripts whose action items are long stale; processing them
    // wastes OpenAI spend and floods the board.
    //
    // Age is read from the "[HM YYYY-MM-DD]" filename prefix, NOT the Drive
    // modified time — files copied between environments have a fresh modified
    // time and would all look new.
    //
    // Overrides:
    //   processInboxSince(90)  — custom window, run manually
    //   processInboxAll()      — no filter at all, run manually
    PROCESS_LOOKBACK_DAYS: 14
  };
}

var CONFIG = loadConfig_();

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
// EXECUTION_COLS — Column indexes for the 10 workbench columns
// appended to Master Action Board after MASTER_COLS (Q-Z).
// Existing 16-col reads are unaffected; workbench reads use sheet.getLastColumn().
// ============================================================
var EXECUTION_COLS = {
  EXECUTION_NEEDED:        16,  // Q
  EXECUTION_CONTEXT:       17,  // R — user-edited
  EXECUTION_TYPE:          18,  // S
  MISSING_INFO:            19,  // T
  EXECUTION_STATUS:        20,  // U
  EXECUTION_STATUS_REASON: 21,  // V
  LATEST_EXECUTION_ID:     22,  // W
  EXECUTION_OUTPUT_LINK:   23,  // X
  LAST_EXECUTED_AT:        24,  // Y
  FORCE_RERUN:             25   // Z — user-edited
};

var EXECUTION_HEADERS = [
  'Execution Needed',
  'Execution Context',
  'Execution Type',
  'Missing Info',
  'Execution Status',
  'Execution Status Reason',
  'Latest Execution ID',
  'Execution Output Link',
  'Last Executed At',
  'Force Re-run'
];

// Exact strings used in the Execution Status column. Filters and
// downstream tools depend on these — do not vary the casing or wording.
var EXEC_STATUS = {
  MISSING_INFO:        'Missing Info',
  READY_FOR_EXECUTION: 'Ready for Execution',
  NOT_AUTOMATABLE:     'Not Automatable',
  READY_FOR_REVIEW:    'Ready for Review'
};

// ============================================================
// INBOX FILENAME HELPERS
// The copy name format we write is: "[HM YYYY-MM-DD] Original Title"
// These helpers extract meeting date and clean title from that token.
//
// The "[HM ...]" token is deliberately NOT anchored to the start of the
// filename. When files are copied between Drive folders, Google prepends
// "Copy of " — e.g. "Copy of [HM 2026-05-09] Nguyen / Rod re: ...". An
// anchored match returned an empty date for every one of those files, which
// made processInbox treat them as unknown-age and exclude them from the
// default lookback window. Matching the token anywhere in the name keeps
// copied and re-copied files working.
// ============================================================

/**
 * Extract the meeting date from an inbox copy filename.
 * Finds the "[HM YYYY-MM-DD]" token anywhere in the name, so filenames
 * carrying Drive's "Copy of " prefix still resolve.
 * Returns YYYY-MM-DD or empty string if not found.
 */
function parseDateFromInboxName(fileName) {
  var m = String(fileName || '').match(/\[HM (\d{4}-\d{2}-\d{2})\]/);
  return m ? m[1] : '';
}

/**
 * Return the original meeting title from an inbox copy filename by removing
 * everything up to and including the "[HM YYYY-MM-DD]" token. This also drops
 * any "Copy of " (or "Copy of Copy of ") prefix Drive added.
 * Falls back to stripping a bare leading "Copy of " when no token is present.
 */
function parseTitleFromInboxName(fileName) {
  var s = String(fileName || '');
  var m = s.match(/\[HM \d{4}-\d{2}-\d{2}\]\s*([\s\S]*)$/);
  if (m) return m[1].trim();
  return s.replace(/^(?:Copy of\s+)+/i, '').trim();
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
      .filter(function(r) { return String(r[6]).toUpperCase() !== 'FALSE'; })
      .map(function(r) {
        var section   = String(r[0] || '');
        var objective = String(r[2] || '');
        var krLabel   = String(r[4] || '');
        var krText    = String(r[5] || '');
        return 'Section: ' + section + ' | Objective: ' + objective + ' | KR Label: ' + krLabel + ' | KR Text: ' + krText;
      });

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
      'modifiedDate > "' + fromDateStr + '"',
      'not "' + CONFIG.INBOX_FOLDER_ID + '" in parents'
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
    'You are Hive Mind, an AI operations assistant.',
    'Task: extract every action item from the meeting transcript, then assign each action item to the single best-fit OKR Key Result based on business outcome, including indirect and enabling work.',
    'Reference date for relative deadlines: ' + today + '.',
    '',
    'Return ONLY valid JSON (no markdown fences):',
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
    '      "okr_link": "Choose the SINGLE best-fit KR Label from the OKR list based on downstream business outcome. Do NOT require exact wording overlap. A task can support a KR indirectly through enablement, preparation, tooling, or risk reduction and still be a valid match. Pricing, packaging, cost, margin, and unit-economics tasks usually map to profitability, ARR, revenue, gross margin, or deal-conversion KRs. DDQ, RFP, compliance review, and answer-library work usually map to deal-progression or compliance KRs. Onboarding, implementation, integration, UAT, file mapping, handoff quality, and launch-readiness work usually map to signed-to-live, go-live, onboarding-speed, or active-production KRs. Proof assets, case studies, ROI narratives, pricing calculators, battlecards, and playbooks usually map to proof-asset, enablement, category-leadership, or conversion KRs. Client reviews, wallet-share analysis, vendor-ranking discussions, and expansion recommendations usually map to wallet-share, top-2 vendor, value-review, or expansion KRs. AI workflow automation, team AIs, delivery-speed improvements, and workflow documentation usually map to AI-fusion, delivery-speed, or autonomous-workflow KRs. Only write Unmapped if no KR is plausibly advanced even indirectly after checking profitability, market acquisition, go-live, client performance, compliance, AI-fusion, product capability, and team capacity.",',
    '      "okr_rationale": "one short sentence explaining why this task advances that KR (or why it is Unmapped)",',
    '      "risk_flag": "high | medium | low or empty"',
    '    }',
    '  ],',
    '  "insights": ["string insight"],',
    '  "keyTopicsSummary": "one paragraph"',
    '}',
    '',
    'Urgency: 9=crisis, 7-8=critical, 5-6=high priority, 3-4=moderate, 1-2=low, 0=trivial.',
    'Extract every action item explicitly or clearly implied. Omit discussion with no follow-up.',
    '',
    'KR MAPPING RULES:',
    '1. You must assign the single best-fit KR Label for every action item unless there is truly no plausible business connection.',
    '2. Match by intended outcome, not keyword overlap.',
    '3. A task may support a KR indirectly through enablement. Indirect support still counts as a valid match.',
    '4. Prefer the KR that would most likely benefit if this task is completed successfully.',
    '5. Use Unmapped only as a last resort after considering direct impact, indirect impact, execution enablement, and team capacity enablement.',
    '6. If multiple KRs could fit, choose the most downstream business outcome, not the most local activity.',
    '7. Do not leave okr_link blank.',
    '',
    'KR MAPPING DECISION SEQUENCE:',
    '1. What business outcome would improve if this task gets done well?',
    '2. Is the task about winning a client, getting a client live, improving client results, proving value, reducing compliance risk, automating workflows, or increasing team capacity?',
    '3. Which KR would most likely move first or most strongly because of that work?',
    '4. Choose that KR even if the task is only an enabling step toward the result.',
    '5. Use Unmapped only if the task is truly administrative with no plausible effect on any KR.',
    '',
    'TASK TYPE → KR FAMILY mapping:',
    '- Commercial economics (pricing, margin, vendor cost, unit economics, budget, proposal): profitability / ARR / revenue / gross-margin / deal-conversion KRs.',
    '- Deal acceleration (DDQ, RFP, compliance package, proof asset, battlecard, playbook, lender offer): deal-progression / GTM enablement / category-leadership / compliance KRs.',
    '- Go-live execution (integration, data mapping, implementation milestone, onboarding artifact, UAT, launch readiness): signed-to-live / onboarding-cycle / active-production / first-time-go-live KRs.',
    '- Post-live value (ROI review, MBR, wallet-share conversation, vendor ranking, expansion case): wallet-share / top-2-vendor / value-review / expansion KRs.',
    '- Internal scale (workflow inventory, AI-assisted deliverables, Team AIs, process automation, documentation): AI-fusion / delivery-speed / autonomous-workflow / CS-GTM-Integrations-scale KRs.',
    '- Risk control (compliance monitoring, audit, incident reduction, policy docs, regulatory readiness): compliance-AI / audit-AI / client-compliance-proof / response-SLA / auditability KRs.',
    '',
    'TIE-BREAK RULES:',
    '- Process KR vs revenue KR: choose revenue when the process work is clearly in service of revenue generation.',
    '- Go-live KR vs client-performance KR: choose go-live when the account is not yet live; choose client-performance when the account is live and the work is about results, retention, or expansion.',
    '- Compliance KR vs sales-velocity KR: choose compliance when task primarily reduces regulatory risk; choose sales-velocity when task primarily unblocks contracting.',
    '- Internal AI-fusion KR vs functional-team KR: prefer the functional-team KR when the workflow improvement is clearly meant to move that team outcome.',
    '',
    'KOMPATO-SPECIFIC RULES:',
    '- Pricing, packaging, proposal economics, margin analysis, collections cost, vendor cost, staffing efficiency, or unit-economics work maps first to profitability / revenue / gross-margin KRs.',
    '- If pricing work is in service of a live opportunity, sales proposal, lender offer, or debt-buyer close plan, prefer the acquisition or ARR KR.',
    '- If pricing work is in service of implementation scope, launch feasibility, or go-live approval, prefer the go-live / onboarding KR.',
    '- Collections strategy, liquidation improvement, RPC/PTP, routing logic, operational QA, or channel optimization maps to Operations or Product performance KRs tied to vendor ranking, collections amount, cure rate, or liquidation lift.',
    '- Integration specs, AIM mappings, SFTP/file handling, UAT readiness, implementation artifacts, and engineering handoff quality map to Client Integrations or Engineering onboarding KRs.',
    '',
    okrContext || 'No OKR list available — use "Unmapped" for all okr_link values.'
  ].join('\n');

  // Log what we're actually sending so we can verify OKR context is present
  logSyncActivity('openai_prompt', '', '', 'model=' + CONFIG.OPENAI_MODEL + ' | systemPrompt=' + systemPrompt.length + ' chars | transcript=' + transcriptText.length + ' chars | okrInPrompt=' + (okrContext ? 'YES (' + okrContext.length + ' chars)' : 'NO'));
  logSyncActivity('openai_prompt_head', '', '', 'System prompt first 500 chars: ' + systemPrompt.slice(0, 500).replace(/\n/g, ' | '));

  // gpt-5+ uses the Responses API; gpt-4o and earlier use Chat Completions.
  var isResponsesApi = !CONFIG.OPENAI_MODEL.startsWith('gpt-4');

  var payload, endpoint;
  if (isResponsesApi) {
    // Responses API — /v1/responses
    // NOTE: gpt-5 rejects `temperature` ("Unsupported parameter ... not supported with this model").
    // Do NOT add temperature here. gpt-4o uses the Chat Completions branch below and supports it.
    endpoint = 'https://api.openai.com/v1/responses';
    payload = {
      model:        CONFIG.OPENAI_MODEL,
      instructions: systemPrompt,
      input:        'Transcript:\n\n' + transcriptText
    };
  } else {
    // Chat Completions API — /v1/chat/completions (gpt-4o and earlier)
    endpoint = 'https://api.openai.com/v1/chat/completions';
    payload = {
      model:       CONFIG.OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: 'Transcript:\n\n' + transcriptText }
      ]
    };
  }

  var response = UrlFetchApp.fetch(endpoint, {
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
  var content = isResponsesApi
    ? body.output_text
    : body.choices[0].message.content;

  // Log raw response so we can see exactly what GPT returned for okr_link
  logSyncActivity('openai_raw', '', '', 'Raw response (' + content.length + ' chars): ' + content.slice(0, 800).replace(/\n/g, ' '));

  // Strip accidental markdown code fences
  content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

  var parsed = JSON.parse(content);

  // Log okr_link + okr_rationale for every item — primary diagnostic for mapping quality
  if (parsed && parsed.actionItems) {
    parsed.actionItems.forEach(function(item, i) {
      logSyncActivity('openai_okr_links', '', '',
        'item' + i + ' okr=[' + (item.okr_link || 'MISSING') + '] rationale=[' + (item.okr_rationale || '') + '] task=[' + String(item.task || '').slice(0, 60) + ']'
      );
    });
  }

  return parsed;
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
 * Strategy 1 — DocumentApp.getTabs(): reads all tabs including transcript tab 2+.
 *   Blocked when a Google Workspace DLP "Confidential" sensitivity label is applied.
 *
 * Strategy 2 — Drive REST API export (plain text): exports the full doc as text/plain
 *   via the Drive API. Works even when DLP blocks DocumentApp, because it uses the
 *   OAuth token of the script runner (you) rather than the Apps Script runtime principal.
 *   Note: multi-tab docs are exported as a single concatenated text blob — all tabs included.
 *
 * @param  {string} fileId  Google Drive file ID of the Doc to read
 * @return {string}         Full text of all tabs, separated by newlines
 */
function getAllTabsText(fileId) {
  // ── Strategy 1: DocumentApp (preferred — preserves tab structure) ────────
  try {
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
      // getTabs() not available — fall back to single body
    }

    if (!allText) allText = doc.getBody().getText();
    if (allText.trim()) return allText.trim();

  } catch(e) {
    // DocumentApp blocked (e.g. DLP/Confidential sensitivity label) — fall through to Strategy 2
    logSyncActivity('doc_dlp_fallback', fileId, '', 'DocumentApp blocked (' + e.message.slice(0, 80) + ') — trying Drive export');
  }

  // ── Strategy 2: Drive REST API plain-text export (DLP-safe) ─────────────
  var token    = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/plain',
    { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
  );

  if (response.getResponseCode() === 200) {
    return response.getContentText().trim();
  }

  throw new Error('Both DocumentApp and Drive export failed for ' + fileId + '. Drive export HTTP ' + response.getResponseCode());
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
function processInbox(daysBackOrEvent) {
  // Apps Script passes a trigger EVENT OBJECT as the first argument when this
  // runs from a time-based trigger. Only treat the arg as a lookback override
  // when it's actually a number, otherwise fall back to the CONFIG default.
  // `null` is the explicit "no date filter" sentinel used by processInboxAll().
  var lookbackDays;
  if (typeof daysBackOrEvent === 'number' && daysBackOrEvent > 0) {
    lookbackDays = daysBackOrEvent;
  } else if (daysBackOrEvent === null) {
    lookbackDays = null; // no filter
  } else {
    lookbackDays = CONFIG.PROCESS_LOOKBACK_DAYS;
  }

  var startMs     = Date.now();
  var inboxFolder = DriveApp.getFolderById(CONFIG.INBOX_FOLDER_ID);
  var processed   = 0;
  var seen        = 0;
  var skipped     = 0;
  var nonDoc      = 0;
  var tooOld      = 0;
  var undated     = 0;
  var stopReason  = 'inbox_exhausted';

  // Fail loudly if CONFIG is being shadowed by a stray CONFIG.gs file in the
  // project. Apps Script concatenates all .gs files into one global scope, so a
  // second `var CONFIG` declaration silently overwrites loadConfig_()'s. That
  // produced `batch limit=undefined, budget=NaNs` and disabled both guards.
  if (typeof CONFIG.INBOX_BATCH_LIMIT !== 'number' ||
      typeof CONFIG.INBOX_MAX_RUN_MS !== 'number' ||
      typeof CONFIG.PROCESS_LOOKBACK_DAYS !== 'number') {
    var msg = 'CONFIG is missing INBOX_BATCH_LIMIT / INBOX_MAX_RUN_MS / ' +
              'PROCESS_LOOKBACK_DAYS. A stray CONFIG.gs is almost certainly ' +
              'shadowing loadConfig_(). Delete CONFIG.gs (and any CODE_*.gs ' +
              'duplicates) from the Apps Script project.';
    logSyncActivity('config_error', '', '', msg);
    throw new Error(msg);
  }

  // Cutoff date as YYYY-MM-DD for lexical comparison against meeting dates.
  var cutoff = '';
  if (lookbackDays !== null) {
    cutoff = Utilities.formatDate(
      new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000), 'UTC', 'yyyy-MM-dd');
  }

  logSyncActivity('process_start', '', '',
    'Scanning inbox (batch limit=' + CONFIG.INBOX_BATCH_LIMIT +
    ', budget=' + Math.round(CONFIG.INBOX_MAX_RUN_MS / 1000) + 's' +
    ', window=' + (cutoff ? 'meetings on/after ' + cutoff + ' (' + lookbackDays + "d)" : 'ALL DATES — no filter') + ')');

  // Prefetch processed file IDs into a Set ONCE. Previously we called
  // isProcessedStatus() on every iteration, which re-read the whole
  // Processed Sources sheet each time — O(N × M) and a major cause of
  // 30-min timeouts once Processed Sources grew past a few hundred rows.
  var processedSet = {};
  var procRows = getProcessedSourcesRows();
  for (var pi = 0; pi < procRows.length; pi++) {
    if (String(procRows[pi][8]) === 'processed') {
      processedSet[String(procRows[pi][1])] = true;
    }
  }
  logSyncActivity('process_prefetch', '', '', 'Loaded ' + procRows.length + ' Processed Sources rows into idempotency set.');

  // ── PHASE 1: enumerate and filter (metadata only — no Doc reads, no LLM) ──
  // Cheap pass over the whole folder so we can sort newest-first before
  // spending the expensive per-file budget. With hundreds of archived
  // transcripts, processing in Drive's arbitrary order would burn the batch
  // on random old meetings.
  var candidates = [];
  var it = inboxFolder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    seen++;

    if (f.getMimeType() !== 'application/vnd.google-apps.document') { nonDoc++; continue; }

    var fid = f.getId();
    if (processedSet[fid]) { skipped++; continue; }

    // Meeting date comes from the "[HM YYYY-MM-DD] Title" copy filename.
    // We deliberately do NOT fall back to file.getLastUpdated() for the age
    // check: files copied between environments have a fresh lastUpdated, so
    // that fallback would treat every archived transcript as brand new.
    var nameDate = parseDateFromInboxName(f.getName());

    if (cutoff) {
      if (!nameDate) {
        // Can't establish age — exclude from windowed runs rather than
        // silently pulling in unknown-age docs. processInboxAll() picks
        // these up (it passes no cutoff).
        undated++;
        continue;
      }
      if (nameDate < cutoff) { tooOld++; continue; }
    }

    candidates.push({ file: f, fileId: fid, fileName: f.getName(), nameDate: nameDate });
  }

  // Newest meetings first; undated (only possible when no cutoff) sort last.
  candidates.sort(function(a, b) { return (b.nameDate || '').localeCompare(a.nameDate || ''); });

  logSyncActivity('process_candidates', '', '',
    'Eligible: ' + candidates.length + ' of ' + seen + ' file(s) seen. ' +
    'Excluded — already processed: ' + skipped + ', outside window: ' + tooOld +
    ', undated: ' + undated + ', non-Doc: ' + nonDoc + '. ' +
    'Processing up to ' + CONFIG.INBOX_BATCH_LIMIT + ' newest-first.');

  // Fetch OKR context once for the whole run (avoids one Doc open per file)
  var okrContext = fetchOKRContext();
  if (okrContext) {
    logSyncActivity('okr_context', '', '', 'OKR context loaded (' + okrContext.length + ' chars). First 300 chars: ' + okrContext.slice(0, 300));
  } else {
    logSyncActivity('okr_context_empty', '', '', 'fetchOKRContext() returned empty — OKR tab "' + CONFIG.OKR_TAB_NAME + '" missing or has no active rows. All tasks will be Unmapped.');
  }

  // ── PHASE 2: process the batch (expensive — Doc read + LLM per file) ─────
  for (var ci = 0; ci < candidates.length; ci++) {
    if (processed >= CONFIG.INBOX_BATCH_LIMIT) { stopReason = 'batch_limit_reached'; break; }
    if (Date.now() - startMs > CONFIG.INBOX_MAX_RUN_MS) { stopReason = 'time_budget_reached'; break; }

    var file     = candidates[ci].file;
    var fileId   = candidates[ci].fileId;
    var fileName = candidates[ci].fileName;

    try {
      var text;
      try {
        text = getAllTabsText(fileId);
      } catch(docErr) {
        var hint = docErr.message.indexOf('openById') !== -1
          ? 'DocumentApp cannot open this file. Likely cause: Shared Drive permissions or missing OAuth scope. Fix: delete file from inbox + re-authorize script, or manually copy its text into a new Doc.'
          : docErr.message;
        logSyncActivity('doc_open_error', fileId, fileName, hint);
        continue;
      }
      logSyncActivity('doc_read', fileId, fileName, 'Text extracted: ' + text.length + ' chars across all tabs. Preview: ' + text.slice(0, 200).replace(/\n/g, ' '));
      if (!text || text.trim().length < 50) {
        logSyncActivity('skip', fileId, fileName, 'Document is empty or too short');
        continue;
      }

      // Extract meeting date and title from the "[HM YYYY-MM-DD] Original Title" filename.
      var meetingDate  = parseDateFromInboxName(fileName)
                         || Utilities.formatDate(file.getLastUpdated(), 'UTC', 'yyyy-MM-dd');
      var meetingTitle = parseTitleFromInboxName(fileName) || fileName;
      var sourceType   = classifyDoc(meetingTitle) || 'unknown_meet_doc';
      logSyncActivity('doc_meta', fileId, fileName, 'meetingDate=' + meetingDate + ' | meetingTitle=' + meetingTitle + ' | sourceType=' + sourceType + ' | okrContext=' + (okrContext ? okrContext.length + ' chars' : 'EMPTY'));

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
      processedSet[fileId] = true; // keep in-memory set in sync so we don't reprocess if we loop again
      processed++;

    } catch (e) {
      logSyncActivity('process_error', fileId, fileName, 'Error: ' + e.message);
    }
  }

  var elapsedSec = Math.round((Date.now() - startMs) / 1000);
  var leftover   = Math.max(0, candidates.length - processed);
  logSyncActivity('process_done', '', '',
    'Processed ' + processed + ' file(s) in ' + elapsedSec + 's. ' +
    'Stopped=' + stopReason + '. ' +
    'Eligible remaining in window: ' + leftover + ' (next run continues). ' +
    'Outside ' + (cutoff ? lookbackDays + '-day window: ' + tooOld : 'window: 0') +
    ', undated: ' + undated + '. ' +
    'Use processInboxAll() to include everything, or processInboxSince(N) for a custom window.');
}

/**
 * Process the inbox with NO date filter — every unprocessed Doc is eligible,
 * including archived transcripts and any whose filename lacks the
 * "[HM YYYY-MM-DD]" prefix.
 *
 * Still honors INBOX_BATCH_LIMIT and the time budget, so with a large archive
 * you'll need to run it repeatedly (or temporarily raise INBOX_BATCH_LIMIT).
 * Run manually from the IDE — do NOT attach this to a trigger.
 */
function processInboxAll() {
  return processInbox(null);
}

/**
 * Process the inbox using a custom lookback window in days.
 * Example: processInboxSince(90) — meetings from the last 90 days.
 * Run manually from the IDE.
 */
function processInboxSince(days) {
  if (typeof days !== 'number' || days <= 0) {
    throw new Error('processInboxSince(days): pass a positive number, e.g. processInboxSince(30)');
  }
  return processInbox(days);
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

  // 0. Script Properties presence check
  var requiredProps = ['INBOX_FOLDER_ID', 'SPREADSHEET_ID', 'OPENAI_API_KEY', 'EXECUTION_OUTPUT_FOLDER_ID'];
  var props = PropertiesService.getScriptProperties().getProperties();
  var missing = requiredProps.filter(function(k) { return !props[k]; });
  if (missing.length > 0) {
    results.push('SCRIPT_PROPERTIES: MISSING — ' + missing.join(', ') +
      '. Set them in Apps Script editor → Project Settings → Script Properties.');
  } else {
    results.push('SCRIPT_PROPERTIES: OK — all 4 secrets/IDs are set.');
  }

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

/**
 * diagnoseEnvironment() — Answers "which environment am I actually wired to?"
 *
 * Read-only. Prints to the execution log ONLY (does not write to Sync Log, so
 * it's safe to run against either environment without leaving a trace).
 *
 * Resolves every configured ID to a human-readable name and shows the Drive
 * folder path, so a prod/staging cross-wire is visible at a glance. Also
 * detects the CONFIG-shadowing failure mode by comparing the effective CONFIG
 * against raw Script Properties.
 *
 * Run this BEFORE moving any files between environments.
 */
/**
 * Build a human-readable Drive path for a folder by walking its parents.
 * This is what makes "Hive Mind Inbox" vs "Hive Mind Inbox - STAGING"
 * unambiguous when only the folder ID is configured.
 */
function folderPath_(folder) {
  var path = folder.getName();
  var p = folder.getParents();
  while (p.hasNext()) {
    var par = p.next();
    path = par.getName() + ' / ' + path;
    p = par.getParents();
  }
  return path;
}

function diagnoseEnvironment() {
  var out = [];
  function say(s) { out.push(s); Logger.log(s); }

  // ── 1. Shadowing check: raw Script Properties vs effective CONFIG ────────
  var props = PropertiesService.getScriptProperties().getProperties();
  say('=== CONFIG SOURCE ===');
  ['INBOX_FOLDER_ID', 'SPREADSHEET_ID', 'EXECUTION_OUTPUT_FOLDER_ID'].forEach(function(k) {
    var fromProps = props[k] || '(unset)';
    var effective = CONFIG[k] || '(undefined)';
    var flag = (fromProps === effective) ? 'match' : '*** MISMATCH — CONFIG IS SHADOWED ***';
    say(k + ':\n    ScriptProperty = ' + fromProps + '\n    effective      = ' + effective + '\n    ' + flag);
  });
  var keyProp = props.OPENAI_API_KEY || '';
  var keyEff  = CONFIG.OPENAI_API_KEY || '';
  say('OPENAI_API_KEY: ScriptProperty ' + (keyProp ? 'set (len ' + keyProp.length + ')' : 'UNSET') +
      ' | effective ' + (keyEff ? 'set (len ' + keyEff.length + ')' : 'UNSET') +
      (keyProp === keyEff ? ' | match' : ' | *** MISMATCH — CONFIG IS SHADOWED ***'));
  say('OPENAI_MODEL (effective): ' + CONFIG.OPENAI_MODEL);
  say('INBOX_BATCH_LIMIT (effective): ' + CONFIG.INBOX_BATCH_LIMIT +
      (typeof CONFIG.INBOX_BATCH_LIMIT === 'number' ? '' : '  *** undefined => CONFIG IS SHADOWED ***'));

  // ── 2. Inbox folder: name, full path, count, newest file ─────────────────
  say('');
  say('=== INBOX FOLDER (' + CONFIG.INBOX_FOLDER_ID + ') ===');
  try {
    var folder = DriveApp.getFolderById(CONFIG.INBOX_FOLDER_ID);
    say('path: ' + folderPath_(folder));

    var count = 0, newest = null, newestName = '';
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      count++;
      var u = f.getLastUpdated();
      if (!newest || u > newest) { newest = u; newestName = f.getName(); }
    }
    say('file count: ' + count);
    say('newest file: ' + (newestName || '(none)') +
        (newest ? '  [updated ' + Utilities.formatDate(newest, 'UTC', 'yyyy-MM-dd') + ']' : ''));
  } catch (e) {
    say('ERROR: ' + e.message);
  }

  // ── 2b. Execution output folder — must match the same environment ────────
  say('');
  say('=== EXECUTION OUTPUT FOLDER (' + CONFIG.EXECUTION_OUTPUT_FOLDER_ID + ') ===');
  try {
    if (!CONFIG.EXECUTION_OUTPUT_FOLDER_ID) {
      say('UNSET — workbench Doc creation will fail.');
    } else {
      var of = DriveApp.getFolderById(CONFIG.EXECUTION_OUTPUT_FOLDER_ID);
      say('path: ' + folderPath_(of));
      var oc = 0, oit = of.getFiles();
      while (oit.hasNext()) { oit.next(); oc++; }
      say('existing execution Docs: ' + oc);
    }
  } catch (e) {
    say('ERROR: ' + e.message);
  }

  // ── 3. Spreadsheet: name, board size, newest meeting_date ───────────────
  say('');
  say('=== SPREADSHEET (' + CONFIG.SPREADSHEET_ID + ') ===');
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    say('name: ' + ss.getName());
    var mb = ss.getSheetByName(CONFIG.TAB_MASTER);
    if (!mb) {
      say('Master Action Board: NOT FOUND');
    } else {
      var lastRow = mb.getLastRow();
      say('Master Action Board rows (excl. header): ' + Math.max(0, lastRow - 1));
      if (lastRow > 1) {
        // Newest meeting_date tells us whether this board received the
        // July artifacts or stopped in May.
        var dates = mb.getRange(2, MASTER_COLS.MEETING_DATE + 1, lastRow - 1, 1).getValues();
        var maxDate = '';
        for (var i = 0; i < dates.length; i++) {
          var d = String(dates[i][0] || '');
          if (d && d > maxDate) maxDate = d;
        }
        say('newest meeting_date on board: ' + (maxDate || '(none parseable)'));
      }
    }
    var ps = ss.getSheetByName(CONFIG.TAB_PROCESSED);
    say('Processed Sources rows: ' + (ps ? Math.max(0, ps.getLastRow() - 1) : 'TAB NOT FOUND'));
  } catch (e) {
    say('ERROR: ' + e.message);
  }

  // ── 4. Processed Sources status breakdown + cross-wire detection ─────────
  // IMPORTANT: Processed Sources holds two different kinds of ID in column B.
  //   status='copied'    → the SOURCE Doc ID, which lives wherever Meet put it
  //                        (typically "Meet Recordings"). Foreign parent is
  //                        expected and correct — do NOT flag it.
  //   status='processed' → the INBOX COPY ID, which must live in the
  //                        configured inbox folder.
  // Only 'processed' rows are meaningful for cross-wire detection.
  say('');
  say('=== PROCESSED SOURCES BREAKDOWN ===');
  try {
    var rows = getProcessedSourcesRows();
    var byStatus = {};
    for (var s = 0; s < rows.length; s++) {
      var st = String(rows[s][8] || '(blank)');
      byStatus[st] = (byStatus[st] || 0) + 1;
    }
    Object.keys(byStatus).forEach(function(k) { say('status "' + k + '": ' + byStatus[k] + ' row(s)'); });

    // Warn about the state that silently blocks all processing: files marked
    // processed while the board has no corresponding task rows.
    var processedCount = byStatus['processed'] || 0;
    if (processedCount > 0) {
      try {
        var ss3 = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
        var mb3 = ss3.getSheetByName(CONFIG.TAB_MASTER);
        var boardRows = mb3 ? Math.max(0, mb3.getLastRow() - 1) : 0;
        if (boardRows < processedCount / 10) {
          say('*** WARNING: ' + processedCount + " files marked 'processed' but only " +
              boardRows + ' row(s) on the board. Those files will be SKIPPED as ' +
              'already-done, so the board cannot repopulate. If you cleared the ' +
              'board, you must also clear Processed Sources. ***');
        }
      } catch (e4) {}
    }

    say('');
    say('=== CROSS-WIRE CHECK (up to 10 rows with status=processed) ===');
    var checked = 0, sameFolder = 0, otherFolder = {}, gone = 0, noParent = 0;
    for (var r = rows.length - 1; r >= 0 && checked < 10; r--) {
      if (String(rows[r][8]) !== 'processed') continue; // only copy IDs
      var fid = String(rows[r][1] || '');
      if (!fid) continue;
      checked++;
      try {
        var pf = DriveApp.getFileById(fid).getParents();
        var names = [];
        while (pf.hasNext()) names.push(pf.next().getId());
        if (names.length === 0) noParent++;
        else if (names.indexOf(CONFIG.INBOX_FOLDER_ID) !== -1) sameFolder++;
        else names.forEach(function(n) { otherFolder[n] = (otherFolder[n] || 0) + 1; });
      } catch (e2) { gone++; }
    }
    if (checked === 0) {
      say("no rows with status='processed' to check");
    } else {
      say('sampled: ' + checked + ' | in configured inbox: ' + sameFolder +
          ' | no visible parent: ' + noParent + ' | inaccessible/trashed: ' + gone);
      var keys = Object.keys(otherFolder);
      if (keys.length === 0) {
        say('no foreign parent folders detected');
      } else {
        say('*** processed copies parented OUTSIDE the configured inbox — cross-wire: ***');
        keys.forEach(function(k) {
          var nm = k;
          try { nm = DriveApp.getFolderById(k).getName(); } catch (e3) {}
          say('    ' + nm + '  (' + k + ')  x' + otherFolder[k]);
        });
      }
    }
  } catch (e) {
    say('ERROR: ' + e.message);
  }

  say('');
  say('=== DONE — copy this whole log ===');
  return out.join('\n');
}

// ============================================================
// EXECUTION WORKBENCH — Stage 3: Per-task LLM execution
// Spec: docs/superpowers/specs/2026-05-07-execution-workbench-design.md
// ============================================================

/**
 * Idempotent. Ensures the 10 workbench headers exist in columns Q–Z of
 * Master Action Board. Adds any that are missing without touching Q–Z values
 * in existing data rows. Logs which columns (if any) were added.
 */
function ensureExecutionColumns_(sheet) {
  var lastCol = sheet.getLastColumn();
  var existingHeaders = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || ''); })
    : [];

  var added = [];
  EXECUTION_HEADERS.forEach(function(header, i) {
    var targetCol = 17 + i; // 1-based: Q=17, R=18, ..., Z=26
    var current   = existingHeaders[targetCol - 1] || '';
    if (current !== header) {
      sheet.getRange(1, targetCol).setValue(header);
      added.push(header);
    }
  });

  if (added.length > 0) {
    logSyncActivity('exec_schema', '', '', 'Added ' + added.length + ' header(s): ' + added.join(', '));
  } else {
    logSyncActivity('exec_schema', '', '', 'All 10 workbench headers already present (no-op).');
  }
}

/**
 * Read Master Action Board and return up to EXECUTION_BATCH_LIMIT candidate
 * rows for this pass. A row is a candidate iff:
 *   - status (col D) != 'done' (case-insensitive, trimmed)
 *   - AND (Execution Output Link empty OR Force Re-run == 'Yes')
 *
 * Returns: array of { rowNum, values } objects.
 *   rowNum is 1-based sheet row (header is 1, data starts at 2).
 *   values is the full row array, length >= 26.
 */
function findExecutionCandidates_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var width = sheet.getLastColumn();
  var rows  = sheet.getRange(2, 1, lastRow - 1, width).getValues();

  var candidates = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var status     = String(r[MASTER_COLS.STATUS] || '').trim().toLowerCase();
    var outputLink = String(r[EXECUTION_COLS.EXECUTION_OUTPUT_LINK] || '').trim();
    var forceRerun = String(r[EXECUTION_COLS.FORCE_RERUN] || '').trim().toLowerCase();

    if (status === 'done') continue;
    if (outputLink && forceRerun !== 'yes') continue;

    candidates.push({ rowNum: i + 2, values: r });
    if (candidates.length >= CONFIG.EXECUTION_BATCH_LIMIT) break;
  }

  return candidates;
}

/**
 * Build the classifier system prompt. Mirrors the rubric in the design spec §6.2.
 * The OKR list is appended last; everything else is fixed instruction text.
 */
function buildClassifierSystemPrompt_(okrContext) {
  return [
    'You are a task classifier for a founder execution workbench. Each input row is one action item from a Master Action Board fed by meeting transcripts. Your job is to decide whether an LLM should produce a deliverable for this row, what kind of deliverable, and what (if anything) is missing.',
    '',
    'Output JSON ONLY — no markdown fences, no commentary, no extra fields. Schema:',
    '{',
    '  "execution_needed": "Yes" | "No",',
    '  "is_executable": true | false,',
    '  "execution_type": string,           // short label: "draft email", "summary", "checklist", "doc outline", "spec", "agenda", etc. Empty string if execution_needed is No.',
    '  "missing_info": string,             // concrete missing facts (audience, success criteria, links, definitions). Empty string when nothing concrete is missing.',
    '  "generated_prompt": string,         // the exact prompt to send to a downstream execution LLM. Empty string if execution_needed is No or is_executable is false.',
    '  "should_execute_now": true | false  // see HARD RULE below',
    '}',
    '',
    'execution_needed = "No" when:',
    '- The task is a pure human commitment (relationship building, decisions only the owner can make, in-person work).',
    '- The next step is to talk to a person, attend a meeting, sign a document, or operate physical/credentialed systems.',
    '- The task is purely administrative scheduling that does not benefit from a written deliverable.',
    '- The task is already complete or trivially obvious (no LLM value-add).',
    '',
    'is_executable = false when:',
    '- An LLM cannot produce the deliverable even with perfect context: signing, calling, paying, attending, deploying, demoing in person, anything requiring credentials or human presence.',
    '',
    'missing_info should list CONCRETE GAPS, not vague "needs more detail":',
    '- Who is the audience? What is the desired tone? What is the success criterion? What URL / doc / metric is referenced? What constraints apply?',
    '- Empty string when the task already has enough context for an LLM to produce a useful first draft.',
    '',
    'generated_prompt rules:',
    '- Self-contained: assume the executor has only this prompt + the row\'s own context.',
    '- Specify the deliverable format explicitly (e.g. "Output a 3-paragraph email in plain text").',
    '- Include relevant constraints from the row: audience, tone, length, format.',
    '- Reference the OKR link if the task is OKR-aligned.',
    '- Do NOT include a JSON wrapper. Plain instruction prose.',
    '',
    'HARD RULE for should_execute_now:',
    '- should_execute_now = true if and only if execution_needed == "Yes" AND is_executable == true AND missing_info == "".',
    '- Otherwise should_execute_now = false.',
    '',
    'Respond with JSON only. No prose.',
    '',
    'OKR list for context (use okr_link from the row, do not invent):',
    okrContext || '(no OKR list available)'
  ].join('\n');
}

/**
 * Build the classifier user-message input. One row's data plus its
 * Execution Context (column R) — the place users add facts the transcript missed.
 */
function buildClassifierInput_(rowValues) {
  var v = rowValues;
  return [
    'task_id: '          + String(v[MASTER_COLS.TASK_ID]       || ''),
    'task: '             + String(v[MASTER_COLS.TASK]          || ''),
    'owner: '            + String(v[MASTER_COLS.OWNER]         || ''),
    'status: '           + String(v[MASTER_COLS.STATUS]        || ''),
    'urgency: '          + String(v[MASTER_COLS.URGENCY]       || ''),
    'due_date: '         + String(v[MASTER_COLS.DUE_DATE]      || ''),
    'next_step: '        + String(v[MASTER_COLS.NEXT_STEP]     || ''),
    'blockers: '         + String(v[MASTER_COLS.BLOCKERS]      || ''),
    'dependencies: '     + String(v[MASTER_COLS.DEPENDENCIES]  || ''),
    'okr_link: '         + String(v[MASTER_COLS.OKR_LINK]      || ''),
    'risk_flag: '        + String(v[MASTER_COLS.RISK_FLAG]     || ''),
    'meeting_title: '    + String(v[MASTER_COLS.MEETING_TITLE] || ''),
    'meeting_date: '     + String(v[MASTER_COLS.MEETING_DATE]  || ''),
    'execution_context: ' + String(v[EXECUTION_COLS.EXECUTION_CONTEXT] || '(none provided)')
  ].join('\n');
}

/**
 * Call OpenAI to classify one row. Returns the parsed JSON object on success,
 * or throws with a descriptive message. Logs prompt sizes and raw response head.
 *
 * Endpoint routing matches parseWithHiveMind: gpt-5+ uses /v1/responses,
 * gpt-4o and earlier use /v1/chat/completions.
 */
function classifyTask_(rowValues, okrContext) {
  var taskId       = String(rowValues[MASTER_COLS.TASK_ID] || '(no-id)');
  var systemPrompt = buildClassifierSystemPrompt_(okrContext);
  var userInput    = buildClassifierInput_(rowValues);

  logSyncActivity('exec_classify_prompt', taskId, '', 'system=' + systemPrompt.length + ' chars | user=' + userInput.length + ' chars');

  var isResponsesApi = !CONFIG.OPENAI_MODEL.startsWith('gpt-4');
  var endpoint, payload;
  if (isResponsesApi) {
    // NOTE: gpt-5 via the Responses API rejects `temperature` with HTTP 400
    // ("Unsupported parameter: 'temperature' is not supported with this model").
    // Do NOT add temperature here.
    endpoint = 'https://api.openai.com/v1/responses';
    payload = {
      model:             CONFIG.OPENAI_MODEL,
      instructions:      systemPrompt,
      input:             userInput,
      // Classification is small structured JSON — minimize reasoning so the
      // model doesn't burn its token budget on hidden CoT and starve the message.
      reasoning:         { effort: 'low' },
      max_output_tokens: 4000
    };
  } else {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    payload = {
      model:       CONFIG.OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userInput }
      ]
    };
  }

  var response = UrlFetchApp.fetch(endpoint, {
    method:          'post',
    contentType:     'application/json',
    headers:         { 'Authorization': 'Bearer ' + CONFIG.OPENAI_API_KEY },
    payload:         JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body   = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Classifier HTTP ' + status + ': ' + body.slice(0, 400));
  }

  var rawText = extractOpenAIText_(body, isResponsesApi);
  logSyncActivity('exec_classify_raw', taskId, '', 'first 800 chars: ' + rawText.slice(0, 800));

  var parsed;
  try {
    parsed = JSON.parse(stripCodeFences_(rawText));
  } catch (e) {
    throw new Error('Classifier returned non-JSON: ' + rawText.slice(0, 400));
  }

  // Coerce defensive defaults so downstream code can rely on shape.
  parsed.execution_needed   = String(parsed.execution_needed   || 'No');
  parsed.is_executable      = parsed.is_executable === true;
  parsed.execution_type     = String(parsed.execution_type     || '');
  parsed.missing_info       = String(parsed.missing_info       || '');
  parsed.generated_prompt   = String(parsed.generated_prompt   || '');
  parsed.should_execute_now = parsed.should_execute_now === true;

  logSyncActivity('exec_classify_parsed', taskId, '',
    'execution_needed=' + parsed.execution_needed +
    ' | is_executable=' + parsed.is_executable +
    ' | execution_type="' + parsed.execution_type + '"' +
    ' | missing_info=' + (parsed.missing_info ? parsed.missing_info.length + ' chars' : 'empty') +
    ' | generated_prompt=' + (parsed.generated_prompt ? parsed.generated_prompt.length + ' chars' : 'empty') +
    ' | should_execute_now=' + parsed.should_execute_now);

  return parsed;
}

/**
 * Extract the assistant text from an OpenAI response body.
 * Responses API: prefer body.output_text, fall back to body.output[0].content[0].text.
 * Chat Completions: body.choices[0].message.content.
 */
function extractOpenAIText_(rawJson, isResponsesApi) {
  var body = JSON.parse(rawJson);
  if (isResponsesApi) {
    if (body.output_text) return String(body.output_text);
    // gpt-5 (reasoning model) returns output[] as a sequence: typically a
    // {type:"reasoning"} item first, then a {type:"message"} item with the text.
    // Scan all items to find the first one that carries content[].text.
    if (body.output && body.output.length) {
      for (var i = 0; i < body.output.length; i++) {
        var item = body.output[i];
        if (item && item.content && item.content.length) {
          for (var j = 0; j < item.content.length; j++) {
            var part = item.content[j];
            if (part && part.text) return String(part.text);
          }
        }
      }
    }
    // Include status + truncated raw body so the failure is diagnosable from logs.
    var status = body.status ? ' status=' + body.status : '';
    var incomplete = (body.incomplete_details && body.incomplete_details.reason)
      ? ' incomplete=' + body.incomplete_details.reason : '';
    throw new Error('Responses API: no output_text or output[].content[].text in response.' +
      status + incomplete + ' raw(0..600)=' + rawJson.slice(0, 600));
  } else {
    if (body.choices && body.choices.length && body.choices[0].message && body.choices[0].message.content) {
      return String(body.choices[0].message.content);
    }
    throw new Error('Chat Completions: no choices[0].message.content in response');
  }
}

/**
 * Strip ```json ... ``` or ``` ... ``` code fences if the model added them
 * despite the JSON-only instruction.
 */
function stripCodeFences_(text) {
  return String(text)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Map a classification result to (status, statusReason) per spec §5.1.
 * - Missing Info wins over Not Automatable when both could apply.
 * - Distinguishes the two Not Automatable reasons exactly.
 */
function classificationToStatus_(c) {
  if (c.execution_needed === 'No') {
    return { status: EXEC_STATUS.NOT_AUTOMATABLE, reason: 'Automation not selected by model' };
  }
  if (c.is_executable === false) {
    return { status: EXEC_STATUS.NOT_AUTOMATABLE, reason: 'Task not suitable for an LLM' };
  }
  if (c.missing_info && c.missing_info.length > 0) {
    return { status: EXEC_STATUS.MISSING_INFO, reason: 'Classifier reported gaps; see Missing Info column' };
  }
  if (!c.generated_prompt) {
    return { status: EXEC_STATUS.MISSING_INFO, reason: 'Classifier did not produce a generated_prompt' };
  }
  return { status: EXEC_STATUS.READY_FOR_EXECUTION, reason: '' };
}

/**
 * Write the 5 classification columns to a single row.
 * Columns Q, S, T, U, V. Leaves R (user-edited Execution Context) and
 * W/X/Y/Z (executor + user) untouched.
 */
function writeClassificationToRow_(sheet, rowNum, c, statusInfo) {
  // Q (17): Execution Needed
  sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_NEEDED + 1).setValue(c.execution_needed);
  // S (19): Execution Type
  sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_TYPE + 1).setValue(c.execution_type);
  // T (20): Missing Info
  sheet.getRange(rowNum, EXECUTION_COLS.MISSING_INFO + 1).setValue(c.missing_info);
  // U (21): Execution Status
  sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS + 1).setValue(statusInfo.status);
  // V (22): Execution Status Reason
  sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS_REASON + 1).setValue(statusInfo.reason);

  logSyncActivity('exec_writeback', String(c.__taskId || ''), '',
    'row ' + rowNum +
    ' | status=' + statusInfo.status +
    ' | reason=' + (statusInfo.reason || '(empty)') +
    ' | execution_type=' + c.execution_type);
}

/**
 * Scan column W (Latest Execution ID) for EX-#### values and return the next one.
 * Format: EX-0001, EX-0002, ... zero-padded to 4 digits.
 *
 * @param {Sheet} sheet  Master Action Board sheet
 * @return {string}      Next monotonic EX-#### ID
 */
function generateExecutionId_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'EX-0001';

  var ids = sheet.getRange(2, EXECUTION_COLS.LATEST_EXECUTION_ID + 1, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < ids.length; i++) {
    var m = String(ids[i][0] || '').match(/^EX-(\d+)$/);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }

  var next = max + 1;
  return 'EX-' + ('0000' + next).slice(-4);
}

/**
 * Create a per-task execution Google Doc inside CONFIG.EXECUTION_OUTPUT_FOLDER_ID,
 * with the QA layout from spec §6.1: metadata table, Generated Prompt, LLM Output,
 * Missing Info, Review Notes.
 *
 * Returns the Doc URL.
 */
function createExecutionDoc_(rowValues, classification, output, executionId) {
  var taskId        = String(rowValues[MASTER_COLS.TASK_ID]       || '');
  var task          = String(rowValues[MASTER_COLS.TASK]          || '');
  var owner         = String(rowValues[MASTER_COLS.OWNER]         || '');
  var meetingTitle  = String(rowValues[MASTER_COLS.MEETING_TITLE] || '');
  var meetingDate   = String(rowValues[MASTER_COLS.MEETING_DATE]  || '');
  var okrLink       = String(rowValues[MASTER_COLS.OKR_LINK]      || '');
  var executionType = String(classification.execution_type        || '');
  var missingInfo   = String(classification.missing_info          || '');
  var generatedPrompt = String(classification.generated_prompt    || '');

  var truncatedTask = task.length > 60 ? task.slice(0, 57) + '...' : task;
  var datePrefix    = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  var docTitle      = '[' + executionId + ' ' + datePrefix + '] ' + truncatedTask;

  var doc  = DocumentApp.create(docTitle);
  var body = doc.getBody();
  body.clear();

  // 1. Heading 1 — TaskID + task
  body.appendParagraph(taskId + ' · ' + task).setHeading(DocumentApp.ParagraphHeading.HEADING1);

  // 2. Metadata table
  var metaTable = body.appendTable([
    ['Task ID',       taskId],
    ['Execution ID',  executionId],
    ['Execution Type', executionType],
    ['Owner',         owner],
    ['Created At',    new Date().toISOString()],
    ['Source meeting', (meetingTitle || '(unknown)') + ' — ' + (meetingDate || '(no date)')],
    ['OKR link',      okrLink || '(none)']
  ]);
  // Bold the first column
  for (var r = 0; r < metaTable.getNumRows(); r++) {
    metaTable.getCell(r, 0).getChild(0).asParagraph().editAsText().setBold(true);
  }

  // 3. Generated Prompt (monospaced for QA legibility)
  body.appendParagraph('Generated Prompt (sent to execution LLM — for QA)')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var promptPara = body.appendParagraph(generatedPrompt || '(empty)');
  promptPara.editAsText().setFontFamily('Roboto Mono');

  // 4. LLM Output
  body.appendParagraph('LLM Output').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(output || '(empty)');

  // 5. Missing Info
  body.appendParagraph('Missing Info (from classification)').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(missingInfo || 'None noted');

  // 6. Review Notes (empty)
  body.appendParagraph('Review Notes').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(''); // intentional: reviewer fills this in

  doc.saveAndClose();

  // Move the Doc into the configured output folder
  var folder = DriveApp.getFolderById(CONFIG.EXECUTION_OUTPUT_FOLDER_ID);
  DriveApp.getFileById(doc.getId()).moveTo(folder);

  var url = doc.getUrl();
  logSyncActivity('exec_doc', taskId, doc.getName(), url);
  return url;
}

/**
 * Run the execution LLM against a generated prompt. Returns the raw output text.
 * Uses the same endpoint-routing as classifyTask_; minimal system instructions —
 * the classifier owns task framing, the executor just produces the deliverable.
 */
function executeTask_(generatedPrompt, taskId) {
  if (!generatedPrompt) throw new Error('executeTask_ called with empty generated_prompt');

  var systemPrompt = 'You are an execution assistant. Produce the deliverable described in the user\'s prompt. Output only the deliverable; no preamble or explanation.';

  logSyncActivity('exec_run_prompt', taskId, '', 'first 200 chars: ' + generatedPrompt.slice(0, 200).replace(/\n/g, ' '));

  var isResponsesApi = !CONFIG.OPENAI_MODEL.startsWith('gpt-4');
  var endpoint, payload;
  if (isResponsesApi) {
    // gpt-5 Responses API rejects `temperature` (HTTP 400). Do NOT add it.
    endpoint = 'https://api.openai.com/v1/responses';
    payload = {
      model:             CONFIG.OPENAI_MODEL,
      instructions:      systemPrompt,
      input:             generatedPrompt,
      // Executor produces a finished deliverable (email/draft/brief). Low
      // reasoning effort keeps latency/cost down; the higher token cap lets
      // longer deliverables (multi-paragraph emails, briefs) complete.
      reasoning:         { effort: 'low' },
      max_output_tokens: 18000
    };
  } else {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    payload = {
      model:       CONFIG.OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: generatedPrompt }
      ]
    };
  }

  var response = UrlFetchApp.fetch(endpoint, {
    method:          'post',
    contentType:     'application/json',
    headers:         { 'Authorization': 'Bearer ' + CONFIG.OPENAI_API_KEY },
    payload:         JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body   = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Executor HTTP ' + status + ': ' + body.slice(0, 400));
  }

  var output = extractOpenAIText_(body, isResponsesApi);
  logSyncActivity('exec_run_raw', taskId, '', 'first 800 chars: ' + output.slice(0, 800));

  return output;
}

/**
 * For one row that passed the gate: run the executor, create the Doc, write
 * the executor columns (W/X/Y), set status = Ready for Review, clear Force Re-run.
 *
 * On executor or Doc failure: leaves status = Ready for Execution, writes the
 * truncated error to Execution Status Reason. Row will retry next pass.
 */
function executeAndWriteback_(sheet, candidate) {
  var rowNum = candidate.rowNum;
  var c      = candidate.classification;
  var taskId = String(candidate.values[MASTER_COLS.TASK_ID] || '(no-id)');

  try {
    var output      = executeTask_(c.generated_prompt, taskId);
    var executionId = generateExecutionId_(sheet);
    var docUrl      = createExecutionDoc_(candidate.values, c, output, executionId);
    var nowIso      = new Date().toISOString();

    sheet.getRange(rowNum, EXECUTION_COLS.LATEST_EXECUTION_ID + 1).setValue(executionId);
    sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_OUTPUT_LINK + 1).setValue(docUrl);
    sheet.getRange(rowNum, EXECUTION_COLS.LAST_EXECUTED_AT + 1).setValue(nowIso);
    sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS + 1).setValue(EXEC_STATUS.READY_FOR_REVIEW);
    sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS_REASON + 1).setValue('');
    sheet.getRange(rowNum, EXECUTION_COLS.FORCE_RERUN + 1).setValue('No');

    logSyncActivity('exec_writeback', taskId, '',
      'row ' + rowNum +
      ' | status=' + EXEC_STATUS.READY_FOR_REVIEW +
      ' | execution_id=' + executionId +
      ' | doc=' + docUrl);
    return true;
  } catch (e) {
    var msg = e.message ? e.message.slice(0, 300) : String(e);
    sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS_REASON + 1).setValue('Executor error: ' + msg);
    logSyncActivity('exec_error', taskId, '', 'execute stage: ' + msg);
    return false;
  }
}

/**
 * Apply the execute gate per spec §5.2 and log the decision.
 */
function passesExecuteGate_(c) {
  return c.execution_needed === 'Yes'
      && c.is_executable === true
      && (!c.missing_info || c.missing_info.length === 0)
      && c.generated_prompt
      && c.generated_prompt.length > 0;
}

/**
 * Entrypoint for both the menu item and the hourly time trigger.
 */
function runExecutionWorkbench() {
  // getScriptLock works for both standalone and container-bound scripts;
  // getDocumentLock returns null in standalone projects.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    logSyncActivity('exec_skipped', '', '', 'Another workbench pass is already running — skipped.');
    return;
  }

  try {
    logSyncActivity('exec_start', '', '', 'Workbench pass starting (batch limit ' + CONFIG.EXECUTION_BATCH_LIMIT + ').');

    var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CONFIG.TAB_MASTER);
    if (!sheet) throw new Error('Tab "' + CONFIG.TAB_MASTER + '" not found in spreadsheet');

    ensureExecutionColumns_(sheet);

    var candidates = findExecutionCandidates_(sheet);
    var preview    = candidates.slice(0, 5).map(function(c) {
      return String(c.values[MASTER_COLS.TASK_ID] || '(no id)') + ' (row ' + c.rowNum + ')';
    }).join(', ');
    logSyncActivity('exec_candidates', '', '', candidates.length + ' candidate row(s); first 5: ' + (preview || '(none)'));

    if (candidates.length === 0) {
      logSyncActivity('exec_done', '', '', 'Workbench pass complete — no candidates.');
      return;
    }

    var okrContext = fetchOKRContext();

    var classified = 0;
    var classifyErrors = 0;
    candidates.forEach(function(c) {
      var taskId = String(c.values[MASTER_COLS.TASK_ID] || '(no-id)');
      try {
        var classification = classifyTask_(c.values, okrContext);
        classification.__taskId = taskId;
        var statusInfo = classificationToStatus_(classification);
        writeClassificationToRow_(sheet, c.rowNum, classification, statusInfo);
        c.classification = classification;
        c.statusInfo     = statusInfo;
        classified++;
      } catch (e) {
        classifyErrors++;
        logSyncActivity('exec_error', taskId, '', 'classify stage: ' + e.message.slice(0, 300));
      }
    });

    var executed = 0;
    var executeErrors = 0;
    candidates.forEach(function(c) {
      if (!c.classification) return;
      var taskId = String(c.values[MASTER_COLS.TASK_ID] || '(no-id)');
      var pass   = passesExecuteGate_(c.classification);
      logSyncActivity('exec_gate', taskId, '', pass ? 'PASS — executing' : 'SKIP — gate not met');
      if (!pass) return;

      var ok = executeAndWriteback_(sheet, c);
      if (ok) executed++; else executeErrors++;
    });

    logSyncActivity('exec_done', '', '',
      'Workbench pass complete — candidates=' + candidates.length +
      ' | classified=' + classified +
      ' | executed=' + executed +
      ' | classify_errors=' + classifyErrors +
      ' | execute_errors=' + executeErrors);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Apps Script lifecycle hook. Runs every time the spreadsheet is opened
 * by an editor user. Adds the "Execution Workbench" menu.
 *
 * Note: simple triggers like onOpen run as the user, with limited auth.
 * This menu only adds menu items — the menu actions themselves run with
 * full auth when clicked.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu('Execution Workbench')
    .addItem('Run execution workbench', 'runExecutionWorkbench')
    .addItem('Install / refresh hourly trigger', 'setupExecutionTrigger_')
    .addItem('Remove hourly trigger', 'removeExecutionTrigger_')
    .addToUi();

  ui.createMenu('Hive Mind Sync')
    .addItem('Process inbox (last ' + CONFIG.PROCESS_LOOKBACK_DAYS + ' days)', 'processInbox')
    .addItem('Process inbox — custom window…', 'promptProcessInboxSince')
    .addItem('Process inbox — ALL dates (slow)', 'confirmProcessInboxAll')
    .addSeparator()
    .addItem('Diagnose environment (prod vs staging)', 'diagnoseEnvironment')
    .addItem('Diagnose config', 'diagnoseConfig')
    .addToUi();
}

/**
 * Menu handler: ask for a lookback window, then run processInbox with it.
 */
function promptProcessInboxSince() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    'Process inbox — custom window',
    'How many days back? (meetings dated on/after today minus N)\n\n' +
    'Default is ' + CONFIG.PROCESS_LOOKBACK_DAYS + '. Larger windows cost more ' +
    'OpenAI spend and take longer.',
    ui.ButtonSet.OK_CANCEL);

  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var days = parseInt(resp.getResponseText(), 10);
  if (isNaN(days) || days <= 0) {
    ui.alert('Not a valid number of days — nothing ran.');
    return;
  }
  processInbox(days);
  ui.alert('Done. See the Sync Log tab for the process_done summary.');
}

/**
 * Menu handler: confirm before running with no date filter, since this can
 * process hundreds of archived transcripts across many runs.
 */
function confirmProcessInboxAll() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    'Process ALL dates?',
    'This ignores the ' + CONFIG.PROCESS_LOOKBACK_DAYS + '-day window and makes every ' +
    'unprocessed transcript eligible, including archived ones and any without a ' +
    '"[HM YYYY-MM-DD]" filename prefix.\n\n' +
    'It still processes only ' + CONFIG.INBOX_BATCH_LIMIT + ' per run, so you may need ' +
    'to run it many times. Each file costs an OpenAI call.\n\nContinue?',
    ui.ButtonSet.YES_NO);

  if (resp !== ui.Button.YES) return;
  processInboxAll();
  ui.alert('Done. See the Sync Log tab for the process_done summary.');
}

/**
 * Idempotent. Removes any existing time triggers for runExecutionWorkbench
 * and creates a fresh hourly trigger. Run this once per project deployment.
 */
function setupExecutionTrigger_() {
  removeExecutionTrigger_();
  ScriptApp.newTrigger('runExecutionWorkbench')
    .timeBased()
    .everyHours(1)
    .create();
  SpreadsheetApp.getUi().alert('Hourly trigger installed for runExecutionWorkbench.');
  logSyncActivity('exec_trigger_install', '', '', 'Hourly trigger created.');
}

/**
 * Removes any time-based triggers pointing at runExecutionWorkbench.
 * Safe to call when none exist (no-op).
 */
function removeExecutionTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed  = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'runExecutionWorkbench') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed > 0) {
    logSyncActivity('exec_trigger_remove', '', '', 'Removed ' + removed + ' trigger(s).');
  }
}
