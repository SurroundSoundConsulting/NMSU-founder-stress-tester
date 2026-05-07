/**
 * Hive Mind — backend (Express)
 *
 * Loads secrets from .env (see dotenv) and calls the OpenAI Chat Completions API.
 * Required env: OPENAI_API_KEY
 * Optional Google Sheets (same .env): GOOGLE_SHEET_ID or GOOGLE_SHEETS_SPREADSHEET_ID,
 *   GOOGLE_SHEETS_TAB_NAME or GOOGLE_SHEETS_TAB,
 *   GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_JSON — see lib/googleSheets.js
 * Week 4: FIREFLIES_API_KEY, POLL_LOOKBACK_MINUTES, BACKFILL_LOOKBACK_DAYS — see fireflies-polling/
 * Week 5: EXECUTION_DRIVE_FOLDER_ID, EXECUTION_CLASSIFY_MODEL, EXECUTION_MODEL, EXECUTION_DRY_RUN,
 *   EXECUTION_CONTEXT_DOC_MAX_CHARS_PER_FILE / _TOTAL / _MAX_FILES — see lib/executionWorkbench.js
 * Week 6: ENFORCER_* , ENFORCER_DRIVE_FOLDER_ID (optional; else EXECUTION_DRIVE_FOLDER_ID), LEARNINGS_* — see lib/enforcerWorkbench.js
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
const {
  isGoogleSheetsConfigured,
  appendActionItemsToSheet,
  logGoogleSheetsStartupHint,
  mapSheetsError,
} = require("./lib/googleSheets");
const { analyzeTranscriptToHiveMind, DEFAULT_MODEL } = require("./lib/hiveMind");
const { runFirefliesJob } = require("./fireflies-polling/run");
const { runExecutionWorkbenchOnce } = require("./lib/executionWorkbench");
const { runEnforcerWorkbenchOnce, runEnforcerFeedbackOnce } = require("./lib/enforcerWorkbench");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || DEFAULT_MODEL;

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/google-sheets/status", (req, res) => {
  res.json({ configured: isGoogleSheetsConfigured() });
});

/**
 * POST /api/google-sheets/action-items
 * Body: { "actionItems": [ { urgency, task, owner, dueOrNextStep }, ... ] }
 */
app.post("/api/google-sheets/action-items", async (req, res) => {
  const items = req.body?.actionItems;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "Missing or invalid 'actionItems' array in JSON body." });
  }

  if (!isGoogleSheetsConfigured()) {
    return res.status(503).json({
      error: "Google Sheets is not configured on this server.",
      code: "SHEETS_NOT_CONFIGURED",
    });
  }

  try {
    const result = await appendActionItemsToSheet(items);
    return res.json(result);
  } catch (err) {
    console.error("Google Sheets append error:", err?.message || err);
    const mapped = mapSheetsError(err);
    return res.status(mapped.status).json(mapped.body);
  }
});

/**
 * POST /api/fireflies/run  Body: { "mode": "poll" | "backfill" } (optional, default poll)
 * Runs one Fireflies job in-process (can take a long time; use for local testing).
 */
app.post("/api/fireflies/run", async (req, res) => {
  const mode = req.body?.mode === "backfill" ? "backfill" : "poll";
  try {
    const out = await runFirefliesJob(mode);
    return res.json(out);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: String(err?.message || err),
    });
  }
});

/**
 * POST /api/execution/run — Week 5 task execution workbench (classify + optional LLM + Google Doc).
 */
app.post("/api/execution/run", async (req, res) => {
  if (!isGoogleSheetsConfigured()) {
    return res.status(503).json({
      error: "Google Sheets is not configured on this server.",
      code: "SHEETS_NOT_CONFIGURED",
    });
  }
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not set.",
      code: "NO_OPENAI",
    });
  }
  try {
    const out = await runExecutionWorkbenchOnce();
    return res.json(out);
  } catch (err) {
    console.error(err);
    const code = err?.code;
    if (code === "NO_OPENAI") {
      return res.status(500).json({ error: err.message, code });
    }
    return res.status(500).json({
      error: String(err?.message || err),
      code: code || "EXECUTION_ERROR",
    });
  }
});

