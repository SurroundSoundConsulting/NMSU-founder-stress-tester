/**
 * Google Docs + Drive for Week 5 execution output and linked context docs.
 * Create docs inside a folder via Drive files.create (parents) — avoids move issues with drive.file scope.
 * drive.readonly: read user-shared Google Docs linked from the sheet (share each file or folder with the SA).
 * Prefer Shared drive folder + EXECUTION_DRIVE_FOLDER_ID (see Week 5 guide).
 */

const { google } = require("googleapis");
const { getServiceAccountCredentials } = require("./googleSheets");

const DRIVE_DOCS_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
];

function formatGoogleApiError(err) {
  const status = err?.response?.status;
  const err0 = err?.response?.data?.error?.errors?.[0];
  const reason = err0?.reason;
  const message = err?.response?.data?.error?.message || err?.message || String(err);
  return JSON.stringify({ status, reason, message });
}

async function getDriveDocsAuthClient() {
  const creds = getServiceAccountCredentials();
  if (!creds || !creds.client_email || !creds.private_key) {
    const err = new Error("Service account credentials not configured.");
    err.code = "NO_CREDENTIALS";
    throw err;
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: DRIVE_DOCS_SCOPES,
  });
  return auth.getClient();
}

const DRIVE_ID_PATTERNS = [
  /\/document\/d\/([a-zA-Z0-9_-]+)/,
  /\/file\/d\/([a-zA-Z0-9_-]+)/,
  /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
  /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
  /[?&]id=([a-zA-Z0-9_-]+)/,
];

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

/**
 * Parse a cell value into unique Drive file ids (Docs URLs, Drive URLs, or raw ids).
 * @param {string} raw
 * @param {number} maxFiles
 * @returns {string[]}
 */
