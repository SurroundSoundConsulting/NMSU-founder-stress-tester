# Execution Workbench — Design Spec

**Date:** 2026-05-07
**Branch:** `claude/angry-jang`
**Target:** `apps-script-meet-sync/Code.gs` (Google Apps Script)
**Source lab:** Week 4 lab guide (Hive Mind execution workbench). Lab references "Fireflies"; this project uses **Google Meet** transcripts and runs entirely in Apps Script.

## 1. Goal

Add a second-stage pipeline on top of the existing Meet → Hive Mind → Master Action Board flow:

1. Decide which board rows are LLM-executable.
2. Detect missing context per row.
3. Generate an execution prompt per row.
4. Execute that prompt and store the output in a per-task Google Doc.
5. Write a link back to the sheet.
6. Allow operators to add context and force a re-run.

The workbench is observable, idempotent, and runs against the same Master Action Board the ingest pipeline already populates.

## 2. Non-goals

- No Node.js work. The `lib/` and `fireflies-polling/` directories are untouched.
- No new external dependencies; no Drive REST API; no service-account changes. Apps Script's built-in `DriveApp` / `DocumentApp` / `SpreadsheetApp` only.
- No automatic permission changes on output Docs (folder-level access is provisioned once by hand).
- No deletion of prior execution Docs on re-run (audit history preserved).
- No reshuffle of the existing 16-column schema; new columns append.

## 3. Architecture

The workbench is a set of new functions inside the same `Code.gs`. No new files unless the file outgrows itself during implementation.

### 3.1 New top-level functions

| Function | Purpose |
|---|---|
| `onOpen()` | Adds the "Execution Workbench" menu to the spreadsheet. |
| `runExecutionWorkbench()` | Entry point used by both the menu item and the time trigger. Acquires `LockService.getDocumentLock().tryLock(0)`; runs schema check → candidates → classify → writeback → gated execute → Doc → writeback. |
| `ensureExecutionColumns_()` | Idempotent schema check. Adds any missing Q–Z headers to Master Action Board. |
| `findExecutionCandidates_(masterRows)` | Returns 1-based sheet row numbers (header is row 1, data starts at row 2) that are eligible for classification or execution this pass, capped at `EXECUTION_BATCH_LIMIT`. |
| `classifyTask_(rowObj, okrContext)` | Single LLM call returning the classification JSON. |
| `executeTask_(generatedPrompt)` | Single LLM call returning the execution output text. |
| `createExecutionDoc_(rowObj, classification, output, executionId)` | Creates a Google Doc in `EXECUTION_OUTPUT_FOLDER_ID` with the QA layout. Returns URL. |
| `generateExecutionId_(masterRows)` | Scans column W for `EX-(\d+)`, returns next zero-padded `EX-####`. |

### 3.2 Reused, untouched

- `parseWithHiveMind` and the gpt-5 / gpt-4o endpoint-routing pattern (the workbench duplicates the same pattern in its own LLM helpers, since `parseWithHiveMind` returns a different shape).
- `fetchOKRContext()` — same OKR list passed to the classifier.
- `logSyncActivity(step, fileId, fileName, message)` — the workbench writes to the existing Sync Log tab with `exec_*` step labels.
- `MASTER_COLS`, `buildMasterRow`, ingest pipeline, processed-sources tracking. None are modified.

### 3.3 New CONFIG entries

```js
EXECUTION_OUTPUT_FOLDER_ID: 'REPLACE_WITH_DRIVE_FOLDER_ID',  // dedicated folder for execution Docs
EXECUTION_BATCH_LIMIT: 10                                    // cap candidates per pass (Apps Script 6-min trigger limit)
```

### 3.4 Triggers

