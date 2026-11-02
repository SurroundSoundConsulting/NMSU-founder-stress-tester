# Session 2 — Extend the Hive Mind

This upgrade uses the existing Week 1 Sheet, Apps Script project, Cloud project,
private key, A–P contract and HM-#### identifiers. It adds supporting state and
manual controls. Shared inputs are original native Docs read only from the configured folder.

## Part 1 — Carry Week 1 forward

Before upgrading, save code and private data/formula snapshots. The facilitator
baseline was three tasks (HM-0007–HM-0009) and one SYN-MTG-001 completion.
Private recovery files are under git-ignored `session2-private/`.

## Part 2 — Plan conservative merges

Identity is action + deliverable + project + audience. Owner/date/status can
change without creating a new task. The model sees all candidates within the
reported context limits; it proposes new, match or review with exact quotes.
A missing field is unchanged; explicit clearing requires quoted evidence.
Machine baselines retain per-field evidence dates. Conflicting human values or
formulas, older/same-date conflicts, unknown legacy baselines, and reopening done
work require review. Existing legacy rows receive no invented machine baseline.

## Part 3 — Initialize and grant document access

Merge the read-only `drive.readonly` and `documents.readonly` scopes into the
existing manifest; keep Sheets and external requests. Enable Drive and Docs
APIs in the existing Cloud project, then reauthorize the same OAuth client.

- `setupWeek2()`: additive supporting tables; no extraction.
- `setupWeek2Views()`: formula views, with reference date 2026-11-04.
- `verifySession2Inputs()`: folder membership, native type, one document tab,
  title, one ISO meeting date, Transcript section and fingerprints.

Properties: retain `SPREADSHEET_ID`, `OPENAI_API_KEY`, optional `OPENAI_MODEL`.
`INPUT_FOLDER_ID` defaults to the supplied shared folder; `SELECTED_FILE_ID`
selects a single original Doc. The Week 1 model default remains gpt-4o-mini. Session 2 uses optional
SESSION2_MODEL, default gpt-4.1 (the guide-tested model); this separate setting
was chosen after live gpt-4o-mini proposals failed grounding/identity validation.

State lives outside A–P: Task Baselines, Task History, Merge Reviews, Source
Registry, Source Journal, Run Log, OKR Registry and View Settings. Processed
Sources retains its Week 1 schema and old records. Journal entries hold intended
cell writes, expected values/formulas, stable event keys and phase. Incomplete
journals block fresh extraction and changes to affected tasks. Recovery compares
actual values with expected-before/intended-after; it never blind-replays.

## Part 4 — Stage A → B → human edit → C → D

Use `npm run session2 -- FUNCTION` from this directory. Every successful call
saves private evidence, and API errors or failed/needs-reconciliation outcomes produce a nonzero exit. Successful command execution alone does not prove semantic correctness; inspect the saved results and run the stage checker.

The named A–D controls are lab checks with expected-count guards before writes. For future transcripts use the generic selected/batch/folder controls below; they do not assume these classroom counts.

1. `processWeek2A`: expect five new Arroyo tasks, separate from legacy work.
2. `processWeek2B`: expect one freight task; hardware owner/deadline change only.
3. `session2HumanDeadline`: explicit lab demonstration, hardware November 9 → 12
   on master only; refuses a human formula and preserves baseline November 9.
4. `processWeek2C`: scope/internal done; agenda unblocked, due November 6;
   preserve human deadline and retain exactly two pending reviews.
5. `processWeek2D`: zero actions, but source completes.

`session2Status` exposes IDs, fields, reviews and baselines for inspection.
`processSelectedWeek2` uses SELECTED_FILE_ID; `processWeek2Batch(ids)` accepts
an explicit bounded selection. `processWeek2Folder` lists at most 100 original
native Docs; it stops visibly if folder pagination would exceed that bound.

## Part 5 — Operational views

Edit the master board, not the formula outputs. View Settings contains
reference_date, optional owner and optional okr filters. Due This Week is
Monday–Sunday and excludes done work. Blocked Work uses blocked status. By Owner
includes done work. Risk View includes unfinished medium/high tasks. OKR View
includes only codes registered in OKR Registry; unknown assignments are rejected.
Initially blank Risk/OKR views are valid because inputs assigned no ratings/codes.

