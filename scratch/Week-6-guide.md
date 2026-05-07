# Week 6 — Enforcer, QA sheet columns & human-feedback loop (implementation guide)

This document specifies **what to build**: automated QA of execution artifacts (Google Docs), multi-pass revision with scored loops, Master Action Board columns, ingestion of reviewer notes into Learnings, and rescoring with fair comparison between revision URLs. Follow it as the single source of behavior while implementing; suggested module names match the Hive Mind repo layout but the spec is portable.

An ordered task breakdown lives in `scratch/Week-6-plan.md`.

---

## 1. Objectives

1. When **execution** produces a primary Google Doc for a task row, **score** that artifact with multiple LLM passes and persist results on the **Master Action Board**.
2. If the combined score is below a configurable threshold, **revise** in a closed loop: evaluate → apply structured revision instructions → create a **new** Doc per attempt → re-evaluate, until one of the standard stop conditions fires (see §6).
3. Allow humans to annotate the Doc with **`FEEDBACK:`** and **`GENERAL RULE:`** lines; **ingest** structured feedback into Drive-backed Learnings (judgment log + project rules).
4. After ingestion, optionally run the **same** revision loop semantics as (2) driven by reviewer feedback, then **rescore** the resulting Doc. When comparing to a **different** “best” revision URL, **fair-score** that prior Doc under the **same** feedback-augmented evaluation bundle before deciding which URL wins.

---

## 2. Data flow

```
Master row
  → Resolve artifact URL (execution output / latest / best revision)
  → Export Doc plain text (Drive API)
  → Pipeline: Universal QA → Task-type rubric → Task-specific criteria → Combined judgment (+ revision instructions)
  → Below threshold: revise → new Doc → repeat until stop condition
  → Write QA columns and revision URLs to sheet

Feedback path (same row):
  → Export reviewer Doc → parse markers → update Learnings
  → If revision enabled: feedback-driven evaluate/revise loop (new Doc per attempt, same stop rules as main loop)
  → If rescore enabled: combined scoring on chosen Doc; fair-score prior-best URL when applicable; update columns
```

---

## 3. Configuration (environment)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_SHEET_ID` / `GOOGLE_SHEETS_SPREADSHEET_ID` | Command-center spreadsheet |
| Service account / OAuth | Sheets + Drive access (match project auth pattern) |
| `OPENAI_API_KEY` | LLM calls |
| `EXECUTION_DRIVE_FOLDER_ID` | Root folder for execution and Enforcer artifact Docs |
| `LEARNINGS_DRIVE_FOLDER_ID` | Folder for Learnings artifacts |
| `LEARNINGS_JUDGMENT_LOG_FILE_ID` | Optional; pin/update existing judgment log file |
| `LEARNINGS_PROJECT_RULES_FILE_ID` | Optional; pin/update existing project-rules file |
| `ENFORCER_QUALITY_THRESHOLD` | Combined score target (default commonly 90) |
| `ENFORCER_MIN_IMPROVEMENT_DELTA` | Minimum score gain between successive scored revisions to continue |
| `ENFORCER_MAX_REVISION_ATTEMPTS` | Upper bound on revision attempts per loop |
| `ENFORCER_MODEL` | Model for Enforcer JSON + revision calls |
| `ENFORCER_RESCORE_AFTER_FEEDBACK` | When false, skip rescoring after feedback ingest |
| `ENFORCER_REVISION_AFTER_FEEDBACK` | When false, skip generating post-feedback revision Docs |
| `EXECUTION_CONTEXT_DOC_*` | Limits for linked context Docs (per file, total, max files) |
| `SHEET_TAB_MASTER` (etc.) | Override tab names if needed |

Execution-specific models may remain separate (e.g. `EXECUTION_MODEL`).

---

## 4. Master Action Board — schema

### 4.1 Column blocks

Define a single ordered list of column keys (e.g. `MASTER_COLUMNS`) and matching row-1 labels.

1. **Base block** — task metadata (fixed count, e.g. 16 columns A–P).
2. **Execution extension** — execution-needed fields through **Execution Context Doc Links** (fixed count of labels).
3. **QA / Enforcer block** — appended immediately after execution columns.

Compute the **0-based index** where the QA block starts as `base_count + execution_extension_count`. Any code that reads/writes QA cells must use this offset.

### 4.2 QA block columns (conceptual order)

