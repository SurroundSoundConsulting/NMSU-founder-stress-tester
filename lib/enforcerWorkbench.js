/**
 * Week 6 Enforcer runner: scoring loop, revision Docs, sheet QA columns.
 */

const {
  getMasterDataRows,
  updateMasterRow,
  ensureMasterExecutionSchema,
  ensureMasterEnforcerSchema,
} = require("./commandCenterSheets");
const { MASTER_COLUMNS } = require("./sheetSchema");
const {
  getExecutionDriveFolderId,
  getExecutionContextDocMaxCharsPerFile,
  getExecutionContextDocMaxCharsTotal,
  getExecutionContextDocMaxFiles,
} = require("./env");
const {
  exportGoogleDocPlainText,
  exportGoogleDocPlainTextForFeedback,
  extractLlmOutputSection,
  extractGeneratedPromptSection,
  extractArtifactSectionFromDoc,
  parseGoogleDocFileId,
  fetchExecutionContextFromDocLinksCell,
} = require("./googleDriveDocs");
const { getServiceAccountCredentials } = require("./googleSheets");
const {
  getEnforcerModel,
  getQualityThreshold,
  getMinImprovementDelta,
  getMaxRevisionAttempts,
  isRescoreAfterFeedbackEnabled,
  isRevisionAfterFeedbackEnabled,
} = require("./enforcerConfig");
const {
  buildTaskBundleText,
  evaluateUniversalQA,
  generateTaskTypeRubric,
  generateTaskSpecificCriteria,
  evaluateCombinedEnforcer,
  reviseArtifact,
} = require("./enforcerPipeline");
const { ensureTaskArtifactFolder, createEnforcerArtifactGoogleDoc } = require("./enforcerDrive");
const { IDX, padRow } = require("./executionWorkbench");
const { readProjectRulesMarkdown, getRelevantRulesForPrompt, inferRulesSectionSlug } = require("./learningsStore");
const { ingestHumanFeedbackPlainText, applyGeneralRulesFromFeedback } = require("./feedbackIngest");

function colQ(name) {
  const i = MASTER_COLUMNS.indexOf(name);
  if (i < 0) throw new Error("Unknown column: " + name);
  return i;
}

const QDX = {
  qa_status: colQ("qa_status"),
  universal_score: colQ("universal_score"),
  task_type_score: colQ("task_type_score"),
  task_specific_score: colQ("task_specific_score"),
  final_enforcer_score: colQ("final_enforcer_score"),
  revision_count: colQ("revision_count"),
  revision_delta: colQ("revision_delta"),
  best_revision_url: colQ("best_revision_url"),
  latest_revision_url: colQ("latest_revision_url"),
  ready_for_human_review: colQ("ready_for_human_review"),
  stop_reason: colQ("stop_reason"),
  human_feedback_captured: colQ("human_feedback_captured"),
  general_rules_updated: colQ("general_rules_updated"),
};

function isDoneStatus(s) {
  return String(s || "").trim().toLowerCase() === "done";
}

function listEnforcerCandidates(dataRows, taskIdFilter, force) {
  const out = [];
  const want = taskIdFilter != null ? String(taskIdFilter).trim() : "";
  for (let i = 0; i < dataRows.length; i++) {
    const row = padRow(dataRows[i]);
    if (isDoneStatus(row[IDX.status])) continue;
    const taskText = String(row[IDX.task] || "").trim();
    if (!taskText) continue;
    const outLink = String(row[IDX.execution_output_link] || "").trim();
    if (!outLink) continue;
    if (want && String(row[IDX.task_id] || "").trim() !== want) continue;
    const qa = String(row[QDX.qa_status] || "").trim().toLowerCase();
    if (qa === "complete" && !force) continue;
    out.push({ sheetRow: i + 2, row });
  }
  return out;
}

