# Records, identities and ownership

Use the existing hidden `Executor Connector` ledger unchanged:

`record_id, record_type, task_id, request_id, execution_id, sequence, previous_record_id, recorded_at, actor, schema_version, payload_json`

The envelope stays `connector-executor/1`; production Feedback payloads use `connector-feedback/1` and their own `CF-…` run IDs. Each run has consecutive sequence/predecessor links; records without a run follow the existing type/request grouping. Unique event IDs, complete JSON and exact write/readback are required. Use literal stringValue cells. This is manual single-writer operation, not atomic locking.

Historical `feedback_test` and test-observer `feedback_check` rows use `connector-feedback-test/1`. Read their provenance when relevant, but keep them separate from production Feedback state. They neither enable a production request nor authorize another edit. Preserve all raw historical records, including existing manifest naming variants.

## Minimum production records

| Type | Required content |
| --- | --- |
| `feedback_configuration` | Board/origin namespace, method/instruction ID, manual writer, allowed and protected Doc IDs, limits, authority policy and storage locations. Human-confirmed setup; each request references its exact configuration record. |
| `feedback_request` | Request/version, board, task/deliverable, Executor identity, registered Doc, configuration reference, method/instructions, direct_supported mode, requester/time, authorization, writer and enabled state. |
| `feedback_plan` | Item identity/version, selected post and authority evidence, before Doc/revision, complete comments inventory, source acceptance references/current checks, exact supported change or answer, expected native state, reply candidate, review decision and operation IDs. Large plans reference a complete manifest. |
| `feedback_run` | Frozen request and item, stable item key, phase, plan reference, known Doc/thread/reply IDs, operation IDs, verification results, outcome and original completion time. |
| `feedback_decision` | Human author confirmation, source/target/conflict decision, linked feedback version, bounded recovery, waiver or review request; actor, time, scope and original evidence. |
| `feedback_blob` / `feedback_manifest` | Exact serialized plan chunks and manifest listing every record ID in order, count and character count. |
| `feedback_check` | Separate observed acceptance evidence; distinguish user-reported Work behavior from independent connected readback. |

Draft registration may live in compatible existing records. It must bind the same board, task, deliverable, Executor execution, native Doc and accepted-source IDs. Disposable fixtures explicitly name their origin and synthetic source authorization. A title or copied workbook does not establish registration or execution permission.

Item identity is **board/origin + Doc + provider + thread ID + human post ID + feedback version**. A human reply is a new post, not a new top-level thread. Freeze exact content and observed author with the version; retain timestamps as evidence. Drive's top-level comment modifiedTime can change when a reply is added: that timestamp alone does not create a feedback version. Compare the actual post content/author and reply inventory. Unknown author/anchor IDs stay unknown. A new content version links its predecessor run, reason and authorization; reject competing successors. Request IDs and content hashes do not bypass item identity.

An author grant records human confirmer/time/evidence and binds the permitted author, Doc/post, observed content/version and allowed actions (revise, reply). A stable verified author identity can support an explicitly confirmed broader grant; if tools expose only a display name, use an exact-post confirmation such as the user's corroborating chat decision. Never treat the agent's own post as human feedback because the account matches.

## Phases and saved effects

Revision: `captured → plan_saved → edit_intent → edit_verified → reply_intent → reply_known → reply_verified → complete`.

Answers/clarifications skip edit phases. Acknowledgments and approval observations may finish as `no_action` with zero Doc/reply effects. A deferred request records its reason without pretending it was revised. Preserve `stale`, `deferred`, `needs_reconciliation` and explicit `closed` states together with the last completed phase and known effects. An uncertain effect blocks other writers even when the displayed state says closed, until a recorded human reconciliation settles it.

Never replace frozen input, a plan, effect identity or known ID. Corrections to records are linked decisions/events, not erasure. Completion requires verified native state for revisions, verified original-thread reply for responses, and successful final save. It means feedback processing finished, not business completion.

For large snapshots, use ≤10,000-character chunks, ≤30,000 characters/event, ≤240,000 characters/plan and a final ordered manifest after exact chunk readback. An incomplete manifest is not saved context. Use actual deterministic digests only when computed; exact serialization is sufficient otherwise. Stop at 1,000 ledger events or configured bounds instead of silently truncating discovery. The optional repository protocol module is a pure validator, not a required Work runtime or network helper.

## Ownership and bootstrap

Feedback appends only its authorized namespaced records and edits the authorized Doc/thread. Keep Tasks A–P, Reviews, ingestion, source history, Executor records, Enforcer reports and Drafts A:M unchanged. This release reserves no visible Feedback cells and creates no reports or replacement Docs. A later visible display requires inspected cells and an explicit ownership decision.

Fresh invocation inputs are board + Feedback request ID/version + this installed skill or its approved complete versioned instructions. Read metadata, bounded CellData including formulas/notes/validation, then all required records/manifests and current originals/Doc/comments. Follow actual stable IDs after sorting. Reconstruct run and effect history across request aliases. Return completed work read-only; inspect unfinished effects using recovery.md. Stop if required instructions, sources, authority, inventory or record chains are missing.

Keep live IDs, people and business facts in the board and linked Docs, not in the reusable package. Store new feature instructions/evidence only in the human-supplied destination. Loading this method does not migrate old records or enable a request.