## Part 6 — Full rerun and recovery

Take `session2Snapshot`, run `processAllWeek2`, then take another snapshot.
Expect four skips, zero new model requests, and identical board values/formulas,
IDs, timestamps, baselines, history, reviews, journal and completion records.
Only Run Log may grow. Compare the three legacy rows and original completion
against the pre-upgrade evidence as well.

- `inspectWeek2Recovery(sourceId)`: intended operations alongside actual values.
- `recoverWeek2Source(sourceId, 'INSPECTED_SAFE_TO_FINISH')`: explicit inspected
  repair; unexpected edits remain protected and require human reconciliation.
- `resolveWeek2Review(key, decision)`: requires `{confirmed:true, actor, reason,
  action}`; action is keep/apply/link/create/dismiss. Link needs task_id; create
  needs a human-confirmed task object. Stale decisions are rejected. Interrupted
  resolutions must be recovered from the existing journal, never resubmitted.
  Leave the two main-lab reviews pending.

Limits: four new-source attempts per batch, 240 seconds, 40,000 transcript
characters, 110,000 serialized context characters and 150 candidate tasks.
Completed skips do not consume the new-source attempt budget. Exceeding limits
returns deferred or a visible limit error; candidate lists are never truncated.

## Verification modes

`npm test` includes local fixture/mocked checks for metadata errors, grounded
proposals, identity, exact repeat preservation, chronology, human values/formulas,
partial-write recovery, stale decisions and views. The staged A–D fixture proves
merge behavior independently of model reliability; it is not live API evidence.
Live acceptance is recorded separately in the Session 2 handoff after the original
A–D Docs are processed in the classroom board. Deliberate failure injection stays
in mocks; shared inputs are never edited and the live board is never reset.

## Additional verification and maintenance controls

- `node scripts/session2-check.cjs A|B|C|D`: compare the latest private snapshot
  with the initial legacy snapshot and stage-specific task/review/view assertions.
- `node scripts/session2-wording-check.cjs BEFORE AFTER`: verify the approved
  two-description repair, protected fields, pending reviews and audit.
- `node scripts/session2-rerun-check.cjs BEFORE RUN AFTER`: exact durable-state
  and view comparison plus four skips and zero model requests.
- Source fingerprint version 2 includes Project as well as title, meeting date and
  transcript. Drive filename changes are ignored. `upgradeWeek2Fingerprints()`
  is a one-time compatibility step: it verifies the old content hash and recorded
  source-history project identities, retains the original hash/evidence and
  leaves the original journal/completion untouched. Unverifiable records stop for review.
- Clarification candidates can be suggested from quoted deliverable terms within
  the same confirmed project. They are suggestions only. `enrichWeek2PendingReviews()`
  repairs older missing suggestions with an audit journal and before/after record;
  it never resolves a request or changes tasks. Interrupted enrichment must be recovered first.
- `applyWeek2WordingCorrection(key, edits, decision)` supports separately approved
  description maintenance. Edits contain task_id, expected and task. Decision needs
  confirmed=true, actor and reason. It refuses edited/formula task cells, preserves
  all business fields and source completion, audits old/new text, and refreshes only
  previously current candidate snapshots while retaining pending decisions.
- `previewArroyoCorrection` / `applyArroyoCorrection` are the narrowly scoped,
  already-used Meeting A repair; their original extraction evidence remains intact.

The proposal schema restricts valid status values and grounded quotes. New task
text keeps mutable deadlines/status/blockers in dedicated fields. Failed proposal
validation records safe response evidence when available; run outcomes separately
report actual model-request counts, including rejected attempts.

No business tasks are executed. No messages are sent and no triggers are installed.
Processing is manual: add a native Google Doc to the configured input folder, set
SELECTED_FILE_ID in Script Properties, then run processSelectedWeek2 through Apps
Script or `npm run session2 -- processSelectedWeek2`. Inspect the master and pending
reviews. Use processWeek2Folder for a bounded selection when chronological human
edits are not required between inputs. Keep reviewing proposals for semantic errors;
local tests and a strict JSON schema cannot guarantee model interpretation.
