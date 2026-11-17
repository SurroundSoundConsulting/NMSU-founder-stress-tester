# Durable contract

Keep the existing hidden Executor Connector columns and envelope `connector-executor/1` unchanged:

`record_id, record_type, task_id, request_id, execution_id, sequence, previous_record_id, recorded_at, actor, schema_version, payload_json`

All new payloads use `protocol: connector-judgment/1`, actual board ID and an exact `configuration_id` reference. Use `CJ-…` run/operation identities, unique event IDs, literal stringValue cells and consecutive predecessor chains. A consumer application uses its original CX/CE/CF execution ID with the existing global chain, never a second sequence 1. Preserve all older rows. Inspect exact event IDs/predecessors on uncertain appends. Equal bytes are already saved; conflicting/duplicate IDs stop.

## Records

| Type | Required content |
| --- | --- |
| `judgment_setup` | Before configuration: CJ setup run, create_intent → doc_known → log_verified → complete, fixed writer/designated human, explicit authorization evidence, folder, create operation, seed text and immutable known Doc ID. Preserve uncertain creation and inspect before retry. |
| `judgment_configuration` | Method 1.0; board and origin_board_id equal actual board; manual_single_writer; designated_human_id; writer; known log_doc_id; Learning folder; setup authorization actor/time/evidence; log_registration binding known Doc/folder and designated human confirmation (existing_doc or completed setup_run); automatic_proposals true; selected consumer methods Executor 1.4, Enforcer 2.1, Feedback 1.1. One active configuration; ambiguous duplicates stop. Loading instructions does not create this record or migrate an existing board. |
| `judgment_request` | Exact configuration; request_id; CJ run_id; entry_id; action propose/decide/confirm/reject/retire/supersede; enabled; writer; requester/time; explicit authorization. Automatic proposal requests cite the enabled parent's learning grant. A new label does not bypass an entry's origin or earlier effects. |
| `judgment_entry` | Immutable entry_id, kind lesson/decision, integer version, exact text, reason, scope, evidence, origin, conflicts_with, producer; predecessor_entry_id and revision_reason for higher versions. |
| `judgment_human_action` | Action, entry_id, exact displayed prompt including wording/scope/version and expected reply, designated human ID, time, reason, original evidence with quote/provider/artifact ID, exact-action human attestation and agent_created false. Supersession also names successor_entry_id. |
| `judgment_blob` / `judgment_manifest` | Exact serialized native before/expected state and requests, or assessment/evidence. Indexed chunks and ordered record_ids/count/characters. A manifest is accepted only after all listed chunks are saved and read back exactly. |
| `judgment_log_intent` | operation_id equals its event ID; entry_id; action; same Log ID; before revision/text; complete expected text; native_manifest_id; human_action_id except proposals. Save and read back before any Doc effect. |
| `judgment_log_verified` | Same operation/entry/Log; exact actual native_doc, text and revision. Compare full native state with the intent's expected snapshot. Stop at event-size bound instead of truncating. |
| `judgment_commit` | Exact operation, action, verification event ID and original completed_at. This final record activates the confirmed/decided state, or commits a rejection/retirement/supersession. |
| `judgment_application` | Consumer identity, role, board/request/task/Doc/task type/project/audience context, configured method, applied IDs/versions/commit IDs/reasons, excluded IDs/reasons, assessment and Log observation references. Save as a companion; preserve each consumer's original payload contract. |

The optional `connector-judgment/protocol.mjs` validates this exact schema using pure code. It is not an app coordinator, a required hosted runtime, or proof that Work's semantic assessments are true. Do not feed reference-oriented variants to it as though they were this contract. Its synthetic tests certify only the tested shapes. If the actual Work runtime produces another shape, preserve raw records and resolve the compatibility gap before claiming helper reconstruction.

## Entry scope and provenance

Scope objects use `level: task | task_type | board`, board_id and optional exact project/audience restrictions. Task scope requires task_id and may also bind doc_id. Task-type scope requires task_type, from the board's human-confirmed task-type mapping. Board scope introduces no task/type restriction. Missing context needed by a restriction is not a match. Do not infer task types from a similar title.

Origin is provider + artifact_id + post_id + content version + topic, within this board. Use real post IDs; for a manual human statement with no exposed message ID, record a stable board-issued attestation ID and label the provider human-attestation. Preserve the exact quote and identity limitation. Topic identifies the substantive lesson, not a new alias to bypass duplicates. Evidence records provider/artifact/version/quote and actual source/post links where available. Accepted-source references retain the existing acceptance record ID and exact current version separately from human instructions or machine findings.

New versions name exactly one predecessor, retain kind/origin, advance by one and explain the change. Competing successors stop. Confirmation never carries to changed content. Exact duplicates return the existing entry; additional evidence can be proposed in a separately authorized operation without creating another rule. Semantic near-duplicates require Work's actual comparison; a text match is not the full duplicate check.

## Bounds and ownership

One task/Doc, one primary item and at most one lesson proposal per invocation; eight evidence references/entry; 2,000 characters each for rule and reason; 20,000 Log text characters; 30,000 JSON characters/event; 240,000 characters/manifest in chunks of at most 10,000; 1,000 total ledger events. Read complete bounded ranges and comment pages. Stop on bounds instead of omitting required history. These initial limits may cause an early capacity stop on a growing board; an explicit later storage/archival design is separate.

Judgment appends only namespaced records and edits its registered Log. Other roles save their own application companions and explicitly granted proposal operations. The designated human supplies decisions and rule confirmation. Preserve Tasks A–P, Reviews, Drafts, ingestion history, prior records and business-task status. No new visible cells are reserved.
