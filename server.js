/**
 * Hive Mind — backend (Express)
 *
 * Loads secrets from .env (see dotenv) and calls the OpenAI Chat Completions API.
 * Required env: OPENAI_API_KEY
 */

// Load .env from this file's directory (project root), not from wherever the shell
// was when you ran `node server.js` — otherwise OPENAI_API_KEY may appear "unset".
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
const dotenvResult = require("dotenv").config({ path: envPath });

if (!fs.existsSync(envPath)) {
  console.warn("No .env file found at:", envPath);
} else if (fs.statSync(envPath).size === 0) {
  console.warn(
    ".env exists but is empty on disk. Paste OPENAI_API_KEY=sk-... and save the file (Cmd+S), then restart the server.",
  );
} else if (dotenvResult.error) {
  console.warn("Could not read .env:", dotenvResult.error.message);
}

if (
  fs.existsSync(envPath) &&
  fs.statSync(envPath).size > 0 &&
  !String(process.env.OPENAI_API_KEY || "").trim()
) {
  console.warn(
    ".env is not empty but OPENAI_API_KEY is missing. Use exactly: OPENAI_API_KEY=sk-... (one line, no spaces around =).",
  );
}

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI REST endpoint (same for all models you pick below)
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// Use a small, capable model; override with OPENAI_MODEL in .env if you like
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Parse JSON bodies (for POST /analyze)
app.use(express.json());

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, "public")));

/** Calendar date in YYYY-MM-DD (UTC) for resolving relative deadlines in the model. */
function referenceDateUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** First Mon–Fri day strictly after `isoDate` (UTC noon anchor). Used for ASAP hints. */
function nextBusinessDayUtc(isoDate) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/** Friday of the ISO week (Mon–Sun) containing `isoDate` (UTC). */
function isoWeekFridayUtc(isoDate) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - mondayOffset);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  return friday.toISOString().slice(0, 10);
}

function addDaysUtc(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonthUtc(isoDate) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

/**
 * Precomputed calendar hints (UTC) so the model can align with consistent date rules.
 * @param {string} ref YYYY-MM-DD
 */
function buildDateHints(ref) {
  return [
    `tomorrow (if used as meeting date + 1 day): ${addDaysUtc(ref, 1)}`,
    `Friday of the calendar week that contains the reference date (Mon–Sun week): ${isoWeekFridayUtc(ref)}`,
    `about 7 days after the reference date (for vague "next week" / "next meeting" when not specified): ${addDaysUtc(ref, 7)}`,
    `last day of the reference month: ${lastDayOfMonthUtc(ref)}`,
    `next business day after the reference date (for ASAP when no closer rule applies): ${nextBusinessDayUtc(ref)}`,
  ].join("\n");
}

/**
 * Ask the model to return ONLY JSON. Internal fields are stripped in parseHiveMindPayload.
 * response_format: json_object helps the model stay valid JSON.
 */
function buildSystemPrompt() {
  return [
    "You are the Hive Mind meeting analyst. The user pastes a meeting transcript or notes.",
    "Return one JSON object only. No markdown, no prose outside JSON.",
    "",
    "TOP-LEVEL KEYS (exactly):",
    '- "action_items": array of objects.',
    '- "insights": array of strings.',
    '- "points_of_debate": array of strings.',
    '- "key_topics_summary": array of strings.',
    "",
    "ACTION ITEMS — columns (map to JSON keys exactly):",
    '- Urgency (0–9, 9 = highest) → key "urgency" (integer).',
    '- Task → key "task" (string).',
    '- Owner → key "owner" (string).',
    '- Due / Next Step → key "due_next_step" (string).',
    '- INTERNAL ONLY (stripped before UI): key "urgency_justification" (string, one short paragraph).',
    "For EVERY action item you MUST output urgency_justification BEFORE you finalize urgency.",
    "In urgency_justification, briefly state how each of these four factors applies (even if \"low\" or \"none\"):",
    "(1) Time sensitivity — real deadline, near-term milestone, or timing pressure?",
    "(2) External exposure — client, partner, public deliverable, investor, regulator, or outside-facing commitment?",
    "(3) Dependency chain — blocking other work, decisions, or people?",
    "(4) Strategic weight — central to launch, revenue, or a stated priority?",
    "Then choose urgency using that reasoning. This field must never appear in user-facing output; the server removes it.",
    "",
    "URGENCY SCORING — use structured judgment, not vibes:",
    "- 9 = true fire: immediate risk, deadline collision, serious blocker, or equivalent.",
    "- 7–8 = high priority: clear time sensitivity and/or meaningful downstream or external impact.",
    "- 5–6 = important but not immediately pressing.",
    "- 3–4 = useful; can wait briefly.",
    "- 0–2 = optional, exploratory, low-consequence, or background.",
    "",
    "ANTI-INFLATION (mandatory):",
    "- Do NOT assign high urgency just because a topic sounds important.",
    "- Do NOT assign high urgency without real timing pressure, external consequence, or blocking impact.",
    "- Internal ideas, nice-to-haves, and generic follow-ups usually score lower unless the transcript clearly signals urgency.",
    "- If the tone is intense but no concrete urgency driver exists, keep the score moderate.",
    "",
    "ACTION ITEMS vs DISCUSSION:",
    "- Include a row only if it is a real next step, deliverable, follow-up, decision-dependent task, or concrete work item.",
    "- Do not turn every topic into a task. Prefer fewer, non-overlapping, high-quality rows.",
    "",
    "TASK QUALITY:",
    "- Imperative, start with a strong verb, specific enough to execute.",
    "- Avoid vague verbs like \"discuss\", \"handle\", \"look into\" unless the transcript offers no clearer action; then phrase the smallest concrete step.",
    "",
    "OWNER:",
    "- Use a named person only if assigned or clearly stated.",
    "- If ownership is implied but not explicit, use the most likely owner ONLY if the transcript strongly supports it; otherwise \"TBD\".",
    "- Do not invent owners.",
    "",
    "DUE / NEXT STEP (due_next_step):",
    "- Prefer an ISO date (YYYY-MM-DD) when you can justify it from the transcript and the reference date hints.",
    "- You may combine date + context, e.g. \"2025-09-23 — before next sales sync\".",
    "- If no real due date, use a meaningful next-step phrase, e.g. \"None noted — follow up with team\" or \"None noted — awaiting owner assignment\".",
    "- Follow the reference-date rules supplied in the user message when they apply (today, tomorrow, this week, next week, this month, ASAP).",
    "",
    "OTHER SECTIONS:",
    "- insights: non-obvious takeaways (not duplicated as tasks).",
    "- points_of_debate: disagreements, unresolved questions, tension.",
    "- key_topics_summary: short theme labels.",
    "- If insights, points_of_debate, or key_topics_summary would be empty, use a single-element array: [\"None noted\"].",
    "- If there are no action items, return exactly one action row: urgency 0, urgency_justification \"No actionable items.\", task \"None noted\", owner \"TBD\", due_next_step \"None noted\".",
  ].join("\n");
}

function clampUrgency(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(9, Math.round(x)));
}