function applyQaToRow(row, patch) {
  const r = padRow(row);
  const set = function (idx, val) {
    r[idx] = val != null ? String(val) : "";
  };
  set(QDX.qa_status, patch.qa_status);
  set(QDX.universal_score, patch.universal_score);
  set(QDX.task_type_score, patch.task_type_score);
  set(QDX.task_specific_score, patch.task_specific_score);
  set(QDX.final_enforcer_score, patch.final_enforcer_score);
  set(QDX.revision_count, patch.revision_count);
  set(QDX.revision_delta, patch.revision_delta);
  set(QDX.best_revision_url, patch.best_revision_url);
  set(QDX.latest_revision_url, patch.latest_revision_url);
  set(QDX.ready_for_human_review, patch.ready_for_human_review);
  set(QDX.stop_reason, patch.stop_reason);
  if (patch.human_feedback_captured != null) set(QDX.human_feedback_captured, patch.human_feedback_captured);
  if (patch.general_rules_updated != null) set(QDX.general_rules_updated, patch.general_rules_updated);
  return r;
}

/**
 * @param {{ taskId?: string, force?: boolean, ingestFeedback?: boolean, apiKey?: string }} opts
 */
async function runEnforcerOnce(opts) {
  const apiKey = String(opts?.apiKey || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set.");
    err.code = "NO_OPENAI";
    throw err;
  }

  const model = getEnforcerModel();
  const qualityThreshold = getQualityThreshold();
  const minDelta = getMinImprovementDelta();
  const maxAttempts = getMaxRevisionAttempts();
  const force = Boolean(opts?.force);
  const ingestFeedback = Boolean(opts?.ingestFeedback);

  await ensureMasterExecutionSchema();
  await ensureMasterEnforcerSchema();

  const dataRows = await getMasterDataRows();
  const candidates = listEnforcerCandidates(dataRows, opts?.taskId, force);
  if (candidates.length === 0) {
    return {
      processed: 0,
      message: opts?.taskId
        ? "No eligible row for task_id (needs execution output link, not Done, QA not complete unless force)."
        : "No eligible rows for Enforcer.",
    };
  }

  const { sheetRow, row } = candidates[0];
  let working = padRow(row);

  const summary = {
    processed: 1,
    sheetRow,
    task_id: working[IDX.task_id],
    errors: [],
    revision_history: [],
    stop_reason: "",
    final_score: 0,
    ready_for_human_review: false,
  };

  try {
    const draftUrl = String(working[IDX.execution_output_link] || "").trim();
    const draftFileId = parseGoogleDocFileId(draftUrl);
    if (!draftFileId) {
      throw new Error("Could not parse Google Doc id from Execution Output Link.");
    }

    const creds = getServiceAccountCredentials();
    const clientEmail = typeof creds?.client_email === "string" ? creds.client_email : "";

    const fullDocText = await exportGoogleDocPlainText(draftFileId);
    let artifactText = extractLlmOutputSection(fullDocText);
    if (!artifactText) artifactText = fullDocText.trim();

    const executionPrompt =
      extractGeneratedPromptSection(fullDocText) ||
      String(working[IDX.execution_context] || "").trim();

    const linksCell = String(working[IDX.execution_context_doc_links] || "").trim();
    const { text: contextDocText } = await fetchExecutionContextFromDocLinksCell(linksCell, {
      perFileMaxChars: getExecutionContextDocMaxCharsPerFile(),
      totalMaxChars: getExecutionContextDocMaxCharsTotal(),
      maxFiles: getExecutionContextDocMaxFiles(),
      clientEmail,
    });

    const rulesRes = await readProjectRulesMarkdown();
    const slug = inferRulesSectionSlug(working[IDX.execution_type], working[IDX.task]);
    const projectRulesForRevision = rulesRes.configured ? getRelevantRulesForPrompt(rulesRes.text, slug) : "";

    const taskBundle = buildTaskBundleText(working, padRow, IDX);
    const rootFolder = getExecutionDriveFolderId();
    const taskFolderId = await ensureTaskArtifactFolder(rootFolder, working[IDX.task_id] || String(sheetRow));

    let bestScore = -1;
    let bestUrl = draftUrl;
    let bestLabel = "Draft v1";
    /** @type {{ universal: object, taskType: object, taskSpecific: object, combined: object } | null} */
    let bestEval = null;

    async function evaluateArtifact(text, versionLabel, artifactUrl) {
      const u = await evaluateUniversalQA(apiKey, model, text, taskBundle);
      const tt = await generateTaskTypeRubric(apiKey, model, taskBundle, executionPrompt, text);
      const ts = await generateTaskSpecificCriteria(
        apiKey,
        model,
        taskBundle,
        executionPrompt,
        contextDocText,
        text,
      );
      const comb = await evaluateCombinedEnforcer(
        apiKey,
        model,
        text,
        taskBundle,
        u,
        tt,
        ts,
        qualityThreshold,
      );
      const score = comb.overall_score;
      if (score > bestScore) {
        bestScore = score;
        bestUrl = artifactUrl;
        bestLabel = versionLabel;
        bestEval = { universal: u, taskType: tt, taskSpecific: ts, combined: comb };
      }
      return { universal: u, taskType: tt, taskSpecific: ts, combined: comb, score };
    }

    let iter = 1;
    let currentText = artifactText;
    let currentUrl = draftUrl;
    let currentLabel = "Draft v1";

    let lastEval = await evaluateArtifact(currentText, currentLabel, currentUrl);
    summary.revision_history.push({
      iteration: iter,
      version_label: currentLabel,
      score: lastEval.score,
      improvement_delta: null,
      decision: lastEval.score >= qualityThreshold ? "ready" : "revise",
      stop_reason: null,
      artifact_url: currentUrl,
    });

    let stopReason = "";
    let revisionAttemptsUsed = 0;
    let lastDelta = "";

    if (lastEval.score >= qualityThreshold) {
      stopReason = "quality_threshold_met";
    }

    let prevScore = lastEval.score;

    while (!stopReason && revisionAttemptsUsed < maxAttempts) {
      if (lastEval.score >= qualityThreshold) {
        stopReason = "quality_threshold_met";
        break;
      }

      revisionAttemptsUsed += 1;
      const versionNum = revisionAttemptsUsed + 1;
      const nextLabel = "Revised v" + versionNum;

      const revisedText = await reviseArtifact(apiKey, model, {
        taskBundle,
        executionPrompt,
        contextDocText,
        currentArtifact: currentText,
        universalJson: lastEval.universal,
        taskTypeRubricJson: lastEval.taskType,
        taskSpecificJson: lastEval.taskSpecific,
        revisionInstructions: lastEval.combined.revision_instructions || [],
        projectRulesText: projectRulesForRevision,
      });

      const title =
        String(working[IDX.task_id] || sheetRow) +
        " - " +
        nextLabel +
        " - " +
        new Date().toISOString().slice(0, 10);
      const doc = await createEnforcerArtifactGoogleDoc({
        folderId: taskFolderId,
        title,
        fields: {
          taskId: working[IDX.task_id],
          task: working[IDX.task],
          versionLabel: nextLabel,
          enforcerScore: "(pending)",
          artifactBody: revisedText,
        },
      });

      currentText = revisedText;
      currentUrl = doc.url;
      currentLabel = nextLabel;

      lastEval = await evaluateArtifact(currentText, currentLabel, currentUrl);
      const newScore = lastEval.score;
      const improvementDelta = newScore - prevScore;
      lastDelta = String(improvementDelta);

      iter += 1;
      summary.revision_history.push({
        iteration: iter,
        version_label: currentLabel,
        score: newScore,
        improvement_delta: improvementDelta,
        decision: "evaluated_after_revision",
        stop_reason: null,
        artifact_url: currentUrl,
      });

      if (newScore < prevScore) {
        stopReason = "score_decreased";
        break;
      }
      if (newScore >= qualityThreshold) {
        stopReason = "quality_threshold_met";
        break;
      }
      if (improvementDelta < minDelta) {
        stopReason = "improvement_below_delta";
        break;
      }

      prevScore = newScore;
    }

    if (!stopReason) {
      if (revisionAttemptsUsed >= maxAttempts) {
        stopReason = "max_revision_attempts_reached";
      } else {
        stopReason = "quality_threshold_met";
      }
    }

    summary.stop_reason = stopReason;
    summary.final_score = bestScore < 0 ? lastEval.score : bestScore;
    summary.ready_for_human_review = summary.final_score >= qualityThreshold;

    const evalForSheet = bestEval || lastEval;
    const readyStr = summary.ready_for_human_review ? "Yes" : "No";

    let humanCaptured = "";
    let rulesUpdated = "";
    const feedbackDocUrl = String(currentUrl || "").trim() || bestUrl;
    const feedbackId = parseGoogleDocFileId(feedbackDocUrl);
    if (ingestFeedback && feedbackId) {
      try {
        const fbText = await exportGoogleDocPlainTextForFeedback(feedbackId);
        const fb = ingestHumanFeedbackPlainText(fbText);
        const applied = await applyGeneralRulesFromFeedback(fb, {
          taskId: working[IDX.task_id],
          taskText: working[IDX.task],
          artifactUrl: feedbackDocUrl,
          outputType: evalForSheet.taskType?.detected_output_type || working[IDX.execution_type],
          apiKey,
          model,
        });
        humanCaptured =
          fb.artifact_specific_feedback.length + fb.generalizable_feedback.length > 0 ? "Yes" : "No";
        rulesUpdated = applied.rulesUpdated ? "Yes" : "No";
      } catch (e) {
        humanCaptured = "Error: " + String(e.message || e);
      }
    }

    working = applyQaToRow(working, {
      qa_status: "complete",
      universal_score: evalForSheet.combined.universal_score,
      task_type_score: evalForSheet.combined.task_type_score,
      task_specific_score: evalForSheet.combined.task_specific_score,
      final_enforcer_score: summary.final_score,
      revision_count: String(revisionAttemptsUsed),
      revision_delta: lastDelta,
      best_revision_url: bestUrl,
      latest_revision_url: currentUrl,
      ready_for_human_review: readyStr,
      stop_reason: stopReason,
      human_feedback_captured: humanCaptured || String(working[QDX.human_feedback_captured] || ""),
      general_rules_updated: rulesUpdated || String(working[QDX.general_rules_updated] || ""),
    });

    await updateMasterRow(sheetRow, working);

    summary.sheet = {
      final_enforcer_score: summary.final_score,
      best_revision_url: bestUrl,
      latest_revision_url: currentUrl,
    };

    return summary;
  } catch (e) {
    summary.errors.push(String(e.message || e));
    working = applyQaToRow(working, {
      qa_status: "failed",
      universal_score: "",
      task_type_score: "",
      task_specific_score: "",
      final_enforcer_score: "",
      revision_count: "",
      revision_delta: "",
      best_revision_url: "",
      latest_revision_url: "",
      ready_for_human_review: "No",
      stop_reason: "error",
    });
    working[IDX.execution_status_reason] =
      String(working[IDX.execution_status_reason] || "").trim() +
      (working[IDX.execution_status_reason] ? " | " : "") +
      "Enforcer error: " +
      String(e.message || e);
    await updateMasterRow(sheetRow, working);
    throw e;
  }
}

