/**
 * Week 6 Enforcer loop thresholds (override via env).
 */

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function getQualityThreshold() {
  const n = Number(process.env.ENFORCER_QUALITY_THRESHOLD);
  if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  return 90;
}

function getMinImprovementDelta() {
  const n = Number(process.env.ENFORCER_MIN_IMPROVEMENT_DELTA);
  if (Number.isFinite(n) && n >= 0) return n;
  return 5;
}

function getMaxRevisionAttempts() {
  return Math.floor(numEnv("ENFORCER_MAX_REVISION_ATTEMPTS", 10));
}

/** Model for Enforcer JSON + revision calls; falls back to execution / OpenAI default. */
function getEnforcerModel() {
  return (
    String(process.env.ENFORCER_MODEL || "").trim() ||
    String(process.env.EXECUTION_MODEL || "").trim() ||
    String(process.env.OPENAI_MODEL || "").trim() ||
    "gpt-4o-mini"
  );
}

/** After human feedback ingest, re-run Enforcer scoring on the Doc (default on). Set ENFORCER_RESCORE_AFTER_FEEDBACK=false to skip. */
function isRescoreAfterFeedbackEnabled() {
  const v = String(process.env.ENFORCER_RESCORE_AFTER_FEEDBACK || "true").toLowerCase().trim();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

/** After human feedback ingest, generate a new revised Google Doc from reviewer notes + GENERAL RULE lines (default on). Set ENFORCER_REVISION_AFTER_FEEDBACK=false to skip. */
function isRevisionAfterFeedbackEnabled() {
  const v = String(process.env.ENFORCER_REVISION_AFTER_FEEDBACK || "true").toLowerCase().trim();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

module.exports = {
  getQualityThreshold,
  getMinImprovementDelta,
  getMaxRevisionAttempts,
  getEnforcerModel,
  isRescoreAfterFeedbackEnabled,
  isRevisionAfterFeedbackEnabled,
};
