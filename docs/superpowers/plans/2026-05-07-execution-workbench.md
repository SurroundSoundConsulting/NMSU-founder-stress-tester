# Execution Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second-stage execution workbench on top of the existing Meet → Hive Mind → Master Action Board pipeline: classify each board row for LLM-executability, surface missing context, generate and run an execution prompt, store the output in a per-task Google Doc, and write the link back to the sheet.

**Architecture:** All new code lands in `apps-script-meet-sync/Code.gs`. The workbench reuses the existing `logSyncActivity`, `fetchOKRContext`, OpenAI endpoint-routing pattern (gpt-5 Responses API vs gpt-4o Chat Completions), and 16-column ingest path. Ten new columns (Q–Z) append to **Master Action Board**. A single entrypoint `runExecutionWorkbench()` is wired to a custom menu and an hourly time trigger; both share a `LockService` document lock. Per-task Google Docs are created in a dedicated Drive folder.

**Tech Stack:** Google Apps Script (V8), `SpreadsheetApp`, `DocumentApp`, `DriveApp`, `LockService`, `ScriptApp`, `UrlFetchApp` against OpenAI Responses API (`gpt-5`).

**Source spec:** [`docs/superpowers/specs/2026-05-07-execution-workbench-design.md`](../specs/2026-05-07-execution-workbench-design.md). Read it before starting.

**Verification model:** This codebase has no unit-test harness (the existing `Code.gs` has no tests either). Each task ends with a **Manual verification** step and a commit. Verification steps are explicit and disciplined — do not skip them. Run them in the Apps Script editor against a real (test) spreadsheet.

**User's editor workflow:** The user runs a copy of `Code.gs` named `Code_staging.gs` inside the Apps Script editor while the production `Code.gs` keeps running. After each task, paste the updated `apps-script-meet-sync/Code.gs` contents into `Code_staging.gs` in the Apps Script editor, save, then run from there. Once the full plan is verified, the user will promote `Code_staging.gs` → `Code.gs` in the editor as a separate step. The git source-of-truth remains `apps-script-meet-sync/Code.gs`.

**Pre-provisioned by the user (do not change):** `EXECUTION_OUTPUT_FOLDER_ID = '1BKWfhq4b22K1ZT9jsfTo-YvEPhrW5Qsz'` — Drive folder for execution output Docs.

---

## File Structure

Single file modified throughout:

- **Modify:** `apps-script-meet-sync/Code.gs` (~1059 lines today; this plan adds ~500 lines, bringing it to ~1500). Apps Script multi-file projects complicate the deploy story for this one-file repo, so we stay in `Code.gs`.

No new files are created.

---

## Task 1: Add CONFIG entries and `EXECUTION_COLS` constants

**Files:**
- Modify: `apps-script-meet-sync/Code.gs:4-40` (CONFIG block) and append a new constant block immediately after `MASTER_COLS`.

- [ ] **Step 1: Add two CONFIG keys**

In `apps-script-meet-sync/Code.gs`, edit the `CONFIG` object. After the existing `OKR_TAB_NAME` line and before the closing `};`, add a comma to that line and append:

```js
  // Drive folder ID where per-task execution Google Docs are created.
  // Pre-provisioned by hand. The script's runner must have edit access to this folder.
  EXECUTION_OUTPUT_FOLDER_ID: '1BKWfhq4b22K1ZT9jsfTo-YvEPhrW5Qsz',

  // Max candidate rows the execution workbench processes per pass.
  // Apps Script time triggers die at 6 min; with 2 gpt-5 calls/row at ~10–30s each,
  // 10 rows is the safe ceiling. Excess candidates wait for the next pass.
  EXECUTION_BATCH_LIMIT: 10
```

The final `CONFIG` block should now end:

```js
  OKR_TAB_NAME: 'OKR Registry',

  EXECUTION_OUTPUT_FOLDER_ID: '1BKWfhq4b22K1ZT9jsfTo-YvEPhrW5Qsz',
  EXECUTION_BATCH_LIMIT: 10
};
```

- [ ] **Step 2: Add `EXECUTION_COLS` constant block**

Immediately after the closing `};` of the `MASTER_COLS` block (`apps-script-meet-sync/Code.gs:63`), append a blank line and:

```js
// ============================================================
// EXECUTION_COLS — Column indexes for the 10 workbench columns
// appended to Master Action Board after MASTER_COLS (Q-Z).
// Existing 16-col reads are unaffected; workbench reads use sheet.getLastColumn().
// ============================================================
var EXECUTION_COLS = {
  EXECUTION_NEEDED:        16,  // Q
  EXECUTION_CONTEXT:       17,  // R — user-edited
  EXECUTION_TYPE:          18,  // S
  MISSING_INFO:            19,  // T
  EXECUTION_STATUS:        20,  // U
  EXECUTION_STATUS_REASON: 21,  // V
  LATEST_EXECUTION_ID:     22,  // W
  EXECUTION_OUTPUT_LINK:   23,  // X
  LAST_EXECUTED_AT:        24,  // Y
  FORCE_RERUN:             25   // Z — user-edited
};

var EXECUTION_HEADERS = [
  'Execution Needed',
  'Execution Context',
  'Execution Type',
  'Missing Info',
  'Execution Status',
  'Execution Status Reason',
  'Latest Execution ID',
  'Execution Output Link',
  'Last Executed At',
  'Force Re-run'
];

// Exact strings used in the Execution Status column. Filters and
// downstream tools depend on these — do not vary the casing or wording.
var EXEC_STATUS = {
  MISSING_INFO:        'Missing Info',
  READY_FOR_EXECUTION: 'Ready for Execution',
  NOT_AUTOMATABLE:     'Not Automatable',
  READY_FOR_REVIEW:    'Ready for Review'
};
```

- [ ] **Step 3: Manual verification — file still parses**

Open the Apps Script editor for the staging project. Paste the updated `Code.gs` into `Code_staging.gs`. Save (Ctrl/Cmd+S). The editor should accept the save with no red squigglies and no "Syntax error" toast.

In the editor's Run dropdown, pick `diagnoseConfig` and Run it. Confirm it still completes successfully and the existing log lines appear in the Sync Log tab. (No new log lines yet — we haven't wired anything that uses the new keys.)

- [ ] **Step 4: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): add CONFIG keys and EXECUTION_COLS constants"
```

---

## Task 2: `ensureExecutionColumns_()` and entrypoint stub

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — append a new section after the existing `ensureMasterHeaders` function (around line 713).

- [ ] **Step 1: Append the schema helper and entrypoint stub**

Append this block at the very end of `apps-script-meet-sync/Code.gs` (after `diagnoseConfig`):

```js
// ============================================================
// EXECUTION WORKBENCH — Stage 3: Per-task LLM execution
// Spec: docs/superpowers/specs/2026-05-07-execution-workbench-design.md
// ============================================================

/**
 * Idempotent. Ensures the 10 workbench headers exist in columns Q–Z of
 * Master Action Board. Adds any that are missing without touching Q–Z values
 * in existing data rows. Logs which columns (if any) were added.
 */
