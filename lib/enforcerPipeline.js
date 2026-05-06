/**
 * Week 6 Enforcer: universal QA, rubrics, combined scoring, revision (OpenAI JSON/text).
 */

const { openAiChatJson, openAiChatText } = require("./openAiChat");

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function buildTaskBundleText(row, padRow, IDX) {
  const r = padRow(row);
  return [
    "Task ID: " + r[IDX.task_id],
    "Task: " + r[IDX.task],
    "Owner: " + r[IDX.owner],
    "Execution type: " + r[IDX.execution_type],
    "Execution context (sheet): " + r[IDX.execution_context],
    "Meeting: " + r[IDX.meeting_title] + " @ " + r[IDX.meeting_date],
  ].join("\n");
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {string} artifactText
 * @param {string} taskBundle
 */
async function evaluateUniversalQA(apiKey, model, artifactText, taskBundle) {
  const system = [
    "You are a strict QA reviewer for generated work product.",
    "Score the artifact from 0–100 using: task completion; use of context; specificity/usefulness; alignment; completeness; structure/readability; safety; clear next-step usefulness.",
    "Respond with JSON only. Keys: overall_score (number), passes_universal_quality_bar (boolean), strengths (array of strings), issues (array), missing_context (array), revision_instructions (array), human_review_notes (string).",
  ].join("\n");
  const user = [taskBundle, "", "=== Artifact ===", String(artifactText || "").slice(0, 120000)].join("\n");
  return openAiChatJson(apiKey, model, system, user, 0.15);
}

async function generateTaskTypeRubric(apiKey, model, taskBundle, executionPrompt, artifactText) {
  const system = [
    "Infer the output type from the task, prompt, and draft (examples: slide outline, email draft, lab guide — but do not limit yourself to any fixed list).",
    "Return JSON only. Keys: detected_output_type (string), task_type_rubric (array of { criteria_name, description, weight, what_good_looks_like }).",
    "Weights should be positive numbers summing to roughly 100.",
  ].join("\n");
  const user = [
    taskBundle,
    "",
    "=== Execution prompt ===",
    String(executionPrompt || "").slice(0, 60000),
    "",
    "=== Artifact ===",
    String(artifactText || "").slice(0, 60000),
  ].join("\n");
  return openAiChatJson(apiKey, model, system, user, 0.2);
}

async function generateTaskSpecificCriteria(apiKey, model, taskBundle, executionPrompt, contextDocText, artifactText) {
  const system = [
    "Generate criteria specific to THIS task only — not generic writing advice.",
    "Return JSON only. Keys: task_specific_criteria (array of { criteria_name, description, weight, what_good_looks_like }).",
    "Weights positive, roughly sum to 100.",
  ].join("\n");
  const user = [
    taskBundle,
    "",
    "=== Execution prompt ===",
    String(executionPrompt || "").slice(0, 60000),
    "",
    "=== Extra context (linked docs, truncated) ===",
    String(contextDocText || "").slice(0, 60000),
    "",
    "=== Artifact ===",
    String(artifactText || "").slice(0, 60000),
  ].join("\n");
  return openAiChatJson(apiKey, model, system, user, 0.2);
}

/**
 * @param {number} qualityThreshold
 */
async function evaluateCombinedEnforcer(
  apiKey,
  model,
  artifactText,
  taskBundle,
  universalJson,
  taskTypeRubricJson,
  taskSpecificJson,
  qualityThreshold,
) {
  const system = [
    "Combine universal QA signals with task-type rubric and task-specific criteria into one judgment.",
    "Return JSON only. Keys:",
    "overall_score (0–100), universal_score, task_type_score, task_specific_score (numbers),",
    "ready_for_human_review (boolean): true iff overall_score >= " +
      qualityThreshold +
      ",",
    "should_revise (boolean): true iff overall_score < " +
      qualityThreshold +
      " and improvement seems feasible,",
    "top_issues (array of strings), revision_instructions (array), human_review_notes (string).",
    "Compute component scores consistently with the rubrics; overall_score is your holistic judgment.",
  ].join("\n");
  const user = [
    taskBundle,
    "",
    "=== Universal QA JSON ===",
    JSON.stringify(universalJson || {}),
    "",
    "=== Task-type rubric JSON ===",
    JSON.stringify(taskTypeRubricJson || {}),
    "",
    "=== Task-specific criteria JSON ===",
    JSON.stringify(taskSpecificJson || {}),
    "",
    "=== Artifact ===",
    String(artifactText || "").slice(0, 120000),
  ].join("\n");
  const out = await openAiChatJson(apiKey, model, system, user, 0.15);
  out.overall_score = clampScore(out.overall_score);
  out.universal_score = clampScore(out.universal_score);
  out.task_type_score = clampScore(out.task_type_score);
  out.task_specific_score = clampScore(out.task_specific_score);
  out.ready_for_human_review = Boolean(out.ready_for_human_review);
  out.should_revise = Boolean(out.should_revise);
  return out;
}

async function reviseArtifact(apiKey, model, params) {
  const system = [
    "You revise a draft work product based on structured QA feedback.",
    "Return ONLY the revised artifact body — no preamble, no markdown fences unless they belong in the artifact itself.",
    "Preserve the intended output type; do not change into a different artifact kind.",
    "Address highest-priority issues first; follow revision_instructions; avoid generic commentary.",
    params.humanFeedbackSummary
      ? "Human reviewer feedback (when provided) overrides generic QA nits: implement every item unless it conflicts with the task or context."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const userParts = [
    "=== Original task row ===",
    params.taskBundle,
    "",
    "=== Execution prompt used ===",
    String(params.executionPrompt || "").slice(0, 80000),
    "",
    "=== Linked context (truncated) ===",
    String(params.contextDocText || "").slice(0, 80000),
    "",
    "=== Current artifact ===",
    String(params.currentArtifact || "").slice(0, 120000),
    "",
    "=== Universal QA ===",
    JSON.stringify(params.universalJson || {}),
    "",
    "=== Task-type rubric ===",
    JSON.stringify(params.taskTypeRubricJson || {}),
    "",
    "=== Task-specific criteria ===",
    JSON.stringify(params.taskSpecificJson || {}),
    "",
    "=== Enforcer revision_instructions ===",
    JSON.stringify(params.revisionInstructions || []),
    "",
    "=== Project rules (optional) ===",
    String(params.projectRulesText || "").slice(0, 20000),
  ];
  const hf = String(params.humanFeedbackSummary || "").trim();
  if (hf) {
    userParts.push(
      "",
      "=== Human reviewer feedback (must address every item) ===",
      hf.slice(0, 20000),
    );
  }
  const user = userParts.join("\n");
  const text = await openAiChatText(apiKey, model, system, user, 0.25);
  return String(text || "").trim();
}

module.exports = {
  clampScore,
  buildTaskBundleText,
  evaluateUniversalQA,
  generateTaskTypeRubric,
  generateTaskSpecificCriteria,
  evaluateCombinedEnforcer,
  reviseArtifact,
};
