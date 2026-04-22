/**
 * Task-level deduplication and human-readable Task IDs (HM-0001).
 */

const { MASTER_COL_COUNT } = require("./sheetSchema");

const TASK_ID_RE = /^HM-(\d+)$/i;

function parseTaskIdNumber(taskId) {
  const m = String(taskId || "").trim().match(TASK_ID_RE);
  if (!m) return 0;
  return parseInt(m[1], 10) || 0;
}

/**
 * @param {string[][]} rows - data rows (no header), each at least length 1 for task_id column
 * @returns {string} e.g. HM-0042
 */
function getNextTaskId(rows) {
  let maxN = 0;
  for (const row of rows) {
    const n = parseTaskIdNumber(row[0]);
    if (n > maxN) maxN = n;
  }
  const next = maxN + 1;
  return "HM-" + String(next).padStart(4, "0");
}

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dueKey(d) {
  const s = String(d || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return normalizeForMatch(s);
}

/**
 * @param {object} newTask
 * @param {string[][]} existingDataRows - same shape as master sheet (16 cols)
 * @param {number} baseRow - first data row in sheet (usually 2)
 * @returns {{ type: "update" | "insert", sheetRow?: number, taskId: string }}
 */
function matchOrAllocateTask(newTask, existingDataRows, baseRow) {
  const nTask = normalizeForMatch(newTask.task);
  const nOwner = normalizeForMatch(newTask.owner);
  const dNew = dueKey(newTask.due_date || newTask.dueOrNextStep);

  for (let i = 0; i < existingDataRows.length; i++) {
    const row = existingDataRows[i];
    if (!row || row.length < 2) continue;
    const eTask = normalizeForMatch(row[1] || "");
    const eOwner = normalizeForMatch(row[2] || "");
    const dOld = dueKey(row[5] || row[4] || "");
    const existingId = String(row[0] || "").trim();
    if (
      nTask === eTask &&
      nOwner === eOwner &&
      dNew === dOld &&
      nTask.length > 0 &&
      existingId
    ) {
      return {
        type: "update",
        sheetRow: baseRow + i,
        taskId: existingId,
      };
    }
  }

  const taskId = getNextTaskId(existingDataRows);
  return { type: "insert", taskId };
}

/**
 * Build one Master Action Board row (16 cells) for a new or updated task.
 * @param {object} a - action item from parseHiveMindPayload (extended)
 * @param {object} meeting - { source_transcript_id, meeting_title, meeting_date }
 * @param {string} taskId
 * @param {string} createdAt - keep on update
 * @param {string} nowIso
 */
function buildMasterRow(a, meeting, taskId, createdAt, nowIso) {
  const create = createdAt || nowIso;
  return [
    taskId,
    a.task,
    a.owner,
    a.status || "open",
    String(a.urgency),
    a.due_date || "",
    a.next_step || a.dueOrNextStep || "",
    a.blockers || "None noted",
    a.dependencies || "None noted",
    a.okr_link || "None noted",
    a.risk_flag || "none",
    meeting.source_transcript_id,
    meeting.meeting_title,
    meeting.meeting_date,
    create,
    nowIso,
  ];
}

/**
 * @returns {string[][]} padded to MASTER_COL_COUNT
 */
function padRow(cells) {
  const o = cells.slice(0, MASTER_COL_COUNT);
  while (o.length < MASTER_COL_COUNT) o.push("");
  return o;
}

module.exports = {
  getNextTaskId,
  matchOrAllocateTask,
  buildMasterRow,
  padRow,
};