function ensureExecutionColumns_(sheet) {
  var lastCol = sheet.getLastColumn();
  var existingHeaders = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || ''); })
    : [];

  var added = [];
  EXECUTION_HEADERS.forEach(function(header, i) {
    var targetCol = 17 + i; // 1-based: Q=17, R=18, ..., Z=26
    var current   = existingHeaders[targetCol - 1] || '';
    if (current !== header) {
      sheet.getRange(1, targetCol).setValue(header);
      added.push(header);
    }
  });

  if (added.length > 0) {
    logSyncActivity('exec_schema', '', '', 'Added ' + added.length + ' header(s): ' + added.join(', '));
  } else {
    logSyncActivity('exec_schema', '', '', 'All 10 workbench headers already present (no-op).');
  }
}

/**
 * Entrypoint for both the menu item and the hourly time trigger.
 * For now: schema check only. Subsequent tasks add candidate selection,
 * classification, execution, and writeback.
 */
function runExecutionWorkbench() {
  logSyncActivity('exec_start', '', '', 'Workbench pass starting (batch limit ' + CONFIG.EXECUTION_BATCH_LIMIT + ').');

  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_MASTER);
  if (!sheet) throw new Error('Tab "' + CONFIG.TAB_MASTER + '" not found in spreadsheet');

  ensureExecutionColumns_(sheet);

  logSyncActivity('exec_done', '', '', 'Workbench pass complete (schema check only — no rows processed yet).');
}
```

- [ ] **Step 2: Manual verification — schema is added, then idempotent**

In the Apps Script editor, paste the updated `Code.gs` into `Code_staging.gs`, save, then in the Run dropdown pick `runExecutionWorkbench` and click Run.

Open the spreadsheet's **Master Action Board** tab. Verify:
- Cells Q1 through Z1 now show: `Execution Needed`, `Execution Context`, `Execution Type`, `Missing Info`, `Execution Status`, `Execution Status Reason`, `Latest Execution ID`, `Execution Output Link`, `Last Executed At`, `Force Re-run`.
- Existing rows below row 1 are untouched in columns A–P.

Open the **Sync Log** tab. The most recent entries should include:
- `exec_start` — "Workbench pass starting (batch limit 10)."
- `exec_schema` — "Added 10 header(s): ..."
- `exec_done` — "Workbench pass complete..."

Run `runExecutionWorkbench` a second time. Verify Sync Log now shows:
- `exec_schema` — "All 10 workbench headers already present (no-op)."

If any column is missing, mis-named, or duplicates appeared, fix before committing.

- [ ] **Step 3: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): ensureExecutionColumns_ and runExecutionWorkbench stub"
```

---

## Task 3: `findExecutionCandidates_()` — candidate selection

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — append after `ensureExecutionColumns_`.

- [ ] **Step 1: Append the candidate selector**

Add this function immediately after `ensureExecutionColumns_` and before `runExecutionWorkbench`:

```js
/**
 * Read Master Action Board and return up to EXECUTION_BATCH_LIMIT candidate
 * rows for this pass. A row is a candidate iff:
 *   - status (col D) != 'done' (case-insensitive, trimmed)
 *   - AND (Execution Output Link empty OR Force Re-run == 'Yes')
 *
 * Returns: array of { rowNum, values } objects.
 *   rowNum is 1-based sheet row (header is 1, data starts at 2).
 *   values is the full row array, length >= 26.
 */
function findExecutionCandidates_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var width = sheet.getLastColumn();
  var rows  = sheet.getRange(2, 1, lastRow - 1, width).getValues();

  var candidates = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var status     = String(r[MASTER_COLS.STATUS] || '').trim().toLowerCase();
    var outputLink = String(r[EXECUTION_COLS.EXECUTION_OUTPUT_LINK] || '').trim();
    var forceRerun = String(r[EXECUTION_COLS.FORCE_RERUN] || '').trim().toLowerCase();

    if (status === 'done') continue;
    if (outputLink && forceRerun !== 'yes') continue;

    candidates.push({ rowNum: i + 2, values: r });
    if (candidates.length >= CONFIG.EXECUTION_BATCH_LIMIT) break;
  }

  return candidates;
}
```

- [ ] **Step 2: Wire into the entrypoint**

Replace the body of `runExecutionWorkbench` with:

```js
function runExecutionWorkbench() {
  logSyncActivity('exec_start', '', '', 'Workbench pass starting (batch limit ' + CONFIG.EXECUTION_BATCH_LIMIT + ').');

  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_MASTER);
  if (!sheet) throw new Error('Tab "' + CONFIG.TAB_MASTER + '" not found in spreadsheet');

  ensureExecutionColumns_(sheet);

  var candidates = findExecutionCandidates_(sheet);
  var preview    = candidates.slice(0, 5).map(function(c) {
    return String(c.values[MASTER_COLS.TASK_ID] || '(no id)') + ' (row ' + c.rowNum + ')';
  }).join(', ');
  logSyncActivity('exec_candidates', '', '', candidates.length + ' candidate row(s); first 5: ' + (preview || '(none)'));

  logSyncActivity('exec_done', '', '', 'Workbench pass complete (candidate selection only — no LLM calls yet).');
}
```

- [ ] **Step 3: Manual verification — three test rows**

In the spreadsheet, set up three test rows on Master Action Board (or use existing rows that match these conditions):
- **Row A:** `status` = `done`, no Execution Output Link, no Force Re-run.
- **Row B:** `status` = `in_progress`, Execution Output Link = `https://docs.google.com/...` (any non-empty value), Force Re-run blank.
- **Row C:** `status` = `in_progress`, Execution Output Link blank, Force Re-run = `Yes`.
- **Row D (sanity):** `status` = `in_progress`, Execution Output Link blank, Force Re-run blank.

Run `runExecutionWorkbench`. Sync Log's `exec_candidates` line should report **2 candidates** (rows C and D), with their task IDs in the preview. Row A is filtered by status, row B by output-link-and-no-force.

Now set Row B's Force Re-run to `Yes` and run again. The candidate count should be **3** (B, C, D).

- [ ] **Step 4: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): findExecutionCandidates_ with batch cap"
```

---

## Task 4: `classifyTask_()` — LLM classification call

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — append after `findExecutionCandidates_`.

- [ ] **Step 1: Append the classifier function**

Append:

```js
/**
 * Build the classifier system prompt. Mirrors the rubric in the design spec §6.2.
 * The OKR list is appended last; everything else is fixed instruction text.
 */
