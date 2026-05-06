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
const {
  readProjectRulesMarkdown,
  getRelevantRulesForPrompt,
  inferRulesSectionSlug,
} = require("./learningsStore");

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
    '- "is_executable": boolean — suitable for LLM execution (not purely physical-only / impossible here)?',
    '- "execution_type": short string label, e.g. "draft email", "lab guide", "slide outline"',
    '- "can_execute": boolean — true if a reasonable first draft can be produced now without blocking gaps.',
    '- "missing_information": array of objects { "item": string, "status": "blocking" | "optional" | "irrelevant", "reason": string }',
    '- "assumptions": array of strings — explicit assumptions if proceeding with incomplete context.',
    '- "execution_recommendation": short string — e.g. "Proceed with assumptions." or why blocked.',
    '- "generated_prompt": string — concise draft instructions for the execution model (will be expanded by the system). Empty only if truly cannot execute.',
    '- "should_execute_now": boolean — true when execution_needed is Yes, is_executable true, can_execute true, no blocking missing_information items, generated_prompt non-empty.',
    "",
    "Rules:",
    '- Be action-oriented: prefer can_execute=true when a useful draft is possible.',
    '- Use status "blocking" ONLY when missing facts make the task impossible, unsafe, or materially misleading.',
    '- Use "optional" for helpful-but-not-required context; list what is missing and why it still can proceed.',
    '- Use "irrelevant" for noise.',
    '- Linked Google Doc text may appear under "Context from linked Google Docs" — use it; cite blocking gaps only when the draft would be misleading without them.',
    '- If Doc links exist but no body text appears, mention permission/type issues — blocking only if execution truly cannot proceed.',
    '- Do not use vague items; name concrete gaps.',
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

function hasBlockingMissingInformation(json) {
  const arr = Array.isArray(json.missing_information) ? json.missing_information : [];
  return arr.some(function (x) {
    return String(x.status || "").toLowerCase() === "blocking";
  });
}

function formatMissingInfoCell(json) {
  const parts = [];
  const arr = Array.isArray(json.missing_information) ? json.missing_information : [];
  for (const it of arr) {
    const status = String(it.status || "").toLowerCase();
    const item = String(it.item || "").trim();
    const reason = String(it.reason || "").trim();
    if (!item || status === "irrelevant") continue;
    parts.push("[" + status + "] " + item + (reason ? ": " + reason : ""));
  }
  return parts.join(" | ");
}

/**
 * @param {string[]} row
 * @param {object} json - classifier output
 * @param {string} driveContextText
 * @param {string} projectRulesSnippet
 */
function buildExpandedExecutionPrompt(row, json, driveContextText, projectRulesSnippet) {
  const r = padRow(row);
  const assumptions = Array.isArray(json.assumptions) ? json.assumptions.map(String) : [];
  const draft = String(json.generated_prompt || "").trim();
  const lines = [
    "## Expert role",
    "You are an expert operator producing concrete work product for a founder command center.",
    "",
    "## Task objective",
    String(r[IDX.task] || "").trim(),
    "",
    "## Task metadata",
    [
      "Task ID: " + r[IDX.task_id],
      "Owner: " + r[IDX.owner],
      "Due date: " + r[IDX.due_date],
      "Next step: " + r[IDX.next_step],
      "Blockers: " + r[IDX.blockers],
      "Risk: " + r[IDX.risk_flag],
      "Execution type (classified): " + String(json.execution_type || r[IDX.execution_type] || ""),
      "Meeting: " + r[IDX.meeting_title] + " @ " + r[IDX.meeting_date],
    ].join("\n"),
    "",
    "## Execution context (sheet notes)",
    String(r[IDX.execution_context] || "").trim() || "(none)",
    "",
    "## Linked Google Docs context",
    String(driveContextText || "").trim() ||
      "(none — if links exist but this is empty, verify the service account can access the Docs.)",
    "",
    "## Intended output type",
    String(json.execution_type || "").trim() || "Infer from the task wording.",
    "",
    "## Output structure",
    "Deliver the artifact first with clear headings/lists/steps as appropriate. Avoid long preamble.",
    "",
    "## Quality criteria",
    "Specific, actionable, grounded in provided context, appropriately scoped, safe for internal review.",
    "",
    "## Assumptions if context is incomplete",
    assumptions.length ? assumptions.map(function (a) {
      return "- " + a;
    }).join("\n") : "- Use reasonable defaults consistent with context; state them briefly in the artifact if needed.",
    "",
    "## Constraints / things to avoid",
    "- No generic filler or commentary about being an AI.",
    "- Do not refuse solely due to minor unknowns if assumptions suffice.",
    "",
    "## Project rules (Learnings)",
    String(projectRulesSnippet || "").trim() || "(none)",
    "",
    "## Draft instructions (from classifier)",
    draft || "(none)",
    "",
    "## Final instruction",
    "Produce the full deliverable now — useful work product, not a discussion about how you would approach it.",
  ];
  return lines.join("\n");
}

