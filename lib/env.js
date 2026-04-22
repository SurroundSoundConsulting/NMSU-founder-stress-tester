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

module.exports = {
  getCommandCenterSpreadsheetId,
  getFirefliesApiKey,
  getPollLookbackMinutes,
  getBackfillLookbackDays,
  getMaxTranscriptsPerRun,
  isDryRun,
};
