# Initial drafting checkpoint — executor-drafting/1

Read before proposing a new drafting-intent write or inspecting an unsaved/denied initial checkpoint. Instruction revision 1.3 introduces this contract. The envelope remains `connector-executor/1`; historical records retain their own shapes and provenance.

## Build from inspected records

Run the normal eligibility, existing-work, source and completion checks first. A valid JSON shape alone does not prove those checks occurred or authorize execution. Keep one designated writer. Read current named rows using actual headers, preserving blank values and historical records.

Use the packaged [checkpoint module](../scripts/checkpoint.mjs). It is deterministic Node.js code using standard libraries only, with no network, credentials or Google writes. Execute it in a real JavaScript runtime. If the runtime cannot load or run it, stop before any checkpoint write and identify that capability gap. Reasoning about the schema is not executing the validator; never invent SHA-256 values or claim a pass without an actual result.

Call `buildDraftingCheckpoint(current, {execution_id, checked_at})`, providing:

- `board_id`: exact current board ID.
- `request`: complete live fourteen-field named object below.
- `tasks`: live named objects with the sixteen A–P headers. Include the selected task and complete dependency closure. The builder retains only that closure.
- `reviews`: live named review objects, including review_id, task_id, candidate_ids and status. Inspect current pending decisions; relevant pending decisions block drafting. Unrelated details are excluded from output.
- `configuration_record`, `authorization_record`: existing ledger records as `{record_id, payload}`. Parse the actual returned payload_json cell with JSON.parse; do not reconstruct its text or manually retype records for digest calculation. Authorization must explicitly bind this request/version and predecessor. Output retains only IDs and canonical SHA-256 digests computed by the module.
- `accepted_sources`: only this context's accepted ledger records as `{record_id, payload}`, after originals have been opened and current text/revisions compared with saved acceptance. Output retains only record ID, file ID, accepted revision and digest of the existing record, without copying source text or approver contact data.
- `completion_search`: `{folder_id, checked_at, complete, files}` from an actual complete bounded check. Each file has file_id, classification and checked_at. Preserve real observation times. Same-task completion prevents drafting. Empty files means an inspected empty folder, not an assumption.

For CLI use, prepare a local input JSON with `{current, identity: {execution_id, checked_at}}` and run:

```sh
node /actual/installed/skill/path/scripts/checkpoint.mjs build /local/checkpoint-input.json
```

Use actual discovered paths. Output is `{payload, summary}`. Only payload becomes the proposed K-cell value; summary is for human review. The local input is solely for validation: do not upload it or copy it into Sheets. Alternatively import the module in the actual available JavaScript runtime. If neither the module nor real execution of its exact source is available, stop.

Before a newly installed revision is used against live data, execute `build` on the packaged [synthetic self-test input](../scripts/self-test-input.json). It uses fictional IDs and no Google connection. Confirm the returned phase/schema, fourteen request keys, two selected tasks, one source reference and no copied source/authorization text. Then run `validate` on that output payload. A passed packaged-file inspection alone is not this runtime check.

## Exact output shape

The first `run` payload has these keys only:

```text
checkpoint_schema: "executor-drafting/1"
phase: "drafting"
execution_id: designated stable execution ID
instruction_revision: "1.3"
attempt: 1
generation_status: "not_started"
provider_response_id: null
input_snapshot:
  board_id
  request: complete fourteen-field named object
  tasks: selected/dependency named objects sorted by task_id
  reviews: [] (relevant pending decisions would have stopped the run)
  configuration_ref: {record_id, sha256}
  authorization_ref: {record_id, sha256}
  sources: [{record_id, sha256, file_id, revision}] sorted by record_id
  completion_check: {folder_id, checked_at, complete: true, files}
```

Request fields, retained as strings including empty values:

`request_id, task_id, deliverable_type, version, enabled, project, audience, context_set_id, requested_by, requested_at, no_known_completion_at, previous_execution_id, revision_reason, reviewer`

Task fields, retained as strings including empty values:

`task_id, task, owner, status, urgency, due_date, next_step, blockers, dependencies, okr_link, risk_flag, source_transcript_id, meeting_title, meeting_date, created_at, updated_at`

Keep full source bodies, task history, processed-source evidence, unrelated reviews, old drafts, full configuration, authorization text and source-approver contact data out of this new record. They have durable locations; resolve references and verify digests during reconstruction. Freeze the complete current request and selected mutable task rows rather than reconstructing them later from potentially edited cells. Installing this revision changes neither authorization nor ownership.

## Validate, explain and submit

Execute `validateDraftingCheckpoint(payload)` and retain `checkpointSummary(payload)`. The validator rejects extra fields, positional rows, incomplete requests, duplicate sources, relevant pending decisions and payloads over 12,000 characters. The bound stops unbounded snapshots; never truncate required records or use encoding/chunking to evade approval.

Before the Google write, show exact spreadsheet/tab/range, event/execution/request IDs, schema/method, phase, selected task IDs, referenced source/configuration/authorization IDs, payload character count, validator result and actual validation route. Explain that this saves one intent record, not a document, new approval, source acceptance or permission change. Show the decoded payload when asked. Required name/email fields remain visible; never hide or silently remove them to change an approval result.

Re-read the target, event IDs and predecessor chain. Write only the literal eleven-column ledger row. Preserve the immutable initial snapshot in later stages, either inherited or exactly repeated; never replace it. Read back exact submitted bytes and the contiguous chain before generation. Later publication stages still follow publication.md and may store candidates/native write states; this initial contract does not expand their permissions.

## Denial, ambiguity and continuation

An approval warning proves neither maliciousness nor safety. Explain its scope honestly. A denied operation stays denied: stop it. Do not automatically retry, split/encode/repackage to evade review, use another account/tool to write it, or assume original task authorization overrides denial.

For an uncertain outcome, inspect exact event IDs and target rows read-only first. Preserve request/version/execution identities. A malformed persisted event needs explicit reconciliation, not silent deletion or overwrite. If inspection confirms no checkpoint and no generation/document effects, a user-authorized continuation may propose the corrected validated contract as a new reviewable operation. Record compatible-method continuation separately without rewriting original authorization. Obtain fresh approval when prompted. Denial or missing validation runtime never authorizes another execution identity or an untracked draft.

Completed historical returns remain read-only. New-format reconstruction verifies referenced record digests, then compares mutable request/tasks/relevant decisions and current original source text/revision. Changes stop publication or label completed output stale; they never authorize regeneration.
