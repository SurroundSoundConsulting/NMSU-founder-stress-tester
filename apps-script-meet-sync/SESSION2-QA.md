# Session 2 acceptance record

Observed November 1, 2026, America/Denver. Existing classroom Sheet and bound
Apps Script were retained. Initial N=3 tasks (HM-0007–HM-0009), S=1 completed
source (SYN-MTG-001). No business action items were executed, messages sent or
triggers installed.

Current board: **9 tasks, 5 completed sources, 2 pending reviews**.
Private API deployment version **4**. Session 2 extraction used gpt-4.1; the
Week 1 model setting was retained. Credentials and raw snapshots remain ignored.

## Main lab: observed live results

| Check | Result | Evidence / limitation |
|---|---|---|
| A1: additive repeated setup | PASS | Same board; original three rows, formulas, IDs, timestamps and original completion match the initial private snapshot. Setup was repeated without duplicate tables/headers. |
| A2: Meeting A | PASS after approved correction | Five Arroyo tasks exist. Initial model incorrectly proposed legacy matches; protective merge rules preserved legacy rows but created five reviews and only three tasks. Facilitator explicitly approved the displayed correction: added HM-0013/HM-0014 and dismissed those five erroneous reviews. Original extraction, history and completion evidence were retained; correction has a separate approval journal and API evidence. This was not a clean first-pass model success. |
| A3: Meeting B | PASS on retry | One new freight task HM-0015; hardware HM-0014 changed to Morgan, due November 9. Other rows/timestamps are byte-for-byte unchanged from corrected A. Hardware ID, creation and original provenance survived. Earlier rejected attempt made no task/completion writes; its original cause was not captured. Rejection diagnostics now retain safe proposal evidence. |
| A4: human edit | PASS | Hardware master deadline November 12; machine baseline still November 9. Helper initially refused an ambiguous prose match, then was fixed/tested to select stored hardware deliverable identity. |
| A5: Meeting C | PASS after candidate enrichment | Zero new tasks, three task updates, two reviews. Scope and internal checklist done; customer checklist open; agenda open, due November 6, blocker/obsolete next step cleared, historical HM-0010 dependency retained. Hardware stayed November 12; conflict records baseline/current/proposed November 9/12/10. Initial clarification omitted candidate IDs; reusable quote-based enrichment added HM-0011/HM-0012 with before/after audit, without resolving it or re-extracting C. |
| A6: Meeting D and final text | D processing PASS; final wording PENDING | D completed with zero task additions/updates/reviews. First proposal's unnecessary no-action review was rejected before writes; revised contract passed on retry. Two descriptions inherited from A still embed stale blocker/deadline wording (HM-0013/HM-0014). Their dedicated status/deadline fields are correct. A concrete wording correction was shown for facilitator approval and remains unapplied pending that answer. |
| A7: operational views | PASS | Reference date November 4: Arroyo due view = HM-0013, HM-0012, HM-0015; no blocked rows; owner view includes all nine tasks including done/legacy work; blank risk/OKR views are valid. Actual Sheet formula outputs were read back. |
| A8: full A–D rerun | PASS | Four skips, zero model requests, zero extractions. Exact before/after equality of master values/formulas, timestamps, baselines, history, reviews, journals, registry and completions. View values also identical. Run Log growth allowed. |

Task IDs: scope HM-0010; internal readiness checklist HM-0011; customer onboarding
HM-0012; agenda HM-0013; hardware quotes HM-0014; freight options HM-0015.

Both main-lab reviews remain pending. Neither checklist was selected for sending.
The human November 12 deadline was not replaced. Final wording is deliberately
reported separately; a green count/view check does not establish clean task text.

## Reliability: isolated verification

`npm test`: **54 passed, 0 failed**. The following are local fixture/mocked checks,
not claims of live failure injection or real concurrent Google executions.

| Check | Result and mode |
|---|---|
| B1: input/API/proposal failures | PASS, local mocks: malformed metadata, inaccessible input, HTTP error, invalid JSON, fabricated quotes, unknown ID, invalid values; no task/completion writes; later valid source remains eligible. Live expired-key 401 also caused no task/completion writes before replacement. |
| B2: source identity | PASS, local: Drive rename ignored; edited completed transcript or Project-only change creates review without extraction. Live full rerun separately established unchanged-source skips. |
| B3: field/chronology protection | PASS, local: human values/formulas including baseline-displaying formula; missing baseline, older/same-date conflict, done reopening, absent vs clear, newer fact confirmation dates. Live C established the human deadline case. |
| B4: concurrency/interruption | PASS, mocked overlapping lock attempt and injected history-write failure: no duplicate append/completion, no fresh extraction, inspected recovery succeeds, unexpected human edit refuses replay. No deliberate live classroom interruption or live concurrency test. |
| B5: review resolution | PASS, local: audited keep/apply/link/create/dismiss, stale refusal, idempotent replay, interrupted resolution blocked until recovery. Main-lab reviews intentionally left pending. |
| B6: limits/views | PASS, local: source attempts/runtime/context/text bounds visible; completed skips do not consume new-source budget; seeded risk/known-objective view policy and unknown-objective rejection. Live normal views separately verified under A7; seeded risk/OKR formula output was not tested in the classroom Sheet. |

Additional regressions cover Project fingerprint migration with original evidence
preservation, task identity matching, model-time human edits, approval-gated
correction/recovery, repeated candidate enrichment with unique audit keys, and
human-approved wording maintenance. Two independent code-review passes identified
issues which were fixed and regression-tested; final requested rereviews reported
no remaining actionable findings.

## Repeatable evidence

Commands and operational controls are in [SESSION2.md](SESSION2.md). Private
`session2-private/acceptance-A.json`, `acceptance-B.json`, `acceptance-C.json`,
`acceptance-D.json` and `acceptance-rerun.json` record checks and snapshot names.
The rerun checker compares entire durable snapshots, not just row counts.
Raw function responses retain safe API model/response/status evidence.

Model interpretation failed in several attempts despite valid JSON. Strict
schema, grounding checks, conservative merge rules and pre-write lab checks
reduced their effects; semantic readback still found missing candidates and
stale wording. Future transcripts use generic selected/batch/folder controls,
with pending reviews inspected by a human. Lab A–D expected counts are not a
universal correctness oracle.
