/**
 * Week 6 Enforcer: Universal → task-type → task-specific → combined evaluation + revision.
 */

const { openAiChatJson } = require("./openAiChat");

/**
 * @param {object} bundle
 * @param {string} bundle.task
 * @param {string} bundle.artifactBody - primary deliverable text (usually LLM output section)
 * @param {string} bundle.executionPrompt
 * @param {string} [bundle.linkedContext] - optional capped context
 * @param {string} [bundle.projectRulesExcerpt]
 * @param {string} [bundle.humanFeedbackSummary]
 */
function buildUserEnvelope(bundle) {
  const parts = [
    "## Task\n" + String(bundle.task || "").trim(),
    "## Execution prompt (what the executor was asked)\n" + String(bundle.executionPrompt || "").trim(),
    "## Artifact (deliverable to score)\n" + String(bundle.artifactBody || "").trim(),
  ];
  const lc = String(bundle.linkedContext || "").trim();
  if (lc) parts.push("## Linked context (may be truncated)\n" + lc);
  const pr = String(bundle.projectRulesExcerpt || "").trim();
  if (pr) parts.push("## Project rules (excerpt)\n" + pr);
  const hf = String(bundle.humanFeedbackSummary || "").trim();
  if (hf) parts.push("## Human feedback (from Doc markers)\n" + hf);
  return parts.join("\n\n");
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {object} bundle
 */
async function runUniversalPass(apiKey, model, bundle) {
  const system =
    "You are a universal QA reviewer. Judge clarity, professionalism, actionability, and basic completeness. Respond with one JSON object only: {\"score\": number 0-100, \"findings\": string}.";
  const user = buildUserEnvelope(bundle);
  return openAiChatJson(apiKey, model, system, user);
}

async function runTaskTypePass(apiKey, model, bundle, universal) {
  const system =
    "You score how well the artifact matches the implied task TYPE (email, checklist, summary, etc.) and conventions for that type. Respond JSON only: {\"score\": number 0-100, \"findings\": string}.";
  const user =
    buildUserEnvelope(bundle) +
    "\n\n## Prior universal pass (for context)\n" +
    JSON.stringify(universal || {});
  return openAiChatJson(apiKey, model, system, user);
}

async function runTaskSpecificPass(apiKey, model, bundle, universal, taskType) {
  const system =
    "You score task-specific fit: does the artifact satisfy the explicit execution instructions and constraints? Respond JSON only: {\"score\": number 0-100, \"findings\": string}.";
  const user =
    buildUserEnvelope(bundle) +
    "\n\n## Prior passes\n" +
    JSON.stringify({ universal, taskType });
  return openAiChatJson(apiKey, model, system, user);
}

async function runCombinedPass(apiKey, model, bundle, universal, taskType, taskSpecific) {
  const system =
    "You produce the FINAL Enforcer judgment. Output one JSON object with keys: " +
    '"universal_score" (number 0-100), "task_type_score" (0-100), "task_specific_score" (0-100), ' +
    '"overall_score" (0-100 holistic), "revision_instructions" (string, concrete bullet steps to improve the deliverable), ' +
    '"summary" (short string). The three *_score values must align with the prior pass rationales but you may adjust slightly for consistency.';
  const user =
    buildUserEnvelope(bundle) +
    "\n\n## Prior structured passes\n" +
    JSON.stringify({ universal, taskType, taskSpecific });
  return openAiChatJson(apiKey, model, system, user);
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/**
 * @returns {Promise<{ universal: object, taskType: object, taskSpecific: object, combined: object }>}
 */
async function runFullEvaluation(apiKey, model, bundle) {
  const universal = await runUniversalPass(apiKey, model, bundle);
  const taskType = await runTaskTypePass(apiKey, model, bundle, universal);
  const taskSpecific = await runTaskSpecificPass(apiKey, model, bundle, universal, taskType);
  const combined = await runCombinedPass(apiKey, model, bundle, universal, taskType, taskSpecific);
  return { universal, taskType, taskSpecific, combined };
}

/**
 * Normalize combined LLM output to numbers + strings.
 * @param {object} combined
 */
function normalizeCombinedScores(combined) {
  const c = combined && typeof combined === "object" ? combined : {};
  return {
    universal_score: clampScore(c.universal_score),
    task_type_score: clampScore(c.task_type_score),
    task_specific_score: clampScore(c.task_specific_score),
    overall_score: clampScore(c.overall_score),
    revision_instructions: String(c.revision_instructions || "").trim(),
    summary: String(c.summary || "").trim(),
  };
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {object} bundle
 * @param {object} normCombined - normalized combined object
 */
async function reviseArtifact(apiKey, model, bundle, normCombined) {
  const system =
    "You revise the task deliverable (the ARTIFACT body only). Output one JSON object: " +
    '{"revised_llm_output": string} — the full replacement text for the execution deliverable (plain text). ' +
    "Preserve important facts; apply revision_instructions and project/human context. No markdown code fences inside the string.";
  const user =
    buildUserEnvelope(bundle) +
    "\n\n## Revision instructions\n" +
    normCombined.revision_instructions;
  return openAiChatJson(apiKey, model, system, user);
}

module.exports = {
  runFullEvaluation,
  normalizeCombinedScores,
  reviseArtifact,
  buildUserEnvelope,
};
