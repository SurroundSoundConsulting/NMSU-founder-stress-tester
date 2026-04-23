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