| Header (example label) | Meaning |
|------------------------|---------|
| QA Status | e.g. complete / failed / pending |
| Universal/Task/Artifact Score | **One cell**, display format `u/tt/ts` — three subscores from the **combined** judgment (`universal_score`, `task_type_score`, `task_specific_score`). Missing segments may render as `-`. |
| Final Enforcer Score (combined) | Holistic `overall_score` from the combined pass |
| Revision Count | Number of revision attempts attributable to the last relevant run (see §7) |
| Revision Delta (new vs baseline) | Human-readable delta vs baseline after feedback rescoring (§4.4); main Enforcer run may use step-wise delta vs prior pass |
| Best Revision URL | Canonical link to highest-quality revision seen |
| Latest Revision URL | Most recently produced revision link |
| Ready for Production | Derived from threshold vs final score |
| Stop Reason | Machine-readable exit reason (§4.5) |
| Human Feedback Captured | Whether ingest found artifact-specific / general feedback |
| General Rules Updated | Whether project rules or judgment log changed |

Maintain a small map of **legacy header strings → current label** so row 1 can be upgraded in place when labels rename.

### 4.3 Score semantics

- **Universal/Task/Artifact**: Three numbers from one combined evaluator pass; they are not independent sheet columns.
- **Final Enforcer Score**: Same pass’s overall score; drives “ready for production” messaging against threshold.

### 4.4 Revision Delta (feedback rescoring)

Specify behavior:

- Compute **new** combined score after rescoring the Doc being evaluated.
- **Baseline**:
  - If **Best Revision URL** references another Doc and that Doc is **fair rescored** using the **same** feedback-augmented task bundle, baseline = that fair score (**fair prior best**).
  - Else baseline = **prior sheet final** combined score before overwrite (**prior sheet final**).

Display a short explanation, e.g. `(+N) (fair prior best: B -> R)` or `(+N) (prior sheet final: B -> R)`.

**Sheets API constraint:** When writing with `USER_ENTERED`, avoid cell text that **starts with `+`** (and generally avoid strings that Sheets parses as formulas). Encode signed deltas in parentheses: `(+13)`, `(-4)`, `(0)`.

### 4.5 Stop Reason

Use one shared vocabulary for **both**:

- Main Enforcer revision loop  
- Post-feedback revision loop  

Standard values include:

- `quality_threshold_met`
- `score_decreased`
- `improvement_below_delta`
- `max_revision_attempts_reached`

**After feedback ingest:**

- If the **feedback revision loop** ran to completion, persist **`loop_stop_reason`** from that loop into **Stop Reason** (same strings as above).
- If rescoring ran **without** that revision loop (revision disabled, revision error, or ingest-only rescore path), set **Stop Reason** to **`Rescoring only - no revision`** — see §7.2.

Do not use opaque placeholders (e.g. a generic “feedback revision done”) where the loop already exposes a concrete exit reason.

### 4.6 Migrating older sheets

If an existing workbook still has **three** separate numeric columns (Universal / Task Type / Task Specific) before **Final Enforcer Score**:

1. **Merge columns**: For each row, concatenate the three values into one cell `u/tt/ts`, shift subsequent cells left, and rewrite headers so only **Universal/Task/Artifact Score** remains.
2. **Trim grid width**: Physical columns that become redundant after the left shift must be **removed or cleared** so duplicate trailing headers (e.g. repeated Human Feedback / General Rules) do not appear.

Running schema enforcement before relying on column indices should apply migration when legacy headers are detected, then reconcile row 1 labels.

---

## 5. Suggested module layout

| Module | Responsibility |
|--------|------------------|
| `sheetSchema.js` | Column keys, header arrays, helpers (`columnToA1Letter`, merged score formatter) |
| `commandCenterSheets.js` | Get/update rows, ensure headers, optional migration/repair |
| `enforcerConfig.js` | Thresholds, model, feature toggles |
| `enforcerPipeline.js` | Universal QA, task-type rubric, task-specific criteria, combined evaluation, `reviseArtifact` |
| `enforcerDrive.js` | Per-task folders, create templated artifact Docs |
| `enforcerWorkbench.js` | Orchestration: main loop, sheet patches, feedback pipeline, fair comparison |
| `feedbackIngest.js` | Plain-text parsing → structured feedback + learnings writes |
| `learningsStore.js` | Judgment log append, project-rules merge, Drive file lifecycle |
| `googleDriveDocs.js` | Export text, parse Doc URLs/ids, fetch linked docs |
| `executionWorkbench.js` | Shared row padding and execution column indices (`IDX`) |
| `openAiChat.js` | LLM HTTP wrapper |
| `enforcerCli.js` | CLI |
| `server.js` | HTTP routes for Enforcer and feedback |

---

## 6. Main Enforcer loop (behavior)

1. Select a row: must have execution output link; exclude Done rows; skip rows already QA-complete unless forced.
2. Export draft Doc; isolate artifact body, execution prompt, and optional linked context Docs (with caps).
3. Load relevant **project rules** excerpt for revision prompts.
4. **Evaluate**: universal → task-type rubric → task-specific → combined (scores + revision instructions).
5. **Iterate** until stop:
   - Track **best** score and URL across iterations (best may remain the original draft).
   - Each revision: call reviser with structured signals + rules + optional human-feedback summary (unused on main path unless ingesting inline).
   - Create **new** Doc per revision attempt with version label (e.g. Revised v2…).
   - Re-evaluate new artifact.
   - **Stop if**: new score `<` previous scored score; or score `>=` threshold; or gain `<` min improvement delta; or attempts `>=` max; or equivalent guards as implemented.
