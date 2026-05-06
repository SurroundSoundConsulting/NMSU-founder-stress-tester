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

module.exports = {
  getQualityThreshold,
  getMinImprovementDelta,
  getMaxRevisionAttempts,
  getEnforcerModel,
};
