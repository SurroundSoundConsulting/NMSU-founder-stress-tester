/**
 * Human feedback ingestion from execution / Enforcer Google Docs (plain text export).
 * Parses reviewer intent only from Review Notes (and optional === Human feedback === block),
 * not the full artifact body — otherwise every outline line is misclassified as feedback.
 *
 * GENERAL RULE: lines may use list prefixes (-, *, 1.) before the marker.
 */

const { openAiChatJson } = require("./openAiChat");
const { appendJudgmentEntry, mergeProjectRulesBullet, inferRulesSectionSlug } = require("./learningsStore");

const REVIEW_MARKER = "=== Review Notes ===";

/**
 * Split body vs review using flexible matching (spacing/case).
 */
function splitReviewSection(fullText) {
  const text = String(fullText || "");
  const re = /\r?\n\s*===\s*Review Notes\s*===\s*/i;
  const m = re.exec(text);
  if (!m) {
    const idx0 = text.search(/^\s*===\s*Review Notes\s*===\s*/im);
    if (idx0 === 0) {
      const after = text.replace(/^\s*===\s*Review Notes\s*===\s*/im, "").trim();
      return { body: "", review: after };
    }
    return { body: text.trim(), review: "" };
  }
  const body = text.slice(0, m.index).trim();
  const review = text.slice(m.index + m[0].length).trim();
  return { body, review };
}

function stripReviewBoilerplate(review) {
  return String(review || "")
    .replace(/^\(?Human reviewer notes below\.?\)?\.?\s*/i, "")
    .trim();
}

/**
 * Optional block in main body for reviewers who type outside Review Notes.
 */
function extractHumanFeedbackBlock(body) {
  const b = String(body || "");
  const match = b.match(/===\s*Human feedback\s*===\s*([\s\S]*)/i);
  if (!match) return "";
  let chunk = match[1];
  const stop = chunk.search(/\r?\n\s*===\s*[A-Za-z]/);
  if (stop >= 0) chunk = chunk.slice(0, stop);
  return chunk.trim();
}

/**
 * Strip common list / markdown noise so "GENERAL RULE:" can be detected.
 */
function stripLeadingListMarkdown(line) {
  let t = String(line || "").trim();
  if (!t) return "";
  t = t.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
  t = t.replace(/^\*{1,3}\s*/, "").trim();
  return t;
}

function isGeneralRuleLine(line) {
  const t = stripLeadingListMarkdown(line);
  return /^GENERAL\s+RULE\s*:/i.test(t);
}

function extractRuleBody(line) {
  const t = stripLeadingListMarkdown(line);
  return t.replace(/^GENERAL\s+RULE\s*:\s*/i, "").trim();
}

/**
 * @param {string} fullText - exported Doc plain text
 * @returns {object} guide-shaped JSON object (also usable as POJO)
 */
function ingestHumanFeedbackPlainText(fullText) {
  const { body, review } = splitReviewSection(fullText);
  const artifact_specific_feedback = [];
  const generalizable_feedback = [];

  const scanLines = function (src, sourceLabel) {
    const lines = String(src || "").split(/\r?\n/);
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      if (isGeneralRuleLine(raw)) {
        generalizable_feedback.push({
          feedback: stripLeadingListMarkdown(raw),
          source: sourceLabel,
          marker: "GENERAL RULE",
          inferred_task_type: "",
          suggested_rule: "",
        });
      } else {
        artifact_specific_feedback.push({
          feedback: raw,
          source: sourceLabel,
          applies_to: "current_artifact",
        });
      }
    }
  };

  scanLines(stripReviewBoilerplate(review), "review_notes");

  const inlineBlock = extractHumanFeedbackBlock(body);
  if (inlineBlock) {
    scanLines(inlineBlock, "inline_text");
  }

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
    let suggested = extractRuleBody(item.feedback || "");

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
  stripLeadingListMarkdown,
  isGeneralRuleLine,
};
