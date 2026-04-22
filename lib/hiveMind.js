/**
 * Shared Hive Mind analysis (OpenAI) — used by the web server and Fireflies batch job.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function buildHiveMindSystemPrompt() {
  return [
    "You are an expert meeting analyst. Extract decision-oriented, high-signal structure from transcripts or notes.",
    "",
    "Output: one JSON object only (no markdown, no prose outside JSON). Top-level keys:",
    '- "actionItems": array of objects (see Action Items rules below)',
    '- "insights": array of strings — non-obvious takeaways, patterns, implications (not a task list)',
    '- "pointsOfDebate": array of strings — disagreements, unresolved questions, contested points',
    '- "keyTopicsSummary": one string — concise synthesis of main themes',
    "",
    "=== ACTION ITEMS (strict) ===",
    "Each action item object MUST use exactly these fields (names matter):",
    '- "urgency": integer 0–9 (9 = highest). See Urgency Process below.',
    '- "task": string — the work to do.',
    '- "owner": string — responsible person/role if stated; otherwise "TBD".',
    '- "dueOrNextStep": string — a concrete calendar due in ISO YYYY-MM-DD when possible, or a next-step / context line when no real date exists.',
    '- "status": one of: "open", "pending", "blocked", "done" — default "open" for new work.',
    '- "blockers": string — what is blocking this task, or "None noted".',
    '- "dependencies": string — other task titles or task IDs this depends on, or "None noted".',
    '- "due_date": string — if a real calendar date is clear, use YYYY-MM-DD; otherwise empty string "".',
    '- "next_step": string — same intent as dueOrNextStep: what happens next; use if helpful alongside due_date.',
    '- "okr_link": string — link or short label to an OKR or objective if clearly stated, else "None noted".',
    '- "risk_flag": string — one of: "none", "low", "medium", "high" based on external exposure, deadlines, or uncertainty in the transcript.',
    '- "urgencyJustification": string — REQUIRED for your reasoning only: 1–3 short sentences. Stripped before storage.',
    "",
    "What counts as an action item:",
    "- Include only real next steps: deliverables, follow-ups, commitments, decision-dependent tasks, or concrete work items assigned or clearly implied.",
    "- Do NOT inflate the list: skip pure discussion, background context, opinions, or topics with no actionable outcome.",
    "- Do NOT turn every mentioned theme into a task.",
    "",
    "Task writing (next_step / dueOrNextStep):",
    "- Imperative mood; start with a strong verb (e.g. Send, Draft, Schedule, Confirm, Ship).",
    "- Specific enough that someone could execute without re-asking what was meant.",
    "",
    "dueOrNextStep, due_date, and next_step:",
    "- When you can resolve a relative time phrase, use ISO date YYYY-MM-DD in due_date and summarize context in next_step or dueOrNextStep.",
    "- When no real calendar due exists, set due_date to \"\" and use a meaningful next_step line.",
    "",
    "=== URGENCY PROCESS (mandatory before setting urgency) ===",
    "For EACH action item, mentally evaluate these four factors using only transcript evidence (not general importance):",
    "1) Time sensitivity — real deadline, near-term milestone, or implied timing pressure?",
    "2) External exposure — client, partner, public deliverable, investor, regulator, or other outside-facing commitment?",
    "3) Dependency chain — blocking other work, decisions, or people?",
    "4) Strategic weight — central to a named priority, launch, revenue goal, or major initiative?",
    "",
    "Then assign urgency using this scale (do not inflate):",
    "- 9 = true fire: immediate risk, hard deadline collision, serious blocker, or severe external consequence if not done now.",
    "- 7–8 = high: clear time sensitivity AND/OR strong external or blocking impact; must move soon.",
    "- 5–6 = important but not immediately pressing; should happen on a normal horizon.",
    "- 3–4 = useful, can wait briefly; low time pressure.",
    "- 0–2 = optional, exploratory, nice-to-have, or low consequence unless the transcript clearly raises the bar.",
    "",
    "Anti-inflation rules:",
    "- Do NOT assign high urgency because a topic sounds important in the abstract.",
    "- Do NOT assign high urgency without at least one of: real timing pressure, external consequence, or blocking impact evidenced in the text.",
    "After internal reasoning, set \"urgency\" to match urgencyJustification; they must be consistent.",
  ].join("\n");
}

function clampUrgency(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(9, Math.round(x)));
}

const STATUS_SET = new Set(["open", "pending", "blocked", "done"]);

function cleanOperationalString(s, fallback) {
  const t = typeof s === "string" ? s.trim() : String(s || "").trim();
  return t || fallback;
}

/**
 * @param {unknown} raw
 */
