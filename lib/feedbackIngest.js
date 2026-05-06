/**
 * Human feedback ingestion from execution / Enforcer Google Docs (plain text export).
 *
 * Strategy: split the Doc on `=== Section Title ===` headers. Ingest every section’s body as
 * potential feedback **except** deliverable-only sections (Artifact, LLM Output, Generated Prompt)
 * and the preamble before the first header (task metadata). Reviewers can type under Review Notes,
 * Human feedback, **Feedback**, or any user-created `=== … ===` heading — all count without
 * needing one magic header. Plain-text export with PREVIEW_SUGGESTIONS_ACCEPTED includes
 * Suggesting-mode insertions as normal lines inside those sections.
 *
 * We still **never** scrape the Artifact section body as feedback (outline bullets would be noise).
 *
 * Docs with no `===` headers fall back to the legacy Review Notes + Human feedback block parser.
 *
 * GENERAL RULE: lines may use list prefixes (-, *, 1.) before the marker.
 */

const { openAiChatJson } = require("./openAiChat");
const { appendJudgmentEntry, mergeProjectRulesBullet, inferRulesSectionSlug } = require("./learningsStore");

const REVIEW_MARKER = "=== Review Notes ===";

/** @typedef {{ title: string, body: string }} DocSection */

/**
 * Strip invisible / Docs-export quirks so "GENERAL RULE:" matches reliably.
 */
function sanitizeExportLine(line) {
  return String(line || "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

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

function normalizeSectionTitle(title) {
  return String(title || "")
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Deliverable / prompt sections: never treat body as reviewer feedback.
 * @param {string} title - raw title between === markers
 */
function isDeliverableDocSection(title) {
  const n = normalizeSectionTitle(title);
  if (n === "_preamble") return true;
  if (n === "artifact") return true;
  if (n.includes("llm output")) return true;
  if (n.includes("generated prompt")) return true;
  return false;
}

/**
 * Split Google Doc plain text on `=== Title ===` lines (Docs-friendly; matches export quirks).
 * @param {string} fullText
 * @returns {DocSection[]}
 */
function splitIntoTripleEqualsSections(fullText) {
  const text = String(fullText || "");
  const headerRe = /(?:^|\r?\n)\s*===\s*([^=\n]+?)\s*===\s*/gi;
  const matches = [...text.matchAll(headerRe)];
  if (matches.length === 0) return [];

  /** @type {DocSection[]} */
  const out = [];
  const first = matches[0];
  const preamble = text.slice(0, first.index).trim();
  if (preamble) out.push({ title: "_preamble", body: preamble });

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const title = String(m[1] || "").trim();
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    out.push({ title, body });
  }
  return out;
}

function shouldIngestSectionAsFeedback(sec) {
  if (sec.title === "_preamble") return false;
  if (isDeliverableDocSection(sec.title)) return false;
  return true;
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
  let t = sanitizeExportLine(line);
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
 * Multiple GENERAL RULE segments on one exported line (common from Docs).
 * @param {string} reviewText
 * @returns {string[]}
 */
function extractGeneralRuleSegments(reviewText) {
  const s = String(reviewText || "");
  const indices = [];
  const re = /\bGENERAL\s+RULE\s*:/gi;
  let m;
  while ((m = re.exec(s)) !== null) indices.push(m.index);
  const rules = [];
  for (let i = 0; i < indices.length; i++) {
    const from = indices[i];
    const to = i + 1 < indices.length ? indices[i + 1] : s.length;
    rules.push(s.slice(from, to).trim());
  }
  return rules;
}

function pushRulesFromBlob(blob, sourceLabel, seen, generalizable_feedback) {
  for (const seg of extractGeneralRuleSegments(blob)) {
    const normalized = stripLeadingListMarkdown(sanitizeExportLine(seg));
    if (!/^GENERAL\s+RULE\s*:/i.test(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    generalizable_feedback.push({
      feedback: normalized,
      source: sourceLabel,
      marker: "GENERAL RULE",
      inferred_task_type: "",
      suggested_rule: "",
    });
  }
}

function pushArtifactLinesFromBlob(blob, sourceLabel, artifact_specific_feedback) {
  const lines = String(blob || "").split(/\r?\n/);
  for (const line of lines) {
    const raw = sanitizeExportLine(line);
    if (!raw) continue;
    if (/\bGENERAL\s+RULE\s*:/i.test(raw)) continue;
    artifact_specific_feedback.push({
      feedback: raw,
      source: sourceLabel,
      applies_to: "current_artifact",
    });
  }
}

function ingestHumanFeedbackPlainTextLegacy(fullText) {
  const { body, review } = splitReviewSection(fullText);
  const artifact_specific_feedback = [];
  const generalizable_feedback = [];
  const seenRule = new Set();

  const reviewClean = stripReviewBoilerplate(review);
  pushRulesFromBlob(reviewClean, "review_notes", seenRule, generalizable_feedback);
  pushArtifactLinesFromBlob(reviewClean, "review_notes", artifact_specific_feedback);

  const inlineBlock = extractHumanFeedbackBlock(body);
  if (inlineBlock) {
    pushRulesFromBlob(inlineBlock, "inline_text", seenRule, generalizable_feedback);
    pushArtifactLinesFromBlob(inlineBlock, "inline_text", artifact_specific_feedback);
  }

  return {
    artifact_specific_feedback,
    generalizable_feedback,
  };
}

/**
 * @param {string} fullText - exported Doc plain text
 * @returns {object} guide-shaped JSON object (also usable as POJO)
 */
function ingestHumanFeedbackPlainText(fullText) {
  const sections = splitIntoTripleEqualsSections(fullText);
  if (sections.length === 0) {
    return ingestHumanFeedbackPlainTextLegacy(fullText);
  }

  const artifact_specific_feedback = [];
  const generalizable_feedback = [];
  const seenRule = new Set();

  for (const sec of sections) {
    if (!shouldIngestSectionAsFeedback(sec)) continue;
    let blob = sec.body;
    const nt = normalizeSectionTitle(sec.title);
    if (nt === "review notes") {
      blob = stripReviewBoilerplate(blob);
    }
    const sourceLabel = "section_" + nt.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unnamed";
    pushRulesFromBlob(blob, sourceLabel, seenRule, generalizable_feedback);
    pushArtifactLinesFromBlob(blob, sourceLabel, artifact_specific_feedback);
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
  sanitizeExportLine,
  extractGeneralRuleSegments,
  splitIntoTripleEqualsSections,
  normalizeSectionTitle,
  shouldIngestSectionAsFeedback,
  isDeliverableDocSection,
};
