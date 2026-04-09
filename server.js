/**
 * Founder Stress Tester — backend (Express)
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

// Parse JSON bodies (for POST /stress-test)
app.use(express.json());

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, "public")));

/** Allowed values for POST body { mode: "..." } */
const STRESS_MODES = new Set(["brutal", "balanced", "supportive"]);

/**
 * How hard to "stress" the founder's idea in the system prompt.
 * @param {"brutal"|"balanced"|"supportive"} mode
 */
function getToneInstructions(mode) {
  if (mode === "brutal") {
    return [
      "Tone: BRUTAL.",
      "Be blunt and skeptical. Surface the worst-case failures, harsh truths, and reasons customers or investors might say no.",
      "Do not soften criticism or add false reassurance. Stay constructive enough to be useful, but prioritize cold realism.",
    ].join(" ");
  }
  if (mode === "supportive") {
    return [
      "Tone: SUPPORTIVE.",
      "Be encouraging and constructive. Acknowledge real strengths where they exist.",
      "Frame risks as challenges to navigate, not personal attacks. Stay honest—do not invent hype or hide real risks.",
    ].join(" ");
  }
  // balanced (default)
  return [
    "Tone: BALANCED.",
    "Be fair and practical: mix strengths and weaknesses without leaning overly negative or positive.",
  ].join(" ");
}

/**
 * Ask the model to return ONLY JSON matching our UI shape.
 * response_format: json_object helps the model stay valid JSON.
 * @param {"brutal"|"balanced"|"supportive"} mode
 */
function buildSystemPrompt(mode) {
  return [
    "You are a practical advisor helping founders stress-test startup ideas.",
    getToneInstructions(mode),
    "Reply with a single JSON object (no markdown, no extra text) with exactly these keys:",
    '- "coreAssumptions": array of strings (3–6 short bullets the idea depends on)',
    '- "majorRisks": array of strings (3–6 concrete risks: market, execution, competition, regulation, etc.)',
    '- "fastestValidationTest": one string describing the cheapest, fastest experiment to test the riskiest assumption',
    "Be specific to the idea; avoid generic fluff.",
  ].join(" ");
}

/**
 * Normalize whatever the model returned into { coreAssumptions, majorRisks, fastestValidationTest }.
 */
function parseStressTestPayload(raw) {
  let data = raw;
  if (typeof data === "string") {
    data = JSON.parse(data);
  }
  const coreAssumptions = Array.isArray(data.coreAssumptions)
    ? data.coreAssumptions.map(String)
    : [];
  const majorRisks = Array.isArray(data.majorRisks) ? data.majorRisks.map(String) : [];
  const fastestValidationTest =
    typeof data.fastestValidationTest === "string" ? data.fastestValidationTest : "";
  return { coreAssumptions, majorRisks, fastestValidationTest };
}

/**
 * POST /stress-test
 * Body: { "idea": "string", "mode"?: "brutal" | "balanced" | "supportive" }
 * Response: { coreAssumptions: string[], majorRisks: string[], fastestValidationTest: string }
 */
app.post("/stress-test", async (req, res) => {
  const idea = req.body?.idea;

  if (!idea || typeof idea !== "string" || !idea.trim()) {
    return res.status(400).json({ error: "Missing or invalid 'idea' in JSON body." });
  }

  // Stress test mode (optional; default balanced)
  let mode = "balanced";
  if (req.body?.mode !== undefined && req.body?.mode !== null && String(req.body.mode).trim() !== "") {
    const m = String(req.body.mode).toLowerCase();
    if (!STRESS_MODES.has(m)) {
      return res.status(400).json({
        error: 'Invalid "mode". Use "brutal", "balanced", or "supportive".',
      });
    }
    mode = m;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "OPENAI_API_KEY is not set. Create a .env file in the project root with OPENAI_API_KEY=your_key.",
    });
  }

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
          { role: "system", content: buildSystemPrompt(mode) },
          {
            role: "user",
            content: `Stress test mode: ${mode}. Analyze this startup idea and respond with JSON only:\n\n${idea.trim()}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.6,
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
      parsed = parseStressTestPayload(content);
    } catch (e) {
      return res.status(502).json({
        error: "Could not parse model JSON. Try again or simplify your idea.",
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
