/**
 * Week 6 Enforcer: orchestration (main loop, sheet writes, feedback + fair scoring).
 */

const {
  getMasterDataRows,
  updateMasterRow,
  ensureMasterExecutionSchema,
  ensureMasterQaSchema,
} = require("./commandCenterSheets");
const { masterColumnIndex, formatMergedScores } = require("./sheetSchema");
const { padRow, IDX } = require("./executionWorkbench");
const {
  exportGoogleDocPlainText,
  parseGoogleDocUrlToFileId,
  parseExecutionDocSections,
  fetchExecutionContextFromDocLinksCell,
  pickNewestGoogleDocAmongUrls,
} = require("./googleDriveDocs");
const { getServiceAccountCredentials } = require("./googleSheets");
const {
  getExecutionContextDocMaxCharsPerFile,
  getExecutionContextDocMaxCharsTotal,
  getExecutionContextDocMaxFiles,
} = require("./env");
const {
  getEnforcerQualityThreshold,
  getEnforcerMinImprovementDelta,
  getEnforcerMaxRevisionAttempts,
  getEnforcerModel,
  isEnforcerRescoreAfterFeedback,
  isEnforcerRevisionAfterFeedback,
  STOP,
} = require("./enforcerConfig");
const { runFullEvaluation, normalizeCombinedScores, reviseArtifact } = require("./enforcerPipeline");
const { createEnforcerRevisionDoc } = require("./enforcerDrive");
const { parseFeedbackFromDocText } = require("./feedbackIngest");
const { appendJudgmentLogEntry, mergeGeneralRules, loadProjectRulesExcerpt } = require("./learningsStore");

const QA = {
  qa_status: masterColumnIndex("qa_status"),
  qa_scores_merged: masterColumnIndex("qa_scores_merged"),
  qa_final_score: masterColumnIndex("qa_final_score"),
  qa_revision_count: masterColumnIndex("qa_revision_count"),
  qa_revision_delta: masterColumnIndex("qa_revision_delta"),
  qa_best_revision_url: masterColumnIndex("qa_best_revision_url"),
  qa_latest_revision_url: masterColumnIndex("qa_latest_revision_url"),
  qa_ready_for_production: masterColumnIndex("qa_ready_for_production"),
  qa_stop_reason: masterColumnIndex("qa_stop_reason"),
  qa_human_feedback_captured: masterColumnIndex("qa_human_feedback_captured"),
  qa_general_rules_updated: masterColumnIndex("qa_general_rules_updated"),
};

function isDoneStatus(s) {
  return String(s || "").trim().toLowerCase() === "done";
}

function isQaComplete(status) {
  return String(status || "").trim().toLowerCase() === "complete";
}

function formatSignedDeltaInParens(delta) {
  const n = Math.round(Number(delta));
  if (n > 0) return "(+" + n + ")";
  if (n < 0) return "(" + n + ")";
  return "(0)";
}

function formatStepDelta(prev, next) {
  const p = Number(prev);
  const x = Number(next);
  if (!Number.isFinite(p) || !Number.isFinite(x)) return "(0) (step: n/a)";
  return formatSignedDeltaInParens(x - p) + " (step: " + Math.round(p) + " -> " + Math.round(x) + ")";
}

/**
 * @param {string[][]} dataRows
 * @param {{ taskId?: string, force?: boolean }} opts
 */
function listEnforcerCandidates(dataRows, opts) {
  const taskId = opts.taskId ? String(opts.taskId).trim().toLowerCase() : "";
  const force = !!opts.force;
  const out = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = padRow(dataRows[i]);
    if (isDoneStatus(row[IDX.status])) continue;
    if (!resolveMasterArtifactDocUrls(row).length) continue;
    if (taskId && String(row[IDX.task_id] || "").trim().toLowerCase() !== taskId) continue;
    if (isQaComplete(row[QA.qa_status]) && !force) continue;
    out.push({ sheetRow: i + 2, row });
  }
  return out;
}