function parseHiveMindPayload(raw) {
  let data = raw;
  if (typeof data === "string") {
    data = JSON.parse(data);
  }

  const rawItems = Array.isArray(data.actionItems) ? data.actionItems : [];
  const actionItems = rawItems.map(function (row) {
    const task = typeof row.task === "string" ? row.task.trim() : String(row.task || "").trim();
    let owner =
      typeof row.owner === "string" && row.owner.trim() ? row.owner.trim() : "TBD";
    const dueRaw =
      typeof row.dueOrNextStep === "string" && row.dueOrNextStep.trim()
        ? row.dueOrNextStep.trim()
        : typeof row.dateDue === "string" && row.dateDue.trim()
          ? row.dateDue.trim()
          : "";
    const dueOrNextStep = dueRaw || "None noted";

    const statusRaw = typeof row.status === "string" ? row.status.trim().toLowerCase() : "open";
    const status = STATUS_SET.has(statusRaw) ? statusRaw : "open";
    const blockers = cleanOperationalString(row.blockers, "None noted");
    const dependencies = cleanOperationalString(row.dependencies, "None noted");
    let dueDate = typeof row.due_date === "string" ? row.due_date.trim() : "";
    if (!dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueOrNextStep)) {
      dueDate = dueOrNextStep.slice(0, 10);
    }
    const nextStep =
      typeof row.next_step === "string" && row.next_step.trim()
        ? row.next_step.trim()
        : dueOrNextStep;
    const okrLink = cleanOperationalString(row.okr_link, "None noted");
    let risk = typeof row.risk_flag === "string" ? row.risk_flag.trim().toLowerCase() : "none";
    if (!["none", "low", "medium", "high"].includes(risk)) risk = "none";

    return {
      urgency: clampUrgency(row.urgency),
      task: task || "(unspecified task)",
      owner,
      dueOrNextStep,
      status,
      blockers,
      dependencies,
      due_date: dueDate,
      next_step: nextStep,
      okr_link: okrLink,
      risk_flag: risk,
    };
  });

  const insights = Array.isArray(data.insights) ? data.insights.map(String) : [];
  const pointsOfDebate = Array.isArray(data.pointsOfDebate)
    ? data.pointsOfDebate.map(String)
    : [];
  const keyTopicsSummary =
    typeof data.keyTopicsSummary === "string" ? data.keyTopicsSummary : String(data.keyTopicsSummary || "");

  return { actionItems, insights, pointsOfDebate, keyTopicsSummary };
}

function formatReferenceDateForPrompt() {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return `${iso} (${weekday})`;
}

/**
 * @param {string} transcript
 * @param {{ apiKey?: string, model?: string }=} options
 */
async function analyzeTranscriptToHiveMind(transcript, options) {
  const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set.");
    err.code = "OPENAI_MISSING";
    throw err;
  }
  const model = options?.model || DEFAULT_MODEL;
  const referenceDate = formatReferenceDateForPrompt();

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildHiveMindSystemPrompt() },
        {
          role: "user",
          content: [
            `Reference date for resolving relative deadlines: ${referenceDate}.`,
            "Analyze the following meeting transcript or notes and respond with JSON only:\n\n",
            String(transcript).trim(),
          ].join(""),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  const rawText = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    const err = new Error("Unexpected response from OpenAI (not JSON).");
    err.code = "OPENAI_BAD_RESPONSE";
    throw err;
  }

  if (!response.ok) {
    const msg =
      payload?.error?.message ||
      payload?.error ||
      `OpenAI request failed with status ${response.status}`;
    const err = new Error(String(msg));
    err.code = "OPENAI_ERROR";
    throw err;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    const err = new Error("OpenAI returned no message content.");
    err.code = "OPENAI_NO_CONTENT";
    throw err;
  }

  try {
    return parseHiveMindPayload(content);
  } catch (e) {
    const err = new Error("Could not parse model JSON. Try again or shorten the text.");
    err.code = "HIVE_MIND_PARSE";
    err.details = String(e && e.message);
    throw err;
  }
}

module.exports = {
  buildHiveMindSystemPrompt,
  parseHiveMindPayload,
  analyzeTranscriptToHiveMind,
  formatReferenceDateForPrompt,
  OPENAI_URL,
  DEFAULT_MODEL,
};