- **Custom menu** — `onOpen()` adds menu "Execution Workbench" with item "Run execution workbench". User-initiated, on demand.
- **Time-driven trigger** — hourly trigger pointing at `runExecutionWorkbench`. Same entrypoint, same batch cap.
- **`LockService`** — `runExecutionWorkbench` calls `LockService.getDocumentLock().tryLock(0)` at the top. If already held (menu run colliding with trigger run), logs `exec_skipped` and returns.

## 4. Sheet schema additions

Ten columns appended to Master Action Board, columns Q–Z. Headers added by `ensureExecutionColumns_()` if missing.

| Col | Header | Written by | Notes |
|-----|--------|------------|-------|
| Q (16) | `Execution Needed` | classifier | "Yes" / "No". |
| R (17) | `Execution Context` | **user** | Free text. Read into the classification prompt. The one column users edit to add facts the transcript missed. |
| S (18) | `Execution Type` | classifier | Short label: e.g. "draft email", "summary", "checklist", "doc outline". |
| T (19) | `Missing Info` | classifier | Concrete missing facts. Empty when nothing is missing. |
| U (20) | `Execution Status` | workbench | One of four exact strings (§5.1). |
| V (21) | `Execution Status Reason` | workbench | Why this status. Empty for `Ready for Review`. |
| W (22) | `Latest Execution ID` | executor | `EX-####` (monotonic, scan-and-increment, mirroring `HM-####`). |
| X (23) | `Execution Output Link` | executor | Google Doc URL. |
| Y (24) | `Last Executed At` | executor | ISO timestamp. |
| Z (25) | `Force Re-run` | **user** | "Yes" / "No". Workbench resets to "No" after a successful run. Plain text rather than checkbox (consistent with `Execution Needed`, survives copy-paste, no boolean cast). |

Indices live in a new constant block:

```js
var EXECUTION_COLS = {
  EXECUTION_NEEDED: 16,
  EXECUTION_CONTEXT: 17,
  EXECUTION_TYPE: 18,
  MISSING_INFO: 19,
  EXECUTION_STATUS: 20,
  EXECUTION_STATUS_REASON: 21,
  LATEST_EXECUTION_ID: 22,
  EXECUTION_OUTPUT_LINK: 23,
  LAST_EXECUTED_AT: 24,
  FORCE_RERUN: 25
};
```

Existing `MASTER_COLS` indices are unchanged. Existing ingest-side range reads (`getRange(2, 1, lastRow-1, 16)`) keep their 16-column width and ignore Q–Z. Workbench code reads `sheet.getLastColumn()`.

## 5. Status semantics & execute gate

### 5.1 Four exact `Execution Status` strings

| Status | Set when | `Execution Status Reason` |
|---|---|---|
| `Missing Info` | classifier returns non-empty `missing_info` | exact string `"Classifier reported gaps; see Missing Info column"` (column T carries the detail; Reason column avoids duplicating it) |
| `Ready for Execution` | classifier returns `execution_needed=Yes`, `is_executable=true`, `missing_info=""`, `generated_prompt!=""` — but execution has not yet succeeded this pass (e.g. batch cap hit, executor errored) | empty (or executor error message if executor errored) |
| `Not Automatable` | classifier returns `execution_needed=No` OR `is_executable=false` | one of two exact strings: `"Automation not selected by model"` (when `execution_needed=No`) or `"Task not suitable for an LLM"` (when `is_executable=false`) |
| `Ready for Review` | execution call succeeded and Doc was created | empty (per lab) |

### 5.2 Execute gate

The execution LLM runs only when, in the same pass for the same row, classification produced:

- `execution_needed == "Yes"` AND
- `is_executable == true` AND
- `missing_info == ""` AND
- `generated_prompt != ""`

The classifier's own `should_execute_now` field is **logged** (`exec_classify_parsed`) but is not the gate. The system prompt instructs the classifier to set `should_execute_now=true` iff the four conditions above hold, so disagreement should be rare; when it disagrees, the sheet semantics win.

### 5.3 Per-row pass flow

