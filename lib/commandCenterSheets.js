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
  MASTER_ENFORCER_HEADER_LEGACY_UPGRADE,
  MASTER_EXECUTION_EXTENSION_COUNT,
  MASTER_LEGACY_EXTRA_SCORE_COLUMNS,
  POLLING_LOG_COL_COUNT,
  masterEndColumnLetter,
  columnToA1Letter,
  formatUniversalTaskArtifactCell,
  masterEnforcerBlockStartIndex,
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
  await migrateMasterEnforcerMergedScoreColumnIfNeeded();
  await repairOrphanEnforcerTailColumnsIfNeeded();

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
      if (MASTER_ENFORCER_HEADER_LEGACY_UPGRADE[cur] === expected) {
        row[i] = expected;
        changed = true;
      } else {
        warnings.push(`Column ${i + 1}: expected "${expected}", found "${cur}" (left unchanged).`);
      }
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
 * Old sheets had Universal / Task Type / Task Specific as three columns; squeeze into one cell and shift the tail left.
 * @param {string[]} oldRow
 * @param {number} start - 0-based index of QA Status column
 * @param {number} newColCount
 * @param {boolean} isHeaderRow
 */
function squashMasterRowFromLegacyThreeScores(oldRow, start, newColCount, isHeaderRow) {
  const need = Math.max(oldRow.length, start + 5);
  const padded = padTo(need, oldRow);
  const out = Array.from({ length: newColCount }, () => "");
  for (let i = 0; i <= start; i++) {
    out[i] = String(padded[i] ?? "");
  }
  if (isHeaderRow) {
    out[start + 1] = MASTER_ENFORCER_HEADER_LABELS[1];
    let j = start + 2;
    for (let i = start + 4; i < padded.length && j < newColCount; i++) {
      out[j++] = String(padded[i] ?? "");
    }
    return out;
  }
  out[start + 1] = formatUniversalTaskArtifactCell(
    padded[start + 1],
    padded[start + 2],
    padded[start + 3],
  );
  let j = start + 2;
  for (let i = start + 4; i < padded.length && j < newColCount; i++) {
    out[j++] = String(padded[i] ?? "");
  }
  return out;
}

/**
 * After squeezing three score columns into one, the old tail still occupied two physical columns
 * (duplicate Human Feedback / General Rules headers). Remove those 0-based columns
 * MASTER_COL_COUNT .. MASTER_COL_COUNT+1.
 */
async function deleteOrphanColumnsAfterScoreMerge(sheets, spreadsheetId, sheetId) {
  if (!Number.isFinite(sheetId)) return;
  const start = MASTER_COL_COUNT;
  const end = MASTER_COL_COUNT + MASTER_LEGACY_EXTRA_SCORE_COLUMNS;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: start,
              endIndex: end,
            },
          },
        },
      ],
    },
  });
}

/**
 * Sheets migrated before orphan-column deletion left two duplicate tail columns; detect header row and remove them.
 * @returns {Promise<{ repaired: boolean }>}
 */
async function repairOrphanEnforcerTailColumnsIfNeeded() {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const prefix = sheetRangePrefix(tab);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,gridProperties))",
  });
  const props = (meta.data.sheets || []).find((s) => String(s.properties.title || "") === tab)?.properties;
  if (!props || typeof props.sheetId !== "number") {
    return { repaired: false };
  }

  const gridCols = props.gridProperties?.columnCount;
  if (Number.isFinite(gridCols) && gridCols <= MASTER_COL_COUNT) {
    return { repaired: false };
  }

  const tailLetter = columnToA1Letter(MASTER_COL_COUNT + MASTER_LEGACY_EXTRA_SCORE_COLUMNS);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${prefix}!A1:${tailLetter}1`,
  });
  const row = res.data.values && res.data.values[0] ? res.data.values[0] : [];
  const hfLabel = MASTER_ENFORCER_HEADER_LABELS[MASTER_ENFORCER_HEADER_LABELS.length - 2];
  const grLabel = MASTER_ENFORCER_HEADER_LABELS[MASTER_ENFORCER_HEADER_LABELS.length - 1];
  const o1 = String(row[MASTER_COL_COUNT] ?? "").trim();
  const o2 = String(row[MASTER_COL_COUNT + 1] ?? "").trim();
  if (o1 !== hfLabel || o2 !== grLabel) {
    return { repaired: false };
  }

  try {
    await deleteOrphanColumnsAfterScoreMerge(sheets, spreadsheetId, props.sheetId);
    console.info("[enforcer migrate] Removed duplicate Human Feedback / General Rules columns.");
    return { repaired: true };
  } catch (e) {
    console.warn("[enforcer migrate] Could not remove duplicate tail columns:", String(e.message || e));
    return { repaired: false };
  }
}

/**
 * One-time layout fix when row 1 still has three separate Enforcer score headers.
 * @returns {Promise<{ migrated: boolean, rows?: number }>}
 */
async function migrateMasterEnforcerMergedScoreColumnIfNeeded() {
  const { sheets, spreadsheetId } = await getClient();
  const tab = TABS.MASTER;
  const start = masterEnforcerBlockStartIndex();
  const wideColCount = MASTER_COL_COUNT + MASTER_LEGACY_EXTRA_SCORE_COLUMNS;
  const endLetter = columnToA1Letter(wideColCount);
  const prefix = sheetRangePrefix(tab);

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${prefix}!A1:${endLetter}1`,
  });
  const headerRaw = headerRes.data.values && headerRes.data.values[0] ? headerRes.data.values[0] : [];
  const h1 = String(headerRaw[start + 1] || "").trim();
  const h2 = String(headerRaw[start + 2] || "").trim();
  const h3 = String(headerRaw[start + 3] || "").trim();
  const legacyUniversal =
    h1 === "Universal Score (generic QA)" || h1 === "Universal Score";
  const legacyThree =
    legacyUniversal && h2 === "Task Type Score" && h3 === "Task Specific Score";
  if (!legacyThree) {
    return { migrated: false };
  }

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,gridProperties))",
  });
  const props = (meta.data.sheets || []).find((s) => String(s.properties.title || "") === tab)?.properties;
  if (!props || typeof props.sheetId !== "number") {
    console.warn("[enforcer migrate] Could not resolve sheetId for tab:", tab);
    return { migrated: false };
  }

  const gridRows = props.gridProperties?.rowCount;
  const scanRows = Math.min(Math.max(Number(gridRows) || 2000, 2), 5000);

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${prefix}!A2:${endLetter}${scanRows}`,
  });
  const dataRows = dataRes.data.values || [];

  const newHeader = squashMasterRowFromLegacyThreeScores(headerRaw, start, MASTER_COL_COUNT, true);
  const newBody = dataRows.map((r) =>
    squashMasterRowFromLegacyThreeScores(r, start, MASTER_COL_COUNT, false),
  );
  const newValues = [newHeader, ...newBody];
  const lastRow = newValues.length;
  const outEnd = columnToA1Letter(MASTER_COL_COUNT);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${prefix}!A1:${outEnd}${lastRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: newValues },
  });

  try {
    await deleteOrphanColumnsAfterScoreMerge(sheets, spreadsheetId, props.sheetId);
  } catch (e) {
    console.warn("[enforcer migrate] Could not delete orphan columns after merge:", String(e.message || e));
  }

  console.info(
    "[enforcer migrate] Merged Universal/Task/Artifact columns into one (" + dataRows.length + " data rows).",
  );
  return { migrated: true, rows: lastRow };
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