function buildHumanFeedbackSummary(fb) {
  const lines = [];
  for (const x of fb.artifact_specific_feedback || []) {
    const t = String(x.feedback || "").trim();
    if (t) lines.push("- " + t);
  }
  for (const x of fb.generalizable_feedback || []) {
    const t = String(x.feedback || "").trim();
    if (t) lines.push("- (general) " + t);
  }
  return lines.join("\n").slice(0, 12000);
}

function appendFeedbackToTaskBundle(taskBundle, fbSummary) {
  const s = String(fbSummary || "").trim();
  if (!s) return taskBundle;
  return (
    taskBundle +
    "\n\n=== Human reviewer feedback (use when judging whether the artifact reflects reviewer intent) ===\n" +
    s
  );
}

/**
 * After learnings are updated: evaluate current artifact, revise with human feedback + QA signals, create a new Google Doc.
 *
 * @param {{ apiKey: string, model: string, working: string[], fb: object, sourceFullPlainText: string, sheetRow: number }} opts
 */
async function runHumanFeedbackRevision(opts) {
  const { apiKey, model, working, fb, sourceFullPlainText, sheetRow } = opts;
  const qualityThreshold = getQualityThreshold();

  let artifactText = extractArtifactSectionFromDoc(sourceFullPlainText);
  if (!artifactText) artifactText = String(sourceFullPlainText || "").trim();

  const executionPrompt =
    extractGeneratedPromptSection(sourceFullPlainText) ||
    String(working[IDX.execution_context] || "").trim();

  const creds = getServiceAccountCredentials();
  const clientEmail = typeof creds?.client_email === "string" ? creds.client_email : "";
  const linksCell = String(working[IDX.execution_context_doc_links] || "").trim();
  const { text: contextDocText } = await fetchExecutionContextFromDocLinksCell(linksCell, {
    perFileMaxChars: getExecutionContextDocMaxCharsPerFile(),
    totalMaxChars: getExecutionContextDocMaxCharsTotal(),
    maxFiles: getExecutionContextDocMaxFiles(),
    clientEmail,
  });

  const fbSummary = buildHumanFeedbackSummary(fb);
  const taskBundleBase = buildTaskBundleText(working, padRow, IDX);
  const taskBundleForEval = appendFeedbackToTaskBundle(taskBundleBase, fbSummary);

  const rulesRes = await readProjectRulesMarkdown();
  const slug = inferRulesSectionSlug(working[IDX.execution_type], working[IDX.task]);
  const projectRulesForRevision = rulesRes.configured ? getRelevantRulesForPrompt(rulesRes.text, slug) : "";

  const u = await evaluateUniversalQA(apiKey, model, artifactText, taskBundleForEval);
  const tt = await generateTaskTypeRubric(apiKey, model, taskBundleForEval, executionPrompt, artifactText);
  const ts = await generateTaskSpecificCriteria(
    apiKey,
    model,
    taskBundleForEval,
    executionPrompt,
    contextDocText,
    artifactText,
  );
  const comb = await evaluateCombinedEnforcer(
    apiKey,
    model,
    artifactText,
    taskBundleForEval,
    u,
    tt,
    ts,
    qualityThreshold,
  );

  const revisedText = await reviseArtifact(apiKey, model, {
    taskBundle: taskBundleBase,
    executionPrompt,
    contextDocText,
    currentArtifact: artifactText,
    universalJson: u,
    taskTypeRubricJson: tt,
    taskSpecificJson: ts,
    revisionInstructions: comb.revision_instructions || [],
    projectRulesText: projectRulesForRevision,
    humanFeedbackSummary: fbSummary,
  });

  const rootFolder = getExecutionDriveFolderId();
  const taskFolderId = await ensureTaskArtifactFolder(rootFolder, working[IDX.task_id] || String(sheetRow));
  const nextLabel = "Human-feedback revision";
  const title =
    String(working[IDX.task_id] || sheetRow) +
    " - " +
    nextLabel +
    " - " +
    new Date().toISOString().slice(0, 10);

  const doc = await createEnforcerArtifactGoogleDoc({
    folderId: taskFolderId,
    title,
    fields: {
      taskId: working[IDX.task_id],
      task: working[IDX.task],
      versionLabel: nextLabel,
      enforcerScore: "(pending)",
      artifactBody: revisedText,
    },
  });

  const newId = parseGoogleDocFileId(doc.url);
  if (!newId) {
    throw new Error("Could not parse new revision Doc id after human-feedback revision.");
  }
  const full_plain_text = await exportGoogleDocPlainTextForFeedback(newId);

  return {
    ok: true,
    doc_url: doc.url,
    full_plain_text,
  };
}