function normalizeStringArray(arr, fallbackSingle) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return [fallbackSingle];
  }
  const out = arr.map((s) => String(s).trim()).filter(Boolean);
  if (out.length === 0) return [fallbackSingle];
  return out;
}

/**
 * Normalize model output into { action_items, insights, points_of_debate, key_topics_summary }.
 */
function parseHiveMindPayload(raw) {
  let data = raw;
  if (typeof data === "string") {
    data = JSON.parse(data);
  }

  const NONE = "None noted";
  const TBD = "TBD";

  let action_items = [];
  if (Array.isArray(data.action_items)) {
    action_items = data.action_items.map((row) => {
      const o = row && typeof row === "object" ? row : {};
      // urgency_justification is for model reasoning only — never expose to the client
      return {
        urgency: clampUrgency(o.urgency),
        task: String(o.task ?? "").trim() || NONE,
        owner: String(o.owner ?? "").trim() || TBD,
        due_next_step: String(o.due_next_step ?? "").trim() || NONE,
      };
    });
  }

  const placeholderRow = {
    urgency: 0,
    task: NONE,
    owner: TBD,
    due_next_step: NONE,
  };
  if (action_items.length === 0) {
    action_items = [placeholderRow];
  }

  return {
    action_items,
    insights: normalizeStringArray(data.insights, NONE),
    points_of_debate: normalizeStringArray(data.points_of_debate, NONE),
    key_topics_summary: normalizeStringArray(data.key_topics_summary, NONE),
  };
}

/**
 * POST /analyze
 * Body: { "transcript": "string" }
 * Response: { action_items, insights, points_of_debate, key_topics_summary }
 */