function extractGoogleDriveFileIds(raw, maxFiles) {
  const cap = Number.isFinite(maxFiles) && maxFiles > 0 ? Math.min(maxFiles, 10) : 5;
  const text = String(raw || "").trim();
  if (!text) return [];
  const tokens = text.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set();
  const ids = [];
  for (const tok of tokens) {
    if (ids.length >= cap) break;
    let id = null;
    for (const re of DRIVE_ID_PATTERNS) {
      const m = tok.match(re);
      if (m) {
        id = m[1];
        break;
      }
    }
    if (!id && /^[a-zA-Z0-9_-]{10,}$/.test(tok)) id = tok;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Export linked Google Docs as plain text for classifier / execution context.
 * Only Google Docs are supported in v1; other mime types are reported in errors.
 *
 * @param {string} raw - cell contents (URLs / ids, comma or newline separated)
 * @param {{ perFileMaxChars?: number, totalMaxChars?: number, maxFiles?: number, clientEmail?: string }} [options]
 * @returns {Promise<{ text: string, errors: { fileId: string, message: string }[] }>}
 */
async function fetchExecutionContextFromDocLinksCell(raw, options) {
  const perFileMaxChars = options?.perFileMaxChars ?? 15000;
  const totalMaxChars = options?.totalMaxChars ?? 48000;
  const maxFiles = options?.maxFiles ?? 5;
  const clientEmail = String(options?.clientEmail || "").trim();

  const ids = extractGoogleDriveFileIds(raw, maxFiles);
  if (ids.length === 0) {
    return { text: "", errors: [] };
  }

  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const parts = [];
  const errors = [];
  let totalLen = 0;

  for (const fileId of ids) {
    if (totalLen >= totalMaxChars) break;
    const shareHint = clientEmail
      ? ` Share the file (or a parent folder) with the service account: ${clientEmail} (Viewer or higher).`
      : " Share the file with your service account (Viewer or higher).";
    try {
      const meta = await drive.files.get({
        fileId,
        fields: "id, name, mimeType",
        supportsAllDrives: true,
      });
      const mime = meta.data.mimeType || "";
      const name = meta.data.name || fileId;
      if (mime !== "application/vnd.google-apps.document") {
        errors.push({
          fileId,
          message:
            "Only Google Docs are supported for link context (got mimeType: " +
            mime +
            "). Convert or paste a Google Doc link.",
        });
        continue;
      }
      const res = await drive.files.export(
        { fileId, mimeType: "text/plain" },
        { responseType: "text" },
      );
      let body = typeof res.data === "string" ? res.data : String(res.data || "");
      if (body.length > perFileMaxChars) {
        body =
          body.slice(0, perFileMaxChars) +
          "\n[truncated per EXECUTION_CONTEXT_DOC_MAX_CHARS_PER_FILE]\n";
      }
      const header = "\n---\nGoogle Doc: " + name + " (file id: " + fileId + ")\n---\n";
      const section = header + body + "\n";
      if (totalLen + section.length > totalMaxChars) {
        const room = Math.max(0, totalMaxChars - totalLen);
        parts.push(section.slice(0, room) + "\n[truncated per EXECUTION_CONTEXT_DOC_MAX_CHARS_TOTAL]\n");
        totalLen = totalMaxChars;
        break;
      }
      parts.push(section);
      totalLen += section.length;
    } catch (err) {
      errors.push({
        fileId,
        message: formatGoogleApiError(err) + shareHint,
      });
    }
  }

  let text = parts.join("").trim();
  if (errors.length > 0) {
    text +=
      (text ? "\n\n" : "") +
      "=== Linked files that could not be fully used ===\n" +
      errors.map((e) => "- " + e.fileId + ": " + e.message).join("\n") +
      "\n";
  }
  return { text, errors };
}

/**
 * Plain-text body for Week 5 execution / Week 6 Enforcer revision Docs (same section markers).
 * @param {object} f
 * @returns {string}
 */
function buildExecutionRecordPlainBody(f) {
  const linkLine = String(f.executionContextDocLinks || "").trim();
  return [
    "Hive Mind — Task execution record",
    "",
    "Task ID: " + String(f.taskId || ""),
    "Task: " + String(f.task || ""),
    "Execution Type: " + String(f.executionType || ""),
    "Created At: " + String(f.createdAt || ""),
    linkLine ? "Execution Context Doc Links (cell): " + linkLine : "",
    "",
    "=== Missing Info (from classification) ===",
    String(f.missingInfo || "").trim() || "(none)",
    "",
    "=== Generated Prompt (exact text sent to execution LLM — QA) ===",
    String(f.generatedPrompt || "").trim() || "(empty)",
    "",
    "=== LLM Output (execution result) ===",
    String(f.llmOutput || "").trim() || "(empty)",
    "",
    "=== Review Notes ===",
    String(f.reviewNotesPlaceholder || "(Add reviewer notes below.)"),
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * @param {object} opts
 * @param {string} [opts.folderId] - Drive folder id (Shared drive recommended)
 * @param {string} opts.title - Doc title
 * @param {object} opts.fields - content sections
 * @param {string} [opts.fields.executionContextDocLinks] - raw links cell (QA)
 * @returns {Promise<{ fileId: string, url: string }>}
 */
async function createExecutionGoogleDoc(opts) {
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const docs = google.docs({ version: "v1", auth });

  const title = String(opts.title || "Hive Mind execution").trim() || "Hive Mind execution";
  const folderId = String(opts.folderId || "").trim();
  const f = opts.fields || {};

  const body = buildExecutionRecordPlainBody({
    ...f,
    reviewNotesPlaceholder: f.reviewNotesPlaceholder || "(Add reviewer notes below.)",
  });

  const requestBody = {
    name: title,
    mimeType: "application/vnd.google-apps.document",
  };
  if (folderId) {
    requestBody.parents = [folderId];
  }

  let createRes;
  try {
    createRes = await drive.files.create({
      requestBody,
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
  } catch (err) {
    const wrap = new Error("Drive files.create failed: " + formatGoogleApiError(err));
    wrap.cause = err;
    throw wrap;
  }

  const fileId = createRes.data.id;
  if (!fileId) {
    throw new Error("Drive API returned no file id.");
  }

  try {
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: body } }],
      },
    });
  } catch (err) {
    const wrap = new Error("Docs batchUpdate failed: " + formatGoogleApiError(err));
    wrap.cause = err;
    throw wrap;
  }

  try {
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (err) {
    console.warn("[execution doc] permissions.create (anyone) failed:", formatGoogleApiError(err));
  }

  const url = `https://docs.google.com/document/d/${fileId}/edit`;
  return { fileId, url };
}

/**
 * @param {string} urlOrRaw
 * @returns {string|null} first Google Doc file id, or null
 */
function parseGoogleDocUrlToFileId(urlOrRaw) {
  const ids = extractGoogleDriveFileIds(String(urlOrRaw || ""), 1);
  return ids.length ? ids[0] : null;
}

/**
 * Export a Google Doc as plain text.
 * @param {string} fileId
 * @returns {Promise<string>}
 */
async function exportGoogleDocPlainText(fileId) {
  const id = String(fileId || "").trim();
  if (!id) throw new Error("exportGoogleDocPlainText: missing fileId.");
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const meta = await drive.files.get({
    fileId: id,
    fields: "id, name, mimeType",
    supportsAllDrives: true,
  });
  const mime = meta.data.mimeType || "";
  if (mime !== GOOGLE_DOC_MIME) {
    throw new Error("Not a Google Doc (mimeType: " + mime + ").");
  }
  const res = await drive.files.export({ fileId: id, mimeType: "text/plain" }, { responseType: "text" });
  return typeof res.data === "string" ? res.data : String(res.data || "");
}

/**
 * Among sheet-linked Doc URLs, pick the Google Doc with the latest Drive `modifiedTime`.
 * Ties (same timestamp): earlier index in `urls` wins (caller should pass Best → Latest → Execution).
 *
 * @param {string[]} urls
 * @returns {Promise<{ url: string, fileId: string, modifiedTime: string } | null>}
 */
async function pickNewestGoogleDocAmongUrls(urls) {
  const order = Array.isArray(urls) ? urls : [];
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const entries = [];
  for (let orderIdx = 0; orderIdx < order.length; orderIdx++) {
    const url = order[orderIdx];
    const id = parseGoogleDocUrlToFileId(url);
    if (!id) continue;
    try {
      const res = await drive.files.get({
        fileId: id,
        fields: "id, modifiedTime, mimeType",
        supportsAllDrives: true,
      });
      const mime = res.data.mimeType || "";
      if (mime !== GOOGLE_DOC_MIME) continue;
      const modifiedTime = String(res.data.modifiedTime || "");
      entries.push({ url, fileId: id, modifiedTime, orderIdx });
    } catch {
      continue;
    }
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => {
    const ta = new Date(a.modifiedTime).getTime();
    const tb = new Date(b.modifiedTime).getTime();
    if (tb !== ta) return tb - ta;
    return a.orderIdx - b.orderIdx;
  });
  const w = entries[0];
  return { url: w.url, fileId: w.fileId, modifiedTime: w.modifiedTime };
}

/**
 * Split execution-record plain text into sections (Week 5 template).
 * @param {string} fullText
 * @returns {{ missingInfo: string, generatedPrompt: string, llmOutput: string, reviewNotes: string }}
 */
function parseExecutionDocSections(fullText) {
  const t = String(fullText || "");
  function sliceBetween(startLabel, endLabels) {
    const start = t.indexOf(startLabel);
    if (start < 0) return "";
    const from = start + startLabel.length;
    let end = t.length;
    for (const el of endLabels) {
      const j = t.indexOf(el, from);
      if (j >= 0 && j < end) end = j;
    }
    return t.slice(from, end).trim();
  }
  const L0 = "=== Missing Info (from classification) ===";
  const L1 = "=== Generated Prompt (exact text sent to execution LLM — QA) ===";
  const L2 = "=== LLM Output (execution result) ===";
  const L3 = "=== Review Notes ===";
  return {
    missingInfo: sliceBetween(L0, [L1]),
    generatedPrompt: sliceBetween(L1, [L2]),
    llmOutput: sliceBetween(L2, [L3]),
    reviewNotes: sliceBetween(L3, []),
  };
}

module.exports = {
  getDriveDocsAuthClient,
  createExecutionGoogleDoc,
  fetchExecutionContextFromDocLinksCell,
  extractGoogleDriveFileIds,
  parseGoogleDocUrlToFileId,
  exportGoogleDocPlainText,
  pickNewestGoogleDocAmongUrls,
  parseExecutionDocSections,
  buildExecutionRecordPlainBody,
  formatGoogleApiError,
  DRIVE_DOCS_SCOPES,
};
