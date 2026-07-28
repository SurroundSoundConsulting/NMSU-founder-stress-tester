/**
 * LLM-assisted dedupe: compare new Hive Mind tasks to recent Master Action Board rows
 * (within N calendar days of the transcript meeting date). Duplicate detection is by
 * semantic similarity of the **task** description only — not owner/due triple matching.
 */

const {
  getDedupeLlmLookbackDays,
  getDedupeLlmModel,
  isDedupeLlmLogVerbose,
  getDedupeLlmLogMaxChars,
} = require("./env");
const { updateMasterRow, appendMasterRows } = require("./commandCenterSheets");
const { getNextTaskId, buildMasterRow, padRow } = require("./taskMerge");

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function dedupeLog() {
  const args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ["[dedupe]"].concat(args));
}

function maybeTruncate(s, maxLen) {
  const str = String(s);
  if (str.length <= maxLen) return str;
  return (
    str.slice(0, maxLen) +
    "\n... [truncated " +
    (str.length - maxLen) +
    " chars; set DEDUPE_LLM_LOG_MAX_CHARS to raise limit]"
  );
}

function parseYmdToUtcMs(s) {
  const m = String(s || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m)) return null;
  const [y, mo, d] = m.split("-").map(Number);
  const t = Date.UTC(y, mo - 1, d);
  return Number.isFinite(t) ? t : null;
}

