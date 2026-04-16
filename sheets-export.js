/**
 * Optional Google Sheets export for Hive Mind action items.
 *
 * This module is inactive until you set environment variables (see below).
 * The rest of the app runs normally without them.
 *
 * ---------------------------------------------------------------------------
 * SETUP (one-time)
 * ---------------------------------------------------------------------------
 * 1. Google Cloud Console (https://console.cloud.google.com/)
 *    - Create or pick a project.
 *    - APIs & Services → Enable APIs → enable "Google Sheets API".
 *
 * 2. Service account
 *    - IAM & Admin → Service Accounts → Create service account (name only is fine).
 *    - Keys → Add key → JSON. Download the file.
 *    - Store the JSON outside git (e.g. ./secrets/google-sheets-sa.json).
 *
 * 3. Environment variables in .env (project root)
 *    - GOOGLE_APPLICATION_CREDENTIALS=/absolute/or/project/relative/path/to/key.json
 *      (Standard Google variable: path to the service account JSON file.)
 *    - GOOGLE_SHEETS_SPREADSHEET_ID=<id>
 *      The id is the long string in the sheet URL:
 *      https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 *
 * 4. Share the Google Sheet with the service account
 *    - Open the downloaded JSON and copy "client_email" (ends with @...gserviceaccount.com).
 *    - In Google Sheets: Share → paste that email → Editor.
 *
 * 5. Optional: GOOGLE_SHEETS_TAB_NAME=Sheet1
 *    Tab name to append to (default Sheet1). Use a dedicated tab for Hive Mind.
 *
 * ---------------------------------------------------------------------------
 * SECURITY
 * ---------------------------------------------------------------------------
 * The HTTP route that calls this runs on your server. On localhost only you
 * can reach it. If you bind the app to the network or deploy it, protect that
 * route (e.g. API key header) so strangers cannot append rows to your sheet.
 *
 * Never commit the service account JSON or put it in frontend code.
 */

const fs = require("fs");
const { google } = require("googleapis");

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** Column headers written once when the tab’s first row is empty. */
const HEADER_ROW = [
  "Urgency",
  "Why urgent",
  "Task",
  "Owner",
  "Due / Next step",
  "Status",
  "Synced at (UTC)",
];

function spreadsheetId() {
  return String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
}

function credentialsPath() {
  return String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
}

function tabName() {
  const t = String(process.env.GOOGLE_SHEETS_TAB_NAME || "Sheet1").trim();
  return t || "Sheet1";
}

/**
 * True when Spreadsheet ID and a readable service-account JSON path are set.
 */
function isSheetsConfigured() {
  const sid = spreadsheetId();
  const cred = credentialsPath();
  if (!sid || !cred) {
    return false;
  }
  try {
    return fs.existsSync(cred) && fs.statSync(cred).isFile();
  } catch {
    return false;
  }
}

function defaultStatus(value) {
  const allowed = new Set(["Not started", "In progress", "Done", "Blocked"]);
  const t = String(value ?? "").trim();
  return allowed.has(t) ? t : "Not started";
}

function rowFromActionItem(row) {
  const r = row && typeof row === "object" ? row : {};
  return [
    r.urgency != null ? String(r.urgency) : "",
    String(r.why_this_is_urgent ?? "").trim() || "—",
    String(r.task ?? ""),
    String(r.owner ?? ""),
    String(r.due_next_step ?? ""),
    defaultStatus(r.status),
    new Date().toISOString(),
  ];
}

/**
 * Append action items as new rows. Ensures a header row if cell A1 is empty.
 * @param {object[]} actionItems
 * @returns {Promise<{ appended: number }>}
 */
async function appendActionItemsToSheet(actionItems) {
  if (!isSheetsConfigured()) {
    throw new Error("Google Sheets is not configured (missing env or credentials file).");
  }

  const items = Array.isArray(actionItems) ? actionItems : [];
  if (items.length === 0) {
    return { appended: 0 };
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath(),
    scopes: [SHEETS_SCOPE],
  });

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });
  const id = spreadsheetId();
  const tab = tabName();
  const rangeA1 = `'${tab.replace(/'/g, "''")}'!A1`;

  const top = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: rangeA1,
  });

  const firstCell = top.data.values && top.data.values[0] && top.data.values[0][0];
  const needsHeader = firstCell === undefined || firstCell === null || String(firstCell).trim() === "";

  if (needsHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${tab.replace(/'/g, "''")}'!A1:G1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [HEADER_ROW] },
    });
  }

  const dataRows = items.map(rowFromActionItem);
  const appendRange = `'${tab.replace(/'/g, "''")}'!A:G`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: appendRange,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: dataRows },
  });

  return { appended: dataRows.length };
}

module.exports = {
  isSheetsConfigured,
  appendActionItemsToSheet,
};
