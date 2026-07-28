# Execution Workbench — End-to-End Verification Guide

This guide walks you through verifying the workbench is working correctly. Each test is self-contained with explicit setup, what to click, and what to expect.

**Before you start:**
- [ ] You have pasted the latest `Code.gs` into the Apps Script editor and saved.
- [ ] Reload the Sheet tab in your browser (close and reopen) so `onOpen()` re-fires and the **Execution Workbench** menu appears.
- [ ] The 4 Script Properties are set (`INBOX_FOLDER_ID`, `SPREADSHEET_ID`, `OPENAI_API_KEY`, `EXECUTION_OUTPUT_FOLDER_ID`).
- [ ] Run **Apps Script editor → Run dropdown → `diagnoseConfig`**. The execution log should show all checks `OK`. If anything is `MISSING` or `ERROR`, fix that first.
- [ ] **`Code.gs` is the only `.gs` file in the Apps Script project.** Apps Script concatenates every file into one global scope, so a second file declaring `var CONFIG` (an old `CONFIG.gs`, a `CODE_backup.gs`) silently replaces the one `loadConfig_()` built — with stale IDs, a stale model, and missing keys. This has been the single most expensive failure mode in this project. The repo keeps `CODE_backup.gs` / `CODE_staging.gs` as local snapshots only; they must never be pasted into the project.
- [ ] Optional: set `EXECUTION_OWNER_ALLOWLIST` (comma-separated names) if you want the workbench scoped to owners other than the default `Rodrigo Fuentes, Rod`. Everything else is skipped before classification.

**Conventions used below:**
- "Sync Log" = the `Sync Log` tab in your Sheet.
- "Master Action Board" or "MAB" = the `Master Action Board` tab.
- "**Run X**" = in Apps Script editor, pick `X` in the Run dropdown and click **Run**. Or: from the Sheet, click **Execution Workbench → Run execution workbench** in the menu bar.
- Column letters refer to Master Action Board: Q–V are workbench-classification columns; W–Z are workbench-executor columns.

---

## Test 1 — Schema idempotency (spec §9.1)

**Goal:** verify `ensureExecutionColumns_` adds the 10 workbench headers when missing, and is a safe no-op when they already exist.

### Setup
1. Open Master Action Board.
2. Select columns **Q through Z** (10 columns). Right-click → **Delete columns Q–Z**.
3. Confirm columns end at P (Updated At) and there are no Q–Z headers.

### Run 1 — headers should appear
4. **Run `runExecutionWorkbench`.**
5. Check Master Action Board row 1 (headers). Expected, in order:
   - Q `Execution Needed`
   - R `Execution Context`
   - S `Execution Type`
   - T `Missing Info`
   - U `Execution Status`
   - V `Execution Status Reason`
   - W `Latest Execution ID`
   - X `Execution Output Link`
   - Y `Last Executed At`
   - Z `Force Re-run`
6. Open Sync Log. Look for the most recent `exec_schema` row. Expected message: `Added 10 workbench column header(s): Execution Needed, Execution Context, ...`

✅ Pass criteria for Run 1: all 10 headers present in correct order; `exec_schema` log line confirms which were added.

### Run 2 — should be a no-op
7. **Run `runExecutionWorkbench`** again.
8. Check Master Action Board row 1. Expected: still exactly 10 workbench headers in columns Q–Z. **No duplicates** anywhere.
9. Check Sync Log. Expected: a new `exec_schema` row with message `All 10 workbench headers already present (no-op).`

✅ Pass criteria for Run 2: no duplicate headers, idempotent log message.

**If it fails:** if you see duplicate headers, `ensureExecutionColumns_` isn't matching by name correctly — check the literal strings. If the log says it added headers on Run 2, the existing-header detection logic is wrong.

- [✅] Test 1 passed

---

## Test 2 — Candidate selection (spec §9.2)

**Goal:** verify `findExecutionCandidates_` excludes, in order: `Done` rows, rows whose Owner is outside `EXECUTION_OWNER_ALLOWLIST`, rows that already have an Output Link, and rows that were already triaged (non-empty Execution Status) — with `Force Re-run = Yes` overriding all but the `Done` check.

The three latter skips exist because a `Missing Info` row never acquires an output link, so an output-link-only filter let the first 10 such rows monopolise the batch cap forever and rows past them were unreachable.

### Setup
Add 6 test rows to Master Action Board. Use any task IDs (e.g. `T-VERIFY-1` through `T-VERIFY-6`). Leave columns Q–Z blank for all 6 except where noted:

| Row | Task | Owner (col C) | Status (col D) | Execution Status (col U) | Output Link (col X) | Force Re-run (col Z) | Candidate? |
|-----|------|---------------|----------------|--------------------------|---------------------|----------------------|-----------|
| A | "Test row A — eligible" | `Rodrigo Fuentes` | `in_progress` | (blank) | (blank) | (blank) | **YES** |
| B | "Test row B — done" | `Rodrigo Fuentes` | `done` | (blank) | (blank) | (blank) | NO (status=done) |
| C | "Test row C — already executed" | `Rodrigo Fuentes` | `in_progress` | `Ready for Review` | `https://docs.google.com/example` | (blank) | NO (has output link) |
| D | "Test row D — force re-run" | `Rodrigo Fuentes` | `in_progress` | `Ready for Review` | `https://docs.google.com/example` | `Yes` | **YES** |
| E | "Test row E — someone else's" | `Dana Ortiz` | `in_progress` | (blank) | (blank) | (blank) | NO (owner out of scope) |
| F | "Test row F — awaiting my input" | `Rodrigo Fuentes` | `in_progress` | `Missing Info` | (blank) | (blank) | NO (already triaged) |

(The URL in col X for rows C and D doesn't have to be a real Doc — any non-empty string is enough for the candidate filter.)

### Run
1. **Run `runExecutionWorkbench`.**
2. Open Sync Log. Find the most recent `exec_candidates` row.
3. Expected: the candidate count includes rows A and D (and any other eligible rows already on the board), but **not** B, C, E or F. The "first 5" preview should mention rows A and D's task IDs.
4. Find the `exec_owner_filter` row. Expected: a count of at least 1 (row E), naming the allowlist in force.
5. Re-check row D. Expected: **Z is now `No`** — the workbench consumes the flag after re-classifying, so a forced row can't hold the batch cap open indefinitely.

✅ Pass criteria: A and D are candidates; B, C, E, F are not; `exec_owner_filter` logged; D's Force Re-run reset to `No`.

**If row E is a candidate:** either `EXECUTION_OWNER_ALLOWLIST` isn't set and the default `['Rodrigo Fuentes', 'Rod']` isn't matching your sheet's owner spelling, or `CONFIG` is shadowed by a stray `CONFIG.gs` (the workbench throws a specific error for this — read it).

**If row F is a candidate:** the Execution Status skip is missing; the batch cap will stall on the first 10 `Missing Info` rows.

**If it fails otherwise:** check that columns C, D, U, X, Z map to your actual Master Action Board columns. If the schema isn't in standard order on your sheet, candidate selection reads the wrong cells.

- [✅] Test 2 passed

---

## Test 3 — Missing-info → re-run round trip (spec §9.3)

**Goal:** verify the full classify → missing-info → user adds context → Force Re-run → Ready for Review with Doc workflow.

### Setup
Add **one** new test row to Master Action Board:

- **Task (col B):** `Follow up with Acme about the integration`
- **Owner (col C):** must be in `EXECUTION_OWNER_ALLOWLIST` — `Rodrigo Fuentes` unless you changed the property. An owner outside the allowlist is skipped before classification and this test will find no candidate.
- **Status (col D):** `in_progress`
- **Execution Context (col R):** leave blank
- **Force Re-run (col Z):** leave blank
- All other columns: leave blank

Note this row's Task ID (col A) — call it `<TASK_ID>` below.

### Pass 1 — expect Missing Info
1. **Run `runExecutionWorkbench`.**
2. Find your row in Master Action Board. Expected:
   - **Q (Execution Needed):** `Yes`
   - **S (Execution Type):** something like `summary` or `email` (model's choice)
   - **T (Missing Info):** non-empty — but note the classifier rubric was deliberately loosened, so it now only blocks on facts that would make the deliverable *wrong* (a metric it would have to invent, content that doesn't exist, an owner-only decision). Missing tone, length, or format is no longer blocking — the classifier handles those with `[BRACKETED PLACEHOLDER]`s in the prompt instead. **Landing `Ready for Execution` on Pass 1 is now the expected common case; see the note below.**
   - **U (Execution Status):** `Missing Info`
   - **V (Execution Status Reason):** `Classifier reported gaps; see Missing Info column`
   - **X (Execution Output Link):** still blank
3. In Sync Log, search for `<TASK_ID>`. Expected entries: `exec_classify_prompt`, `exec_classify_raw`, `exec_classify_parsed`, `exec_writeback`, `exec_gate` with message `SKIP — gate not met`.

✅ Pass 1 criteria: status = `Missing Info`, no Doc created, gate skipped.

### Pass 2 — add context, force re-run, expect Ready for Review with Doc
4. Edit your row's **Execution Context (col R)** to: `Audience: Acme COO. Deliverable: a short email reminding them of the integration testing window and asking for a date confirmation. Tone: friendly, low-pressure.`
5. Set **Force Re-run (col Z)** to `Yes`.
6. **Run `runExecutionWorkbench`.**
7. Find your row. Expected:
   - **U (Execution Status):** `Ready for Review`
   - **V (Execution Status Reason):** empty
   - **W (Latest Execution ID):** `EX-0001` (or the next available `EX-####` if you've run this before)
   - **X (Execution Output Link):** a Google Doc URL
   - **Y (Last Executed At):** an ISO timestamp like `2026-05-07T18:42:13.456Z`
   - **Z (Force Re-run):** `No` (workbench reset it)
8. **Click the X column URL.** The Doc opens. Verify the sections appear **in this order** — the work product first, diagnostics last, so the reviewer never scrolls past a prompt dump to reach the thing they're reviewing:
   - Title: `[EX-#### YYYY-MM-DD] Follow up with Acme...` (truncated to 60 chars)
   - **H1** — task ID `·` task
   - **H2 `Deliverable`** — a real follow-up email addressed to Acme COO
   - **H2 `Review Notes`** — empty paragraph for you to fill in
   - a horizontal rule
   - **H2 `Diagnostics`**, containing:
     - metadata table (Task ID, Execution ID, Execution Type, Owner, Created At, Source meeting, OKR link) — first column bold
     - **H3 `Missing Info (from classification)`** — should say `None noted`
     - **H3 `Generated Prompt (sent to execution LLM — for QA)`** — content in monospaced (Roboto Mono) font
9. In Sync Log, search for `<TASK_ID>` after the Pass 2 run. Expected: `exec_classify_*`, `exec_gate` with `PASS — executing`, `exec_run_prompt`, `exec_run_raw`, `exec_doc`, `exec_writeback`.

✅ Pass 2 criteria: Doc created in correct folder, status = `Ready for Review`, all Doc sections present in the order above.

### Pass 3 — confirm idempotency (no duplicate execution)
10. Do **not** edit the row.
11. **Run `runExecutionWorkbench`** again.
12. Open Sync Log. Find the latest `exec_candidates` row. Expected: the candidate count is **lower** than Pass 2 (your row is no longer eligible — X is filled, U is non-empty, and Z is back to `No`).
13. Re-check your row in MAB. Expected: W, X, Y, Z values are unchanged from Pass 2.

✅ Pass 3 criteria: row not re-classified, not re-executed, no new Doc.

**If Pass 1 lands `Ready for Execution` (or goes straight through to `Ready for Review`) instead of `Missing Info`:** that is now the *expected* outcome for most rows. The model decided it can draft something useful and flag its assumptions inline. Skip to step 8 and verify the Doc. To still exercise the missing-info path deliberately, use a task that would force the model to invent a number — e.g. `Send Acme the Q2 uptime figures they asked for` with no figures anywhere on the board.

**If Pass 2 lands `Missing Info` instead of `Ready for Review`:** read column T. The model wants a fact it refuses to fabricate. Add it to col R, set Z = Yes, run again. This is the normal UX, not a bug.

**If Pass 3 re-classifies your row:** check that col X actually contains the URL (sometimes Sheets auto-strips on paste), col U is non-empty, and col Z says `No` (case-insensitive). The candidate filter checks all three.

**Observed on the production board (2026-05-07):** HM-0005 ran the full round trip — Pass 1 `Missing Info`, context added to col R, `Force Re-run` set to `Yes`, Pass 2 logged `exec_gate PASS — executing`, assigned `EX-0001`, wrote Doc `1_zgzUeiBtcO54cloJkwHzVx4W9TgxkuiZ56DP-oAyb8`, set status `Ready for Review`, and self-cleared `Force Re-run` to `No`. Passes 1–3 are therefore demonstrated end-to-end against real data, not just synthetic rows.

- [✅] Test 3 passed (Pass 1)
- [✅] Test 3 passed (Pass 2)
- [✅] Test 3 passed (Pass 3)

---

## Test 4 — Both Not Automatable reasons (spec §9.4)

**Goal:** verify the workbench distinguishes the two `Not Automatable` reasons.

### Setup
Add 2 new rows. Leave Q–Z blank.

| Row | Task | Status |
|-----|------|--------|
| P1 | `Sign the MSA in person at Friday's meeting` | `in_progress` |
| P2 | `Decide on Q3 strategic priorities` | `in_progress` |

### Run
1. **Run `runExecutionWorkbench`.**
2. Find row P1. Expected:
   - **U:** `Not Automatable`
   - **V:** `Task not suitable for an LLM` (because the model marked `is_executable=false` — signing in person isn't an LLM-doable thing)
3. Find row P2. Expected:
   - **U:** `Not Automatable`
   - **V:** `Automation not selected by model` (because the model marked `execution_needed=No` — pure judgment isn't worth automating)

✅ Pass criteria: both rows = `Not Automatable`, but with the **distinct** V reasons.

**If P2 lands the wrong reason** (e.g., V says "Task not suitable for an LLM" instead of "Automation not selected by model"): the model called it `is_executable=false` instead of `execution_needed=No`. Both are technically "Not Automatable" so the user-facing outcome is correct, but the reason text differs. To verify which path the model took, search Sync Log for P2's task ID and read the `exec_classify_parsed` row — it shows the 6 fields. Either reason is acceptable for the test as long as U = `Not Automatable`.

**Partial coverage — read this before checking the box.** On the production board, HM-0004 and HM-0010 both landed `Not Automatable`, but *both* with reason `Automation not selected by model` (the `execution_needed=No` path). The `Task not suitable for an LLM` path (`is_executable=false`) has **not** been observed in a real run. The code path exists and is a single branch in `runExecutionWorkbench`, but it is unverified by observation. Treat this test as half-passed until a row exercises it.

- [✅] Test 4 passed — `Automation not selected by model` observed (HM-0004, HM-0010)
- [ ] Test 4 passed — `Task not suitable for an LLM` **not yet observed in any run**

---

## Test 5 — Doc layout & folder placement (spec §9.5)

**Goal:** verify the Doc lives in the right folder and has all required sections.

This is largely covered by Test 3 step 8, but make it explicit:

1. Open the folder whose ID is in the `EXECUTION_OUTPUT_FOLDER_ID` script property (`https://drive.google.com/drive/folders/<that-id>`).
2. Verify the Doc(s) created during Test 3 appear here. Title format: `[EX-#### YYYY-MM-DD] <task...>`.
3. Open one Doc. Verify in order from top: title → **H1** (task ID · task) → **H2 `Deliverable`** → **H2 `Review Notes`** (empty paragraph) → horizontal rule → **H2 `Diagnostics`** → metadata table (7 rows, bold first column) → **H3 `Missing Info`** → **H3 `Generated Prompt`** (Roboto Mono).

The deliverable-first ordering is the point of this test, not incidental: the prompt dump used to sit above the output, which meant reviewing a draft started with scrolling past a page of monospaced diagnostics. If you see the prompt before the deliverable, you are running a stale `Code.gs`.

✅ Pass criteria: Doc is in the configured folder (not in My Drive root), all sections present, deliverable above the horizontal rule and every diagnostic below it.

**If the Doc landed in My Drive root:** the script runner doesn't have edit access to the configured folder. Right-click the folder → Share → add the Apps Script project owner's email as Editor. Then re-run the test.

- [ ] Test 5 passed

---

## Test 6 — Lock contention (spec §9.6)

**Goal:** verify a second concurrent invocation logs `exec_skipped` and doesn't double-process.

Apps Script editor only runs one function at a time, so we simulate a collision.

### Setup
1. Open Apps Script editor.
2. At the very bottom of `Code.gs`, paste:

```js
function _debugLockCollision() {
  var lock = LockService.getScriptLock();
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

3. Save the script.

### Run
4. **Run `_debugLockCollision`.**
5. Open the editor's execution log (View → Logs, or the small log panel that opens after execution). Expected lines:
   - `OUTER: acquired lock; calling runExecutionWorkbench (should skip)`
   - `OUTER: returned from runExecutionWorkbench`
6. Open Sync Log. The most recent entry should be `exec_skipped` with message `Another workbench pass is already running — skipped.`

✅ Pass criteria: nested call logs `exec_skipped` and returns immediately.

### Cleanup
7. Delete the `_debugLockCollision` function from `Code.gs`. Save.

- [ ] Test 6 passed

---

## Test 7 — Batch cap (spec §9.7)

**Goal:** verify the batch limit (10) is enforced — extras wait for the next pass.

### Setup
1. Add 12 fresh, eligible rows to Master Action Board. The cleanest way:
   - 12 rows with simple, varied LLM-doable tasks (e.g., "Draft a 1-paragraph welcome email to <person>", "Summarize the key points of <topic>", etc.).
   - All with status=`in_progress`, blank U, blank X, blank Z, and **Owner set to a name in `EXECUTION_OWNER_ALLOWLIST`** — out-of-scope owners are filtered before the cap is counted, so mixed owners make this test unreadable.
2. Make sure no other prior eligible rows are around — clean up Test 3's row by setting its status=`done` first, so Test 7's count is clean.

### Run 1
3. **Run `runExecutionWorkbench`.**
4. Open Sync Log. The latest `exec_candidates` row should report **exactly 10**.
5. Open Master Action Board. Expected: exactly 10 of your 12 rows have columns Q–V populated by the classifier. **2 rows are untouched** (Q–Z still blank).

✅ Pass criteria for Run 1: candidate count capped at 10; 2 rows un-classified.

### Run 2
6. **Run `runExecutionWorkbench`** again.
7. Expected: the 2 previously-untouched rows are now classified (and possibly executed, depending on the model's classification). **None of the original 10 are revisited** — a non-empty Execution Status is itself a skip, so a `Missing Info` row waits for a human rather than being re-classified every pass. The candidate count this time should be **2** (plus any other genuinely fresh rows).

✅ Pass criteria for Run 2: the 2 leftover rows now have classifications, and the original 10 are untouched — check their `Last Executed At` / classification cells are unchanged.

**Why this matters:** before the Execution Status skip, a `Missing Info` row never acquired an output link, so it stayed eligible forever. The first 10 such rows consumed the batch cap on every single pass — each costing ~15s and one gpt-5 call — and rows beyond them were permanently unreachable. If Run 2 re-classifies the original 10, that regression is back.

**If Run 1 reported more than 10 candidates:** `EXECUTION_BATCH_LIMIT` isn't being respected — check the `if (candidates.length >= CONFIG.EXECUTION_BATCH_LIMIT) break;` line in `findExecutionCandidates_`.

- [ ] Test 7 passed

---

## Test 8 — Duplicate transcript suppression

**Goal:** verify the same meeting arriving as two Drive files produces board rows only once.

This is an ingestion-stage test (`processInbox`), not a workbench test, but it guards the workbench's input: a duplicated transcript means the workbench executes twice against near-identical rows.

### Setup
1. Pick a Doc already in the inbox folder that has a `processed` row in **Processed Sources**. Note its title.
2. Make a copy of it *into the same inbox folder* (right-click → Make a copy). Drive will name it `Copy of [HM YYYY-MM-DD] <title>`.
3. Rename the copy so its `[HM YYYY-MM-DD]` date is **within** `PROCESS_LOOKBACK_DAYS` (14) of today, otherwise the window filter excludes it and this test proves nothing.

### Run
4. **Run `processInbox`.**
5. Open Sync Log. Expected a `duplicate_content` row naming the copy, with a message of the form `Same meeting content already processed as "<title>". Recorded as duplicate; no OpenAI call, no board rows.`
6. Check `process_done`. Expected the count phrased as `Processed N file(s) in Ms (plus 1 skipped as duplicate content).`
7. Open **Processed Sources**. Expected a new row for the copy with **status `duplicate`** and a non-empty **content_fingerprint (col J)** matching the original's.
8. Open Master Action Board. Expected **no new rows** from the copy.

### Run 2 — the duplicate stays settled
9. **Run `processInbox`** again.
10. Expected: **no** new `duplicate_content` row for the copy. `duplicate` rows count toward the idempotency set, so the file is never reopened or re-fingerprinted.

✅ Pass criteria: one `duplicate_content` log, `status=duplicate` in Processed Sources, zero new board rows, and silence on the second pass.

**If the copy gets fully processed instead:** the fingerprint didn't match. The fingerprint is an MD5 of the meeting date plus a whitespace-normalised, lowercased **200-character** opening — chosen because two extractions of the same meeting are not byte-identical (an observed pair differed by 28 chars) but their opening title-plus-summary is. Compare the two `content_fingerprint` values in col J. If they differ, the docs diverge inside the first 200 chars and the prefix window needs to shrink.

**If a genuinely different meeting gets marked `duplicate`:** two different meetings on the same date share a 200-char opening — unlikely, but the fix is to lengthen the window, not to disable the check. Clear the bad `duplicate` row from Processed Sources and re-run.

**If the copy is skipped for some other reason:** check the Sync Log line. `double-stamped copies` means the filename picked up a second `[HM ...]` stamp — a different guard, `isDoubleStampedName_`. `outside window` means step 3 was missed.

- [ ] Test 8 passed (Run 1)
- [ ] Test 8 passed (Run 2)

---

## Test 9 — Reflection notes (lab requirement)

After running Tests 1–8, you've seen the workbench succeed and fail across enough cases to answer the lab's reflection prompts.

1. Open `apps-script-meet-sync/REFLECTIONS.md`.
2. Replace each `(fill in)` placeholder with **1–2 sentences** based on what you observed during this verification:
   - **Easiest task types to execute well:** which kinds of tasks produced the best Doc output without needing context fixes?
   - **Where missing context hurt output quality:** which tasks landed in `Missing Info` first and required col R additions?
   - **Information that improved results most:** what kinds of facts (audience, format, tone, success criteria) made the biggest difference when added?
   - **What would I trust this to execute today:** which task types feel safe to ship straight from `Ready for Review` with light edits?
   - **What still needs human judgment:** which task types are clearly out of scope (and confirmed by the `Not Automatable` rows)?

- [ ] REFLECTIONS.md filled in

---

## Final commit

Once all boxes above are checked:

```bash
git add apps-script-meet-sync/REFLECTIONS.md apps-script-meet-sync/VERIFICATION.md
git commit -m "docs: execution workbench end-to-end verification + reflections"
```

---

## Cleanup checklist

After verification is complete:
- [ ] Delete the test rows you added during Tests 2, 3, 4, 7 from Master Action Board (or set them all to `status=done` and let the candidate filter ignore them naturally).
- [ ] Delete the test Docs created during Tests 3, 7 from the execution output folder if you want a clean slate.
- [ ] Trash the duplicate copy created in Test 8, and delete its `duplicate` row from Processed Sources.
- [ ] If you re-installed the hourly trigger during Task 11, leave it on (production wants it). If not, click **Execution Workbench → Install / refresh hourly trigger** to enable it now.

---

## Quick troubleshooting reference

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `TypeError: Cannot read properties of null (reading 'tryLock')` | Using `getDocumentLock()` in a standalone script | Already fixed — should be `getScriptLock()` in Code.gs |
| `SCRIPT_PROPERTIES: MISSING` from diagnoseConfig | One of the 4 properties not set | Apps Script editor → Project Settings → Script Properties → add it |
| `exec_classify_prompt` logged but no `exec_classify_raw` | Classifier API call failed | Check Sync Log for `exec_error` row with the same task ID; usually OpenAI auth or quota |
| Doc lands in My Drive root, not the configured folder | Folder permission missing | Share `EXECUTION_OUTPUT_FOLDER_ID` folder with script runner as Editor |
| Force Re-run = Yes ignored | Cell value isn't matching `'yes'` | The check is case-insensitive but trimmed — make sure cell is plain text `Yes`, not a formula or checkbox |
| Same row keeps re-executing every pass | X column got cleared, or Z stayed `Yes` | Check both — workbench resets Z to `No` after a successful execute |
| `CONFIG.EXECUTION_OWNER_ALLOWLIST is undefined, expected an array` | A second `.gs` file declares `var CONFIG` and shadowed `loadConfig_()` | Delete every `.gs` file except `Code.gs` from the Apps Script project, then re-run |
| Workbench reports 0 candidates but the board has obvious work | Every eligible row is owned by someone outside the allowlist | Read the `exec_owner_filter` Sync Log row for the count and the allowlist in force |
| Same batch of rows classified on every pass, later rows never reached | Running a `Code.gs` predating the Execution Status skip | Re-paste the current `Code.gs`; see Test 7 Run 2 |
| Near-duplicate task rows from one meeting | Two Drive files hold the same transcript | See Test 8; check for a `duplicate_content` Sync Log row |
| New files named `[HM date] [HM date] ...` | An old `discoverFromDrive` is still deployed and re-copying inbox files | Deploy current `Code.gs` **first**, then run `cleanupDoubleStampedCopies` (dry run) and `cleanupDoubleStampedCopiesForReal`. Cleaning before deploying just lets the 15-min trigger recreate them |