function buildClassifierSystemPrompt_(okrContext) {
  return [
    'You are a task classifier for a founder execution workbench. Each input row is one action item from a Master Action Board fed by meeting transcripts. Your job is to decide whether an LLM should produce a deliverable for this row, what kind of deliverable, and what (if anything) is missing.',
    '',
    'Output JSON ONLY — no markdown fences, no commentary, no extra fields. Schema:',
    '{',
    '  "execution_needed": "Yes" | "No",',
    '  "is_executable": true | false,',
    '  "execution_type": string,           // short label: "draft email", "summary", "checklist", "doc outline", "spec", "agenda", etc. Empty string if execution_needed is No.',
    '  "missing_info": string,             // concrete missing facts (audience, success criteria, links, definitions). Empty string when nothing concrete is missing.',
    '  "generated_prompt": string,         // the exact prompt to send to a downstream execution LLM. Empty string if execution_needed is No or is_executable is false.',
    '  "should_execute_now": true | false  // see HARD RULE below',
    '}',
    '',
    'execution_needed = "No" when:',
    '- The task is a pure human commitment (relationship building, decisions only the owner can make, in-person work).',
    '- The next step is to talk to a person, attend a meeting, sign a document, or operate physical/credentialed systems.',
    '- The task is purely administrative scheduling that does not benefit from a written deliverable.',
    '- The task is already complete or trivially obvious (no LLM value-add).',
    '',
    'is_executable = false when:',
    '- An LLM cannot produce the deliverable even with perfect context: signing, calling, paying, attending, deploying, demoing in person, anything requiring credentials or human presence.',
    '',
    'missing_info should list CONCRETE GAPS, not vague "needs more detail":',
    '- Who is the audience? What is the desired tone? What is the success criterion? What URL / doc / metric is referenced? What constraints apply?',
    '- Empty string when the task already has enough context for an LLM to produce a useful first draft.',
    '',
    'generated_prompt rules:',
    '- Self-contained: assume the executor has only this prompt + the row\'s own context.',
    '- Specify the deliverable format explicitly (e.g. "Output a 3-paragraph email in plain text").',
    '- Include relevant constraints from the row: audience, tone, length, format.',
    '- Reference the OKR link if the task is OKR-aligned.',
    '- Do NOT include a JSON wrapper. Plain instruction prose.',
    '',
    'HARD RULE for should_execute_now:',
    '- should_execute_now = true if and only if execution_needed == "Yes" AND is_executable == true AND missing_info == "".',
    '- Otherwise should_execute_now = false.',
    '',
    'Respond with JSON only. No prose.',
    '',
    'OKR list for context (use okr_link from the row, do not invent):',
    okrContext || '(no OKR list available)'
  ].join('\n');
}

/**
 * Build the classifier user-message input. One row's data plus its
 * Execution Context (column R) — the place users add facts the transcript missed.
 */
function buildClassifierInput_(rowValues) {
  var v = rowValues;
  return [
    'task_id: '          + String(v[MASTER_COLS.TASK_ID]       || ''),
    'task: '             + String(v[MASTER_COLS.TASK]          || ''),
    'owner: '            + String(v[MASTER_COLS.OWNER]         || ''),
    'status: '           + String(v[MASTER_COLS.STATUS]        || ''),
    'urgency: '          + String(v[MASTER_COLS.URGENCY]       || ''),
    'due_date: '         + String(v[MASTER_COLS.DUE_DATE]      || ''),
    'next_step: '        + String(v[MASTER_COLS.NEXT_STEP]     || ''),
    'blockers: '         + String(v[MASTER_COLS.BLOCKERS]      || ''),
    'dependencies: '     + String(v[MASTER_COLS.DEPENDENCIES]  || ''),
    'okr_link: '         + String(v[MASTER_COLS.OKR_LINK]      || ''),
    'risk_flag: '        + String(v[MASTER_COLS.RISK_FLAG]     || ''),
    'meeting_title: '    + String(v[MASTER_COLS.MEETING_TITLE] || ''),
    'meeting_date: '     + String(v[MASTER_COLS.MEETING_DATE]  || ''),
    'execution_context: ' + String(v[EXECUTION_COLS.EXECUTION_CONTEXT] || '(none provided)')
  ].join('\n');
}

/**
 * Call OpenAI to classify one row. Returns the parsed JSON object on success,
 * or throws with a descriptive message. Logs prompt sizes and raw response head.
 *
 * Endpoint routing matches parseWithHiveMind: gpt-5+ uses /v1/responses,
 * gpt-4o and earlier use /v1/chat/completions.
 */
function classifyTask_(rowValues, okrContext) {
  var taskId       = String(rowValues[MASTER_COLS.TASK_ID] || '(no-id)');
  var systemPrompt = buildClassifierSystemPrompt_(okrContext);
  var userInput    = buildClassifierInput_(rowValues);

  logSyncActivity('exec_classify_prompt', taskId, '', 'system=' + systemPrompt.length + ' chars | user=' + userInput.length + ' chars');

  var isResponsesApi = !CONFIG.OPENAI_MODEL.startsWith('gpt-4');
  var endpoint, payload;
  if (isResponsesApi) {
    // NOTE: gpt-5 via the Responses API rejects `temperature` with HTTP 400
    // ("Unsupported parameter: 'temperature' is not supported with this model").
    // Do NOT add temperature here.
    endpoint = 'https://api.openai.com/v1/responses';
    payload = {
      model:        CONFIG.OPENAI_MODEL,
      instructions: systemPrompt,
      input:        userInput
    };
  } else {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    payload = {
      model:       CONFIG.OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userInput }
      ]
    };
  }

  var response = UrlFetchApp.fetch(endpoint, {
    method:          'post',
    contentType:     'application/json',
    headers:         { 'Authorization': 'Bearer ' + CONFIG.OPENAI_API_KEY },
    payload:         JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body   = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Classifier HTTP ' + status + ': ' + body.slice(0, 400));
  }

  var rawText = extractOpenAIText_(body, isResponsesApi);
  logSyncActivity('exec_classify_raw', taskId, '', 'first 800 chars: ' + rawText.slice(0, 800));

  var parsed;
  try {
    parsed = JSON.parse(stripCodeFences_(rawText));
  } catch (e) {
    throw new Error('Classifier returned non-JSON: ' + rawText.slice(0, 400));
  }

  // Coerce defensive defaults so downstream code can rely on shape.
  parsed.execution_needed   = String(parsed.execution_needed   || 'No');
  parsed.is_executable      = parsed.is_executable === true;
  parsed.execution_type     = String(parsed.execution_type     || '');
  parsed.missing_info       = String(parsed.missing_info       || '');
  parsed.generated_prompt   = String(parsed.generated_prompt   || '');
  parsed.should_execute_now = parsed.should_execute_now === true;

  logSyncActivity('exec_classify_parsed', taskId, '',
    'execution_needed=' + parsed.execution_needed +
    ' | is_executable=' + parsed.is_executable +
    ' | execution_type="' + parsed.execution_type + '"' +
    ' | missing_info=' + (parsed.missing_info ? parsed.missing_info.length + ' chars' : 'empty') +
    ' | generated_prompt=' + (parsed.generated_prompt ? parsed.generated_prompt.length + ' chars' : 'empty') +
    ' | should_execute_now=' + parsed.should_execute_now);

  return parsed;
}

/**
 * Extract the assistant text from an OpenAI response body.
 * Responses API: prefer body.output_text, fall back to body.output[0].content[0].text.
 * Chat Completions: body.choices[0].message.content.
 */
function extractOpenAIText_(rawJson, isResponsesApi) {
  var body = JSON.parse(rawJson);
  if (isResponsesApi) {
    if (body.output_text) return String(body.output_text);
    if (body.output && body.output.length) {
      var item = body.output[0];
      if (item.content && item.content.length && item.content[0].text) {
        return String(item.content[0].text);
      }
    }
    throw new Error('Responses API: no output_text or output[].content[].text in response');
  } else {
    if (body.choices && body.choices.length && body.choices[0].message && body.choices[0].message.content) {
      return String(body.choices[0].message.content);
    }
    throw new Error('Chat Completions: no choices[0].message.content in response');
  }
}

/**
 * Strip ```json ... ``` or ``` ... ``` code fences if the model added them
 * despite the JSON-only instruction.
 */
function stripCodeFences_(text) {
  return String(text)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}
