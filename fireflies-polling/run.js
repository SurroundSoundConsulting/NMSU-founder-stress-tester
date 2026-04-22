/**
 * Orchestrates Fireflies poll / backfill → Hive Mind → command-center sheet.
 * Run: node fireflies-polling/run.js poll | backfill
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const {
  getPollLookbackMinutes,
  getBackfillLookbackDays,
  getMaxTranscriptsPerRun,
  isDryRun,
} = require("../lib/env");
const { listTranscriptsInWindow, fetchTranscriptDetail } = require("./fireflies");
const { analyzeTranscriptToHiveMind } = require("../lib/hiveMind");
const {
  getProcessedTranscriptIdSet,
  getMasterDataRows,
  appendProcessedTranscriptRow,
  appendPollingLogRow,
  appendMasterRows,
  updateMasterRow,
} = require("../lib/commandCenterSheets");
const { matchOrAllocateTask, buildMasterRow, padRow } = require("../lib/taskMerge");

async function logStep(transcriptId, step, message) {
  const ts = new Date().toISOString();
  try {
    await appendPollingLogRow([ts, step, transcriptId || "", message]);
  } catch (e) {
    console.error("Polling log append failed:", e.message);
  }
  console.log(`[${step}] ${message}${transcriptId ? " — " + transcriptId : ""}`);
}

/**
 * Apply Hive Mind action items to Master Action Board with dedupe.
 * @param {object} hiveResult
 * @param {{ source_transcript_id: string, meeting_title: string, meeting_date: string, source_url: string }} meeting
 */
async function mergeActionItemsToMaster(hiveResult, meeting) {
  const items = hiveResult.actionItems || [];
  if (items.length === 0) return { inserted: 0, updated: 0 };

  let masterSnapshot = await getMasterDataRows();
  const baseRow = 2;
  let inserted = 0;
  let updated = 0;
  const nowIso = new Date().toISOString();

  for (const task of items) {
    const m = matchOrAllocateTask(task, masterSnapshot, baseRow);
    if (m.type === "update") {
      const idx = m.sheetRow - baseRow;
      const existing = masterSnapshot[idx] || [];
      const row = padRow(
        buildMasterRow(task, meeting, m.taskId, existing[14] || nowIso, nowIso),
      );
      await updateMasterRow(m.sheetRow, row);
      masterSnapshot[idx] = row;
      updated += 1;
    } else {
      const row = padRow(buildMasterRow(task, meeting, m.taskId, null, nowIso));
      await appendMasterRows([row]);
      masterSnapshot.push(row);
      inserted += 1;
    }
  }

  return { inserted, updated };
}

/**
 * @param {"poll"|"backfill"} mode
 */
async function runFirefliesJob(mode) {
  const windowLabel = mode === "backfill" ? "backfill" : "poll";
  await logStep("", "init", "Fireflies job start (" + windowLabel + ")" + (isDryRun() ? " [DRY RUN]" : ""));

  const now = Date.now();
  let fromMs;
  let toMs = now;
  if (mode === "backfill") {
    const days = getBackfillLookbackDays();
    fromMs = now - days * 24 * 60 * 60 * 1000;
  } else {
    const mins = getPollLookbackMinutes();
    fromMs = now - mins * 60 * 1000;
  }

  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  let list;
  try {
    list = await listTranscriptsInWindow({ fromIso, toIso });
  } catch (e) {
    await logStep("", "error", "listTranscripts failed: " + (e.message || e));
    throw e;
  }

  await logStep("", "list", "Found " + list.length + " transcript(s) in window");

  const processed = await getProcessedTranscriptIdSet();
  const fresh = list.filter((t) => !processed.has(t.id));
  const maxN = getMaxTranscriptsPerRun();
  const toProcess = fresh.slice(0, maxN);

  await logStep("", "filter", toProcess.length + " new to process (cap " + maxN + ")");

  if (isDryRun()) {
    await logStep("", "dry_run", "Skipped fetch/process/write");
    return { ok: true, dryRun: true, candidates: toProcess.length };
  }

  let okCount = 0;
  for (const summary of toProcess) {
    const tid = summary.id;
    try {
      await logStep(tid, "fetch", "Fetching transcript");
      const detail = await fetchTranscriptDetail(tid);
      if (!detail.text || !detail.text.trim()) {
        await logStep(tid, "skip", "Empty transcript text");
        continue;
      }

      await logStep(tid, "hive_mind", "Running Hive Mind");
      const hiveResult = await analyzeTranscriptToHiveMind(detail.text);

      const meeting = {
        source_transcript_id: detail.fireflies_transcript_id,
        meeting_title: detail.title || summary.title || "",
        meeting_date: detail.meeting_date || "",
        source_url: detail.source_url || summary.transcript_url || "",
      };

      await logStep(tid, "merge", "Merging tasks to Master Action Board");
      const stats = await mergeActionItemsToMaster(hiveResult, meeting);

      await logStep(
        tid,
        "done",
        "Processed. tasks inserted " + stats.inserted + ", updated " + stats.updated,
      );

      await appendProcessedTranscriptRow([
        detail.fireflies_transcript_id,
        meeting.meeting_title,
        meeting.meeting_date,
        new Date().toISOString(),
        "processed",
        meeting.source_url,
      ]);

      okCount += 1;
    } catch (err) {
      console.error(err);
      await logStep(tid, "error", String(err.message || err));
    }
  }

  await logStep("", "complete", "Finished. Successfully processed " + okCount + " transcript(s).");
  return { ok: true, processed: okCount };
}

async function main() {
  const mode = (process.argv[2] || "poll").toLowerCase();
  if (mode !== "poll" && mode !== "backfill") {
    console.error('Usage: node fireflies-polling/run.js [poll|backfill]');
    process.exit(1);
  }
  try {
    await runFirefliesJob(mode);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runFirefliesJob, mergeActionItemsToMaster, logStep };
