/**
 * Drive helpers for Week 6 Enforcer artifacts under Agentic Work Product/<TASK-ID>/.
 */

const { google } = require("googleapis");
const {
  getDriveDocsAuthClient,
  formatGoogleApiError,
} = require("./googleDriveDocs");

const AGENTIC_FOLDER_NAME = "Agentic Work Product";

async function findChildFolder(drive, parentId, name) {
  const escaped = String(name).replace(/'/g, "\\'");
  const q =
    "'" +
    parentId +
    "' in parents and name = '" +
    escaped +
    "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const res = await drive.files.list({
    q,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 5,
  });
  const files = res.data.files || [];
  return files.length ? files[0].id : null;
}

async function createChildFolder(drive, parentId, name) {
  const createRes = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const id = createRes.data.id;
  if (!id) throw new Error("Drive folder create returned no id for " + name);
  return id;
}

/**
 * Ensure single child folder by name under parent (creates if missing).
 */
async function ensureChildFolder(parentId, name) {
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  let id = await findChildFolder(drive, parentId, name);
  if (!id) id = await createChildFolder(drive, parentId, name);
  return id;
}

/**
 * EXECUTION_DRIVE_FOLDER_ID -> Agentic Work Product -> TASK-ID
 * @param {string} rootExecutionFolderId
 * @param {string} taskId
 */
async function ensureTaskArtifactFolder(rootExecutionFolderId, taskId) {
  const root = String(rootExecutionFolderId || "").trim();
  if (!root) {
    const err = new Error("EXECUTION_DRIVE_FOLDER_ID is not set.");
    err.code = "NO_EXECUTION_FOLDER";
    throw err;
  }
  const tid = String(taskId || "TASK").trim() || "TASK";
  const agentic = await ensureChildFolder(root, AGENTIC_FOLDER_NAME);
  return ensureChildFolder(agentic, tid);
}

/**
 * Create a Google Doc with Enforcer artifact layout.
 * @param {{ folderId: string, title: string, fields: object }} opts
 */
async function createEnforcerArtifactGoogleDoc(opts) {
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const docs = google.docs({ version: "v1", auth });

  const title = String(opts.title || "Enforcer artifact").trim();
  const folderId = String(opts.folderId || "").trim();
  const f = opts.fields || {};

  const body = [
    "Hive Mind — Enforcer artifact",
    "",
    "Task ID: " + String(f.taskId || ""),
    "Task: " + String(f.task || ""),
    "Version label: " + String(f.versionLabel || ""),
    "Enforcer score: " + String(f.enforcerScore != null ? f.enforcerScore : ""),
    "",
    "=== Artifact ===",
    String(f.artifactBody || "").trim(),
    "",
    "=== Review Notes ===",
    "(Human reviewer notes below.)",
    "",
  ].join("\n");

  const requestBody = {
    name: title,
    mimeType: "application/vnd.google-apps.document",
  };
  if (folderId) requestBody.parents = [folderId];

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
  if (!fileId) throw new Error("Drive API returned no file id.");

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
    console.warn("[enforcer doc] permissions.create (anyone) failed:", formatGoogleApiError(err));
  }

  const url = `https://docs.google.com/document/d/${fileId}/edit`;
  return { fileId, url };
}

module.exports = {
  AGENTIC_FOLDER_NAME,
  ensureChildFolder,
  ensureTaskArtifactFolder,
  createEnforcerArtifactGoogleDoc,
};
