# Session 2 acceptance record

Observed November 1, 2026, America/Denver. Existing classroom Sheet and bound
Apps Script were retained. Initial N=3 tasks (HM-0007–HM-0009), S=1 completed
source (SYN-MTG-001). No business action items were executed, messages sent or
triggers installed.

Original A–D lab finish: **9 tasks, 5 completed sources, 2 pending reviews**.
After the additional unseen-transcript test: **12 tasks, 6 completed sources,
2 pending reviews**.
Private API deployment version **6** after the additional intake fixes. Session 2 extraction used gpt-4.1; the
Week 1 model setting was retained. Credentials and raw snapshots remain ignored.

## Main lab: observed live results

| Check | Result | Evidence / limitation |
|---|---|---|
| A1: additive repeated setup | PASS | Same board; original three rows, formulas, IDs, timestamps and original completion match the initial private snapshot. Setup was repeated without duplicate tables/headers. |
| A2: Meeting A | PASS after approved correction | Five Arroyo tasks exist. Initial model incorrectly proposed legacy matches; protective merge rules preserved legacy rows but created five reviews and only three tasks. Facilitator explicitly approved the displayed correction: added HM-0013/HM-0014 and dismissed those five erroneous reviews. Original extraction, history and completion evidence were retained; correction has a separate approval journal and API evidence. This was not a clean first-pass model success. |
| A3: Meeting B | PASS on retry | One new freight task HM-0015; hardware HM-0014 changed to Morgan, due November 9. Other rows/timestamps are byte-for-byte unchanged from corrected A. Hardware ID, creation and original provenance survived. Earlier rejected attempt made no task/completion writes; its original cause was not captured. Rejection diagnostics now retain safe proposal evidence. |
| A4: human edit | PASS | Hardware master deadline November 12; machine baseline still November 9. Helper initially refused an ambiguous prose match, then was fixed/tested to select stored hardware deliverable identity. |
| A5: Meeting C | PASS after candidate enrichment | Zero new tasks, three task updates, two reviews. Scope and internal checklist done; customer checklist open; agenda open, due November 6, blocker/obsolete next step cleared, historical HM-0010 dependency retained. Hardware stayed November 12; conflict records baseline/current/proposed November 9/12/10. Initial clarification omitted candidate IDs; reusable quote-based enrichment added HM-0011/HM-0012 with before/after audit, without resolving it or re-extracting C. |
| A6: Meeting D and final text | PASS after approved wording correction | D completed with zero task additions/updates/reviews. First proposal's unnecessary no-action review was rejected before writes; revised contract passed on retry. Facilitator explicitly approved removing stale blocker/deadline wording inherited from A in HM-0013/HM-0014. The audited correction changed only descriptions, their task-text baselines and update timestamps; source/provenance, all business fields, original records and both pending decisions were preserved. The pending deadline review snapshot was refreshed with before/after audit so wording maintenance does not invalidate its otherwise current facts. Final text checker passes with no stale descriptions. |
| A7: operational views | PASS | Reference date November 4: Arroyo due view = HM-0013, HM-0012, HM-0015; no blocked rows; owner view includes all nine tasks including done/legacy work; blank risk/OKR views are valid. Actual Sheet formula outputs were read back. |
| A8: full A–D rerun | PASS | Four skips, zero model requests, zero extractions. Exact before/after equality of master values/formulas, timestamps, baselines, history, reviews, journals, registry and completions. View values also identical. Run Log growth allowed. |

Task IDs: scope HM-0010; internal readiness checklist HM-0011; customer onboarding
HM-0012; agenda HM-0013; hardware quotes HM-0014; freight options HM-0015.

Both main-lab reviews remain pending. Neither checklist was selected for sending.
The human November 12 deadline was not replaced. Final wording was checked separately and passed after the approved correction;
a green count/view check alone does not establish clean task text.

## Reliability: isolated verification

`npm test`: **63 passed, 0 failed** after the additional intake/schema/date regressions. The following are local fixture/mocked checks,
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
`acceptance-D.json`, `acceptance-wording.json` and `acceptance-rerun.json` record
checks and snapshot names. The wording checker verifies exact preservation of all
other business fields, original records and pending review decisions.
The rerun checker compares entire durable snapshots, not just row counts.
Raw function responses retain safe API model/response/status evidence.

Model interpretation failed in several attempts despite valid JSON. Strict
schema, grounding checks, conservative merge rules and pre-write lab checks
reduced their effects; semantic readback still found missing candidates and
stale wording. Future transcripts use generic selected/batch/folder controls,
with pending reviews inspected by a human. Lab A–D expected counts are not a
universal correctness oracle.


## Additional unseen-transcript folder E2E

The facilitator added a new native research-sync Doc to the shared folder. The
application discovered it through Drive using its own Apps Script credentials.
The original failed on missing lab-style metadata, with no task/completion writes,
zero model requests and four prior-source skips. The live Triggers page showed
zero installed triggers for the facilitator; this pipeline is manually invoked.

The facilitator supplied meeting date November 1, 2026. The exact document title
was disclosed and used as a separate workstream label; it was not linked to
Arroyo. Added reusable, audited intake metadata for headerless Docs without
editing the shared source. A subsequent model proposal omitted task descriptions
and was rejected before writes. Its next-Tuesday date also disagreed with the
stated November 3 interpretation. New-task descriptions are now structurally
required, and a narrow deterministic relative-weekday resolver records any model
value it normalizes. Peer review caught and fixed first-line loss and overly broad
normalization of qualified/absolute dates; regressions cover both.

The successful **generic processWeek2Folder** run used no A–D expected-count gate:

| Task | Owner | Due | Evidence |
|---|---|---|---|
| HM-0016: five controlled comparison experiments | Luis | November 5 | Five setups, planner-only vs JEV comparison and measurement requirements retained in quoted source evidence; board summary describes setup and recorded outcomes. |
| HM-0017: Three Futures demo | Priya | November 6 | Predicted/actual examples and saving predictions before execution captured. |
| HM-0018: ten act/observe/ask-for-help scenarios | Theo | November 3 | Unsafe attempts and unnecessary interruptions scored separately. Model November 10 normalized to November 3 with both values retained in history. |

Observed: one processed source, three new tasks, zero task updates, zero new
reviews, four old-source skips and one successful model request. All nine prior
rows/formulas/timestamps and their supporting records survived exactly; the two
pending reviews and human November 12 deadline remain protected. New tasks appear
in the actual due/owner formula outputs. No tasks were created from jokes.
The shared Doc text and revision were compared with the pre-test read and match.

Final folder rerun: five skips, zero model requests/extractions, and identical
before/after durable state and views. The private acceptance record is
session2-private/acceptance-folder-e2e.json; repeatable checker is
scripts/qa-folder-e2e.cjs. Timer execution is **NOT VERIFIED / NOT INSTALLED**;
manual invocation of the full Google-hosted ingestion path is **PASS after the
recorded fixes**. This additional test exposed limitations the original A–D lab
had not exercised.