6. Write all QA columns; set **Revision Delta** for this run to **step vs prior scored pass** (sheet-safe formatting).

---

## 7. Human feedback ingest (behavior)

### 7.1 Doc resolution

Resolve URL in order: **Latest Revision URL** → **Best Revision URL** → **Execution Output Link**.

### 7.2 Revision vs rescore (independent toggles)

Feedback ingest should support **four** combinations from operator/env flags:

| Revision | Rescore | Typical use |
|----------|---------|-------------|
| on | on | Default: apply learnings, regenerate Doc(s), refresh scores |
| on | off | Produce revisions without rewriting QA numbers |
| **off** | **on** | **Rescore-only**: capture feedback + Learnings, **do not** create Human-feedback revision Docs; still run combined scoring on the **existing** Doc so the sheet reflects judgment under the updated feedback-augmented bundle |
| off | off | Ingest markers only (Learnings / flags) |

**Why rescoring without revision:** Operators may want updated scores and deltas **against** newly merged GENERAL RULEs and extracted FEEDBACK context **without** spending tokens or creating new Docs — for example when the artifact is frozen but the rubric context changed, or when debugging scoring.

When **revision did not run** but **rescore did**, **Stop Reason** must be **`Rescoring only - no revision`** — **not** a loop exit code.

When **revision ran**, **Stop Reason** must be the **revision loop’s** exit reason (same enum as §4.5).

### 7.3 Revision loop details

When revision is on and structured feedback exists:

- Build task bundle including human feedback summary.
- Run the **same** evaluate → revise → new Doc → re-evaluate loop as §6 (shared stop rules and thresholds).
- Increment **Revision Count** by the number of revision **attempts** in that loop, not necessarily by one.
- Version labels should distinguish human-feedback revisions (e.g. Human-feedback vN).

### 7.4 Fair best-url comparison

If **Best Revision URL** differs from the Doc just scored:

- Export plain text for both.
- Score the **current** candidate as usual.
- **Fair-score** the prior-best Doc using the **same** feedback-augmented bundle (same prompts/task text).
- Pick the URL with higher fair combined score; record decision metadata if returning JSON.

### 7.5 Markers (`feedbackIngest`)

- **`FEEDBACK:`** — artifact-specific instructions (may appear inline).
- **`GENERAL RULE:** — durable rules → project rules + judgment log per product rules.
- Support an optional **`=== Review Notes ===`** region: unmarked lines there still count as artifact feedback for backward compatibility.

---

## 8. HTTP API (shape)

- **POST `/api/enforcer/run`** — Optional body: `task_id`, `force`, `ingest_feedback`. Runs main loop for one eligible row (or filtered row).
- **POST `/api/enforcer/feedback`** — Body: `task_id`, optional `rescore`, `revision` booleans to override defaults.

---

## 9. CLI (shape)

```bash
npm run enforcer:run -- [--task=TASK_ID] [--force] [--ingest-feedback]
npm run enforcer:feedback -- --task=TASK_ID [--no-rescore] [--no-revision]
```

---

## 10. Drive layout

- **Artifacts**: Under execution root, one folder per `task_id` (or equivalent), containing Enforcer-generated Docs with titles encoding task id + version label + timestamp.
- **Learnings**: Canonical **judgment-log.json** and **project-rules.md**; create on first use when folder/file ids configured, then update in place.

---

## 11. Validation checklist (acceptance)

1. Execution row → Enforcer run → QA columns populated; merged triple score renders as three slash-separated values.
2. Below-threshold artifact → multiple revision Docs → Stop Reason and Revision Count match loop behavior.
3. Doc with FEEDBACK + GENERAL RULE → feedback command with defaults → Learnings updated, new human-feedback revision Doc(s) when revision enabled, rescore writes Revision Delta and correct Stop Reason (`loop_stop_reason`).
4. **`--no-revision`** (or env off) with rescore on → **no** new Human-feedback Doc; scores refresh; Stop Reason is **`Rescoring only - no revision`**.
5. After any sheet merge migration, physical column count matches logical `MASTER_COL_COUNT` (no duplicate tail headers).

---

## 12. Design constraints (non-obvious)

- **Fair scoring**: Prior-best and new Doc must be judged with the **same** augmented context when URLs differ.
- **Sheet writes**: Avoid leading `+` on Revision Delta cells under `USER_ENTERED`; use parenthesized deltas.
- **Single triple-score column**: Prefer one display column plus migration from legacy three-column layouts so operational sheets stay aligned with code.