function windowStartYmd(anchorYmd, daysBack) {
  const t = parseYmdToUtcMs(anchorYmd);
  if (t == null) return null;
  const d = new Date(t);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function ymdInInclusiveWindow(rowYmd, startYmd, endYmd) {
  if (!rowYmd || !startYmd || !endYmd) return false;
  return rowYmd >= startYmd && rowYmd <= endYmd;
}

/**
 * Prefer meeting_date (col M, index 13); else created_at (index 14) date prefix.
 * @param {string[]} row
 */
function rowAnchorYmd(row) {
  const md = String(row[13] || "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(md)) return md;
  const created = String(row[14] || "").trim();
  if (created.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(created)) return created.slice(0, 10);
  return null;
}

/**
 * @param {Array<{ sheetRow: number, row: string[] }>} stamped
 * @param {string} transcriptMeetingYmd
 * @param {number} daysBack
 * @param {number} maxRows
 */
function filterExistingForPrompt(stamped, transcriptMeetingYmd, daysBack, maxRows) {
  const anchor =
    transcriptMeetingYmd && /^\d{4}-\d{2}-\d{2}$/.test(transcriptMeetingYmd)
      ? transcriptMeetingYmd.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  const start = windowStartYmd(anchor, daysBack) || anchor;
  const end = anchor;
  const fixed = [];
  for (const { sheetRow, row } of stamped) {
    const y = rowAnchorYmd(row);
    if (!y || !ymdInInclusiveWindow(y, start, end)) continue;
    const tid = String(row[0] || "").trim();
    if (!tid) continue;
    fixed.push({
      task_id: tid,
      task: String(row[1] || ""),
      owner: String(row[2] || ""),
      status: String(row[3] || ""),
      urgency: String(row[4] || ""),
      due_date: String(row[5] || ""),
      next_step: String(row[6] || ""),
      blockers: String(row[7] || ""),
      dependencies: String(row[8] || ""),
      okr_link: String(row[9] || ""),
      risk_flag: String(row[10] || ""),
      source_transcript_id: String(row[11] || ""),
      meeting_title: String(row[12] || ""),
      meeting_date: String(row[13] || ""),
      created_at: String(row[14] || ""),
      updated_at: String(row[15] || ""),
      _sheetRow: sheetRow,
    });
  }
  fixed.sort(function (a, b) {
    const c = (b.meeting_date || "").localeCompare(a.meeting_date || "");
    if (c !== 0) return c;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
  return fixed.slice(0, maxRows);
}

function buildDedupeSystemPrompt() {
  return [
    "You are deduplicating action items for a founder command center.",
    "",
    "You receive:",
    "- transcript_meeting_date: YYYY-MM-DD anchor for the meeting being processed.",
    "- lookback_days: calendar-day window — existing_tasks are board rows whose meeting_date or created_at falls in [anchor - lookback_days, anchor] inclusive.",
    "- existing_tasks: those rows (includes task_id and fields).",
    "- candidate_tasks: NEW action items from the current transcript only (candidate_index 0..N-1).",
    "",
    "Rules:",
    "1) Decide duplicate by **semantic meaning of the task description only** (`task` field). Do NOT require the same owner or due date to call two tasks duplicates.",
    "1b) Be **generous** with updates: if a candidate is a paraphrase, minor rewording, abbreviation, or clearer restatement of the **same deliverable or commitment** as an existing task, treat it as the same task and choose **update** (not insert). When in doubt between insert and update, prefer **update** if any existing_tasks[].task plausibly refers to the same work.",
    "2) If a candidate is the same underlying work as exactly one existing task: action = \"update\", match_task_id = that task's task_id (must appear in existing_tasks). Provide `fields` with merged values for: task, owner, status, urgency, due_date, next_step, blockers, dependencies, okr_link, risk_flag. Use string for urgency (0-9). Prefer the newer transcript when details conflict.",
    "3) If no existing task is the same work: action = \"insert\". Omit match_task_id; fields may be {} or omitted.",
    "4) Output ONE JSON object only, no markdown. Exact shape:",
    '{"decisions":[{"candidate_index":0,"action":"insert"|"update","match_task_id":"HM-0001","fields":{}}]}',
    "5) Include exactly one decision per candidate_index from 0 through len(candidate_tasks)-1, sorted by candidate_index.",
    "6) For every \"update\", match_task_id MUST be copied from an existing_tasks[].task_id. Never invent task_ids for inserts.",
  ].join("\n");
}

/**
 * @param {object[]} candidates
 * @param {object[]} existingForPrompt
 * @param {string} transcriptMeetingYmd
 * @param {number} lookbackDays
 * @param {string} apiKey
 */
async function callDedupeLlm(candidates, existingForPrompt, transcriptMeetingYmd, lookbackDays, apiKey) {
  const model = getDedupeLlmModel();
  const windowStart = windowStartYmd(transcriptMeetingYmd, lookbackDays) || transcriptMeetingYmd;
  const verbose = isDedupeLlmLogVerbose();
  const maxChars = getDedupeLlmLogMaxChars();

  dedupeLog(
    "call model=" +
      model +
      " anchor=" +
      transcriptMeetingYmd +
      " window_ymd=" +
      windowStart +
      ".." +
      transcriptMeetingYmd +
      " lookback_days=" +
      lookbackDays +
      " existing_tasks=" +
      existingForPrompt.length +
      " candidates=" +
      candidates.length,
  );

  const payload = {
    transcript_meeting_date: transcriptMeetingYmd,
    lookback_days: lookbackDays,
    existing_tasks: existingForPrompt.map(function (e) {
      const o = { ...e };
      delete o._sheetRow;
      return o;
    }),
    candidate_tasks: candidates.map(function (c, i) {
      return {
        candidate_index: i,
        task: c.task,
        owner: c.owner,
        status: c.status,
        urgency: c.urgency,
        due_date: c.due_date || "",
        next_step: c.next_step || c.dueOrNextStep || "",
        blockers: c.blockers,
        dependencies: c.dependencies,
        okr_link: c.okr_link,
        risk_flag: c.risk_flag,
      };
    }),
  };

  const systemPrompt = buildDedupeSystemPrompt();
  const userContent =
    "Decide insert vs update for each candidate. Input JSON:\n\n" +
    JSON.stringify(payload, null, 2);

  if (verbose) {
    console.log("\n========== DEDUPE LLM: SYSTEM PROMPT ==========\n" + systemPrompt);
    console.log(
      "\n========== DEDUPE LLM: USER MESSAGE ==========\n" + maybeTruncate(userContent, maxChars) + "\n",
    );
  }

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: userContent,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  const rawText = await res.text();
  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    dedupeLog("OpenAI wrapper not JSON; first 500 chars:", rawText.slice(0, 500));
    throw new Error("Dedupe LLM: non-JSON response");
  }
  if (!res.ok) {
    dedupeLog("OpenAI error body:", JSON.stringify(body, null, 2));
    throw new Error(body?.error?.message || "Dedupe LLM HTTP " + res.status);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Dedupe LLM: empty content");
  }

  if (verbose) {
    console.log("\n========== DEDUPE LLM: ASSISTANT RAW (message.content) ==========\n" + content + "\n");
  }

  const parsed = JSON.parse(content);
  const decisions = parsed.decisions;
  if (!Array.isArray(decisions)) {
    throw new Error("Dedupe LLM: missing decisions array");
  }

  dedupeLog(
    "decisions summary:",
    decisions
      .map(function (d) {
        return (
          "#" +
          d.candidate_index +
          ":" +
          d.action +
          (d.match_task_id ? "->" + d.match_task_id : "")
        );
      })
      .join(" | "),
  );
  if (verbose) {
    console.log("[dedupe] decisions JSON:\n" + JSON.stringify(decisions, null, 2));
  }

  return decisions;
}

function validateDecisions(decisions, candidateCount, validTaskIds) {
  if (decisions.length !== candidateCount) return false;
  const seen = new Set();
  for (const d of decisions) {
    const ci = d.candidate_index;
    if (typeof ci !== "number" || ci < 0 || ci >= candidateCount) return false;
    if (seen.has(ci)) return false;
    seen.add(ci);
    if (d.action !== "insert" && d.action !== "update") return false;
    if (d.action === "update") {
      const id = String(d.match_task_id || "").trim();
      if (!id || !validTaskIds.has(id)) return false;
      if (!d.fields || typeof d.fields !== "object") return false;
    }
  }
  return seen.size === candidateCount;
}

function mergeFieldsFromLlm(fields, candidate) {
  const f = fields || {};
  function pick(k, alt) {
    const v = f[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    if (alt !== undefined && alt !== null && String(alt).trim() !== "") return String(alt).trim();
    return "";
  }
  const urg = f.urgency;
  const urgencyNum = Number.isFinite(Number(urg)) ? Number(urg) : candidate.urgency;
  return {
    task: pick("task", candidate.task),
    owner: pick("owner", candidate.owner),
    status: pick("status", candidate.status || "open"),
    urgency: urgencyNum,
    due_date: pick("due_date", candidate.due_date),
    next_step: pick("next_step", candidate.next_step || candidate.dueOrNextStep),
    blockers: pick("blockers", candidate.blockers),
    dependencies: pick("dependencies", candidate.dependencies),
    okr_link: pick("okr_link", candidate.okr_link),
    risk_flag: pick("risk_flag", candidate.risk_flag),
  };
}

/**
 * @param {object[]} items - hive actionItems
 * @param {object} meeting
 * @param {string[][]} masterSnapshot - rows (mutated)
 * @param {Array<{ sheetRow: number, row: string[] }>} stamped
 * @param {string} apiKey
 */
async function applyLlmDedupeMerge(items, meeting, masterSnapshot, stamped, apiKey) {
  const lookback = getDedupeLlmLookbackDays();
  const anchorYmd =
    meeting.meeting_date && /^\d{4}-\d{2}-\d{2}/.test(meeting.meeting_date)
      ? meeting.meeting_date.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  const existingForPrompt = filterExistingForPrompt(stamped, anchorYmd, lookback, 100);
  const validIds = new Set(existingForPrompt.map((e) => e.task_id));

  dedupeLog(
    "merge start meeting=" +
      (meeting.source_transcript_id || "") +
      " title=" +
      (meeting.meeting_title || "").slice(0, 80),
  );
  if (isDedupeLlmLogVerbose() && existingForPrompt.length > 0) {
    dedupeLog(
      "existing task_ids in window:",
      existingForPrompt.map(function (e) {
        return e.task_id;
      }).join(", "),
    );
  }

  const decisions = await callDedupeLlm(items, existingForPrompt, anchorYmd, lookback, apiKey);

  if (!validateDecisions(decisions, items.length, validIds)) {
    dedupeLog("validation FAILED; decisions:", JSON.stringify(decisions, null, 2));
    dedupeLog("valid match_task_id set size:", validIds.size);
    throw new Error("Dedupe LLM: invalid decisions shape or unknown task_id");
  }

  const sheetRowByTaskId = new Map();
  for (const { sheetRow, row } of stamped) {
    const tid = String(row[0] || "").trim();
    if (tid) sheetRowByTaskId.set(tid, sheetRow);
  }

  const byIndex = decisions.slice().sort((a, b) => a.candidate_index - b.candidate_index);
  let inserted = 0;
  let updated = 0;
  const nowIso = new Date().toISOString();

  for (const d of byIndex) {
    const candidate = items[d.candidate_index];
    if (d.action === "insert") {
      const taskId = getNextTaskId(masterSnapshot);
      const row = padRow(buildMasterRow(candidate, meeting, taskId, null, nowIso));
      await appendMasterRows([row]);
      masterSnapshot.push(row);
      inserted += 1;
    } else {
      const taskId = String(d.match_task_id).trim();
      const sheetRow = sheetRowByTaskId.get(taskId);
      if (!sheetRow) throw new Error("Dedupe: missing sheet row for " + taskId);
      const idx = sheetRow - 2;
      const existing = masterSnapshot[idx] || [];
      const merged = mergeFieldsFromLlm(d.fields, candidate);
      const synthetic = { ...candidate, ...merged };
      const row = padRow(
        buildMasterRow(synthetic, meeting, taskId, existing[14] || nowIso, nowIso),
      );
      await updateMasterRow(sheetRow, row);
      masterSnapshot[idx] = row;
      const st = stamped.find(function (s) {
        return s.sheetRow === sheetRow;
      });
      if (st) st.row = row;
      updated += 1;
    }
  }

  dedupeLog("merge done inserted=" + inserted + " updated=" + updated);

  return { inserted, updated };
}

module.exports = {
  applyLlmDedupeMerge,
  filterExistingForPrompt,
  buildDedupeSystemPrompt,
};
