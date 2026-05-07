/**
 * Week 5: scan Master Action Board, classify tasks for execution, run execution LLM, write Google Doc + sheet.
 */

const {
  getMasterDataRows,
  updateMasterRow,
  ensureMasterExecutionSchema,
} = require("./commandCenterSheets");
const { MASTER_COLUMNS } = require("./sheetSchema");
const {
  getExecutionDriveFolderId,
  getExecutionClassifyModel,
  getExecutionLlmModel,
  isExecutionDryRun,
  getExecutionContextDocMaxCharsPerFile,
  getExecutionContextDocMaxCharsTotal,
  getExecutionContextDocMaxFiles,
} = require("./env");
const { createExecutionGoogleDoc, fetchExecutionContextFromDocLinksCell } = require("./googleDriveDocs");
const { getServiceAccountCredentials } = require("./googleSheets");
const { openAiChatJson, openAiChatText } = require("./openAiChat");

const STATUS_READY = "Ready for Execution";
const STATUS_MISSING = "Missing Info";
const STATUS_NOT_AUTO = "Not Automatable";
const STATUS_REVIEW = "Ready for Review";

function colIndex(name) {
  const i = MASTER_COLUMNS.indexOf(name);
  if (i < 0) throw new Error("Unknown column: " + name);
  return i;
}

const IDX = {
  task_id: colIndex("task_id"),
  task: colIndex("task"),
  owner: colIndex("owner"),
  status: colIndex("status"),
  due_date: colIndex("due_date"),
  next_step: colIndex("next_step"),
  blockers: colIndex("blockers"),
  dependencies: colIndex("dependencies"),
  okr_link: colIndex("okr_link"),
  risk_flag: colIndex("risk_flag"),
  meeting_title: colIndex("meeting_title"),
  meeting_date: colIndex("meeting_date"),
  execution_needed: colIndex("execution_needed"),
  execution_context: colIndex("execution_context"),
  execution_type: colIndex("execution_type"),
  missing_info: colIndex("missing_info"),
  execution_status: colIndex("execution_status"),
  execution_status_reason: colIndex("execution_status_reason"),
  latest_execution_id: colIndex("latest_execution_id"),
  execution_output_link: colIndex("execution_output_link"),
  last_executed_at: colIndex("last_executed_at"),
  force_rerun: colIndex("force_rerun"),
  execution_context_doc_links: colIndex("execution_context_doc_links"),
};

function padRow(row) {
  const r = (row || []).slice();
  while (r.length < MASTER_COLUMNS.length) r.push("");
  return r;
}

function isDoneStatus(s) {
  return String(s || "").trim().toLowerCase() === "done";
}

function isForceRerunCell(s) {
  const v = String(s || "").trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1";
}

function isYes(val) {
  if (val === true) return true;
  const v = String(val || "").trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

/**
 * @param {string[][]} dataRows
 * @returns {{ sheetRow: number, row: string[] }[]}
 */
function listExecutionCandidates(dataRows) {
  const out = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = padRow(dataRows[i]);
    if (isDoneStatus(row[IDX.status])) continue;
    const taskText = String(row[IDX.task] || "").trim();
    if (!taskText) continue;
    const outLink = String(row[IDX.execution_output_link] || "").trim();
    const force = isForceRerunCell(row[IDX.force_rerun]);
    if (outLink && !force) continue;
    out.push({ sheetRow: i + 2, row });
  }
  return out;
}

function buildClassifierSystemPrompt() {
  return [
    "You are a task execution planner for a founder command center.",
    "Given one task row (with meeting and execution context), decide how automation should treat it.",
    "",
    "Respond with one JSON object only (no markdown). Keys:",
    '- "execution_needed": string "Yes" or "No" — should an LLM try to produce a useful artifact?',
    '- "is_executable": boolean — is this suitable for LLM execution (not purely physical/legal-only/etc.)?',
    '- "execution_type": short string label, e.g. "draft email", "create summary", "generate checklist"',
    '- "missing_info": string — concrete gaps (who, artifact, metric, URL). Empty string "" if none.',
    '- "generated_prompt": string — the exact prompt to send to the execution model if we run; empty if not ready.',
    '- "should_execute_now": boolean — MUST be true exactly when execution_needed is Yes, is_executable is true, missing_info is empty, and generated_prompt is non-empty. Otherwise false.',
    "",
    "Rules:",
    "- Linked Google Doc text may appear under \"Context from linked Google Docs\" — use it for facts, constraints, and tone; cite gaps in missing_info if the text is insufficient.",
    "- If the cell lists Doc links but no document body appears, assume permission or type issues — mention that in missing_info if it blocks execution.",
    "- If anything important is unknown, put specifics in missing_info and set should_execute_now to false.",
    "- Do not use vague missing_info; name what is missing.",
    "- should_execute_now must match: Yes + executable + no missing_info + non-empty generated_prompt.",
  ].join("\n");
}