```

- [ ] **Step 2: Wire classification into the entrypoint (no writeback yet)**

Replace the body of `runExecutionWorkbench` with:

```js
function runExecutionWorkbench() {
  logSyncActivity('exec_start', '', '', 'Workbench pass starting (batch limit ' + CONFIG.EXECUTION_BATCH_LIMIT + ').');

  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_MASTER);
  if (!sheet) throw new Error('Tab "' + CONFIG.TAB_MASTER + '" not found in spreadsheet');

  ensureExecutionColumns_(sheet);

  var candidates = findExecutionCandidates_(sheet);
  var preview    = candidates.slice(0, 5).map(function(c) {
    return String(c.values[MASTER_COLS.TASK_ID] || '(no id)') + ' (row ' + c.rowNum + ')';
  }).join(', ');
  logSyncActivity('exec_candidates', '', '', candidates.length + ' candidate row(s); first 5: ' + (preview || '(none)'));

  if (candidates.length === 0) {
    logSyncActivity('exec_done', '', '', 'Workbench pass complete — no candidates.');
    return;
  }

  var okrContext = fetchOKRContext();

  var classified = 0;
  var errors     = 0;
  candidates.forEach(function(c) {
    var taskId = String(c.values[MASTER_COLS.TASK_ID] || '(no-id)');
    try {
      c.classification = classifyTask_(c.values, okrContext);
      classified++;
    } catch (e) {
      errors++;
      logSyncActivity('exec_error', taskId, '', 'classify stage: ' + e.message.slice(0, 300));
    }
  });

  logSyncActivity('exec_done', '', '',
    'Workbench pass complete — candidates=' + candidates.length +
    ' | classified=' + classified +
    ' | errors=' + errors +
    ' (no writeback yet — Task 5 adds it).');
}
```

- [ ] **Step 3: Manual verification — classifier returns parseable JSON for one row**

In the spreadsheet, ensure at least one Master Action Board row is a candidate (status not done, no Execution Output Link). Pick a row with a moderately specific task — e.g. "Draft kickoff email to Acme team summarizing onboarding plan". Leave Execution Context blank for this first run.

Run `runExecutionWorkbench`. Open the Sync Log. Verify:
- `exec_candidates` reports ≥ 1.
- For your row's task ID, you see `exec_classify_prompt`, `exec_classify_raw` (with model output text starting), and `exec_classify_parsed` (with the 6 fields summarized).
- No `exec_error` for that row.

Inspect `exec_classify_raw` carefully — it should be valid JSON (no markdown fences, no preamble). If the model returned fenced output, `stripCodeFences_` should have handled it for `parsed`, but the raw is still useful for QA.

Pick a clearly-not-LLM-executable row (e.g. "Call Bob to confirm pricing") and re-run. Verify `exec_classify_parsed` shows `is_executable=false` and `execution_needed` likely `No`.

- [ ] **Step 4: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): classifyTask_ with gpt-5 Responses API"
```

---

## Task 5: Classification writeback to columns Q, S, T, U, V

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — append a writeback helper, then update `runExecutionWorkbench`.

- [ ] **Step 1: Append the status-mapping and writeback helpers**

Append after `stripCodeFences_`:

```js
/**
 * Map a classification result to (status, statusReason) per spec §5.1.
 * - Missing Info wins over Not Automatable when both could apply.
 * - Distinguishes the two Not Automatable reasons exactly.
 */
function classificationToStatus_(c) {
  if (c.execution_needed === 'No') {
    return { status: EXEC_STATUS.NOT_AUTOMATABLE, reason: 'Automation not selected by model' };
  }
  if (c.is_executable === false) {
    return { status: EXEC_STATUS.NOT_AUTOMATABLE, reason: 'Task not suitable for an LLM' };
  }
  if (c.missing_info && c.missing_info.length > 0) {
    return { status: EXEC_STATUS.MISSING_INFO, reason: 'Classifier reported gaps; see Missing Info column' };
  }
  if (!c.generated_prompt) {
    return { status: EXEC_STATUS.MISSING_INFO, reason: 'Classifier did not produce a generated_prompt' };
  }
  return { status: EXEC_STATUS.READY_FOR_EXECUTION, reason: '' };
}

/**
 * Write the 5 classification columns to a single row.
 * Columns Q, S, T, U, V. Leaves R (user-edited Execution Context) and
 * W/X/Y/Z (executor + user) untouched.
 */
function writeClassificationToRow_(sheet, rowNum, c, statusInfo) {
  // Q (17): Execution Needed
  sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_NEEDED + 1).setValue(c.execution_needed);
  // S (19): Execution Type
  sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_TYPE + 1).setValue(c.execution_type);
  // T (20): Missing Info
  sheet.getRange(rowNum, EXECUTION_COLS.MISSING_INFO + 1).setValue(c.missing_info);
  // U (21): Execution Status
  sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS + 1).setValue(statusInfo.status);
  // V (22): Execution Status Reason
  sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS_REASON + 1).setValue(statusInfo.reason);

  logSyncActivity('exec_writeback', String(c.__taskId || ''), '',
    'row ' + rowNum +
    ' | status=' + statusInfo.status +
    ' | reason=' + (statusInfo.reason || '(empty)') +
    ' | execution_type=' + c.execution_type);
}
```

- [ ] **Step 2: Wire writeback into the entrypoint**

In `runExecutionWorkbench`, replace the `candidates.forEach(...)` block with:

```js
  var classified = 0;
  var missingInfo = 0;
  var notAutomatable = 0;
  var readyForExecution = 0;
  var errors = 0;

  candidates.forEach(function(c) {
    var taskId = String(c.values[MASTER_COLS.TASK_ID] || '(no-id)');
    try {
      var classification = classifyTask_(c.values, okrContext);
      classification.__taskId = taskId; // for writeback log only
      var statusInfo = classificationToStatus_(classification);
      writeClassificationToRow_(sheet, c.rowNum, classification, statusInfo);
      c.classification = classification;
      c.statusInfo     = statusInfo;
      classified++;
      if (statusInfo.status === EXEC_STATUS.MISSING_INFO)        missingInfo++;
      if (statusInfo.status === EXEC_STATUS.NOT_AUTOMATABLE)     notAutomatable++;
      if (statusInfo.status === EXEC_STATUS.READY_FOR_EXECUTION) readyForExecution++;
    } catch (e) {
      errors++;
      logSyncActivity('exec_error', taskId, '', 'classify stage: ' + e.message.slice(0, 300));
    }
  });
```

And update the final `exec_done` log line to include the new counters:

```js
  logSyncActivity('exec_done', '', '',
    'Workbench pass complete — candidates=' + candidates.length +
    ' | classified=' + classified +
    ' | missing_info=' + missingInfo +
    ' | not_automatable=' + notAutomatable +
    ' | ready_for_execution=' + readyForExecution +
    ' | errors=' + errors +
    ' (executor wired in Task 8).');
```

- [ ] **Step 3: Manual verification — three rows yield three different statuses**

Set up (or use existing) three Master Action Board rows on the test sheet:

- **Row 1 — vague task, expect Missing Info.** Task: "Follow up with Acme". Owner, due date filled. Execution Context blank. Status not done. Output link blank.
- **Row 2 — clearly not-LLM-doable, expect Not Automatable.** Task: "Sign the MSA in person at Friday meeting". Execution Context blank.
- **Row 3 — concrete LLM-doable, expect Ready for Execution.** Task: "Draft a 3-paragraph kickoff email to the Acme onboarding team summarizing the agreed launch plan and next steps". Execution Context: "Audience: Acme COO + CFO. Tone: professional, warm. Reference the agreed launch date of June 15."

Run `runExecutionWorkbench`. Open Master Action Board. Verify columns Q/S/T/U/V on each row:

- **Row 1:** U = `Missing Info`; V = `Classifier reported gaps; see Missing Info column`; T (Missing Info) is non-empty and concrete (lists what's missing).
- **Row 2:** U = `Not Automatable`; V = `Task not suitable for an LLM` (or `Automation not selected by model` — either is acceptable depending on how the model labelled it). T may be empty.
- **Row 3:** U = `Ready for Execution`; V = empty; T = empty; S (Execution Type) is a short label like "draft email".

If Row 3 lands in `Missing Info` instead of `Ready for Execution`, read the `Missing Info` text — the classifier may legitimately need more context. Add the asked-for facts to Execution Context, set Force Re-run = Yes, and re-run. (This is the spec's intended UX, not a bug.)

If a row's status is wrong by your judgment (e.g. the model called Row 2 automatable), check `exec_classify_parsed` in the Sync Log and refine the row text. Status mapping itself is mechanical — only the model's classification is fuzzy.

- [ ] **Step 4: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): classify writeback with status mapping"
```

---

## Task 6: `generateExecutionId_()` — EX-#### counter

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — append after `writeClassificationToRow_`.

- [ ] **Step 1: Append the ID generator**

```js
/**
 * Scan column W (Latest Execution ID) for EX-#### values and return the next one.
 * Format: EX-0001, EX-0002, ... zero-padded to 4 digits.
 *
 * @param {Sheet} sheet  Master Action Board sheet
 * @return {string}      Next monotonic EX-#### ID
 */
function generateExecutionId_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'EX-0001';

  var ids = sheet.getRange(2, EXECUTION_COLS.LATEST_EXECUTION_ID + 1, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < ids.length; i++) {
    var m = String(ids[i][0] || '').match(/^EX-(\d+)$/);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }

  var next = max + 1;
  return 'EX-' + ('0000' + next).slice(-4);
}
```

- [ ] **Step 2: Manual verification**

Open the Apps Script editor's Run dropdown, pick `runExecutionWorkbench` (existing entrypoint won't call this yet — that's Task 8). To smoke-test the helper directly, add a temporary debug function at the very bottom of `Code.gs`:

```js
function _debugGenerateExecutionId() {
  var sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.TAB_MASTER);
  Logger.log('Next EX ID: ' + generateExecutionId_(sheet));
}
```

Paste, save, run `_debugGenerateExecutionId`. With column W empty, the editor's execution log should print `Next EX ID: EX-0001`.

Manually type `EX-0007` into a cell in column W of any row. Re-run `_debugGenerateExecutionId`. The log should print `Next EX ID: EX-0008`.

Clear the test value back out of column W. Delete the `_debugGenerateExecutionId` function from `Code.gs`.

- [ ] **Step 3: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): generateExecutionId_ for EX-#### IDs"
```

---

## Task 7: `createExecutionDoc_()` — Google Doc with QA layout

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — append after `generateExecutionId_`.

- [ ] **Step 1: Append the Doc creator**

```js
/**
 * Create a per-task execution Google Doc inside CONFIG.EXECUTION_OUTPUT_FOLDER_ID,
 * with the QA layout from spec §6.1: metadata table, Generated Prompt, LLM Output,
 * Missing Info, Review Notes.
 *
 * Returns the Doc URL.
 */
function createExecutionDoc_(rowValues, classification, output, executionId) {
  var taskId        = String(rowValues[MASTER_COLS.TASK_ID]       || '');
  var task          = String(rowValues[MASTER_COLS.TASK]          || '');
  var owner         = String(rowValues[MASTER_COLS.OWNER]         || '');
  var meetingTitle  = String(rowValues[MASTER_COLS.MEETING_TITLE] || '');
  var meetingDate   = String(rowValues[MASTER_COLS.MEETING_DATE]  || '');
  var okrLink       = String(rowValues[MASTER_COLS.OKR_LINK]      || '');
  var executionType = String(classification.execution_type        || '');
  var missingInfo   = String(classification.missing_info          || '');
  var generatedPrompt = String(classification.generated_prompt    || '');

  var truncatedTask = task.length > 60 ? task.slice(0, 57) + '...' : task;
  var datePrefix    = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  var docTitle      = '[' + executionId + ' ' + datePrefix + '] ' + truncatedTask;

  var doc  = DocumentApp.create(docTitle);
  var body = doc.getBody();
  body.clear();

  // 1. Heading 1 — TaskID + task
  body.appendParagraph(taskId + ' · ' + task).setHeading(DocumentApp.ParagraphHeading.HEADING1);

  // 2. Metadata table
  var metaTable = body.appendTable([
    ['Task ID',       taskId],
    ['Execution ID',  executionId],
    ['Execution Type', executionType],
    ['Owner',         owner],
    ['Created At',    new Date().toISOString()],
    ['Source meeting', (meetingTitle || '(unknown)') + ' — ' + (meetingDate || '(no date)')],
    ['OKR link',      okrLink || '(none)']
  ]);
  // Bold the first column
  for (var r = 0; r < metaTable.getNumRows(); r++) {
    metaTable.getCell(r, 0).getChild(0).asParagraph().editAsText().setBold(true);
  }

  // 3. Generated Prompt (monospaced for QA legibility)
  body.appendParagraph('Generated Prompt (sent to execution LLM — for QA)')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var promptPara = body.appendParagraph(generatedPrompt || '(empty)');
  promptPara.editAsText().setFontFamily('Roboto Mono');

  // 4. LLM Output
  body.appendParagraph('LLM Output').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(output || '(empty)');

  // 5. Missing Info
  body.appendParagraph('Missing Info (from classification)').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(missingInfo || 'None noted');

  // 6. Review Notes (empty)
  body.appendParagraph('Review Notes').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(''); // intentional: reviewer fills this in

  doc.saveAndClose();

  // Move the Doc into the configured output folder
  var folder = DriveApp.getFolderById(CONFIG.EXECUTION_OUTPUT_FOLDER_ID);
  DriveApp.getFileById(doc.getId()).moveTo(folder);

  var url = doc.getUrl();
  logSyncActivity('exec_doc', taskId, doc.getName(), url);
  return url;
}
```

- [ ] **Step 2: Manual verification — Doc appears in folder with correct sections**

Add a temporary debug function at the bottom of `Code.gs`:

```js
function _debugCreateExecutionDoc() {
  var sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.TAB_MASTER);
  // Use any real row's values, e.g. row 2:
  var rowValues = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  var fakeClassification = {
    execution_type:   'draft email',
    missing_info:     '',
    generated_prompt: 'Write a 3-paragraph kickoff email to the Acme team. Tone: professional, warm. Reference the agreed launch date of June 15.'
  };
  var fakeOutput = 'Subject: Welcome to Kompato\n\nHi Acme team,\n\n[fake output for verification]\n\n— Test';
  var url = createExecutionDoc_(rowValues, fakeClassification, fakeOutput, 'EX-9999');
  Logger.log('Created: ' + url);
}
```