/**
 * POST /api/enforcer/run — Week 6 QA + revision loop (optional ingest_feedback).
 */
app.post("/api/enforcer/run", async (req, res) => {
  if (!isGoogleSheetsConfigured()) {
    return res.status(503).json({
      error: "Google Sheets is not configured on this server.",
      code: "SHEETS_NOT_CONFIGURED",
    });
  }
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not set.",
      code: "NO_OPENAI",
    });
  }
  try {
    const body = req.body || {};
    const out = await runEnforcerWorkbenchOnce({
      taskId: body.task_id || body.taskId,
      force: !!body.force,
      ingest_feedback: !!body.ingest_feedback,
    });
    return res.json(out);
  } catch (err) {
    console.error(err);
    const code = err?.code;
    if (code === "NO_OPENAI") {
      return res.status(500).json({ error: err.message, code });
    }
    return res.status(500).json({
      error: String(err?.message || err),
      code: code || "ENFORCER_ERROR",
    });
  }
});

/**
 * POST /api/enforcer/feedback — ingest markers, optional revision + rescore.
 */
app.post("/api/enforcer/feedback", async (req, res) => {
  if (!isGoogleSheetsConfigured()) {
    return res.status(503).json({
      error: "Google Sheets is not configured on this server.",
      code: "SHEETS_NOT_CONFIGURED",
    });
  }
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not set.",
      code: "NO_OPENAI",
    });
  }
  const body = req.body || {};
  const taskId = body.task_id || body.taskId;
  if (!taskId) {
    return res.status(400).json({ error: "Missing task_id in JSON body.", code: "BAD_INPUT" });
  }
  try {
    const out = await runEnforcerFeedbackOnce({
      taskId: String(taskId),
      rescore: body.rescore === false ? false : body.rescore === true ? true : undefined,
      revision: body.revision === false ? false : body.revision === true ? true : undefined,
    });
    return res.json(out);
  } catch (err) {
    console.error(err);
    const code = err?.code;
    if (code === "NOT_FOUND" || code === "BAD_INPUT") {
      return res.status(code === "NOT_FOUND" ? 404 : 400).json({ error: err.message, code });
    }
    return res.status(500).json({
      error: String(err?.message || err),
      code: code || "ENFORCER_FEEDBACK_ERROR",
    });
  }
});

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

  try {
    const parsed = await analyzeTranscriptToHiveMind(transcript, { apiKey, model: MODEL });
    // Web UI: strip internal-only operational fields for compact JSON (optional: keep for debugging)
    const safeItems = (parsed.actionItems || []).map(function (a) {
      return {
        urgency: a.urgency,
        task: a.task,
        owner: a.owner,
        dueOrNextStep: a.dueOrNextStep,
        status: a.status,
        blockers: a.blockers,
        dependencies: a.dependencies,
        due_date: a.due_date,
        next_step: a.next_step,
        okr_link: a.okr_link,
        risk_flag: a.risk_flag,
      };
    });
    return res.json({
      actionItems: safeItems,
      insights: parsed.insights,
      pointsOfDebate: parsed.pointsOfDebate,
      keyTopicsSummary: parsed.keyTopicsSummary,
    });
  } catch (err) {
    console.error(err);
    const code = err && err.code;
    if (code === "OPENAI_MISSING") {
      return res.status(500).json({ error: err.message });
    }
    if (code === "OPENAI_BAD_RESPONSE" || code === "OPENAI_NO_CONTENT") {
      return res.status(502).json({
        error: err.message,
      });
    }
    if (code === "OPENAI_ERROR" || code === "HIVE_MIND_PARSE") {
      return res.status(502).json({ error: err.message, details: err.details });
    }
    if (err instanceof SyntaxError) {
      return res.status(502).json({
        error: "Could not parse model JSON. Try again or shorten the text.",
        details: err.message,
      });
    }
    return res.status(500).json({
      error: "Server error while calling the AI. Check the terminal for details.",
    });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Using model:", MODEL);
  logGoogleSheetsStartupHint();
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other server (e.g. run: lsof -i :${PORT} then kill <PID>), or start with a different port: PORT=3001 npm start`,
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
