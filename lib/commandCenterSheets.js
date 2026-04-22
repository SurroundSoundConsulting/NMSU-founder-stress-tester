/**
 * Google Sheets operations for the Week 4 command-center tabs.
 */

const { getCommandCenterSpreadsheetId } = require("./env");
const { getSheetsForSpreadsheet, sheetRangePrefix } = require("./googleSheets");
const { TABS, PROCESSED_COL_COUNT, MASTER_COL_COUNT, POLLING_LOG_COL_COUNT } = require("./sheetSchema");

/**
 * @returns {Promise<import("googleapis").sheets_v4.Sheets>}
 */
async function getClient() {
  const id = getCommandCenterSpreadsheetId();
  if (!id) {
    const err = new Error("GOOGLE_SHEET_ID (or GOOGLE_SHEETS_SPREADSHEET_ID) is not set.");
    err.code = "NO_SPREADSHEET";
    throw err;
  }
  return getSheetsForSpreadsheet(id);
}

/**
 * @returns {Promise<Set<string>>} Fireflies transcript IDs already recorded
 */
async function getProcessedTranscriptIdSet() {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.PROCESSED;
  const endCol = String.fromCharCode("A".charCodeAt(0) + PROCESSED_COL_COUNT - 1);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetRangePrefix(tab)}!A2:${endCol}`,
  });
  const rows = res.data.values || [];
  const set = new Set();
  for (const row of rows) {
    const id = String(row[0] || "").trim();
    if (id) set.add(id);
  }
  return set;
}

/**
 * @returns {Promise<string[][]>} Master board data rows (no header)
 */
async function getMasterDataRows() {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const endCol = "P";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetRangePrefix(tab)}!A2:${endCol}`,
  });
  const rows = res.data.values || [];
  return rows.map((r) => {
    const row = r.slice(0, MASTER_COL_COUNT);
    while (row.length < MASTER_COL_COUNT) row.push("");
    return row;
  });
}

function padTo(len, values) {
  const v = (values || []).slice();
  while (v.length < len) v.push("");
  return v;
}

/**
 * @param {string[]} row - 6 values for Processed Transcripts
 */
async function appendProcessedTranscriptRow(row) {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.PROCESSED;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetRangePrefix(tab)}!A:F`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [padTo(PROCESSED_COL_COUNT, row)] },
  });
}

/**
 * @param {string[]} row - 4 values for Polling Log
 */
async function appendPollingLogRow(row) {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.POLLING_LOG;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetRangePrefix(tab)}!A:D`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [padTo(POLLING_LOG_COL_COUNT, row)] },
  });
}

/**
 * @param {string[][]} values - 16 columns each
 */
async function appendMasterRows(values) {
  if (!values || values.length === 0) return;
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const rows = values.map((r) => padTo(MASTER_COL_COUNT, r));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetRangePrefix(tab)}!A:P`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

/**
 * @param {number} sheetRow - 1-based
 * @param {string[]} row - 16 values
 */
async function updateMasterRow(sheetRow, row) {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const r = padTo(MASTER_COL_COUNT, row);
  const range = `${sheetRangePrefix(tab)}!A${sheetRow}:P${sheetRow}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [r] },
  });
}

module.exports = {
  getProcessedTranscriptIdSet,
  getMasterDataRows,
  appendProcessedTranscriptRow,
  appendPollingLogRow,
  appendMasterRows,
  updateMasterRow,
  getClient,
  TABS,
};
