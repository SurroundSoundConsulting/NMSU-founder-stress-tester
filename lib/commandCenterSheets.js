/**
 * Google Sheets operations for the Week 4–5 command-center tabs.
 */

const { getCommandCenterSpreadsheetId } = require("./env");
const { getSheetsForSpreadsheet, sheetRangePrefix } = require("./googleSheets");
const {
  TABS,
  PROCESSED_COL_COUNT,
  MASTER_COL_COUNT,
  MASTER_BASE_COL_COUNT,
  MASTER_EXECUTION_HEADER_LABELS,
  MASTER_ENFORCER_HEADER_LABELS,
  MASTER_EXECUTION_EXTENSION_COUNT,
  POLLING_LOG_COL_COUNT,
  masterEndColumnLetter,
} = require("./sheetSchema");

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
 * Ensure row 1 on Master Action Board has Week 5 execution headers in Q–Z.
 * Does not overwrite non-empty cells in the execution zone (warns on mismatch).
 * @returns {Promise<{ updated: boolean, message?: string }>}
 */
async function ensureMasterExecutionSchema() {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const end = masterEndColumnLetter();
  const range = `${sheetRangePrefix(tab)}!A1:${end}1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const raw = res.data.values && res.data.values[0] ? res.data.values[0] : [];
  const row = [];
  for (let i = 0; i < MASTER_COL_COUNT; i++) {
    row[i] = i < raw.length ? String(raw[i] || "").trim() : "";
  }
  let changed = false;
  const warnings = [];
  for (let j = 0; j < MASTER_EXECUTION_HEADER_LABELS.length; j++) {
    const i = MASTER_BASE_COL_COUNT + j;
    const expected = MASTER_EXECUTION_HEADER_LABELS[j];
    const cur = row[i];
    if (!cur) {
      row[i] = expected;
      changed = true;
    } else if (cur !== expected) {
      warnings.push(`Column ${i + 1}: expected "${expected}", found "${cur}" (left unchanged).`);
    }
  }
  if (changed) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
  }
  if (warnings.length) {
    console.warn("[execution schema]", warnings.join(" "));
  }
  return {
    updated: changed,
    message: warnings.length ? warnings.join(" ") : undefined,
  };
}

/**
 * Ensure row 1 has Week 6 Enforcer headers after the execution block (empty cells only).
 * @returns {Promise<{ updated: boolean, message?: string }>}
 */
async function ensureMasterEnforcerSchema() {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const end = masterEndColumnLetter();
  const range = `${sheetRangePrefix(tab)}!A1:${end}1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const raw = res.data.values && res.data.values[0] ? res.data.values[0] : [];
  const row = [];
  for (let i = 0; i < MASTER_COL_COUNT; i++) {
    row[i] = i < raw.length ? String(raw[i] || "").trim() : "";
  }
  let changed = false;
  const warnings = [];
  const start = MASTER_BASE_COL_COUNT + MASTER_EXECUTION_EXTENSION_COUNT;
  for (let j = 0; j < MASTER_ENFORCER_HEADER_LABELS.length; j++) {
    const i = start + j;
    const expected = MASTER_ENFORCER_HEADER_LABELS[j];
    const cur = row[i];
    if (!cur) {
      row[i] = expected;
      changed = true;
    } else if (cur !== expected) {
      warnings.push(`Column ${i + 1}: expected "${expected}", found "${cur}" (left unchanged).`);
    }
  }
  if (changed) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
  }
  if (warnings.length) {
    console.warn("[enforcer schema]", warnings.join(" "));
  }
  return {
    updated: changed,
    message: warnings.length ? warnings.join(" ") : undefined,
  };
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
  const endCol = masterEndColumnLetter();
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
 * @param {string[][]} values - full master width each
 */
async function appendMasterRows(values) {
  if (!values || values.length === 0) return;
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const endCol = masterEndColumnLetter();
  const rows = values.map((r) => padTo(MASTER_COL_COUNT, r));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetRangePrefix(tab)}!A:${endCol}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

/**
 * @param {number} sheetRow - 1-based
 * @param {string[]} row - full master width
 */
async function updateMasterRow(sheetRow, row) {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const r = padTo(MASTER_COL_COUNT, row);
  const endCol = masterEndColumnLetter();
  const range = `${sheetRangePrefix(tab)}!A${sheetRow}:${endCol}${sheetRow}`;
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
  ensureMasterExecutionSchema,
  ensureMasterEnforcerSchema,
  getClient,
  TABS,
};
