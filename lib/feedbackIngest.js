/**
 * Human feedback ingestion from execution / Enforcer Google Docs (plain text export).
 * Default: artifact-specific; lines starting with GENERAL RULE: are generalizable.
 */

const { openAiChatJson } = require("./openAiChat");
const { appendJudgmentEntry, mergeProjectRulesBullet, inferRulesSectionSlug } = require("./learningsStore");

const REVIEW_MARKER = "=== Review Notes ===";

function splitReviewSection(fullText) {
  const text = String(fullText || "");
  const idx = text.indexOf(REVIEW_MARKER);
  if (idx < 0) {
    return { body: text, review: "" };
  }
  const body = text.slice(0, idx).trim();
  const review = text.slice(idx + REVIEW_MARKER.length).trim();
  return { body, review };
}

/**
 * @param {string} fullText - exported Doc plain text
 * @returns {object} guide-shaped JSON object (also usable as POJO)
 */
function ingestHumanFeedbackPlainText(fullText) {
  const { body, review } = splitReviewSection(fullText);
  const artifact_specific_feedback = [];
  const generalizable_feedback = [];

  const scanBlock = function (src, sourceLabel) {
    const lines = String(src || "").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (/^GENERAL\s+RULE\s*:/i.test(t)) {
        generalizable_feedback.push({
          feedback: t,
          source: sourceLabel,
          marker: "GENERAL RULE",
          inferred_task_type: "",
          suggested_rule: "",
        });
      } else {
        artifact_specific_feedback.push({
          feedback: t,
          source: sourceLabel,
          applies_to: "current_artifact",
        });
      }
    }
  };

  scanBlock(review, "review_notes");
  scanBlock(body, "inline_text");

  return {
    artifact_specific_feedback,
    generalizable_feedback,
  };
}

/**
 * Optional LLM enrichment + persist to Learnings.
 * @param {object} fb - ingestHumanFeedbackPlainText result
 * @param {{ taskId: string, taskText?: string, artifactUrl: string, outputType?: string, apiKey?: string, model?: string }} ctx
 */
async function applyGeneralRulesFromFeedback(fb, ctx) {
  const apiKey = String(ctx.apiKey || "").trim();
  const model = String(ctx.model || "gpt-4o-mini").trim();
  let rulesUpdated = false;

  for (const item of fb.generalizable_feedback || []) {
    let inferred = "";
    let suggested = String(item.feedback || "").replace(/^GENERAL\s+RULE\s*:\s*/i, "").trim();

    if (apiKey && suggested) {
      try {
        const system =
          "Return JSON only: { \"inferred_task_type\": string, \"extracted_rule\": string } — short, actionable rule text without the GENERAL RULE prefix.";
        const user = "Feedback line:\n" + item.feedback;
        const out = await openAiChatJson(apiKey, model, system, user, 0.1);
        inferred = String(out.inferred_task_type || "").trim();
        suggested = String(out.extracted_rule || suggested).trim() || suggested;
      } catch {
        inferred = String(ctx.outputType || "").trim();
      }
    } else {
      inferred = String(ctx.outputType || "").trim();
    }

    const sectionSlug = inferRulesSectionSlug(inferred, ctx.taskText || "");

    await appendJudgmentEntry({
      date: new Date().toISOString(),
      task_id: String(ctx.taskId || ""),
      artifact_url: String(ctx.artifactUrl || ""),
      output_type: String(ctx.outputType || inferred || ""),
      original_feedback: item.feedback,
      extracted_rule: suggested,
      inferred_task_type: inferred,
      status: "active",
    });

    const merge = await mergeProjectRulesBullet(sectionSlug, suggested);
    if (merge.updated) rulesUpdated = true;
    item.inferred_task_type = inferred;
    item.suggested_rule = suggested;
  }

  return { rulesUpdated };
}

module.exports = {
  ingestHumanFeedbackPlainText,
  applyGeneralRulesFromFeedback,
  REVIEW_MARKER,
};