Run `_debugCreateExecutionDoc`. The execution log should print a Doc URL. Open it. Verify:

- The Doc title starts with `[EX-9999 YYYY-MM-DD] ` and includes a truncated task.
- A metadata table at the top with 7 labeled rows.
- A "Generated Prompt" Heading 2, followed by the test prompt rendered in a monospaced font.
- An "LLM Output" Heading 2 followed by the fake output text.
- A "Missing Info" Heading 2 with "None noted".
- A "Review Notes" Heading 2 followed by an empty paragraph.

Open `https://drive.google.com/drive/folders/1BKWfhq4b22K1ZT9jsfTo-YvEPhrW5Qsz` in a browser. Confirm the new Doc is there (not in My Drive root).

Open the Sync Log and verify a new `exec_doc` row with the URL.

If the Doc landed somewhere else (My Drive root), the script runner doesn't have edit access to the configured folder. Re-share the folder with the runner's account as Editor, then re-run.

Delete the test Doc from the folder. Delete `_debugCreateExecutionDoc` from `Code.gs`.

- [ ] **Step 3: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): createExecutionDoc_ with QA layout"
```

---

## Task 8: `executeTask_()` — execution LLM call

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — append after `createExecutionDoc_`.

- [ ] **Step 1: Append the executor**

```js
/**
 * Run the execution LLM against a generated prompt. Returns the raw output text.
 * Uses the same endpoint-routing as classifyTask_; minimal system instructions —
 * the classifier owns task framing, the executor just produces the deliverable.
 */
function executeTask_(generatedPrompt, taskId) {
  if (!generatedPrompt) throw new Error('executeTask_ called with empty generated_prompt');

  var systemPrompt = 'You are an execution assistant. Produce the deliverable described in the user\'s prompt. Output only the deliverable; no preamble or explanation.';

  logSyncActivity('exec_run_prompt', taskId, '', 'first 200 chars: ' + generatedPrompt.slice(0, 200).replace(/\n/g, ' '));

  var isResponsesApi = !CONFIG.OPENAI_MODEL.startsWith('gpt-4');
  var endpoint, payload;
  if (isResponsesApi) {
    // gpt-5 Responses API rejects `temperature` (HTTP 400). Do NOT add it.
    endpoint = 'https://api.openai.com/v1/responses';
    payload = {
      model:        CONFIG.OPENAI_MODEL,
      instructions: systemPrompt,
      input:        generatedPrompt
    };
  } else {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    payload = {
      model:       CONFIG.OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: generatedPrompt }
      ]
    };
  }

  var response = UrlFetchApp.fetch(endpoint, {
    method:          'post',
    contentType:     'application/json',
    headers:         { 'Authorization': 'Bearer ' + CONFIG.OPENAI_API_KEY },
    payload:         JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body   = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Executor HTTP ' + status + ': ' + body.slice(0, 400));
  }

  var output = extractOpenAIText_(body, isResponsesApi);
  logSyncActivity('exec_run_raw', taskId, '', 'first 800 chars: ' + output.slice(0, 800));

  return output;
}
```

- [ ] **Step 2: Manual verification — executor returns text for a known prompt**

Add a temporary debug function:

```js
function _debugExecuteTask() {
  var prompt = 'Write a 2-sentence test message confirming this executor works. Address it to "Test User".';
  var output = executeTask_(prompt, 'TEST-0001');
  Logger.log('Output: ' + output);
}
```

Run `_debugExecuteTask`. The execution log should print 2 sentences addressed to Test User. The Sync Log should show `exec_run_prompt` and `exec_run_raw` rows for `TEST-0001`.

Delete `_debugExecuteTask`.

- [ ] **Step 3: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): executeTask_ minimal execution LLM call"
```

---

## Task 9: Wire the execute gate, executor, Doc, and full writeback

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — update `runExecutionWorkbench` and add an `executeAndWriteback_` helper.

- [ ] **Step 1: Append the per-row execute helper**

Append immediately before `runExecutionWorkbench`:

```js
/**
 * For one row that passed the gate: run the executor, create the Doc, write
 * the executor columns (W/X/Y), set status = Ready for Review, clear Force Re-run.
 *
 * On executor or Doc failure: leaves status = Ready for Execution, writes the
 * truncated error to Execution Status Reason. Row will retry next pass.
 */
function executeAndWriteback_(sheet, candidate) {
  var rowNum = candidate.rowNum;
  var c      = candidate.classification;
  var taskId = String(candidate.values[MASTER_COLS.TASK_ID] || '(no-id)');

  try {
    var output      = executeTask_(c.generated_prompt, taskId);
    var executionId = generateExecutionId_(sheet);
    var docUrl      = createExecutionDoc_(candidate.values, c, output, executionId);
    var nowIso      = new Date().toISOString();

    sheet.getRange(rowNum, EXECUTION_COLS.LATEST_EXECUTION_ID + 1).setValue(executionId);
    sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_OUTPUT_LINK + 1).setValue(docUrl);
    sheet.getRange(rowNum, EXECUTION_COLS.LAST_EXECUTED_AT + 1).setValue(nowIso);
    sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS + 1).setValue(EXEC_STATUS.READY_FOR_REVIEW);
    sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS_REASON + 1).setValue('');
    sheet.getRange(rowNum, EXECUTION_COLS.FORCE_RERUN + 1).setValue('No');

    logSyncActivity('exec_writeback', taskId, '',
      'row ' + rowNum +
      ' | status=' + EXEC_STATUS.READY_FOR_REVIEW +
      ' | execution_id=' + executionId +
      ' | doc=' + docUrl);
    return true;
  } catch (e) {
    var msg = e.message ? e.message.slice(0, 300) : String(e);
    sheet.getRange(rowNum, EXECUTION_COLS.EXECUTION_STATUS_REASON + 1).setValue('Executor error: ' + msg);
    logSyncActivity('exec_error', taskId, '', 'execute stage: ' + msg);
    return false;
  }
}

/**
 * Apply the execute gate per spec §5.2 and log the decision.
 */
function passesExecuteGate_(c) {
  return c.execution_needed === 'Yes'
      && c.is_executable === true
      && (!c.missing_info || c.missing_info.length === 0)
      && c.generated_prompt
      && c.generated_prompt.length > 0;
}
```

- [ ] **Step 2: Update `runExecutionWorkbench` to run the gated executor**

Replace the body of `runExecutionWorkbench` (the version from Task 5) with:

```js
function runExecutionWorkbench() {
  logSyncActivity('exec_start', '', '', 'Workbench pass starting (batch limit ' + CONFIG.EXECUTION_BATCH_LIMIT + ').');

  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.TAB_MASTER);
  if (!sheet) throw new Error('Tab "' + CONFIG.TAB_MASTER + '" not found in spreadsheet');

  ensureExecutionColumns_(sheet);

  var candidates = findExecutionCandidates_(sheet);
  var preview    = candidates.slice(0, 5).map(function(c) {
    return String(c.values[MASTER_COLS.TASK_ID] || '(no id)') + ' (row ' + c.rowNum + ')';
  }).join(', ');
  logSyncActivity('exec_candidates', '', '', candidates.length + ' candidate row(s); first 5: ' + (preview || '(none)'));

  if (candidates.length === 0) {
    logSyncActivity('exec_done', '', '', 'Workbench pass complete — no candidates.');
    return;
  }

  var okrContext = fetchOKRContext();

  // Phase 1: classify all candidates (write Q/S/T/U/V).
  var classified = 0;
  var classifyErrors = 0;
  candidates.forEach(function(c) {
    var taskId = String(c.values[MASTER_COLS.TASK_ID] || '(no-id)');
    try {
      var classification = classifyTask_(c.values, okrContext);
      classification.__taskId = taskId;
      var statusInfo = classificationToStatus_(classification);
      writeClassificationToRow_(sheet, c.rowNum, classification, statusInfo);
      c.classification = classification;
      c.statusInfo     = statusInfo;
      classified++;
    } catch (e) {
      classifyErrors++;
      logSyncActivity('exec_error', taskId, '', 'classify stage: ' + e.message.slice(0, 300));
    }
  });

  // Phase 2: run executor on rows that pass the gate (write W/X/Y, set Ready for Review).
  var executed = 0;
  var executeErrors = 0;
  candidates.forEach(function(c) {
    if (!c.classification) return; // classify failed
    var taskId = String(c.values[MASTER_COLS.TASK_ID] || '(no-id)');
    var pass   = passesExecuteGate_(c.classification);
    logSyncActivity('exec_gate', taskId, '', pass ? 'PASS — executing' : 'SKIP — gate not met');
    if (!pass) return;

    var ok = executeAndWriteback_(sheet, c);
    if (ok) executed++; else executeErrors++;
  });

  logSyncActivity('exec_done', '', '',
    'Workbench pass complete — candidates=' + candidates.length +
    ' | classified=' + classified +
    ' | executed=' + executed +
    ' | classify_errors=' + classifyErrors +
    ' | execute_errors=' + executeErrors);
}
```

- [ ] **Step 3: Manual verification — full end-to-end on the spec's missing-info → re-run path**

Set up one Master Action Board row with a vague task, e.g.:
- Task: "Follow up with Acme about the integration"
- Owner: you
- Status: in_progress
- Execution Context: blank (intentionally — we want the classifier to flag missing info)
- Output Link: blank, Force Re-run: blank

**Pass 1 — expect Missing Info:**
1. Run `runExecutionWorkbench`.
2. Open Master Action Board for that row. Verify:
   - U = `Missing Info`
   - T (Missing Info) is non-empty (lists what's missing — audience, what kind of follow-up, deliverable type, etc.)
   - X (Execution Output Link) is still blank
   - Sync Log shows `exec_gate` = SKIP for this task ID.

**Pass 2 — add context, re-run, expect Ready for Review:**
3. Edit Execution Context for this row to fill in what was missing, e.g. "Audience: Acme COO. Deliverable: short email reminding them of the integration testing window and asking for a date confirmation. Tone: friendly, low-pressure."
4. Set Force Re-run = Yes.
5. Run `runExecutionWorkbench` again.
6. Verify on the row:
   - U = `Ready for Review`
   - V = empty
   - W = `EX-0001` (or whichever next ID)
   - X = a Google Doc URL
   - Y = an ISO timestamp
   - Z = `No` (workbench reset it)
7. Click X. The Doc opens with all six sections; LLM Output is a real follow-up email.
8. Sync Log shows `exec_gate` = PASS, `exec_run_prompt`, `exec_run_raw`, `exec_doc`, `exec_writeback`.

**Pass 3 — confirm idempotency:**
9. Run `runExecutionWorkbench` once more without changing anything. The row's X is filled and Force Re-run is `No`, so it must NOT be re-classified. Sync Log: `exec_candidates` count drops by 1 vs Pass 2, and the row's V/Y/etc are unchanged.

If any of these fail, do not commit until fixed. Errors here mean the gate, the writeback, or the candidate filter is wrong — re-read this task before debugging.

- [ ] **Step 4: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): execute gate, executor, Doc creation, and full writeback"
```

---

## Task 10: `LockService` document lock to prevent overlapping passes

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — wrap the body of `runExecutionWorkbench`.

- [ ] **Step 1: Add the lock wrapper**

Replace `runExecutionWorkbench` again, this time wrapping its body in a `LockService.getDocumentLock().tryLock(0)` block:

```js
function runExecutionWorkbench() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(0)) {
    logSyncActivity('exec_skipped', '', '', 'Another workbench pass is already running — skipped.');
    return;
  }

  try {
    logSyncActivity('exec_start', '', '', 'Workbench pass starting (batch limit ' + CONFIG.EXECUTION_BATCH_LIMIT + ').');

    var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CONFIG.TAB_MASTER);
    if (!sheet) throw new Error('Tab "' + CONFIG.TAB_MASTER + '" not found in spreadsheet');

    ensureExecutionColumns_(sheet);

    var candidates = findExecutionCandidates_(sheet);
    var preview    = candidates.slice(0, 5).map(function(c) {
      return String(c.values[MASTER_COLS.TASK_ID] || '(no id)') + ' (row ' + c.rowNum + ')';
    }).join(', ');
    logSyncActivity('exec_candidates', '', '', candidates.length + ' candidate row(s); first 5: ' + (preview || '(none)'));

    if (candidates.length === 0) {
      logSyncActivity('exec_done', '', '', 'Workbench pass complete — no candidates.');
      return;
    }

    var okrContext = fetchOKRContext();

    var classified = 0;
    var classifyErrors = 0;
    candidates.forEach(function(c) {
      var taskId = String(c.values[MASTER_COLS.TASK_ID] || '(no-id)');
      try {
        var classification = classifyTask_(c.values, okrContext);
        classification.__taskId = taskId;
        var statusInfo = classificationToStatus_(classification);
        writeClassificationToRow_(sheet, c.rowNum, classification, statusInfo);
        c.classification = classification;
        c.statusInfo     = statusInfo;
        classified++;
      } catch (e) {
        classifyErrors++;
        logSyncActivity('exec_error', taskId, '', 'classify stage: ' + e.message.slice(0, 300));
      }
    });

    var executed = 0;
    var executeErrors = 0;
    candidates.forEach(function(c) {
      if (!c.classification) return;
      var taskId = String(c.values[MASTER_COLS.TASK_ID] || '(no-id)');
      var pass   = passesExecuteGate_(c.classification);
      logSyncActivity('exec_gate', taskId, '', pass ? 'PASS — executing' : 'SKIP — gate not met');
      if (!pass) return;

      var ok = executeAndWriteback_(sheet, c);
      if (ok) executed++; else executeErrors++;
    });

    logSyncActivity('exec_done', '', '',
      'Workbench pass complete — candidates=' + candidates.length +
      ' | classified=' + classified +
      ' | executed=' + executed +
      ' | classify_errors=' + classifyErrors +
      ' | execute_errors=' + executeErrors);
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 2: Manual verification — collision logs `exec_skipped`**

Apps Script makes it hard to truly collide two manual runs (the editor only runs one function at a time). Simulate a collision instead:

Add a temporary debug function:

```js
function _debugLockCollision() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(0)) {
    Logger.log('OUTER: failed to acquire — unexpected');
    return;
  }
  try {
    Logger.log('OUTER: acquired lock; calling runExecutionWorkbench (should skip)');
    runExecutionWorkbench();
    Logger.log('OUTER: returned from runExecutionWorkbench');
  } finally {
    lock.releaseLock();
  }
}
```

