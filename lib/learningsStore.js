/**
 * Week 6: Drive-backed judgment log (JSON) and project rules (markdown).
 */

const { google } = require("googleapis");
const { getDriveDocsAuthClient, formatGoogleApiError } = require("./googleDriveDocs");
const {
  getLearningsDriveFolderId,
  getLearningsJudgmentLogFileId,
  getLearningsProjectRulesFileId,
  getLearningsProjectRulesMaxChars,
} = require("./env");

async function getDrive() {
  const auth = await getDriveDocsAuthClient();
  return google.drive({ version: "v3", auth });
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive
 * @param {string} folderId
 * @param {string} name
 * @param {string} mimeType
 * @param {string} body
 */
async function createTextFileInFolder(drive, folderId, name, mimeType, body) {
  const { Readable } = require("stream");
  const stream = Readable.from([Buffer.from(body, "utf8")]);
  const createRes = await drive.files.create({
    requestBody: {
      name,
      mimeType,
      parents: folderId ? [folderId] : undefined,
    },
    media: { mimeType, body: stream },
    fields: "id",
    supportsAllDrives: true,
  });
  const id = createRes.data.id;
  if (!id) throw new Error("Learnings file create returned no id.");
  return id;
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive
 * @param {string} fileId
 * @returns {Promise<string>}
 */
async function downloadTextFile(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "text" },
  );
  return typeof res.data === "string" ? res.data : String(res.data || "");
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive
 * @param {string} fileId
 * @param {string} mimeType
 * @param {string} body
 */
async function uploadReplaceFile(drive, fileId, mimeType, body) {
  const { Readable } = require("stream");
  const stream = Readable.from([Buffer.from(body, "utf8")]);
  await drive.files.update({
    fileId,
    media: { mimeType, body: stream },
    supportsAllDrives: true,
  });
}

/**
 * Find an existing non-trashed file by exact name in a folder (Shared drive safe).
 * @param {import("googleapis").drive_v3.Drive} drive
 * @param {string} folderId
 * @param {string} name
 * @returns {Promise<string|null>} file id or null
 */
async function findFileIdByNameInFolder(drive, folderId, name) {
  const fid = String(folderId || "").trim();
  const n = String(name || "").trim().replace(/'/g, "\\'");
  if (!fid || !n) return null;
  const q = `'${fid}' in parents and name = '${n}' and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const hit = res.data.files && res.data.files[0];
  return hit && hit.id ? hit.id : null;
}

/**
 * Find existing learnings file by name, or create once in folder. Avoids duplicate files when env pins are unset.
 */
async function findOrCreateTextFileInFolder(drive, folderId, name, mimeType, initialBody) {
  const existingId = await findFileIdByNameInFolder(drive, folderId, name);
  if (existingId) return existingId;
  return createTextFileInFolder(drive, folderId, name, mimeType, initialBody);
}

/**
 * Resolve or create judgment log file. Returns { fileId }.
 */
async function ensureJudgmentLogFile(drive) {
  const pinned = getLearningsJudgmentLogFileId();
  if (pinned) return { fileId: pinned };
  const folderId = getLearningsDriveFolderId();
  if (!folderId) {
    const err = new Error("LEARNINGS_DRIVE_FOLDER_ID or LEARNINGS_JUDGMENT_LOG_FILE_ID must be set.");
    err.code = "NO_LEARNINGS";
    throw err;
  }
  const fileId = await findOrCreateTextFileInFolder(drive, folderId, "judgment-log.json", "application/json", "[]\n");
  return { fileId };
}

/**
 * Resolve or create project-rules file.
 */
async function ensureProjectRulesFile(drive) {
  const pinned = getLearningsProjectRulesFileId();
  if (pinned) return { fileId: pinned };
  const folderId = getLearningsDriveFolderId();
  if (!folderId) {
    const err = new Error("LEARNINGS_DRIVE_FOLDER_ID or LEARNINGS_PROJECT_RULES_FILE_ID must be set.");
    err.code = "NO_LEARNINGS";
    throw err;
  }
  const fileId = await findOrCreateTextFileInFolder(
    drive,
    folderId,
    "project-rules.md",
    "text/markdown",
    "# Project rules\n\n(Merged from GENERAL RULE lines in execution docs.)\n",
  );
  return { fileId };
}

/**
 * @param {object} entry - serializable judgment record
 * @returns {Promise<{ judgmentUpdated: boolean }>}
 */
async function appendJudgmentLogEntry(entry) {
  const drive = await getDrive();
  const { fileId } = await ensureJudgmentLogFile(drive);
  let raw = "[]";
  try {
    raw = await downloadTextFile(drive, fileId);
  } catch (e) {
    console.warn("[learnings] judgment log read failed, resetting:", formatGoogleApiError(e));
  }
  let arr = [];
  try {
    const parsed = JSON.parse(raw);
    arr = Array.isArray(parsed) ? parsed : [];
  } catch {
    arr = [];
  }
  arr.push({
    ...entry,
    recorded_at: new Date().toISOString(),
  });
  await uploadReplaceFile(drive, fileId, "application/json", JSON.stringify(arr, null, 2) + "\n");
  return { judgmentUpdated: true };
}

/**
 * @param {string[]} ruleLines
 * @returns {Promise<{ rulesUpdated: boolean }>}
 */
async function mergeGeneralRules(ruleLines) {
  if (!ruleLines || ruleLines.length === 0) return { rulesUpdated: false };
  const drive = await getDrive();
  const { fileId } = await ensureProjectRulesFile(drive);
  let existing = "";
  try {
    existing = await downloadTextFile(drive, fileId);
  } catch (e) {
    console.warn("[learnings] project rules read failed:", formatGoogleApiError(e));
  }
  const stamp = new Date().toISOString();
  const block =
    "\n\n## GENERAL RULE ingest (" +
    stamp +
    ")\n\n" +
    ruleLines.map((r) => "- " + r.replace(/\n/g, " ")).join("\n") +
    "\n";
  const next = (existing || "").trimEnd() + block;
  await uploadReplaceFile(drive, fileId, "text/markdown", next);
  return { rulesUpdated: true };
}

/**
 * @returns {Promise<string>} truncated excerpt for prompts
 */
async function loadProjectRulesExcerpt() {
  const pinned = getLearningsProjectRulesFileId();
  const folderId = getLearningsDriveFolderId();
  if (!pinned && !folderId) return "";
  const max = getLearningsProjectRulesMaxChars();
  try {
    const drive = await getDrive();
    const { fileId } = await ensureProjectRulesFile(drive);
    const full = await downloadTextFile(drive, fileId);
    const t = String(full || "").trim();
    if (t.length <= max) return t;
    return t.slice(0, max) + "\n\n[truncated per LEARNINGS_PROJECT_RULES_MAX_CHARS]\n";
  } catch (e) {
    console.warn("[learnings] could not load project rules excerpt:", formatGoogleApiError(e));
    return "";
  }
}

module.exports = {
  appendJudgmentLogEntry,
  mergeGeneralRules,
  loadProjectRulesExcerpt,
};
