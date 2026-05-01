/**
 * Week 4–5: command-center workbook tabs and column order (row 1 = headers).
 * Sheet range names use A1; tab names with spaces are quoted in API calls by googleSheets helpers.
 */

const TABS = {
  MASTER: process.env.SHEET_TAB_MASTER || "Master Action Board",
  PROCESSED: process.env.SHEET_TAB_PROCESSED || "Processed Transcripts",
  POLLING_LOG: process.env.SHEET_TAB_POLLING_LOG || "Polling Log",
  CONFIG: process.env.SHEET_TAB_CONFIG || "Config",
};

/** Master Action Board: base (A–P) + Week 5 execution columns (Q–AA). Doc links column is last to avoid shifting existing Q–Z data. */
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
  "execution_needed",
  "execution_context",
  "execution_type",
  "missing_info",
  "execution_status",
  "execution_status_reason",
  "latest_execution_id",
  "execution_output_link",
  "last_executed_at",
  "force_rerun",
  "execution_context_doc_links",
];

/** Row 1 labels for execution extension columns (Q onward), in sheet column order. */
const MASTER_EXECUTION_HEADER_LABELS = [
  "Execution Needed",
  "Execution Context",
  "Execution Type",
  "Missing Info",
  "Execution Status",
  "Execution Status Reason",
  "Latest Execution ID",
  "Execution Output Link",
  "Last Executed At",
  "Force Re-run",
  "Execution Context Doc Links",
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

const MASTER_BASE_COL_COUNT = 16;
const MASTER_COL_COUNT = MASTER_COLUMNS.length;
const PROCESSED_COL_COUNT = PROCESSED_COLUMNS.length;
const POLLING_LOG_COL_COUNT = POLLING_LOG_COLUMNS.length;

/** 1-based column index to A1 column letter(s). */
function columnToA1Letter(col1Based) {
  let n = col1Based;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function masterEndColumnLetter() {
  return columnToA1Letter(MASTER_COL_COUNT);
}

module.exports = {
  TABS,
  MASTER_COLUMNS,
  MASTER_EXECUTION_HEADER_LABELS,
  MASTER_BASE_COL_COUNT,
  PROCESSED_COLUMNS,
  POLLING_LOG_COLUMNS,
  MASTER_COL_COUNT,
  PROCESSED_COL_COUNT,
  POLLING_LOG_COL_COUNT,
  columnToA1Letter,
  masterEndColumnLetter,
};