function buildClassifierUserContent(row, driveContextText) {
  const r = padRow(row);
  const lines = [
    "Task ID: " + r[IDX.task_id],
    "Task: " + r[IDX.task],
    "Owner: " + r[IDX.owner],
    "Status: " + r[IDX.status],
    "Due date: " + r[IDX.due_date],
    "Next step: " + r[IDX.next_step],
    "Blockers: " + r[IDX.blockers],
    "Dependencies: " + r[IDX.dependencies],
    "Risk flag: " + r[IDX.risk_flag],
    "OKR link: " + r[IDX.okr_link],
    "Meeting title: " + r[IDX.meeting_title],
    "Meeting date: " + r[IDX.meeting_date],
    "",
    "Execution Context (from sheet — short notes):",
    r[IDX.execution_context] || "(empty)",
    "",
    "Execution Context Doc Links (raw cell — Google Doc URLs or file ids, comma/newline separated):",
    r[IDX.execution_context_doc_links] || "(empty)",
  ];
  const cellLinks = String(r[IDX.execution_context_doc_links] || "").trim();
  const fetched = String(driveContextText || "").trim();
  if (fetched) {
    lines.push("", "Context from linked Google Docs (plain text export; may be truncated):", fetched);
  } else if (cellLinks) {
    lines.push(
      "",
      "Context from linked Google Docs: (no readable text was returned — check that each Doc is shared with the service account and that links are Google Docs.)",
    );
  }
  return lines.join("\n");
}

/**
 * @param {object} json
 */
function mapClassificationToStatus(json) {
  const missing = String(json.missing_info || "").trim();
  const needed = isYes(json.execution_needed);
  const executable = json.is_executable !== false && json.is_executable !== "false";

  if (missing) {
    return { status: STATUS_MISSING, reason: "Classifier reported missing information." };
  }
  if (!needed || !executable) {
    const reason = !needed
      ? "Automation not selected (execution not needed)."
      : "Task not suitable for LLM execution.";
    return { status: STATUS_NOT_AUTO, reason };
  }
  const prompt = String(json.generated_prompt || "").trim();
  if (!prompt) {
    return {
      status: STATUS_MISSING,
      reason: "Classifier did not produce an execution prompt.",
    };
  }
  return { status: STATUS_READY, reason: "" };
}

/**
 * Recommended gate (Week 5 guide Part 7): do not rely on should_execute_now alone.
 * @param {object} json
 */
function passesExecuteGate(json) {
  const missing = String(json.missing_info || "").trim();
  const needed = isYes(json.execution_needed);
  const executable = json.is_executable !== false && json.is_executable !== "false";
  const prompt = String(json.generated_prompt || "").trim();
  return needed && executable && !missing && prompt.length > 0;
}

/**
 * @param {string[]} row
 * @param {string} apiKey
 * @param {string} [driveContextText] - plain text from linked Google Docs
 */
async function classifyTaskForExecution(row, apiKey, driveContextText) {
  const model = getExecutionClassifyModel();
  const system = buildClassifierSystemPrompt();
  const user = buildClassifierUserContent(row, driveContextText);
  return openAiChatJson(apiKey, model, system, user);
}

/**
 * @param {string} generatedPrompt
 * @param {string} apiKey
 * @param {string} [driveContextText]
 */
async function runExecutionLlm(generatedPrompt, apiKey, driveContextText) {
  const model = getExecutionLlmModel();
  const system =
    "You are a capable assistant executing a concrete workspace task. Follow the user's instructions precisely. Output the deliverable directly (no meta-commentary unless asked).";
  const p = String(generatedPrompt || "").trim();
  const d = String(driveContextText || "").trim();
  const user = d
    ? "Execution instructions (primary):\n" +
      p +
      "\n\n---\nSource material from linked Google Docs (may be truncated; use as facts/constraints):\n" +
      d
    : p;
  return openAiChatText(apiKey, model, system, user);
}

/**
 * Merge classification into row; preserves execution_context from sheet.
 * @param {string[]} row
 * @param {object} json
 */
function applyClassificationToRow(row, json) {
  const r = padRow(row);
  const { status, reason } = mapClassificationToStatus(json);
  r[IDX.execution_needed] = isYes(json.execution_needed) ? "Yes" : "No";
  r[IDX.execution_type] = String(json.execution_type || "").trim();
  r[IDX.missing_info] = String(json.missing_info || "").trim();
  r[IDX.execution_status] = status;
  r[IDX.execution_status_reason] = String(reason || "").trim();
  return r;
}

/**
 * @param {string[]} row
 * @param {{ fileId: string, url: string }} doc
 */