1. Build classification input from the row: `task`, `owner`, `status`, `due_date`, `next_step`, `blockers`, `dependencies`, `risk_flag`, `okr_link`, `meeting_title`, `meeting_date`, `Execution Context` (column R), plus the OKR context string (`fetchOKRContext()`).
2. Call `classifyTask_` (gpt-5, Responses API).
3. Write Q, S, T, U, V back to the row.
4. If gate passes:
   a. Call `executeTask_(generated_prompt)`.
   b. Call `createExecutionDoc_` and capture URL.
   c. Write W (`EX-####`), X (URL), Y (timestamp), set U=`Ready for Review`, V=empty, Z=`No`.
5. If executor or Doc creation throws: U stays `Ready for Execution`, V records the truncated error message. Row will retry on the next pass.

### 5.4 Candidate selection (lab Part 4)

A row is a candidate iff:

- `status` (column D) ≠ `done` AND
- (`Execution Output Link` is empty OR `Force Re-run` == `Yes`)

No separate in-flight flag — the document-level lock prevents overlapping passes.

## 6. Doc layout, prompts, idempotency

### 6.1 Doc layout (`createExecutionDoc_`)

Title: `[EX-#### YYYY-MM-DD] <task truncated to 60 chars>`.

Created via `DocumentApp.create()`, then moved into `EXECUTION_OUTPUT_FOLDER_ID` via `DriveApp.getFileById(doc.getId()).moveTo(folder)`. Body sections, in order:

1. **Heading 1** — `HM-#### · <task>`
2. **Metadata table** — Task ID, Execution ID, Execution Type, Owner, Created At, Source meeting (title + date), OKR link
3. **Heading 2** — `Generated Prompt (sent to execution LLM — for QA)` — verbatim `generated_prompt`, monospaced
4. **Heading 2** — `LLM Output` — verbatim execution output
5. **Heading 2** — `Missing Info (from classification)` — `missing_info` text or `None noted`
6. **Heading 2** — `Review Notes` — empty section for the human reviewer

No `permissions.create` calls. The script runs as the user; folder-level access is granted once at provisioning time.

### 6.2 Classifier prompt structure

Passed as the `instructions` field of the gpt-5 Responses API call. Sections:

- Role + non-negotiable JSON-only output (no markdown fences).
- The 6-field JSON schema: `execution_needed`, `is_executable`, `execution_type`, `missing_info`, `generated_prompt`, `should_execute_now`.
- Rubric for `execution_needed=No`: pure human commitments, in-person actions, decisions requiring authority the LLM lacks, social/relational tasks.
- Rubric for `is_executable=false`: tasks an LLM cannot do even with perfect context (signing, calling someone, in-person work, anything requiring credentials or human presence).
- Hard rule: `should_execute_now == true` iff `execution_needed=="Yes"` AND `is_executable==true` AND `missing_info==""`.
- Closing reminder: temperature 0.2, JSON only.

The user-message `input` carries the row fields and the OKR context string.

### 6.3 Executor prompt structure

`instructions`: `"You are an execution assistant. Produce the deliverable described in the user's prompt. Output only the deliverable; no preamble or explanation."`

`input`: the row's `generated_prompt` verbatim. The classifier owns task framing; the executor just produces the deliverable.

### 6.4 Endpoint routing

Same `isResponsesApi = !CONFIG.OPENAI_MODEL.startsWith('gpt-4')` pattern as `parseWithHiveMind`. Both classifier and executor honor it; both default to gpt-5 via `CONFIG.OPENAI_MODEL` (no separate `EXECUTION_MODEL` config — single model per user request).

### 6.5 Idempotency & re-runs

- Default: a row with non-empty `Execution Output Link` is skipped at candidate selection.
- `Force Re-run = Yes` overrides candidacy: the row re-classifies and re-executes, **overwrites** column X with the new URL. The old Doc remains in the folder (not deleted — audit history). On success, `Force Re-run` resets to `No`.
- A new Execution ID is minted on every execution (including re-runs). Column W reflects the most recent.
- `LockService.getDocumentLock().tryLock(0)` at the top of `runExecutionWorkbench`. If locked, log `exec_skipped` and return.

