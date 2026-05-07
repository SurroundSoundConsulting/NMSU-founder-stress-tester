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

/** Master Action Board: base (A–P) + Week 5 execution (Q–AA) + Week 6 Enforcer (AB onward). */
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
  "universal_task_artifact_score",
  "final_enforcer_score",
  "revision_count",
  "revision_delta",
  "best_revision_url",
  "latest_revision_url",
  "ready_for_production",
  "stop_reason",
  "human_feedback_captured",
  "general_rules_updated",
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

/** Week 6 QA / Enforcer columns (after execution extension), row 1 labels in sheet order. */
const MASTER_ENFORCER_HEADER_LABELS = [
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

/** Legacy header text → current label (row 1 upgrades). */
const MASTER_ENFORCER_HEADER_LEGACY_UPGRADE = {
  "Ready for Human Review": "Ready for Production",
  "Universal Score": "Universal/Task/Artifact Score",
  "Universal Score (generic QA)": "Universal/Task/Artifact Score",
  "Final Enforcer Score": "Final Enforcer Score (combined)",
  "Revision Delta": "Revision Delta (new vs baseline)",
};

/** Number of execution-extension columns (same length as MASTER_EXECUTION_HEADER_LABELS). */
const MASTER_EXECUTION_EXTENSION_COUNT = MASTER_EXECUTION_HEADER_LABELS.length;

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

/** Legacy layout had three separate score columns before `universal_task_artifact_score`. */
const MASTER_LEGACY_EXTRA_SCORE_COLUMNS = 2;

/** Single cell: universal / task-type / task-specific scores (sheet display). */
function formatUniversalTaskArtifactCell(u, tt, ts) {
  const a = String(u ?? "").trim();
  const b = String(tt ?? "").trim();
  const c = String(ts ?? "").trim();
  if (!a && !b && !c) return "";
  return [a, b, c].map((x) => (x === "" ? "-" : x)).join("/");
}

/** 0-based column index where Week 6 Enforcer block starts (QA Status). */
function masterEnforcerBlockStartIndex() {
  return MASTER_BASE_COL_COUNT + MASTER_EXECUTION_EXTENSION_COUNT;
}

module.exports = {
  TABS,
  MASTER_COLUMNS,
  MASTER_EXECUTION_HEADER_LABELS,
  MASTER_ENFORCER_HEADER_LABELS,
  MASTER_ENFORCER_HEADER_LEGACY_UPGRADE,
  MASTER_EXECUTION_EXTENSION_COUNT,
  MASTER_BASE_COL_COUNT,
  MASTER_LEGACY_EXTRA_SCORE_COLUMNS,
  PROCESSED_COLUMNS,
  POLLING_LOG_COLUMNS,
  MASTER_COL_COUNT,
  PROCESSED_COL_COUNT,
  POLLING_LOG_COL_COUNT,
  columnToA1Letter,
  masterEndColumnLetter,
  formatUniversalTaskArtifactCell,
  masterEnforcerBlockStartIndex,
};
