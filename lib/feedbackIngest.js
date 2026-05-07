/**
 * Week 6: parse reviewer markers from execution Doc plain text.
 */

const REVIEW_REGION = "=== Review Notes ===";
const FEEDBACK_PREFIX = "FEEDBACK:";
const RULE_PREFIX = "GENERAL RULE:";

/**
 * @param {string} plainText - full Doc export
 * @returns {{
 *   artifactFeedback: string[],
 *   generalRules: string[],
 *   humanFeedbackCaptured: boolean,
 * }}
 */
function parseFeedbackFromDocText(plainText) {
  const text = String(plainText || "");
  const lines = text.split(/\r?\n/);
  const artifactFeedback = [];
  const generalRules = [];
  let inReviewRegion = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === REVIEW_REGION) {
      inReviewRegion = true;
      continue;
    }
    if (trimmed.startsWith("===") && trimmed !== REVIEW_REGION) {
      inReviewRegion = false;
    }

    const upperStart = trimmed.toUpperCase();
    if (upperStart.startsWith(FEEDBACK_PREFIX.toUpperCase())) {
      const body = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      if (body) artifactFeedback.push(body);
      continue;
    }
    if (upperStart.startsWith(RULE_PREFIX.toUpperCase())) {
      const body = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      if (body) generalRules.push(body);
      continue;
    }
    if (inReviewRegion && trimmed && !trimmed.startsWith("===")) {
      artifactFeedback.push(trimmed);
    }
  }

  return {
    artifactFeedback,
    generalRules,
    humanFeedbackCaptured: artifactFeedback.length > 0 || generalRules.length > 0,
  };
}

module.exports = {
  parseFeedbackFromDocText,
  REVIEW_REGION,
  FEEDBACK_PREFIX,
  RULE_PREFIX,
};
