/**
 * Week 6: Enforcer revision Docs under ENFORCER_DRIVE_FOLDER_ID (or EXECUTION_DRIVE_FOLDER_ID) / <task_id>/.
 */

const { google } = require("googleapis");
const {
  getDriveDocsAuthClient,
  formatGoogleApiError,
  buildExecutionRecordPlainBody,
} = require("./googleDriveDocs");
const { getEnforcerDriveFolderId } = require("./env");

function escapeDriveQueryName(name) {
  return String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * @param {string} rootFolderId
 * @param {string} taskId
 * @returns {Promise<string>} folder id for this task
 */
async function ensureTaskSubfolder(rootFolderId, taskId) {
  const root = String(rootFolderId || "").trim();
  const tid = String(taskId || "").trim() || "unknown-task";
  if (!root) {
    const err = new Error("ENFORCER_DRIVE_FOLDER_ID or EXECUTION_DRIVE_FOLDER_ID must be set for Enforcer Docs.");
    err.code = "NO_EXECUTION_FOLDER";
    throw err;
  }
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const q =
    "mimeType='application/vnd.google-apps.folder' and '" +
    escapeDriveQueryName(root) +
    "' in parents and name='" +
    escapeDriveQueryName(tid) +
    "' and trashed=false";
  const list = await drive.files.list({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const hit = list.data.files && list.data.files[0];
  if (hit && hit.id) return hit.id;

  const createRes = await drive.files.create({
    requestBody: {
      name: tid,
      mimeType: "application/vnd.google-apps.folder",
      parents: [root],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const id = createRes.data.id;
  if (!id) throw new Error("Could not create task subfolder.");
  return id;
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {object} opts.fields - same shape as createExecutionGoogleDoc fields (+ optional reviewNotesPlaceholder)
 * @returns {Promise<{ fileId: string, url: string }>}
 */
async function createEnforcerGoogleDoc(opts) {
  const auth = await getDriveDocsAuthClient();
  const drive = google.drive({ version: "v3", auth });
  const docs = google.docs({ version: "v1", auth });

  const title = String(opts.title || "Enforcer revision").trim() || "Enforcer revision";
  const folderId = String(opts.folderId || "").trim();
  const f = opts.fields || {};
  const body = buildExecutionRecordPlainBody({
    ...f,
    reviewNotesPlaceholder: f.reviewNotesPlaceholder || "(Add reviewer notes below.)",
  });

  const requestBody = {
    name: title,
    mimeType: "application/vnd.google-apps.document",
    parents: folderId ? [folderId] : undefined,
  };

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

/**
 * @param {{ taskId: string, versionLabel: string, fields: object }} opts
 */
async function createEnforcerRevisionDoc(opts) {
  const root = getEnforcerDriveFolderId();
  const taskFolderId = await ensureTaskSubfolder(root, opts.taskId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const title =
    "Enforcer — " + String(opts.taskId || "") + " — " + String(opts.versionLabel || "rev") + " — " + stamp;
  return createEnforcerGoogleDoc({
    folderId: taskFolderId,
    title,
    fields: opts.fields,
  });
}

module.exports = {
  ensureTaskSubfolder,
  createEnforcerGoogleDoc,
  createEnforcerRevisionDoc,
};