function applyExecutionSuccessToRow(row, doc) {
  const r = padRow(row);
  const now = new Date().toISOString();
  r[IDX.execution_output_link] = doc.url;
  r[IDX.latest_execution_id] = doc.fileId;
  r[IDX.last_executed_at] = now;
  r[IDX.execution_status] = STATUS_REVIEW;
  r[IDX.execution_status_reason] = "";
  r[IDX.force_rerun] = "No";
  return r;
}

async function runExecutionWorkbenchOnce() {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set.");
    err.code = "NO_OPENAI";
    throw err;
  }

  const dry = isExecutionDryRun();
  const folderId = getExecutionDriveFolderId();
  if (!folderId) {
    console.warn(
      "[execution] EXECUTION_DRIVE_FOLDER_ID is not set. Doc creation may hit service-account quota; prefer a Shared drive folder id.",
    );
  }
  if (dry) {
    console.log("[execution] EXECUTION_DRY_RUN is on: will classify and update the sheet, but skip execution LLM + Google Doc.");
  }

  const schemaResult = await ensureMasterExecutionSchema();
  if (schemaResult.updated) {
    console.log("[execution] Master sheet execution headers were added or filled in.");
  }

  const dataRows = await getMasterDataRows();
  const candidates = listExecutionCandidates(dataRows);

  const summary = {
    candidates: candidates.length,
    classified: 0,
    executed: 0,
    skippedExecute: 0,
    dryRunWouldExecute: 0,
    errors: [],
    dryRun: dry,
  };

  for (const { sheetRow, row } of candidates) {
    let working = padRow(row);
    try {
      const creds = getServiceAccountCredentials();
      const clientEmail = typeof creds?.client_email === "string" ? creds.client_email : "";
      const linksCell = String(working[IDX.execution_context_doc_links] || "").trim();
      const { text: driveContextText } = await fetchExecutionContextFromDocLinksCell(linksCell, {
        perFileMaxChars: getExecutionContextDocMaxCharsPerFile(),
        totalMaxChars: getExecutionContextDocMaxCharsTotal(),
        maxFiles: getExecutionContextDocMaxFiles(),
        clientEmail,
      });

      const json = await classifyTaskForExecution(working, apiKey, driveContextText);
      summary.classified += 1;
      working = applyClassificationToRow(working, json);
      await updateMasterRow(sheetRow, working);

      const canExecute = passesExecuteGate(json);
      if (!canExecute) {
        summary.skippedExecute += 1;
        continue;
      }

      if (dry) {
        summary.dryRunWouldExecute += 1;
        console.log("[execution dry-run] would execute row", sheetRow, working[IDX.task_id]);
        continue;
      }

      const generatedPrompt = String(json.generated_prompt || "").trim();
      let llmOutput;
      try {
        llmOutput = await runExecutionLlm(generatedPrompt, apiKey, driveContextText);
      } catch (e) {
        working[IDX.execution_status] = STATUS_MISSING;
        working[IDX.execution_status_reason] = "Execution LLM failed: " + String(e.message || e);
        await updateMasterRow(sheetRow, working);
        summary.errors.push({ sheetRow, step: "execution_llm", error: String(e.message || e) });
        continue;
      }

      const title = "Execution — " + String(working[IDX.task_id] || sheetRow) + " — " + new Date().toISOString().slice(0, 10);
      let doc;
      try {
        doc = await createExecutionGoogleDoc({
          folderId,
          title,
          fields: {
            taskId: working[IDX.task_id],
            task: working[IDX.task],
            executionType: working[IDX.execution_type],
            generatedPrompt,
            llmOutput,
            missingInfo: working[IDX.missing_info],
            createdAt: new Date().toISOString(),
            executionContextDocLinks: working[IDX.execution_context_doc_links],
          },
        });
      } catch (e) {
        working[IDX.execution_status] = STATUS_MISSING;
        working[IDX.execution_status_reason] = "Google Doc failed: " + String(e.message || e);
        await updateMasterRow(sheetRow, working);
        summary.errors.push({ sheetRow, step: "google_doc", error: String(e.message || e) });
        continue;
      }

      working = applyExecutionSuccessToRow(working, doc);
      await updateMasterRow(sheetRow, working);
      summary.executed += 1;
    } catch (e) {
      summary.errors.push({ sheetRow, step: "classify_or_write", error: String(e.message || e) });
      console.error("[execution] row", sheetRow, e);
    }
  }

  return summary;
}

module.exports = {
  runExecutionWorkbenchOnce,
  listExecutionCandidates,
  classifyTaskForExecution,
  buildClassifierUserContent,
  mapClassificationToStatus,
  passesExecuteGate,
  IDX,
  padRow,
  STATUS_READY,
  STATUS_MISSING,
  STATUS_NOT_AUTO,
  STATUS_REVIEW,
};
