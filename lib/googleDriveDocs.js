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

  const linkLine = String(f.executionContextDocLinks || "").trim();

  const body = [
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
    "(Add reviewer notes below.)",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

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
 * Extract Google Doc file id from URL or return raw id if already an id.
 * @param {string} raw
 * @returns {string|null}
 */
function parseGoogleDocFileId(raw) {
  const ids = extractGoogleDriveFileIds(String(raw || "").trim(), 1);
  return ids.length ? ids[0] : null;
}

/**
 * Export a Google Doc as plain text.
 * @param {string} fileId
 * @returns {Promise<string>}
 */
async function exportGoogleDocPlainText(fileId) {
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });
  const mime = meta.data.mimeType || "";
  if (mime !== "application/vnd.google-apps.document") {
    throw new Error("Not a Google Doc (mimeType: " + mime + ")");
  }
  const res = await drive.files.export({ fileId, mimeType: "text/plain" }, { responseType: "text" });
  return typeof res.data === "string" ? res.data : String(res.data || "");
}

/**
 * Walk Docs API document body (paragraphs + nested table cells) into plain text lines.
 * @param {object} doc - documents.get response.data
 */
function extractPlainTextFromDocsDocument(doc) {
  const lines = [];
  function walk(content) {
    if (!Array.isArray(content)) return;
    for (const element of content) {
      if (element.paragraph) {
        let line = "";
        for (const pe of element.paragraph.elements || []) {
          if (pe.textRun && pe.textRun.content) line += pe.textRun.content;
        }
        lines.push(line);
      } else if (element.table && element.table.tableRows) {
        for (const row of element.table.tableRows) {
          for (const cell of row.tableCells || []) {
            walk(cell.content);
          }
        }
      } else if (element.tableOfContents && element.tableOfContents.content) {
        walk(element.tableOfContents.content);
      }
    }
  }
  walk(doc && doc.body && doc.body.content ? doc.body.content : []);
  return lines.join("\n");
}

/**
 * Plain text for feedback ingestion: includes pending suggestions as if accepted.
 * Drive `files.export` often omits or hides Suggesting-mode edits; Docs API `PREVIEW_SUGGESTIONS_ACCEPTED` does not.
 * Falls back to Drive export on failure.
 *
 * @param {string} fileId
 * @returns {Promise<string>}
 */
async function exportGoogleDocPlainTextForFeedback(fileId) {
  const auth = await getDriveDocsAuthClient();
  const docs = google.docs({ version: "v1", auth });
  try {
    const res = await docs.documents.get({
      documentId: fileId,
      suggestionsViewMode: "PREVIEW_SUGGESTIONS_ACCEPTED",
    });
    const text = extractPlainTextFromDocsDocument(res.data);
    if (String(text || "").trim()) return text;
  } catch (err) {
    console.warn(
      "[feedback doc] documents.get PREVIEW_SUGGESTIONS_ACCEPTED failed; using Drive export:",
      formatGoogleApiError(err),
    );
  }
  return exportGoogleDocPlainText(fileId);
}

function extractLlmOutputSection(fullText) {
  const text = String(fullText || "");
  const marker = "=== LLM Output (execution result) ===";
  const idx = text.indexOf(marker);
  if (idx < 0) return text.trim();
  let rest = text.slice(idx + marker.length);
  const next = rest.search(/\n=== /);
  if (next >= 0) rest = rest.slice(0, next);
  return rest.trim();
}

function extractGeneratedPromptSection(fullText) {
  const text = String(fullText || "");
  const marker = "=== Generated Prompt (exact text sent to execution LLM — QA) ===";
  const idx = text.indexOf(marker);
  if (idx < 0) return "";
  let rest = text.slice(idx + marker.length);
  const next = rest.search(/\n=== /);
  if (next >= 0) rest = rest.slice(0, next);
  return rest.trim();
}

module.exports = {
  createExecutionGoogleDoc,
  fetchExecutionContextFromDocLinksCell,
  extractGoogleDriveFileIds,
  parseGoogleDocFileId,
  exportGoogleDocPlainText,
  exportGoogleDocPlainTextForFeedback,
  extractPlainTextFromDocsDocument,
  extractLlmOutputSection,
  extractGeneratedPromptSection,
  formatGoogleApiError,
  getDriveDocsAuthClient,
  DRIVE_DOCS_SCOPES,
};
