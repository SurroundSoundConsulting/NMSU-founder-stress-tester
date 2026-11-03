# Executor acceptance record

Observed November 2, 2026, America/Denver. Initial baseline: 12 tasks, 6 completed
sources, 2 pending merge reviews. Existing Sheet and Apps Script retained.
Private API deployment updated to version 7 after live verification.
Implementation and live draft/edit/rerun QA passed. One native agenda exists for
HM-0013 after one successful drafting call; unchanged reruns make zero extra calls.
The draft remains ready for the facilitator’s final review, and the task stays open.

## Active application

| Check | Result | Evidence |
|---|---|---|
| A1: same application / repeated setup | PASS | Original task and ingestion snapshot matches exactly after repeated setup; stable task Sheet ID retained. Only Tasks, Reviews, Drafts visible. Five former task-view tabs were removed only after Google Sheets user-entered-cell inspection verified formula-only display content; all other internal/archive tabs preserved and hidden. |
| A2: correct task | PASS | HM-0013, Jordan, open, 2026-11-06, urgency 0; actual prerequisite HM-0010 done. Original source history and project identity separate Arroyo from October 26 work. |
| A3: scope gap | PASS | With scope binding absent, live preflight returned Needs approved scope with a concrete next step, zero drafting calls and no Doc. |
| Context preparation | PASS | Actual script account opened original scope plus A–C, verified native Docs/location and accepted ingestion versions, resolved links and prepared hashes. Approval remained no. |
| Completion search | PASS within declared scope | The app-created dedicated completion folder was inspected and contained zero files/matches. Result explicitly excludes unconnected work. |
| A4: real grounded native draft | PASS live | Facilitator explicitly approved the four prepared versions and one draft run. One successful gpt-4.1 call (HTTP 200, safe response ID retained) produced one native Google Doc, with a visible ready-for-review link against HM-0013. |
| A5: content/layout review | Codex QA PASS; final facilitator draft review pending | All factual claims checked against task/scope/A–C. Judgment: supported and useful. Google Docs renderer showed the complete 211-word agenda on page 1 and sources on separate pages 2–3. The four phases total 20 minutes. Added a note explicitly labeled automated Codex QA; no claim that the facilitator approved the final draft. |
| A6: edited-Doc rerun | PASS live | Real native Docs edit added the identifiable QA note. Unchanged rerun retained the same link/execution, exact edited text and Doc revision, one output Doc and zero additional model calls. This exercised a real edit through the Docs API outside the Executor; it was not a mock or a claim of human keystrokes. |
| A7: earlier work | PASS live after publication/rerun | All captured A–P values/formulas/IDs/timestamps, original completions, baselines, history, source registry/journal and merge reviews equal the pre-build snapshot. Both pending reviews remain unresolved. Successful Executor state, decisions, source evidence, requests and context are also exactly unchanged on rerun; only Executor Runtime can grow. |

The build-plan approval was explicit. Source approval was a separate guide-required
human decision, explicitly received after source preparation; it was not inferred
from build authorization. Shared source
Docs were not modified. No triggers, sending or automatic business completion.

## Reliability, isolated test mode

`npm test`: **93 passed, 0 failed** (63 existing tests plus 30 Executor tests).
These are local VM fixtures/mocked Google/provider adapters, not live Google
concurrency or deliberate interruption of the working classroom application.

| Check | Result / mode |
|---|---|
| B1: done suppression / other engagement | PASS local: done task and accepted matching completion metadata suppress model/create; other-engagement completion does not count. Actual bounded search report retained; unrelated completion files do not stale an existing draft. |
| B2: reviews / prerequisites / access / output / changes | PASS local: relevant review, unfinished prerequisite, denied source, malformed/HTTP model response, invalid exact support and changed source stop clearly; unrelated reviews preserved. Source preparation/approval detects intervening human settings edits. |
| B3: overlap / create-write interruptions | PASS local: overlapping call cannot invoke second model/create; ambiguous create cannot auto-retry; zero search results do not clear uncertainty; unique inspected adoption or matching-content finish avoids duplicate Doc/append; known successful content write can finish after ledger failure. |
| B4: stale/human edits / recovery / versions | PASS local: row sorting preserves stable ID; model-time and post-create task edits stop publication; output revision conflict/human content protected; successful rerun preserves reviewer text and ledger/source evidence; explicit version/recovery replay idempotent. Edited version cells cannot bypass immutable request decision; disabling during drafting stops create/write. |
| B5: limits / untrusted sources | PASS local: source/context/attempt/runtime limits defer; source instructions cannot authorize sending, key disclosure or task completion; model payload excludes the credential. Folder redirection cannot publish outside the app-owned destination. |

Independent Spec and Standards reviews found request-version bypass, mid-run
request-disable behavior and source-limit labeling issues. Each was reproduced
with a failing test and fixed. A later completion-inspection timestamp issue was
also reproduced/fixed: inspection stores its audit without rewriting the request.

## Private evidence and repeatable checks

Private, ignored files under session2-private include executor-before.json,
executor-qa-paths.json, setup/preflight/preparation results and executorSnapshot
responses. No credentials or raw task/state snapshots are committed. The original
provided guide is saved privately as executor-guide.json for traceability.

The live sequence passed: explicit source approval -> real run -> native content
and Google-rendered layout QA -> identifiable reviewer note -> unchanged rerun.
Private acceptance-executor.json records the assertions. Re-run the saved-evidence
checker with `node scripts/qa-executor.cjs`; its paths are recorded privately in
executor-qa-paths.json. This checker requires live snapshots, output listing,
source/claim evidence and reviewer-edit captures; a script returning success alone
is not its pass condition.

One actual output Doc exists in the private output folder. Execution identity:
2cd5b934-fc42-4431-b47a-bae235cf5e0d. Provider model gpt-4.1-2025-04-14, HTTP 200;
response ID chatcmpl-Eg0eGtZh1FVlZjoXdQOEvBtR5kx0w. No live model proposal was
rejected in this run; mandatory audience/duration/boundary fields were rendered
by code from accepted facts, while the model supplied timed activities and
supporting passages. The only post-publication content edit was the disclosed
Codex QA note, not a hidden correction to the model output.

Business status remains open; final facilitator review of the proposed agenda is
intentionally pending. Nothing was sent, scheduled, externally shared or marked
done. Timers remain absent. The native work product and code are ready for review.