Run `_debugLockCollision`. The execution log should show:
- `OUTER: acquired lock; calling runExecutionWorkbench (should skip)`
- `OUTER: returned from runExecutionWorkbench`

Open the Sync Log. Verify the most recent entry is `exec_skipped` with message "Another workbench pass is already running — skipped."

Delete `_debugLockCollision`.

- [ ] **Step 3: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): LockService document lock prevents overlapping passes"
```

---

## Task 11: `onOpen()` menu and `setupExecutionTrigger_()` installer

**Files:**
- Modify: `apps-script-meet-sync/Code.gs` — append at the very end.

- [ ] **Step 1: Append the menu and trigger setup**

```js
/**
 * Apps Script lifecycle hook. Runs every time the spreadsheet is opened
 * by an editor user. Adds the "Execution Workbench" menu.
 *
 * Note: simple triggers like onOpen run as the user, with limited auth.
 * This menu only adds menu items — the menu actions themselves run with
 * full auth when clicked.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Execution Workbench')
    .addItem('Run execution workbench', 'runExecutionWorkbench')
    .addItem('Install / refresh hourly trigger', 'setupExecutionTrigger_')
    .addItem('Remove hourly trigger', 'removeExecutionTrigger_')
    .addToUi();
}

/**
 * Idempotent. Removes any existing time triggers for runExecutionWorkbench
 * and creates a fresh hourly trigger. Run this once per project deployment.
 */
function setupExecutionTrigger_() {
  removeExecutionTrigger_();
  ScriptApp.newTrigger('runExecutionWorkbench')
    .timeBased()
    .everyHours(1)
    .create();
  SpreadsheetApp.getUi().alert('Hourly trigger installed for runExecutionWorkbench.');
  logSyncActivity('exec_trigger_install', '', '', 'Hourly trigger created.');
}

/**
 * Removes any time-based triggers pointing at runExecutionWorkbench.
 * Safe to call when none exist (no-op).
 */
function removeExecutionTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed  = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'runExecutionWorkbench') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed > 0) {
    logSyncActivity('exec_trigger_remove', '', '', 'Removed ' + removed + ' trigger(s).');
  }
}
```

- [ ] **Step 2: Manual verification — menu appears and trigger installs**

Paste the updated `Code.gs` into `Code_staging.gs`, save. **Reload** the spreadsheet (close the tab and reopen it — Apps Script only fires `onOpen` on a fresh open). Verify:
- The menu bar now shows an **Execution Workbench** menu next to Help.
- The menu has three items: "Run execution workbench", "Install / refresh hourly trigger", "Remove hourly trigger".

Click **Run execution workbench**. After authorizing if prompted, the workbench runs. Sync Log shows the usual `exec_start` / `exec_candidates` / `exec_done`.

Click **Install / refresh hourly trigger**. A dialog confirms. Open the Apps Script editor → Triggers (clock icon in the left sidebar). Verify exactly one trigger exists for `runExecutionWorkbench`, time-driven, every hour.

Click **Install / refresh hourly trigger** again. Confirm Triggers UI still shows exactly one (idempotent — old one removed, new one created).

Click **Remove hourly trigger**. Verify Triggers UI now shows zero triggers for `runExecutionWorkbench`.

Re-install the trigger before moving on — production wants the hourly cadence enabled.

- [ ] **Step 3: Commit**

```bash
git add apps-script-meet-sync/Code.gs
git commit -m "feat(workbench): onOpen menu and hourly trigger installer"
```

---

## Task 12: End-to-end verification matrix

This task runs the full spec §9 verification matrix after all code is in place. No new code is written. Each step is a checkpoint; only commit the final completion marker.

- [ ] **Step 1: Schema idempotency (spec §9.1)**

On a clean test sheet (delete columns Q–Z first), run `runExecutionWorkbench`. Verify all 10 headers appear. Run again. Verify Sync Log says "All 10 workbench headers already present (no-op)." and no duplicates appeared.

- [ ] **Step 2: Candidate selection (spec §9.2)**

Set up Rows A/B/C/D from Task 3's verification. Run pass. Verify candidates report excludes the `done` row and the row with output link + no force-rerun.

- [ ] **Step 3: Missing-info → re-run flow (spec §9.3)**

Re-run Task 9's manual verification end to end (the "Follow up with Acme" round-trip). Confirm Pass 1 → Missing Info, Pass 2 with context → Ready for Review with Doc, Pass 3 → no re-execution.

- [ ] **Step 4: Both Not Automatable reasons (spec §9.4)**

Two rows:
- Row P1: "Sign the MSA in person at Friday's meeting" → expect U=`Not Automatable`, V=`Task not suitable for an LLM`.
- Row P2: A row the model deems automation-inappropriate (e.g. "Decide on Q3 strategic priorities" — pure judgment). Expect U=`Not Automatable`, V=`Automation not selected by model`.

If P2 lands the wrong reason (model said `is_executable=false` instead of `execution_needed=No`), inspect `exec_classify_parsed`. The mapping is correct; either row text is ambiguous (refine it) or the rubric needs sharpening (out of scope for this plan).

- [ ] **Step 5: Doc layout (spec §9.5)**

Open one of the Docs created during Step 3. Confirm: title format `[EX-#### YYYY-MM-DD] ...`, metadata table, Generated Prompt monospaced, LLM Output, Missing Info, empty Review Notes. Confirm it lives in `1BKWfhq4b22K1ZT9jsfTo-YvEPhrW5Qsz`, not My Drive root.

- [ ] **Step 6: Lock contention (spec §9.6)**

Already covered in Task 10's verification. Re-confirm `exec_skipped` log line still appears under the simulated collision.

- [ ] **Step 7: Batch cap (spec §9.7)**

Populate 12 rows that all pass the candidate filter (not done, no output link). Run `runExecutionWorkbench`. Open the Sync Log: `exec_candidates` should report exactly 10. After the pass, exactly 10 of the 12 rows have classification columns populated; 2 are untouched. Run again — the remaining 2 are now processed (assuming the first 10 are no longer candidates because they have output links or stuck on Missing Info).

- [ ] **Step 8: Reflection notes (lab requirement)**

The lab guide ends with five reflection questions. Capture brief answers in `apps-script-meet-sync/REFLECTIONS.md` (create the file if it doesn't exist):

```
## Execution Workbench — 2026-05-07

1. Easiest task types to execute well:
2. Where missing context hurt output quality:
3. Information that improved results most:
4. What would I trust this to execute today:
5. What still needs human judgment:
```

Fill in 1–2 sentences per question based on the test runs above.

- [ ] **Step 9: Final commit**

```bash
git add apps-script-meet-sync/REFLECTIONS.md
git commit -m "docs: execution workbench end-to-end verification + reflections"
```

---

## Open follow-ups (not in scope; flagged for later)

- A "Classify only (no execute)" menu item for debugging — useful but not required by the lab.
- Refactor the duplicated endpoint-routing block in `parseWithHiveMind`, `classifyTask_`, and `executeTask_` into a single `callOpenAI_(systemPrompt, userInput)` helper. Deferred to keep the ingest path's blast radius small during this lab.
- `Force Re-run` as a checkbox column instead of plain text — explicitly rejected by the spec for consistency with `Execution Needed`.
