const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/**
 * Command-center spreadsheet id (lab: GOOGLE_SHEET_ID). Falls back to existing Hive export var.
 */
function getCommandCenterSpreadsheetId() {
  return (
    String(process.env.GOOGLE_SHEET_ID || "").trim() ||
    String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim()
  );
}

function getFirefliesApiKey() {
  return String(process.env.FIREFLIES_API_KEY || "").trim();
}

function getPollLookbackMinutes() {
  const n = Number(process.env.POLL_LOOKBACK_MINUTES);
  if (Number.isFinite(n) && n > 0) return n;
  return 15;
}

function getBackfillLookbackDays() {
  const n = Number(process.env.BACKFILL_LOOKBACK_DAYS);
  if (Number.isFinite(n) && n > 0) return n;
  return 7;
}

function getMaxTranscriptsPerRun() {
  const n = Number(process.env.FIREFLIES_MAX_TRANSCRIPTS_PER_RUN);
  if (Number.isFinite(n) && n > 0) return n;
  return 20;
}

function isDryRun() {
  return String(process.env.FIREFLIES_DRY_RUN || "").toLowerCase() === "1" || process.env.FIREFLIES_DRY_RUN === "true";
}

/** Calendar days: existing board rows with meeting_date (or created_at) in [anchor - N, anchor] are sent to the dedupe LLM. */
function getDedupeLlmLookbackDays() {
  const n = Number(process.env.DEDUPE_LLM_LOOKBACK_DAYS);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 365);
  return 30;
}

function getDedupeLlmModel() {
  return String(process.env.DEDUPE_LLM_MODEL || "gpt-4o").trim() || "gpt-4o";
}

/** Dedupe logging: unset or "1"/"true"/"full" = prompts + response; "0"/"false" = one-line summary only. */
function isDedupeLlmLogVerbose() {
  const v = String(process.env.DEDUPE_LLM_LOG || "1").toLowerCase().trim();
  if (v === "0" || v === "false" || v === "off" || v === "summary") return false;
  return true;
}

function getDedupeLlmLogMaxChars() {
  const n = Number(process.env.DEDUPE_LLM_LOG_MAX_CHARS);
  if (Number.isFinite(n) && n > 1000) return Math.min(n, 500000);
  return 120000;
}

module.exports = {
  getCommandCenterSpreadsheetId,
  getFirefliesApiKey,
  getPollLookbackMinutes,
  getBackfillLookbackDays,
  getMaxTranscriptsPerRun,
  isDryRun,
  getDedupeLlmLookbackDays,
  getDedupeLlmModel,
  isDedupeLlmLogVerbose,
  getDedupeLlmLogMaxChars,
};
