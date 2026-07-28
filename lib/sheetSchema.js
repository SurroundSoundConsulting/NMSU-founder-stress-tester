/**
 * Week 4 lab: founder command-center workbook tabs and column order (row 1 = headers).
 * Sheet range names use A1; tab names with spaces are quoted in API calls by googleSheets helpers.
 */

const TABS = {
  MASTER: process.env.SHEET_TAB_MASTER || "Master Action Board",
  PROCESSED: process.env.SHEET_TAB_PROCESSED || "Processed Transcripts",
  POLLING_LOG: process.env.SHEET_TAB_POLLING_LOG || "Polling Log",
  CONFIG: process.env.SHEET_TAB_CONFIG || "Config",
};

/** Master Action Board: column letters A–P in order. */
const MASTER_COLUMNS = [
  "task_id",
  "task",
  "owner",
  "status",
  "urgency",
  "due_date",
  "next_step",
  "blockers",
  "dependencies",
  "okr_link",
  "risk_flag",
  "source_transcript_id",
  "meeting_title",
  "meeting_date",
  "created_at",
  "updated_at",
];

const PROCESSED_COLUMNS = [
  "fireflies_transcript_id",
  "meeting_title",
  "meeting_date",
  "processed_at",
  "status",
  "source_url",
];

const POLLING_LOG_COLUMNS = ["timestamp", "step", "fireflies_transcript_id", "message"];

const MASTER_COL_COUNT = MASTER_COLUMNS.length; // 16 = P
const PROCESSED_COL_COUNT = PROCESSED_COLUMNS.length; // 6
const POLLING_LOG_COL_COUNT = POLLING_LOG_COLUMNS.length; // 4

module.exports = {
  TABS,
  MASTER_COLUMNS,
  PROCESSED_COLUMNS,
  POLLING_LOG_COLUMNS,
  MASTER_COL_COUNT,
  PROCESSED_COL_COUNT,
  POLLING_LOG_COL_COUNT,
};
