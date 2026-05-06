/**
 * Learnings: judgment-log.json + project-rules.md in LEARNINGS_DRIVE_FOLDER_ID.
 * Canonical files updated in place via stable file ids (files.update).
 */

const { google } = require("googleapis");
const { Readable } = require("stream");
const { getDriveDocsAuthClient } = require("./googleDriveDocs");
const {
  getLearningsDriveFolderId,
  getLearningsJudgmentLogFileId,
  getLearningsProjectRulesFileId,
} = require("./env");

const JUDGMENT_NAME = "judgment-log.json";
const RULES_NAME = "project-rules.md";

function slugifySection(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "general";
}

/**
 * Infer markdown section slug for project rules (dynamic; not a fixed task-type enum).
 * @param {string} executionType
 * @param {string} taskText
 */
function inferRulesSectionSlug(executionType, taskText) {
  const et = String(executionType || "").trim();
  if (et) return slugifySection(et);
  return slugifySection(String(taskText || "").slice(0, 80));
}

async function listFilesInFolder(drive, folderId, fileName) {
  const escaped = String(fileName).replace(/'/g, "\\'");
  const q = `'${folderId}' in parents and name = '${escaped}' and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: "files(id, name, modifiedTime)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 20,
  });
  return res.data.files || [];
}

/**
 * @param {string} folderId
 * @param {string} envFileId
 * @param {string} fileName
 */
async function resolveCanonicalFileId(folderId, envFileId, fileName) {
  if (String(envFileId || "").trim()) return String(envFileId).trim();
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const files = await listFilesInFolder(drive, folderId, fileName);
  if (files.length === 0) return null;
  if (files.length === 1) return files[0].id;
  files.sort(function (a, b) {
    return String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || ""));
  });
  console.warn(
    `[learnings] Multiple "${fileName}" in folder ${folderId}; using most recently modified (${files[0].id}).`,
  );
  return files[0].id;
}

async function uploadNewFile(folderId, name, mimeType, body) {
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const buf = Buffer.from(body, "utf8");
  const stream = Readable.from(buf);
  const createRes = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType,
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const id = createRes.data.id;
  if (!id) throw new Error("Drive files.create returned no id for " + name);
  return id;
}

async function updateFileContent(fileId, mimeType, body) {
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const buf = Buffer.from(body, "utf8");
  const stream = Readable.from(buf);
  await drive.files.update({
    fileId,
    media: {
      mimeType,
      body: stream,
    },
    supportsAllDrives: true,
  });
}

function defaultJudgmentDoc() {
  return JSON.stringify({ entries: [] }, null, 2);
}

function defaultRulesDoc() {
  return ["# Project Rules", "", "## general", "", "- (No rules yet.)", ""].join("\n");
}

async function ensureJudgmentLogFileId(folderId) {
  let id = await resolveCanonicalFileId(folderId, getLearningsJudgmentLogFileId(), JUDGMENT_NAME);
  if (!id) {
    id = await uploadNewFile(folderId, JUDGMENT_NAME, "application/json", defaultJudgmentDoc());
    console.log("[learnings] Created", JUDGMENT_NAME, "file id:", id);
  }
  return id;
}

async function ensureProjectRulesFileId(folderId) {
  let id = await resolveCanonicalFileId(folderId, getLearningsProjectRulesFileId(), RULES_NAME);
  if (!id) {
    id = await uploadNewFile(folderId, RULES_NAME, "text/markdown", defaultRulesDoc());
    console.log("[learnings] Created", RULES_NAME, "file id:", id);
  }
  return id;
}

async function readJudgmentLog() {
  const folderId = getLearningsDriveFolderId();
  if (!folderId) return { entries: [], configured: false };
  const fileId = await ensureJudgmentLogFileId(folderId);
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  const raw = typeof res.data === "string" ? res.data : String(res.data || "");
  try {
    const data = JSON.parse(raw);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return { entries, configured: true, fileId };
  } catch {
    return { entries: [], configured: true, fileId, parseError: true };
  }
}

/**
 * @param {object} entry
 */
async function appendJudgmentEntry(entry) {
  const folderId = getLearningsDriveFolderId();
  if (!folderId) {
    const err = new Error("LEARNINGS_DRIVE_FOLDER_ID is not set.");
    err.code = "LEARNINGS_NOT_CONFIGURED";
    throw err;
  }
  const fileId = await ensureJudgmentLogFileId(folderId);
  const cur = await readJudgmentLog();
  if (cur.parseError) {
    const err = new Error("judgment-log.json exists but is not valid JSON; fix the file in Drive before appending.");
    err.code = "JUDGMENT_LOG_PARSE";
    throw err;
  }
  const entries = cur.entries.slice();
  entries.push(entry);
  const body = JSON.stringify({ entries }, null, 2);
  await updateFileContent(fileId, "application/json", body);
  return { fileId, count: entries.length };
}

async function readProjectRulesMarkdown() {
  const folderId = getLearningsDriveFolderId();
  if (!folderId) return { text: "", configured: false };
  const fileId = await ensureProjectRulesFileId(folderId);
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  const text = typeof res.data === "string" ? res.data : String(res.data || "");
  return { text, configured: true, fileId };
}

/**
 * Pull ## general and ## {slug} sections for injection into prompts.
 * @param {string} fullMarkdown
 * @param {string} sectionSlug
 */
function getRelevantRulesForPrompt(fullMarkdown, sectionSlug) {
  const md = String(fullMarkdown || "");
  const slug = slugifySection(sectionSlug);
  const sections = parseMarkdownH2Sections(md);
  const parts = [];
  const gen = sections.get("general");
  if (gen) parts.push("## general\n\n" + gen.trim());
  const spec = sections.get(slug);
  if (spec) parts.push("## " + slug + "\n\n" + spec.trim());
  return parts.join("\n\n").trim();
}

/**
 * @param {string} md
 * @returns {Map<string, string>}
 */
function parseMarkdownH2Sections(md) {
  const map = new Map();
  const lines = String(md || "").split(/\r?\n/);
  let cur = null;
  let buf = [];
  function flush() {
    if (cur != null) map.set(cur, buf.join("\n"));
  }
  for (const line of lines) {
    const m = /^##\s+(.+)\s*$/.exec(line);
    if (m) {
      flush();
      cur = slugifySection(m[1]);
      buf = [];
    } else if (cur != null) buf.push(line);
  }
  flush();
  return map;
}

function normalizeRuleLine(s) {
  return String(s || "")
    .trim()
    .replace(/^[-*]\s*/, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function insertBulletUnderSection(md, slug, bullet) {
  const header = "## " + slug;
  const lines = String(md || "").split(/\r?\n/);
  const out = [];
  let inserted = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    if (line.trim() === header && !inserted) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") {
        out.push(lines[j]);
        j++;
      }
      out.push(bullet);
      inserted = true;
      i = j;
      continue;
    }
    i++;
  }
  if (!inserted) {
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(header, "", bullet, "");
  }
  return out.join("\n");
}

/**
 * Add a bullet under ## {sectionSlug}, creating section if missing. Skip near-duplicates.
 * @param {string} sectionSlug
 * @param {string} bulletText - line without leading GENERAL RULE:
 */
async function mergeProjectRulesBullet(sectionSlug, bulletText) {
  const folderId = getLearningsDriveFolderId();
  if (!folderId) {
    const err = new Error("LEARNINGS_DRIVE_FOLDER_ID is not set.");
    err.code = "LEARNINGS_NOT_CONFIGURED";
    throw err;
  }
  const fileId = await ensureProjectRulesFileId(folderId);
  const cur = await readProjectRulesMarkdown();
  let md = cur.text.trim() || defaultRulesDoc();
  const slug = slugifySection(sectionSlug);
  const bullet = "- " + String(bulletText || "").trim();
  const normNew = normalizeRuleLine(bullet);

  const map = parseMarkdownH2Sections(md);
  const existing = map.get(slug) || "";
  const existingLines = existing.split(/\r?\n/).filter((l) => l.trim());
  for (const line of existingLines) {
    if (normalizeRuleLine(line) === normNew) {
      return { fileId, updated: false, reason: "duplicate" };
    }
  }

  md = insertBulletUnderSection(md, slug, bullet);
  await updateFileContent(fileId, "text/markdown", md);
  return { fileId, updated: true };
}

function isLearningsConfigured() {
  return Boolean(getLearningsDriveFolderId());
}

module.exports = {
  slugifySection,
  inferRulesSectionSlug,
  readJudgmentLog,
  appendJudgmentEntry,
  readProjectRulesMarkdown,
  getRelevantRulesForPrompt,
  mergeProjectRulesBullet,
  isLearningsConfigured,
  ensureJudgmentLogFileId,
  ensureProjectRulesFileId,
  JUDGMENT_NAME,
  RULES_NAME,
};
