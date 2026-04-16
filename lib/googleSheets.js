/**
 * Optional Google Sheets append for Hive Mind action items.
 * Configure via the project root .env — if unset, isGoogleSheetsConfigured() is false and the app runs normally.
 *
 * Expected sheet tab (GOOGLE_SHEETS_TAB_NAME or GOOGLE_SHEETS_TAB, default ActionItems): row 1 headers —
 *   Exported At | Urgency | Task | Owner | Due / Next Step
 * Share the spreadsheet with the service account client_email (Editor).
 */

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const SPREADSHEET_ID = String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
const TAB =
  String(
    process.env.GOOGLE_SHEETS_TAB_NAME || process.env.GOOGLE_SHEETS_TAB || "ActionItems",
  )
    .trim()
    .replace(/^'+|'+$/g, "") || "ActionItems";

/**
 * A1 range prefix for a tab name (quotes if needed).
 */
function sheetRangePrefix(tabName) {
  const name = String(tabName);
  const needsQuote = /[^A-Za-z0-9_]/.test(name);
  const escaped = name.replace(/'/g, "''");
  const prefix = needsQuote ? `'${escaped}'` : escaped;
  return prefix;
}

function readCredentialsFromKeyFile(keyFile) {
  const trimmed = String(keyFile || "").trim();
  if (!trimmed) return null;
  const resolved = path.isAbsolute(trimmed) ? trimmed : path.join(__dirname, "..", trimmed);
  try {
    const raw = fs.readFileSync(resolved, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getServiceAccountCredentials() {
  const inline = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      return null;
    }
  }
  const keyFile =
    String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || "").trim() ||
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  return readCredentialsFromKeyFile(keyFile);
}

function isGoogleSheetsConfigured() {
  if (!SPREADSHEET_ID) return false;
  const creds = getServiceAccountCredentials();
  return Boolean(creds && creds.client_email && creds.private_key);
}

function getServiceAccountEmail() {
  const creds = getServiceAccountCredentials();
  return typeof creds?.client_email === "string" ? creds.client_email : null;
}

function logGoogleSheetsStartupHint() {
  const id = Boolean(SPREADSHEET_ID);
  const creds = getServiceAccountCredentials();
  const hasCreds = Boolean(creds && creds.client_email && creds.private_key);
  if (
    !id &&
    !hasCreds &&
    !process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    !process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  ) {
    return;
  }
  if (isGoogleSheetsConfigured()) {
    console.log("Google Sheets: integration enabled (append action items).");
    return;
  }
  console.warn(
    "Google Sheets: incomplete configuration. Set GOOGLE_SHEETS_SPREADSHEET_ID and credentials (GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SERVICE_ACCOUNT_KEY_FILE, or GOOGLE_SERVICE_ACCOUNT_JSON) in .env. Share the spreadsheet with the service account email.",
  );
}

function normalizeActionItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(function (row) {
    const due =
      row.dueOrNextStep != null && String(row.dueOrNextStep).trim() !== ""
        ? String(row.dueOrNextStep)
        : row.dateDue != null
          ? String(row.dateDue)
          : "";
    return {
      urgency: row.urgency != null ? row.urgency : "",
      task: row.task != null ? String(row.task) : "",
      owner: row.owner != null ? String(row.owner) : "",
      dueOrNextStep: due || "None noted",
    };
  });
}

async function getSheetsClient() {
  const creds = getServiceAccountCredentials();
  if (!creds || !SPREADSHEET_ID) {
    const err = new Error("NOT_CONFIGURED");
    err.code = "SHEETS_NOT_CONFIGURED";
    throw err;
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

/**
 * @param {Array<{urgency?: unknown, task?: unknown, owner?: unknown, dueOrNextStep?: unknown, dateDue?: unknown}>} items
 * @returns {Promise<{ appended: number, updatedRange?: string }>}
 */
async function appendActionItemsToSheet(items) {
  if (!isGoogleSheetsConfigured()) {
    const err = new Error("Google Sheets is not configured on this server.");
    err.code = "SHEETS_NOT_CONFIGURED";
    throw err;
  }

  const normalized = normalizeActionItems(items);
  const exportedAt = new Date().toISOString();
  const values = normalized.map(function (row) {
    return [exportedAt, row.urgency, row.task, row.owner, row.dueOrNextStep];
  });

  if (values.length === 0) {
    return { appended: 0 };
  }

  const sheets = await getSheetsClient();
  const range = `${sheetRangePrefix(TAB)}!A:E`;

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  const updatedRange = res.data?.updates?.updatedRange;
  return { appended: values.length, updatedRange: updatedRange || undefined };
}

/**
 * Map Google / network errors to HTTP status and JSON body fields.
 */
function mapSheetsError(err) {
  if (err?.code === "SHEETS_NOT_CONFIGURED" || err?.message === "NOT_CONFIGURED") {
    return {
      status: 503,
      body: {
        error: "Google Sheets is not configured on this server.",
        code: "SHEETS_NOT_CONFIGURED",
      },
    };
  }

  const status = err?.response?.status;
  const apiMsg =
    err?.response?.data?.error?.message ||
    err?.response?.data?.error?.errors?.[0]?.message ||
    err?.message ||
    "Google Sheets request failed.";

  const email = getServiceAccountEmail();
  const shareHint = email
    ? ` Share the spreadsheet with the service account: ${email} (Editor).`
    : " Share the spreadsheet with your service account email (Editor).";

  if (status === 403 || status === 401) {
    return {
      status: 502,
      body: {
        error: `Google Sheets permission denied.${shareHint}`,
        code: "SHEETS_PERMISSION",
        details: String(apiMsg),
      },
    };
  }

  if (status === 404) {
    return {
      status: 502,
      body: {
        error:
          "Spreadsheet not found. Check GOOGLE_SHEETS_SPREADSHEET_ID and that the sheet exists.",
        code: "SHEETS_NOT_FOUND",
        details: String(apiMsg),
      },
    };
  }

  return {
    status: 502,
    body: {
      error: "Could not write to Google Sheets. Check the server terminal for details.",
      code: "SHEETS_ERROR",
      details: String(apiMsg),
    },
  };
}

module.exports = {
  isGoogleSheetsConfigured,
  appendActionItemsToSheet,
  logGoogleSheetsStartupHint,
  mapSheetsError,
};
