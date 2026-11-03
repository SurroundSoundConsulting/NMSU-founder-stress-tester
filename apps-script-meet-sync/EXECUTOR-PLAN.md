# Executor build plan — existing application

Baseline: 12 tasks, 6 completed sources, 2 pending merge reviews. Sheet and
Apps Script identities remain unchanged. Target HM-0013 is Jordan's open Arroyo
agenda, due 2026-11-06; prerequisite HM-0010 is done. The pending hardware and
checklist reviews are unrelated and remain pending.

1. Preserve the A–P ingestion contract and its logical storage records. Rename
   the physical board to Tasks and merge-review tab to Reviews using a shared
   name resolver, including old journal-operation references. Keep only Tasks,
   Reviews and Drafts visible. Remove existing task-view tabs only after verifying
   their contents are formula-only; preserve all other tabs and hide internals.
2. Add separate editable Executor Requests and Context tables, plus hidden
   execution, source-evidence, intent and runtime-log storage. Set up one disabled
   HM-0013 / pilot_demo_agenda / v1 request. Human approval fields and source links
   remain separate from machine output state. Configure the same Sheet explicitly.
3. Read original scope and A–C through the script's own Google identity. Pin each
   file's allowed location, project, role and SHA-256 text fingerprint. A link
   preparation control fills IDs/hashes while leaving approval=no. Require explicit
   source approval before drafting. Check one dedicated, bounded completion-evidence
   location; report the limits of that search. A similar October 26 agenda cannot
   satisfy this Arroyo task. Never search test answer keys as normal context.
4. Provide setupExecutor, previewExecutorSelection, prepareExecutorContext and
   no-argument runExecutor controls. Eligibility checks stable ID, owner Jordan,
   open status, blocker, completed prerequisites, relevant reviews and unfinished
   ingestion/execution writes. Urgency 0 is eligible. Preserve unrelated reviews.
5. Reuse the existing model credentials with a separate Executor model setting.
   One task/run, at most 6 sources, 40,000 context characters, 3 pre-publication
   attempts/version, 240-second run budget. Validate structured content, exact
   supporting quotes and source versions before creating a native Google Doc.
   Produce an actual 20-minute tabletop agenda with one-page body and separate
   source appendix. Unknown event time/location remain labeled; November 6 is a
   task deadline, never a scheduled event or launch approval.
6. Create private app-owned draft-output and completion-evidence folders. Keep
   shared source Docs unchanged; context is bounded by explicit original file IDs
   and verified parent locations. Add only drive.file to existing scopes for
   app-created Docs; retain unrelated scopes/settings. Explain and obtain Google
   consent in the same Cloud/script project. Do not add broad Drive/Docs writes.
7. Persist an execution identity and publication intent before file creation;
   tag files with task/request/execution identity. Persist returned file ID promptly.
   Check output revision before content writes and recheck task/request/sources
   before and after publication. Ambiguous creation/writing stops for inspection;
   no automatic second create, blind append or erasure of human content. Recovery
   and new-version controls require explicit recorded decisions and preserve
   predecessor links. Unchanged success returns its original link without a model
   call or ledger/timestamp rewrite. Plain-language status and next action appear
   in Drafts and logs; internal codes remain separate.
8. Verify repeat setup and missing/unapproved scope without any drafting call or
   Doc; then one real model-backed native agenda and Google-rendered layout review.
   Make a marked reviewer edit in that output and rerun: same output/execution,
   zero additional model calls, one Doc, preserved reviewer text. Compare original
   task/ingestion snapshots. Test done evidence, irrelevant/relevant reviews,
   permissions/invalid output, interruption/uncertain creation, human edits,
   staleness, explicit recovery/new-version replay and limits with isolated mocks.

No triggers, sending, scheduling, external publication or automatic task completion.
The intended output is a draft for human review, not business-task execution.

Sources:
- Guide: https://docs.google.com/document/d/1ALcMewCXF5bYk6nMnOHX94hBMqGzK889SOQtG5e6sbM/edit
- Scope: https://docs.google.com/document/d/1PbOVkPs0yf-X0jAQEor3vdd2bouUhv9erMRGVZiuffk/edit
- Original A/B/C IDs remain the existing Week 2 source IDs.
