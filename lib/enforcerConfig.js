/**
 * Week 6 Enforcer: thresholds and stop-reason vocabulary.
 */

const STOP = {
  QUALITY_THRESHOLD_MET: "quality_threshold_met",
  SCORE_DECREASED: "score_decreased",
  IMPROVEMENT_BELOW_DELTA: "improvement_below_delta",
  MAX_REVISION_ATTEMPTS: "max_revision_attempts_reached",
  RESCORING_ONLY_NO_REVISION: "Rescoring only - no revision",
};

const {
  getEnforcerQualityThreshold,
  getEnforcerMinImprovementDelta,
  getEnforcerMaxRevisionAttempts,
  getEnforcerModel,
  isEnforcerRescoreAfterFeedback,
  isEnforcerRevisionAfterFeedback,
} = require("./env");

module.exports = {
  STOP,
  getEnforcerQualityThreshold,
  getEnforcerMinImprovementDelta,
  getEnforcerMaxRevisionAttempts,
  getEnforcerModel,
  isEnforcerRescoreAfterFeedback,
  isEnforcerRevisionAfterFeedback,
};
