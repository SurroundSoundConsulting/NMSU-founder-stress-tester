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

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

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
    '- "dueOrNextStep": string — the "Due / Next Step" column: either a concrete date, a date plus context, or a next-step line when no real date exists.',
    '- "urgencyJustification": string — REQUIRED for your reasoning only: 1–3 short sentences. For EACH item, FIRST briefly note evidence for the four factors (time sensitivity, external exposure, dependency chain, strategic weight), THEN state why the final urgency number matches the scale below. This field is stripped before display; it exists to force rigorous scoring.',
    "",
    "What counts as an action item:",
    "- Include only real next steps: deliverables, follow-ups, commitments, decision-dependent tasks, or concrete work items assigned or clearly implied.",
    "- Do NOT inflate the list: skip pure discussion, background context, opinions, or topics with no actionable outcome.",
    "- Do NOT turn every mentioned theme into a task.",
    "",
    "Task writing (Due / Next Step column is separate; \"task\" is the action itself):",
    "- Imperative mood; start with a strong verb (e.g. Send, Draft, Schedule, Confirm, Ship).",
    "- Specific enough that someone could execute without re-asking what was meant.",
    '- Avoid vague verbs like "discuss", "handle", "look into" unless the transcript literally gives no clearer action — if so, still make the task as concrete as the text allows.',
    "",
    "dueOrNextStep rules:",
    "- When you can resolve a relative time phrase, use ISO date YYYY-MM-DD, optionally followed by brief context after an em dash, e.g. \"2026-09-23 — before next sales sync\".",
    "- When a real calendar due date is not available, do NOT invent a fake date. Use a meaningful next-step description, e.g. \"None noted — follow up with team\" or \"None noted — awaiting owner assignment\".",
    "- Prefer one clear line; combine date + context when both apply.",
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
    "- Internal ideas, general follow-ups, and polish items should usually score low–mid unless the transcript clearly signals urgency drivers.",
    "- If the meeting feels intense but there is no concrete urgency driver, keep scores moderate.",
    "",
    "After internal reasoning, set \"urgency\" to match urgencyJustification; they must be consistent.",
  ].join("\n");
}

function clampUrgency(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(9, Math.round(x)));
}

/**
 * Normalize model output into our API shape.
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
    // urgencyJustification is for model reasoning only — never sent to the client
    return {
      urgency: clampUrgency(row.urgency),
      task: task || "(unspecified task)",
      owner,
      dueOrNextStep,
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
 * POST /hive-mind
 * Body: { "transcript": "string" }
 */
app.post("/hive-mind", async (req, res) => {
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

  const referenceDate = formatReferenceDateForPrompt();

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
          { role: "system", content: buildHiveMindSystemPrompt() },
          {
            role: "user",
            content: [
              `Reference date for resolving relative deadlines: ${referenceDate}.`,
              "Analyze the following meeting transcript or notes and respond with JSON only:\n\n",
              transcript.trim(),
            ].join(""),
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
        error: "Could not parse model JSON. Try again or shorten the text.",
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Using model:", MODEL);
});