## 7. Logging

All workbench activity flows through the existing `logSyncActivity(step, fileId, fileName, message)` helper. New step labels:

| Step | When | Notes |
|---|---|---|
| `exec_start` | top of pass | window/batch info |
| `exec_skipped` | lock not acquired | "already running" |
| `exec_schema` | inside `ensureExecutionColumns_` | which columns added |
| `exec_candidates` | after candidate selection | count + first 5 task IDs |
| `exec_classify_prompt` | before classifier call | char counts (system + user) |
| `exec_classify_raw` | after classifier call | first 800 chars of response |
| `exec_classify_parsed` | after JSON parse | one line per row with the 6 fields |
| `exec_gate` | per row | accept/reject + reason |
| `exec_run_prompt` | before executor call | first 200 chars of `generated_prompt` |
| `exec_run_raw` | after executor call | first 800 chars of response |
| `exec_doc` | after Doc creation | URL |
| `exec_writeback` | after row update | which columns were written |
| `exec_error` | any caught exception | row task ID + stage + truncated message |
| `exec_done` | bottom of pass | counts (candidates / classified / executed / errored) |

Sync Log `fileId` column carries the row's task ID (HM-####); `fileName` column carries the meeting title.

## 8. Batch behavior & error handling

- `EXECUTION_BATCH_LIMIT` (default 10) caps candidates per pass. Excess candidates wait for the next pass.
- Classification runs first across all selected candidates; then the executor runs against the gated subset. A slow executor does not starve classification.
- Each row's classify+execute is wrapped in its own try/catch. A failure logs `exec_error`, leaves the row in a retry-friendly state, and continues to the next row. One bad row never aborts the batch.
- The whole pass is wrapped in a top-level try/catch around the `LockService` block to ensure the lock is always released (`finally { lock.releaseLock(); }`).

## 9. Verification (manual, disciplined)

No unit-test framework is wired up here and the existing code has none either. Verification is manual but explicit; the implementation plan will list each as a checkpoint.

1. **Schema add is idempotent.** Run `runExecutionWorkbench` once on a board lacking Q–Z. Verify Q–Z headers appear. Run a second time. Verify no duplicates and a no-op `exec_schema` log.
2. **Candidate selection.** Set up three rows: one `status=done`, one with `Execution Output Link` filled, one with `Force Re-run=Yes`. Run pass. Verify only the third becomes a candidate.
3. **Missing-info path → re-run.** Pick a vague task ("follow up with Acme"). First pass: lands in `Missing Info`. Add Execution Context, set `Force Re-run=Yes`, run again. Verify it now lands in `Ready for Review` with a populated Doc.
4. **`Not Automatable` paths.**
   - Row whose task is "call Bob to confirm pricing" → `Not Automatable`, reason `Task not suitable for an LLM`.
   - Row the model deems automation-inappropriate → `Not Automatable`, reason `Automation not selected by model`.
5. **Doc inspection.** Verify the Doc lives in `EXECUTION_OUTPUT_FOLDER_ID`, contains both the `Generated Prompt` and `LLM Output` sections, and the `Review Notes` section is empty.
6. **Lock contention.** Manually run from menu while the time trigger fires. Verify Sync Log shows the second invocation logged `exec_skipped`.
7. **Batch cap.** Populate 12 candidates. Run once. Verify exactly 10 processed and 2 remain for the next pass.

## 10. Open implementation details (delegated to plan)

- Exact text of the classifier system prompt (the rubrics are described above; final wording is plan-stage).
- Exact text of `Execution Status Reason` strings beyond the two `Not Automatable` constants (executor errors, Doc creation errors).
- Whether the menu also offers "Classify only (no execute)" as a debugging convenience — flagged as a nice-to-have, not required.