app.post("/analyze", async (req, res) => {
  const transcript = req.body?.transcript;

  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return res.status(400).json({ error: "Missing or invalid 'transcript' in JSON body." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "OPENAI_API_KEY is not set. Create a .env file in the project root with OPENAI_API_KEY=your_key.",
    });
  }

  const ref = referenceDateUtc();
  const dateHints = buildDateHints(ref);

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: [
              `Meeting / "today" reference date (UTC calendar date): ${ref}`,
              "",
              "Precomputed UTC date hints (use when a phrase matches; if the transcript specifies a different date, follow the transcript):",
              dateHints,
              "",
              "Relative phrase → due_next_step mapping when not overridden by the transcript:",
              `- "today" → use ${ref}`,
              `- "tomorrow" → use ${addDaysUtc(ref, 1)}`,
              `- "this week" (end of week anchor) → prefer ${isoWeekFridayUtc(ref)} unless the transcript names another day`,
              `- "next week" or vague "next meeting" → prefer ${addDaysUtc(ref, 7)} unless a clearer date is stated`,
              `- "this month" (end of month) → ${lastDayOfMonthUtc(ref)}`,
              `- "ASAP" → ${nextBusinessDayUtc(ref)} (next business day after the reference date)`,
              "",
              "Analyze the following meeting transcript or notes. Respond with JSON only.",
              "",
              transcript.trim(),
            ].join("\n"),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    const rawText = await response.text();
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      return res.status(502).json({
        error: "Unexpected response from OpenAI (not JSON). Check your API key and model name.",
      });
    }

    if (!response.ok) {
      const msg =
        payload?.error?.message ||
        payload?.error ||
        `OpenAI request failed with status ${response.status}`;
      return res.status(502).json({ error: String(msg) });
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return res.status(502).json({ error: "OpenAI returned no message content." });
    }

    let parsed;
    try {
      parsed = parseHiveMindPayload(content);
    } catch (e) {
      return res.status(502).json({
        error: "Could not parse model JSON. Try again or shorten the transcript.",
        details: String(e?.message || e),
      });
    }

    return res.json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error while calling the AI. Check the terminal for details.",
    });
  }
});

/** One line of text safe inside a GFM pipe table cell. */
function escapeMarkdownTableCell(value) {
  return String(value ?? "")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\|/g, "\\|");
}

/** One bullet line (no leading hyphen in content to avoid breaking list). */
function bulletLine(text) {
  const t = String(text ?? "").trim().replace(/\r\n|\r|\n/g, " ");
  if (!t) return "- ";
  return "- " + t;
}

/**
 * Build markdown export for Hive Mind analysis JSON (same shape as GET from /analyze).
 * @param {object} data
 * @returns {string}
 */
function buildHiveMindMarkdown(data) {
  const lines = [];
  lines.push("## Action Items");
  lines.push("");
  lines.push("| Urgency | Task | Owner | Due / Next Step |");
  lines.push("| --- | --- | --- | --- |");
  const rows = Array.isArray(data.action_items) ? data.action_items : [];
  if (rows.length === 0) {
    lines.push(
      "| " +
        ["", "None noted", "TBD", "None noted"].map(escapeMarkdownTableCell).join(" | ") +
        " |",
    );
  } else {
    rows.forEach(function (row) {
      const r = row && typeof row === "object" ? row : {};
      const cells = [r.urgency, r.task, r.owner, r.due_next_step].map(escapeMarkdownTableCell);
      lines.push("| " + cells.join(" | ") + " |");
    });
  }
  lines.push("");
  lines.push("## Insights");
  lines.push("");
  const insights = Array.isArray(data.insights) ? data.insights : [];
  if (insights.length === 0) {
    lines.push("- None noted");
  } else {
    insights.forEach(function (item) {
      lines.push(bulletLine(item));
    });
  }
  lines.push("");
  lines.push("## Points of Debate");
  lines.push("");
  const debate = Array.isArray(data.points_of_debate) ? data.points_of_debate : [];
  if (debate.length === 0) {
    lines.push("- None noted");
  } else {
    debate.forEach(function (item) {
      lines.push(bulletLine(item));
    });
  }
  lines.push("");
  lines.push("## Key Topics Summary");
  lines.push("");
  const topics = Array.isArray(data.key_topics_summary) ? data.key_topics_summary : [];
  if (topics.length === 0) {
    lines.push("- None noted");
  } else {
    topics.forEach(function (item) {
      lines.push(bulletLine(item));
    });
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * POST /export-markdown
 * Body: same JSON shape as /analyze response { action_items, insights, points_of_debate, key_topics_summary }
 * Response: { markdown: string }
 */
app.post("/export-markdown", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      error: 'Expected a JSON object with analysis fields (e.g. from "Analyze meeting").',
    });
  }
  try {
    const markdown = buildHiveMindMarkdown(body);
    return res.json({ markdown });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not build markdown export." });
  }
});

app.listen(PORT, () => {
  console.log(`Hive Mind server running at http://localhost:${PORT}`);
  console.log("Using model:", MODEL);
});
