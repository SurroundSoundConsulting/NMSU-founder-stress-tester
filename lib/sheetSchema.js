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

/** Master Action Board: base (A–P) + Week 5 execution columns (Q–AA) + Week 6 QA / Enforcer block. */
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
  "qa_status",
  "qa_scores_merged",
  "qa_final_score",
  "qa_revision_count",
  "qa_revision_delta",
  "qa_best_revision_url",
  "qa_latest_revision_url",
  "qa_ready_for_production",
  "qa_stop_reason",
  "qa_human_feedback_captured",
  "qa_general_rules_updated",
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

/** Week 6: row-1 labels for QA / Enforcer columns (immediately after execution extension). */
const MASTER_QA_HEADER_LABELS = [
  "QA Status",
  "Universal/Task/Artifact Score",
  "Final Enforcer Score (combined)",
  "Revision Count",
  "Revision Delta (new vs baseline)",
  "Best Revision URL",
  "Latest Revision URL",
  "Ready for Production",
  "Stop Reason",
  "Human Feedback Captured",
  "General Rules Updated",
];

/** Legacy header → current label (row-1 upgrades). */
const MASTER_QA_LEGACY_HEADER_MAP = {
  "Universal Score": "Universal/Task/Artifact Score",
  "Task Type Score": "Universal/Task/Artifact Score",
  "Task Specific Score": "Universal/Task/Artifact Score",
};

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
const MASTER_EXECUTION_EXTENSION_COUNT = MASTER_EXECUTION_HEADER_LABELS.length;
/** 0-based index where Week 6 QA block starts (after base + execution columns). */
const MASTER_QA_START_INDEX = MASTER_BASE_COL_COUNT + MASTER_EXECUTION_EXTENSION_COUNT;
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

/**
 * @param {string} columnKey - key from MASTER_COLUMNS
 * @returns {number} 0-based index
 */
function masterColumnIndex(columnKey) {
  const i = MASTER_COLUMNS.indexOf(columnKey);
  if (i < 0) throw new Error("Unknown MASTER_COLUMNS key: " + columnKey);
  return i;
}

/**
 * @param {number|null|undefined} u
 * @param {number|null|undefined} tt
 * @param {number|null|undefined} ts
 * @returns {string} e.g. "85/80/90" or "85/-/90"
 */
function formatMergedScores(u, tt, ts) {
  const seg = (n) =>
    n !== null && n !== undefined && Number.isFinite(Number(n)) ? String(Math.round(Number(n))) : "-";
  return [seg(u), seg(tt), seg(ts)].join("/");
}

module.exports = {
  TABS,
  MASTER_COLUMNS,
  MASTER_EXECUTION_HEADER_LABELS,
  MASTER_QA_HEADER_LABELS,
  MASTER_QA_LEGACY_HEADER_MAP,
  MASTER_BASE_COL_COUNT,
  MASTER_EXECUTION_EXTENSION_COUNT,
  MASTER_QA_START_INDEX,
  PROCESSED_COLUMNS,
  POLLING_LOG_COLUMNS,
  MASTER_COL_COUNT,
  PROCESSED_COL_COUNT,
  POLLING_LOG_COL_COUNT,
  columnToA1Letter,
  masterEndColumnLetter,
  masterColumnIndex,
  formatMergedScores,
};