/**
 * Re-run universal + rubrics + combined Enforcer scoring on the current Doc after human review.
 * Does not create new revisions; updates QA columns on the sheet.
 *
 * @param {{ apiKey: string, model: string, working: string[], docUrl: string, fullDocPlainText: string, fb: object, stopReason?: string }} opts
 */
async function runPostHumanReviewRescore(opts) {
  const { apiKey, model, working, docUrl, fullDocPlainText, fb } = opts;
  const qualityThreshold = getQualityThreshold();

  let artifactText = extractArtifactSectionFromDoc(fullDocPlainText);
  if (!artifactText) artifactText = String(fullDocPlainText || "").trim();

  const executionPrompt =
    extractGeneratedPromptSection(fullDocPlainText) ||
    String(working[IDX.execution_context] || "").trim();

  const creds = getServiceAccountCredentials();
  const clientEmail = typeof creds?.client_email === "string" ? creds.client_email : "";
  const linksCell = String(working[IDX.execution_context_doc_links] || "").trim();
  const { text: contextDocText } = await fetchExecutionContextFromDocLinksCell(linksCell, {
    perFileMaxChars: getExecutionContextDocMaxCharsPerFile(),
    totalMaxChars: getExecutionContextDocMaxCharsTotal(),
    maxFiles: getExecutionContextDocMaxFiles(),
    clientEmail,
  });

  const fbSummary = buildHumanFeedbackSummary(fb);
  let taskBundle = appendFeedbackToTaskBundle(buildTaskBundleText(working, padRow, IDX), fbSummary);

  const u = await evaluateUniversalQA(apiKey, model, artifactText, taskBundle);
  const tt = await generateTaskTypeRubric(apiKey, model, taskBundle, executionPrompt, artifactText);
  const ts = await generateTaskSpecificCriteria(
    apiKey,
    model,
    taskBundle,
    executionPrompt,
    contextDocText,
    artifactText,
  );
  const comb = await evaluateCombinedEnforcer(
    apiKey,
    model,
    artifactText,
    taskBundle,
    u,
    tt,
    ts,
    qualityThreshold,
  );

  const newScore = comb.overall_score;
  const prevRaw = String(working[QDX.final_enforcer_score] || "").trim();
  const prevNum = Number(prevRaw);
  const delta =
    Number.isFinite(prevNum) && Number.isFinite(newScore) ? Math.round(newScore - prevNum) : "";

  working[QDX.universal_score] = String(comb.universal_score);
  working[QDX.task_type_score] = String(comb.task_type_score);
  working[QDX.task_specific_score] = String(comb.task_specific_score);
  working[QDX.final_enforcer_score] = String(comb.overall_score);
  working[QDX.ready_for_human_review] = newScore >= qualityThreshold ? "Yes" : "No";
  const sr = String(opts.stopReason || "post_human_review").trim();
  working[QDX.stop_reason] = sr || "post_human_review";
  if (delta !== "") {
    working[QDX.revision_delta] = String(delta);
  }
  working[QDX.qa_status] = "complete";

  return {
    ok: true,
    overall_score: newScore,
    universal_score: comb.universal_score,
    task_type_score: comb.task_type_score,
    task_specific_score: comb.task_specific_score,
    delta_vs_prior_final: delta,
    ready_for_human_review: newScore >= qualityThreshold,
    doc_url: docUrl,
  };
}