/**
 * Candidate artifact URLs for this row (Best → Latest → Execution, deduped).
 * {@link resolvePrimaryArtifactByModification} picks among these by Drive `modifiedTime`.
 */
function resolveMasterArtifactDocUrls(row) {
  const best = String(row[QA.qa_best_revision_url] || "").trim();
  const latest = String(row[QA.qa_latest_revision_url] || "").trim();
  const exec = String(row[IDX.execution_output_link] || "").trim();
  const seen = new Set();
  const out = [];
  for (const u of [best, latest, exec]) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/**
 * Among {@link resolveMasterArtifactDocUrls}, pick the Google Doc with the latest `modifiedTime`.
 * Fallback: first URL if metadata fetch fails for all.
 * @param {string[]} row
 * @returns {Promise<{ url: string, fileId: string, modifiedTime: string } | null>}
 */
async function resolvePrimaryArtifactByModification(row) {
  const urls = resolveMasterArtifactDocUrls(row);
  if (!urls.length) return null;
  const picked = await pickNewestGoogleDocAmongUrls(urls);
  if (picked) return picked;
  const id0 = parseGoogleDocUrlToFileId(urls[0]);
  if (!id0) return null;
  return { url: urls[0], fileId: id0, modifiedTime: "" };
}

/**
 * FEEDBACK / GENERAL RULE markers from the **newest-modified** artifact only (same pick as scoring).
 * @param {string[]} row
 */
async function gatherFeedbackFromNewestDoc(row) {
  const picked = await resolvePrimaryArtifactByModification(row);
  if (!picked) {
    return {
      artifactFeedback: [],
      generalRules: [],
      humanFeedbackCaptured: false,
      picked: null,
    };
  }
  const plain = await exportGoogleDocPlainText(picked.fileId);
  const parsed = parseFeedbackFromDocText(plain);
  return {
    artifactFeedback: parsed.artifactFeedback,
    generalRules: parsed.generalRules,
    humanFeedbackCaptured: parsed.humanFeedbackCaptured,
    picked,
  };
}

async function buildEvaluationBundle(text, row, humanFeedbackSummary) {
  const sections = parseExecutionDocSections(text);
  const creds = getServiceAccountCredentials();
  const clientEmail = typeof creds?.client_email === "string" ? creds.client_email : "";
  const linksCell = String(row[IDX.execution_context_doc_links] || "").trim();
  const { text: linkedContext } = await fetchExecutionContextFromDocLinksCell(linksCell, {
    perFileMaxChars: getExecutionContextDocMaxCharsPerFile(),
    totalMaxChars: getExecutionContextDocMaxCharsTotal(),
    maxFiles: getExecutionContextDocMaxFiles(),
    clientEmail,
  });
  const projectRulesExcerpt = await loadProjectRulesExcerpt();
  const bundle = {
    task: String(row[IDX.task] || "").trim(),
    artifactBody: sections.llmOutput || text.slice(0, 120000),
    executionPrompt: sections.generatedPrompt || "",
    linkedContext,
    projectRulesExcerpt,
    humanFeedbackSummary: humanFeedbackSummary ? String(humanFeedbackSummary).trim() : "",
  };
  logEnforcerEvalBundleIfEnabled(bundle, String(row[IDX.task_id] || "").trim());
  return bundle;
}

/** Count http(s) URLs in a string (rough, for diagnostics). */
function countUrlsInText(s) {
  return (String(s || "").match(/https?:\/\/[^\s)\]>'"]+/gi) || []).length;
}

/**
 * When ENFORCER_LOG_EVAL_BUNDLE=1, logs character sizes and URL counts for each bundle section.
 * linkedContext is populated only from the sheet **Execution Context Doc Links** cell (Drive export).
 */
function logEnforcerEvalBundleIfEnabled(bundle, taskIdHint) {
  const v = String(process.env.ENFORCER_LOG_EVAL_BUNDLE || "").toLowerCase().trim();
  if (v !== "1" && v !== "true" && v !== "yes") return;
  const pr = String(bundle.projectRulesExcerpt || "");
  const hf = String(bundle.humanFeedbackSummary || "");
  const lc = String(bundle.linkedContext || "");
  console.log(
    "[enforcer eval bundle]",
    JSON.stringify(
      {
        task_id: taskIdHint || null,
        chars: {
          artifactBody: String(bundle.artifactBody || "").length,
          executionPrompt: String(bundle.executionPrompt || "").length,
          linkedContext_fromExecutionContextDocLinksCell: lc.length,
          linkedContext_urlCount: countUrlsInText(lc),
          projectRulesExcerpt: pr.length,
          projectRules_urlCount: countUrlsInText(pr),
          humanFeedbackSummary: hf.length,
          humanFeedback_urlCount: countUrlsInText(hf),
        },
        behavior:
          "linkedContext is fetched via Drive from URLs in the Execution Context Doc Links column only. " +
          "URLs inside project-rules.md or human feedback are sent as plain text to the model; their Doc bodies are not auto-exported.",
      },
      null,
      0,
    ),
  );
}

async function evaluateDoc(apiKey, model, fileId, row, humanFeedbackSummary) {
  const plain = await exportGoogleDocPlainText(fileId);
  const bundle = await buildEvaluationBundle(plain, row, humanFeedbackSummary);
  const stages = await runFullEvaluation(apiKey, model, bundle);
  const norm = normalizeCombinedScores(stages.combined);
  return { norm, stages, bundle, plain };
}

/**
 * @param {string} [humanFeedbackSummary] - passed to every evaluateDoc in this loop
 * @returns {Promise<{ finalNorm: object, stopReason: string, revisionAttempts: number, lastStepDelta: string, bestScore: number, bestUrl: string, bestFileId: string }>}
 */
async function runScoredRevisionLoop(
  apiKey,
  model,
  row,
  startFileId,
  startUrl,
  threshold,
  minDelta,
  maxAttempts,
  versionPrefix,
  humanFeedbackSummary,
) {
  const hf = humanFeedbackSummary != null ? String(humanFeedbackSummary) : "";
  let currentFileId = startFileId;
  let currentUrl = startUrl;
  const evalOnce = await evaluateDoc(apiKey, model, currentFileId, row, hf);
  let norm = evalOnce.norm;
  const initialOverall = norm.overall_score != null ? norm.overall_score : 0;

  let bestScore = initialOverall;
  let bestUrl = currentUrl;
  let bestFileId = currentFileId;

  if (norm.overall_score != null && norm.overall_score >= threshold) {
    return {
      finalNorm: norm,
      stopReason: STOP.QUALITY_THRESHOLD_MET,
      revisionAttempts: 0,
      lastStepDelta: formatStepDelta(initialOverall, initialOverall),
      bestScore,
      bestUrl,
      bestFileId,
    };
  }

  let lastScore = norm.overall_score != null ? norm.overall_score : 0;
  let revisionAttempts = 0;
  let stopReason = STOP.QUALITY_THRESHOLD_MET;
  let lastStepDelta = formatStepDelta(initialOverall, initialOverall);

  while (true) {
    if (lastScore >= threshold) {
      stopReason = STOP.QUALITY_THRESHOLD_MET;
      break;
    }
    if (revisionAttempts >= maxAttempts) {
      stopReason = STOP.MAX_REVISION_ATTEMPTS;
      break;
    }

    revisionAttempts += 1;
    const bundleForRev = await buildEvaluationBundle(
      await exportGoogleDocPlainText(currentFileId),
      row,
      hf,
    );
    let revised;
    try {
      revised = await reviseArtifact(apiKey, model, bundleForRev, norm);
    } catch (e) {
      stopReason = String(e.message || e);
      break;
    }
    const newBody = String(revised.revised_llm_output || "").trim();
    if (!newBody) {
      stopReason = "revision_empty";
      break;
    }

    const doc = await createEnforcerRevisionDoc({
      taskId: String(row[IDX.task_id] || ""),
      versionLabel: versionPrefix + " v" + revisionAttempts,
      fields: {
        taskId: row[IDX.task_id],
        task: row[IDX.task],
        executionType: row[IDX.execution_type],
        missingInfo: row[IDX.missing_info],
        generatedPrompt: bundleForRev.executionPrompt,
        llmOutput: newBody,
        createdAt: new Date().toISOString(),
        executionContextDocLinks: row[IDX.execution_context_doc_links],
      },
    });

    currentFileId = doc.fileId;
    currentUrl = doc.url;

    const nextEval = await evaluateDoc(apiKey, model, currentFileId, row, hf);
    const nextNorm = nextEval.norm;
    const nextOverall = nextNorm.overall_score != null ? nextNorm.overall_score : 0;

    lastStepDelta = formatStepDelta(lastScore, nextOverall);

    if (nextOverall < lastScore) {
      stopReason = STOP.SCORE_DECREASED;
      norm = nextNorm;
      break;
    }
    if (nextOverall >= threshold) {
      norm = nextNorm;
      stopReason = STOP.QUALITY_THRESHOLD_MET;
      if (nextOverall >= bestScore) {
        bestScore = nextOverall;
        bestUrl = currentUrl;
        bestFileId = currentFileId;
      }
      break;
    }
    if (nextOverall - lastScore < minDelta) {
      norm = nextNorm;
      stopReason = STOP.IMPROVEMENT_BELOW_DELTA;
      if (nextOverall > bestScore) {
        bestScore = nextOverall;
        bestUrl = currentUrl;
        bestFileId = currentFileId;
      }
      break;
    }

    norm = nextNorm;
    lastScore = nextOverall;
    if (nextOverall > bestScore) {
      bestScore = nextOverall;
      bestUrl = currentUrl;
      bestFileId = currentFileId;
    }
  }

  return {
    finalNorm: norm,
    stopReason,
    revisionAttempts,
    lastStepDelta,
    bestScore,
    bestUrl,
    bestFileId,
  };
}

function applyQaSuccess(row, fields) {
  const r = padRow(row);
  for (const key of Object.keys(fields)) {
    const idx = QA[key];
    if (idx === undefined) continue;
    const v = fields[key];
    r[idx] = v == null ? "" : String(v);
  }
  return r;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.taskId]
 * @param {boolean} [opts.force]
 * @param {boolean} [opts.ingest_feedback]
 */
async function runEnforcerWorkbenchOnce(opts = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set.");
    err.code = "NO_OPENAI";
    throw err;
  }

  await ensureMasterExecutionSchema();
  await ensureMasterQaSchema();

  const model = getEnforcerModel();
  const threshold = getEnforcerQualityThreshold();
  const minDelta = getEnforcerMinImprovementDelta();
  const maxAttempts = getEnforcerMaxRevisionAttempts();

  const dataRows = await getMasterDataRows();
  const candidates = listEnforcerCandidates(dataRows, {
    taskId: opts.taskId,
    force: !!opts.force,
  });

  const summary = { candidates: candidates.length, processed: [], errors: [] };

  for (const { sheetRow, row } of candidates) {
    const workingStart = padRow(row);
    try {
      const pickedArt = await resolvePrimaryArtifactByModification(workingStart);
      if (!pickedArt || !pickedArt.fileId) {
        throw new Error("Could not resolve artifact Google Doc (check Best / Latest / Execution URLs).");
      }
      const url = pickedArt.url;
      const fileId = pickedArt.fileId;

      let humanSummary = "";
      let ingestCaptured = false;
      let ingestRulesUpdated = false;
      if (opts.ingest_feedback) {
        try {
          const plainIngest = await exportGoogleDocPlainText(fileId);
          const parsedIngest = parseFeedbackFromDocText(plainIngest);
          ingestCaptured = parsedIngest.humanFeedbackCaptured;
          if (parsedIngest.generalRules.length) {
            const m = await mergeGeneralRules(parsedIngest.generalRules);
            ingestRulesUpdated = m.rulesUpdated;
            await appendJudgmentLogEntry({
              type: "general_rule_ingest",
              task_id: workingStart[IDX.task_id],
              rules: parsedIngest.generalRules,
            });
          }
          if (parsedIngest.artifactFeedback.length) {
            await appendJudgmentLogEntry({
              type: "artifact_feedback_ingest",
              task_id: workingStart[IDX.task_id],
              feedback: parsedIngest.artifactFeedback,
            });
          }
          humanSummary = [
            ...parsedIngest.artifactFeedback,
            ...parsedIngest.generalRules.map((g) => "[GENERAL] " + g),
          ].join("\n");
        } catch (e) {
          console.warn("[enforcer run] ingest_feedback learnings skipped:", String(e.message || e));
        }
      }

      const loop = await runScoredRevisionLoop(
        apiKey,
        model,
        workingStart,
        fileId,
        url,
        threshold,
        minDelta,
        maxAttempts,
        "Revised",
        humanSummary,
      );

      const ready =
        loop.finalNorm.overall_score != null && loop.finalNorm.overall_score >= threshold ? "Yes" : "No";
      const merged = formatMergedScores(
        loop.finalNorm.universal_score,
        loop.finalNorm.task_type_score,
        loop.finalNorm.task_specific_score,
      );

      const priorRev = parseInt(String(workingStart[QA.qa_revision_count] || "0"), 10) || 0;
      let working = applyQaSuccess(workingStart, {
        qa_status: "complete",
        qa_scores_merged: merged,
        qa_final_score: loop.finalNorm.overall_score != null ? String(loop.finalNorm.overall_score) : "",
        qa_revision_count: String(priorRev + loop.revisionAttempts),
        qa_revision_delta: loop.lastStepDelta,
        qa_best_revision_url: loop.bestUrl,
        qa_latest_revision_url: loop.bestUrl,
        qa_ready_for_production: ready,
        qa_stop_reason: loop.stopReason,
        qa_human_feedback_captured: opts.ingest_feedback && ingestCaptured ? "Yes" : String(workingStart[QA.qa_human_feedback_captured] || ""),
        qa_general_rules_updated: opts.ingest_feedback && ingestRulesUpdated ? "Yes" : String(workingStart[QA.qa_general_rules_updated] || ""),
      });

      await updateMasterRow(sheetRow, working);
      summary.processed.push({
        sheetRow,
        task_id: working[IDX.task_id],
        stopReason: loop.stopReason,
        revisionAttempts: loop.revisionAttempts,
      });
    } catch (e) {
      summary.errors.push({ sheetRow, error: String(e.message || e) });
      try {
        const failed = applyQaSuccess(workingStart, {
          qa_status: "failed",
          qa_stop_reason: String(e.message || e).slice(0, 200),
        });
        await updateMasterRow(sheetRow, failed);
      } catch (_) {
        /* ignore */
      }
    }
  }

  return summary;
}

/**
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {boolean} [opts.rescore]
 * @param {boolean} [opts.revision]
 */
async function runEnforcerFeedbackOnce(opts) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set.");
    err.code = "NO_OPENAI";
    throw err;
  }
  const taskId = String(opts.taskId || "").trim();
  if (!taskId) {
    const err = new Error("task_id is required.");
    err.code = "BAD_INPUT";
    throw err;
  }

  const doRescore = opts.rescore !== undefined ? !!opts.rescore : isEnforcerRescoreAfterFeedback();
  const doRevision = opts.revision !== undefined ? !!opts.revision : isEnforcerRevisionAfterFeedback();

  await ensureMasterExecutionSchema();
  await ensureMasterQaSchema();

  const model = getEnforcerModel();
  const threshold = getEnforcerQualityThreshold();
  const minDelta = getEnforcerMinImprovementDelta();
  const maxAttempts = getEnforcerMaxRevisionAttempts();

  const dataRows = await getMasterDataRows();
  const hit = dataRows
    .map((r, i) => ({ sheetRow: i + 2, row: padRow(r) }))
    .find((x) => String(x.row[IDX.task_id] || "").trim().toLowerCase() === taskId.toLowerCase());
  if (!hit) {
    const err = new Error("No row found for task_id: " + taskId);
    err.code = "NOT_FOUND";
    throw err;
  }

  const { sheetRow, row } = hit;
  let working = padRow(row);

  const ingestPack = await gatherFeedbackFromNewestDoc(working);
  if (!ingestPack.picked || !ingestPack.picked.fileId) {
    throw new Error("Could not resolve artifact Google Doc for feedback (check Best / Latest / Execution URLs).");
  }
  const docUrl = ingestPack.picked.url;
  const fileId = ingestPack.picked.fileId;
  const parsed = {
    artifactFeedback: ingestPack.artifactFeedback,
    generalRules: ingestPack.generalRules,
    humanFeedbackCaptured: ingestPack.humanFeedbackCaptured,
  };
  let rulesUpdated = false;
  try {
    if (parsed.generalRules.length) {
      const m = await mergeGeneralRules(parsed.generalRules);
      rulesUpdated = m.rulesUpdated;
      await appendJudgmentLogEntry({
        type: "general_rule_ingest",
        task_id: working[IDX.task_id],
        rules: parsed.generalRules,
      });
    }
    if (parsed.artifactFeedback.length) {
      await appendJudgmentLogEntry({
        type: "artifact_feedback_ingest",
        task_id: working[IDX.task_id],
        feedback: parsed.artifactFeedback,
      });
    }
  } catch (e) {
    console.warn("[enforcer feedback] learnings write skipped:", String(e.message || e));
  }

  const humanSummary = [...parsed.artifactFeedback, ...parsed.generalRules.map((g) => "[GENERAL] " + g)].join("\n");
  const priorSheetFinalRaw = parseFloat(String(working[QA.qa_final_score] || "").trim());
  const priorSheetFinalOk = Number.isFinite(priorSheetFinalRaw) ? priorSheetFinalRaw : null;

  const baselineBestUrl = String(working[QA.qa_best_revision_url] || "").trim();
  const baselineBestId = baselineBestUrl ? parseGoogleDocUrlToFileId(baselineBestUrl) : null;

  let stopReason = "";
  let revisionAttempts = 0;
  let lastStepDelta = "";
  let finalNorm = null;
  let bestUrl = baselineBestUrl || docUrl;
  let latestUrl = String(working[QA.qa_latest_revision_url] || "").trim() || docUrl;
  let scoredUrl = docUrl;

  const hasStructuredFeedback = parsed.humanFeedbackCaptured;

  if (doRevision && hasStructuredFeedback) {
    const loop = await runScoredRevisionLoop(
      apiKey,
      model,
      working,
      fileId,
      docUrl,
      threshold,
      minDelta,
      maxAttempts,
      "Human-feedback",
      humanSummary,
    );
    revisionAttempts = loop.revisionAttempts;
    stopReason = loop.stopReason;
    lastStepDelta = loop.lastStepDelta;
    finalNorm = loop.finalNorm;
    bestUrl = loop.bestUrl;
    latestUrl = loop.bestUrl;
    scoredUrl = loop.bestUrl;
  } else if (doRescore) {
    const ev = await evaluateDoc(apiKey, model, fileId, working, humanSummary);
    finalNorm = ev.norm;
    stopReason = STOP.RESCORING_ONLY_NO_REVISION;
    revisionAttempts = 0;
  }

  let fairOverallForCompare = null;
  if (doRescore && finalNorm) {
    const newOverall = finalNorm.overall_score != null ? finalNorm.overall_score : 0;
    let baseline = priorSheetFinalOk;
    let baselineLabel = "prior sheet final";
    const currentScoredId = parseGoogleDocUrlToFileId(scoredUrl) || fileId;
    const needFairCompare =
      baselineBestId &&
      baselineBestUrl &&
      baselineBestUrl !== scoredUrl &&
      baselineBestId !== currentScoredId;
    if (needFairCompare) {
      try {
        const fair = await evaluateDoc(apiKey, model, baselineBestId, working, humanSummary);
        fairOverallForCompare = fair.norm.overall_score != null ? fair.norm.overall_score : 0;
        baseline = fairOverallForCompare;
        baselineLabel = "fair prior best";
      } catch (_) {
        fairOverallForCompare = null;
      }
    }
    const b = baseline != null ? baseline : newOverall;
    const deltaNum = Math.round(newOverall - b);
    lastStepDelta =
      formatSignedDeltaInParens(deltaNum) +
      " (" +
      baselineLabel +
      ": " +
      Math.round(b) +
      " -> " +
      Math.round(newOverall) +
      ")";

    if (needFairCompare && fairOverallForCompare != null) {
      bestUrl = newOverall >= fairOverallForCompare ? scoredUrl : baselineBestUrl;
    } else {
      bestUrl = scoredUrl;
    }
    if (!doRevision || revisionAttempts === 0) {
      latestUrl = docUrl;
    }
  }

  const priorCount = parseInt(String(working[QA.qa_revision_count] || "0"), 10) || 0;

  if (doRescore && finalNorm) {
    const merged = formatMergedScores(
      finalNorm.universal_score,
      finalNorm.task_type_score,
      finalNorm.task_specific_score,
    );
    const ready = finalNorm.overall_score != null && finalNorm.overall_score >= threshold ? "Yes" : "No";
    let sr = stopReason;
    if (doRevision && revisionAttempts > 0) {
      sr = stopReason;
    } else if (doRescore) {
      sr = STOP.RESCORING_ONLY_NO_REVISION;
    }
    working = applyQaSuccess(working, {
      qa_status: "complete",
      qa_scores_merged: merged,
      qa_final_score: finalNorm.overall_score != null ? String(finalNorm.overall_score) : "",
      qa_revision_count: String(priorCount + revisionAttempts),
      qa_revision_delta: lastStepDelta || working[QA.qa_revision_delta],
      qa_best_revision_url: bestUrl,
      qa_latest_revision_url: latestUrl,
      qa_ready_for_production: ready,
      qa_stop_reason: sr,
      qa_human_feedback_captured: parsed.humanFeedbackCaptured ? "Yes" : "No",
      qa_general_rules_updated: rulesUpdated ? "Yes" : "No",
    });
  } else if (doRevision && !doRescore) {
    working = applyQaSuccess(working, {
      qa_revision_count: String(priorCount + revisionAttempts),
      qa_revision_delta: lastStepDelta || String(working[QA.qa_revision_delta] || ""),
      qa_best_revision_url: bestUrl,
      qa_latest_revision_url: latestUrl,
      qa_stop_reason: stopReason || String(working[QA.qa_stop_reason] || ""),
      qa_human_feedback_captured: parsed.humanFeedbackCaptured ? "Yes" : "No",
      qa_general_rules_updated: rulesUpdated ? "Yes" : "No",
    });
  } else {
    working = applyQaSuccess(working, {
      qa_human_feedback_captured: parsed.humanFeedbackCaptured ? "Yes" : "No",
      qa_general_rules_updated: rulesUpdated ? "Yes" : "No",
      qa_revision_count: String(priorCount + revisionAttempts),
      qa_best_revision_url: bestUrl,
      qa_latest_revision_url: latestUrl,
      qa_stop_reason:
        !doRescore && !doRevision ? "ingest_only" : !doRescore && revisionAttempts > 0 ? stopReason : "",
    });
  }

  await updateMasterRow(sheetRow, working);

  return {
    sheetRow,
    task_id: taskId,
    rescore: doRescore,
    revision: doRevision,
    revisionAttempts,
    stopReason: working[QA.qa_stop_reason],
  };
}

module.exports = {
  runEnforcerWorkbenchOnce,
  runEnforcerFeedbackOnce,
  listEnforcerCandidates,
  resolvePrimaryArtifactByModification,
  resolveMasterArtifactDocUrls,
  gatherFeedbackFromNewestDoc,
  QA,
};
