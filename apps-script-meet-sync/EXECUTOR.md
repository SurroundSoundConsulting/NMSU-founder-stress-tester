# Executor — task to grounded draft

This extension uses the existing Sheet and Apps Script project. It is manually
invoked; adding a Doc, changing a task or running ingestion does not draft anything.
Only **Tasks**, **Reviews** and **Drafts** are normally visible. Tasks retains the
A–P ingestion contract. Source/ingestion/execution records represent different
things and remain separate, hidden tables; no business task is automatically done.

## Everyday controls

In Apps Script select the named function and click Run. The no-argument drafting
entry point is **runExecutor**. Plain-language results are logged and shown in
Drafts with a next step and document link. Editing those result cells does not
authorize work. From the existing facilitator clasp directory, the same controls
can be called with `npm run session2 -- FUNCTION_NAME`.

- `setupExecutor`: repeat-safe storage/layout setup. Initial request is disabled.
- `previewExecutorSelection`: task eligibility only; it does not certify context.
- `preflightExecutor`: full eligibility, source and completion checks, no drafting.
- `prepareExecutorContext`: resolve native Docs links, verify locations, fill IDs
  and SHA-256 hashes. It leaves unapproved sources at no; approved changed sources
  stop without silently replacing their accepted hash.
- `inspectExecutorCompletion`: bounded completion-search evidence and audit,
  without changing the request or starting a draft.
- `runExecutor`: one eligible, approved task/request version; real provider call,
  validated content and native Google Doc publication.
- `inspectExecutorRecovery`: durable phase, known file/content, or tagged candidate
  files when creation returned no ID. Zero matches is not proof of no creation.
- `executorSnapshot`: private QA capture of task/ingestion and Executor state.

Facilitator-only initialization controls are configureExecutorLab (explicitly
selects the verified HM-0013), setupExecutorStorage (creates private app-owned
output/completion folders with create-intent records), and seedExecutorLabContext
(binds the original four links without approving them). Do not use these to reset
history or replace an existing request.

## Request and source ownership

Executor Requests and Executor Context hold human configuration. Use
showExecutorSettings temporarily, then hideExecutorSettings to restore the
three-tab layout. Source text stays in original native Google Docs; the Sheet
contains references, locations, project/role, accepted hash and approval audit.
Use a stable selected request ID in EXECUTOR_SELECTED_REQUEST_ID. One request can
be selected automatically only when exactly one exists.

For preparation: disable the request, paste links/IDs into file_id, assign unique
source_key and role scope/transcript/completion, and keep approved=no. Preparation
fills a blank project/location from the configured request but rejects conflicts.
The required original meetings remain in the existing input folder. The supplied
scope is pinned to its actual verified parent, an equivalent bounded context
location; shared source Docs are not copied or edited.

Open every actual source. Human approval accepts that version for this fictional
exercise; it is not a real business approval. After explicit approval the
facilitator can invoke approveExecutorContext with
`{confirmed:true,actor,reason}`. This marks the prepared versions accepted and
enables the one request. It rechecks source hashes and settings before changes.
Do not calculate hashes manually or treat a completed prerequisite as the scope.

Request identity decisions are also retained separately in Executor Decisions.
Editing version/context/request identity cells alone does not authorize another
Doc. New versions require requestExecutorVersion(newRequestId,newContextSetId,
{confirmed:true,actor,reason}); the control creates a disabled request with a
predecessor link and separate context set. Select it deliberately, prepare its
sources and review again. Repeating the same new-version request is idempotent.
Unfinished publication for a task must be reconciled before bypassing it with a
new version.

## Eligibility, content and publication

The initial workflow is the existing Arroyo pilot demo agenda HM-0013: Jordan,
open, due 2026-11-06, urgency 0 allowed, prerequisite HM-0010 done. Task/project
identity, unresolved dependencies, relevant pending reviews and incomplete
journals are checked. Unrelated hardware/checklist reviews are preserved.

The approved scope supplies audience, objective, permitted demonstration,
constraints, duration and sequence. The provider proposes four timed activity
segments and exact supporting passages. Code validates the segment order, total
20 minutes, quotes and restricted content, then renders mandatory factual context
from accepted evidence. Owner/deadline come from the task; the deadline is not an
event date. The output is an actual proposed agenda, with native headings/bullets,
a short agenda body and a separate source appendix containing original links,
exact excerpts, hashes and read times. Human inspection is still required to
judge whether a cited passage supports the wording and whether the layout works.

Completion checks cover only the configured dedicated folder and explicitly
registered source bindings. Accepted file metadata or approved completion text
must identify this task/project. Similar October 26 work is different work.
The actual bounded search report is retained in the execution; no evidence found
there is not proof that nobody completed work elsewhere.

Before creating an output, intent and intended content are durable. Files carry
execution/task/request tags; returned IDs are saved promptly. The configured
output/completion folders must match the app-created records, remain owned and
unshared, and output identity/location is rechecked. Content writes require a
verified empty output and matching native Doc revision. Source/task/request and
enabled status are rechecked before creation/content and after publication.

An unchanged successful run returns the same execution and Doc link without a
model call, content write or successful-ledger timestamp update. Reviewer edits
in that Doc are preserved. Changed accepted inputs produce staleness and retain
the old Doc; they are not permission to regenerate it. Executor Runtime records
invocations separately.

## Recovery

Inspect first. recoverExecutor requires confirmed=true, actor and reason plus one
supported action:

- adopt: give file_id only after a unique, identity-verified tagged match. Empty
  content can continue safely; exactly matching written content can finish state.
- write_verified_empty: give the inspected expected_revision for a known empty
  Doc. A nonempty or changed Doc is protected.
- finish: finish the ledger only when the actual stored content exactly matches
  the intended saved content. It makes no new model/create/append call.

Uncertain creation is never automatically retried. Unexpected human content
stays blocked for manual reconciliation; do not erase it to satisfy a hash check.
An unchanged successful recovery is idempotent. No control sends, schedules,
externally publishes or marks the task done.

## Permissions and limits

The manifest retains Sheets write, external requests, Drive read-only and Docs
read-only, adding only drive.file for app-created Docs/folders. It does not add
broad Drive/Docs write scopes, change Cloud project or add a runtime. File IDs,
parent locations and app-owned output records constrain reads/writes in code.
The authenticated user owns the created private folders and drafts.

One task/run; at most 6 sources, 12,000 characters/source, 40,000 combined context
characters, 3 pre-publication attempts/version and 240 seconds before a subsequent
publication step. Limit outcomes defer visibly. Required context is not truncated.
Model credentials remain private; EXECUTOR_MODEL defaults separately to gpt-4.1
without changing ingestion settings. No triggers or messaging are installed.

See EXECUTOR-QA.md for observed results and checks still pending, rather than
assuming implementation or a completed invocation establishes acceptance.