/**
 * Ingest feedback from the Doc the reviewer actually edits: Latest Revision URL first,
 * then Best Revision URL, then Execution Output Link.
 * @param {{ taskId: string, apiKey?: string, rescore?: boolean, revision?: boolean }} opts — revision/rescore default on unless env *_AFTER_FEEDBACK=false or opts flags false
 */
async function runFeedbackIngestOnce(opts) {
  const apiKey = String(opts?.apiKey || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set.");
    err.code = "NO_OPENAI";
    throw err;
  }
  const model = getEnforcerModel();
  const want = String(opts?.taskId || "").trim();
  if (!want) {
    const err = new Error("taskId is required for feedback ingestion.");
    err.code = "NO_TASK_ID";
    throw err;
  }

  await ensureMasterExecutionSchema();
  await ensureMasterEnforcerSchema();

  const dataRows = await getMasterDataRows();
  let sheetRow = -1;
  let working = null;
  for (let i = 0; i < dataRows.length; i++) {
    const row = padRow(dataRows[i]);
    if (String(row[IDX.task_id] || "").trim() !== want) continue;
    sheetRow = i + 2;
    working = row;
    break;
  }
  if (!working || sheetRow < 0) {
    return { processed: 0, message: "No row found for task_id." };
  }

  const docUrl =
    String(working[QDX.latest_revision_url] || "").trim() ||
    String(working[QDX.best_revision_url] || "").trim() ||
    String(working[IDX.execution_output_link] || "").trim();
  const docId = parseGoogleDocFileId(docUrl);
  if (!docId) {
    const err = new Error("No Google Doc URL found on row (Best Revision URL or Execution Output Link).");
    err.code = "NO_DOC";
    throw err;
  }

  const fbText = await exportGoogleDocPlainTextForFeedback(docId);
  const fb = ingestHumanFeedbackPlainText(fbText);
  const applied = await applyGeneralRulesFromFeedback(fb, {
    taskId: working[IDX.task_id],
    taskText: working[IDX.task],
    artifactUrl: docUrl,
    outputType: working[IDX.execution_type],
    apiKey,
    model,
  });

  const hasFeedback =
    (fb.artifact_specific_feedback || []).length + (fb.generalizable_feedback || []).length > 0;

  working[QDX.human_feedback_captured] = hasFeedback ? "Yes" : "No";
  working[QDX.general_rules_updated] = applied.rulesUpdated ? "Yes" : "No";

  const scoreBeforePipeline = Number(String(working[QDX.final_enforcer_score] || "").trim());
  const bestUrlBefore = String(working[QDX.best_revision_url] || "").trim();
  const revisionCountBefore =
    parseInt(String(working[QDX.revision_count] || "0").trim(), 10) || 0;

  let docUrlForRescore = docUrl;
  let plainForRescore = fbText;

  let revisionSummary = null;
  const shouldRevise =
    hasFeedback && opts?.revision !== false && isRevisionAfterFeedbackEnabled();

  if (shouldRevise) {
    try {
      revisionSummary = await runHumanFeedbackRevision({
        apiKey,
        model,
        working,
        fb,
        sourceFullPlainText: fbText,
        sheetRow,
      });
      if (revisionSummary.ok) {
        docUrlForRescore = revisionSummary.doc_url;
        plainForRescore = revisionSummary.full_plain_text;
        working[QDX.latest_revision_url] = revisionSummary.doc_url;
        working[QDX.revision_count] = String(revisionCountBefore + 1);
      }
    } catch (err) {
      revisionSummary = { ok: false, error: String(err.message || err) };
      console.error("[feedback revision]", err);
    }
  }

  const shouldRescore =
    hasFeedback && opts?.rescore !== false && isRescoreAfterFeedbackEnabled();

  let rescoreSummary = null;
  if (shouldRescore) {
    try {
      const stopReason = revisionSummary?.ok ? "post_human_feedback_revision" : "post_human_review";
      rescoreSummary = await runPostHumanReviewRescore({
        apiKey,
        model,
        working,
        docUrl: docUrlForRescore,
        fullDocPlainText: plainForRescore,
        fb,
        stopReason,
      });
      if (revisionSummary?.ok && rescoreSummary.ok) {
        const newScore = rescoreSummary.overall_score;
        if (
          Number.isFinite(newScore) &&
          (!Number.isFinite(scoreBeforePipeline) || newScore > scoreBeforePipeline)
        ) {
          working[QDX.best_revision_url] = docUrlForRescore;
        } else if (bestUrlBefore) {
          working[QDX.best_revision_url] = bestUrlBefore;
        } else {
          working[QDX.best_revision_url] = docUrlForRescore;
        }
      }
    } catch (err) {
      rescoreSummary = { ok: false, error: String(err.message || err) };
      console.error("[feedback rescore]", err);
    }
  }

  await updateMasterRow(sheetRow, working);

  return {
    processed: 1,
    sheetRow,
    task_id: working[IDX.task_id],
    feedback: fb,
    rulesUpdated: applied.rulesUpdated,
    revision: revisionSummary,
    rescore: rescoreSummary,
  };
}

module.exports = {
  runEnforcerOnce,
  runFeedbackIngestOnce,
  runPostHumanReviewRescore,
  runHumanFeedbackRevision,
  listEnforcerCandidates,
  QDX,
};