function validateExecutionPromptChecklist(prompt) {
  const p = String(prompt || "");
  const checks = [
    ["Task objective", /Task objective/i.test(p)],
    ["Output structure", /Output structure/i.test(p)],
    ["Quality criteria", /Quality criteria/i.test(p)],
    ["Final instruction", /Final instruction/i.test(p)],
  ];
  const failed = checks.filter(function (c) {
    return !c[1];
  }).map(function (c) {
    return c[0];
  });
  return { ok: failed.length === 0, failed };
}

/**
 * @param {object} json
 */
function mapClassificationToStatus(json) {
  const needed = isYes(json.execution_needed);
  const executable = json.is_executable !== false && json.is_executable !== "false";

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
  if (json.can_execute === false || json.can_execute === "false") {
    return {
      status: STATUS_MISSING,
      reason: String(json.execution_recommendation || "can_execute is false.").trim(),
    };
  }
  if (hasBlockingMissingInformation(json)) {
    return { status: STATUS_MISSING, reason: "Blocking information gaps remain." };
  }
  return { status: STATUS_READY, reason: "" };
}

/**
 * Recommended gate: execution_allowed when no blocking gaps and draft prompt exists.
 * @param {object} json
 */
function passesExecuteGate(json) {
  const needed = isYes(json.execution_needed);
  const executable = json.is_executable !== false && json.is_executable !== "false";
  const prompt = String(json.generated_prompt || "").trim();
  if (!needed || !executable || !prompt) return false;
  if (json.can_execute === false || json.can_execute === "false") return false;
  if (hasBlockingMissingInformation(json)) return false;
  return true;
}

async function openAiChatJsonWrapper(apiKey, model, system, user) {
  return openAiChatJson(apiKey, model, system, user, 0.2);
}

async function openAiChatTextWrapper(apiKey, model, system, user) {
  return openAiChatText(apiKey, model, system, user, 0.3);
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
  return openAiChatJsonWrapper(apiKey, model, system, user);
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
  return openAiChatTextWrapper(apiKey, model, system, user);
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
  const mi = formatMissingInfoCell(json);
  r[IDX.missing_info] = mi;
  let er = String(reason || "").trim();
  const rec = String(json.execution_recommendation || "").trim();
  if (rec && status === STATUS_READY) {
    er = er ? er + " — " + rec : rec;
  } else if (rec && !er) {
    er = rec;
  }
  r[IDX.execution_status] = status;
  r[IDX.execution_status_reason] = er;
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

      const rulesRes = await readProjectRulesMarkdown();
      const slug = inferRulesSectionSlug(json.execution_type, working[IDX.task]);
      const rulesSnip = rulesRes.configured ? getRelevantRulesForPrompt(rulesRes.text, slug) : "";
      const expandedPrompt = buildExpandedExecutionPrompt(working, json, driveContextText, rulesSnip);
      const chk = validateExecutionPromptChecklist(expandedPrompt);
      if (!chk.ok) {
        console.warn("[execution] Prompt checklist incomplete:", chk.failed.join(", "));
      }

      if (dry) {
        summary.dryRunWouldExecute += 1;
        console.log("[execution dry-run] would execute row", sheetRow, working[IDX.task_id]);
        continue;
      }

      let llmOutput;
      try {
        llmOutput = await runExecutionLlm(expandedPrompt, apiKey, "");
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
            generatedPrompt: expandedPrompt,
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
  buildExpandedExecutionPrompt,
  validateExecutionPromptChecklist,
  formatMissingInfoCell,
  hasBlockingMissingInformation,
  mapClassificationToStatus,
  passesExecuteGate,
  runExecutionLlm,
  IDX,
  padRow,
  STATUS_READY,
  STATUS_MISSING,
  STATUS_NOT_AUTO,
  STATUS_REVIEW,
};
