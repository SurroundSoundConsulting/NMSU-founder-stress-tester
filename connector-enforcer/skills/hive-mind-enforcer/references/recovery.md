# Recover saved phases without repeating effects

Read all current records and required complete manifests from Sheets. Preserve review/request identity, saved findings/candidate, original method provenance and every known agenda/report ID. Inspect current originals, task/decisions and native Docs. A missing source/instruction/action stops dependent work. Loading a newer method does not relabel old runs or authorize new effects.

| Last durable phase | Permitted next action |
| --- | --- |
| Semantic-stage intent without saved result | Inspect for a committed result/manifest. Do not silently redo an unknown stage. A deliberate new attempt needs actor/time/reason and explicit accounting of unavailable/possibly completed result. |
| Partial blob/chunk save | Verify exact IDs/bytes and complete the same saved blob only when all content is known. Missing/duplicate/conflicting chunks or manifest stop. No agenda side effect from partial context. |
| Findings/candidate saved | Validate frozen inputs and native before revision. Reuse saved work only after recorded continuation; do not repeat completed semantic stages. |
| Suggestion intent or unknown browser effect | Read [suggestions.md](suggestions.md), inspect the same Doc, saved thread IDs/target and full marker/reply inventory before retry. Never substitute a direct edit. |
| Unique pending suggestion, rationale missing | With authorized continuation and fresh inputs, reply only in that existing suggestion's thread; do not create the suggestion again. Missing marker alone is not proof that no suggestion exists. |
| Pending suggestion and exact attached rationale verified | Continue report/ledger work only, retaining `suggestions_pending_human_review`. Zero new suggestion or reply. |
| Accepted, rejected, removed, duplicate or changed suggestion/rationale | Preserve human decisions and existing threads; stop for reconciliation. Do not recreate or silently accept anything. |
| Edit intent or unknown write response | Inspect the known agenda against exact before and expected-after native states. Never retry first. |
| Confirmed atomic batch validation rejection | Read back the unchanged original revision/native state. A deterministic request-schema repair may use the existing authorized correction, preserving the original failed batch, recording the exact rejection and a new operation/attempt and repaired batch. Require identical expected native result plus fresh inputs/comments. This known rejection is distinct from an unknown write; an ambiguous response still requires reconciliation. |
| Exact expected-after | Record actual revision/verification; continue only report/ledger work, with zero agenda edit. Recheck input freshness and preserve subsequent human work. |
| Exact before plus original revision | No automatic retry. Recorded human decision `apply_saved_batch` with actor/time/reason may authorize that exact batch after fresh inputs/comments/access checks. |
| Different text/style/structure, newer before revision, partial/unreadable outcome | Preserve current document; stop for reconciliation. Same text at a newer revision is not permission to reapply. |
| Edit verified, report missing | Publish/recover only the saved report. Never correct the agenda twice. |
| Report create intent with no known ID | Inspect complete bounded destination/candidates and saved operation evidence. Matching title, no result or 404 is insufficient. Require explicit adoption/reconciliation; never blind create. |
| Known report blank/partly populated | Inspect against saved blank/expected state. Expected result permits ledger-only finish. Original blank with original revision and explicit recovery decision permits saved guarded content. Any human/unexpected change stays protected. |
| Report verified, final outcome/display missing | Recheck inputs/known Docs, save final outcome and owned projection only. No review, creation or content write. |
| Complete | Return same agenda/report/identity; compare current inputs for stale/external-change label without another semantic review or successful-timestamp rewrite. |

Sheet uncertainty: read the exact operation/event IDs and predecessor chain before appending. An identical committed event is reused; conflicting IDs or broken sequence stop. Sheet unavailability stops all further external side effects, with an explicit message that durable status could not be saved.

Use one linked review version for deliberate later review. Do not auto-expire another active/uncertain writer, retrofit edit permission into an old request, reopen the paused legacy test or compensate by rolling back human changes. No transaction spans Sheets and Docs; recovery is inspection plus explicit bounded continuation.

Direct-edit recovery requires the original enabled `correct_supported` authorization; suggestion requests never use `apply_saved_batch`. For a historical direct plan without a stored request, supply its original frozen request explicitly to the optional `recoverEdit` check. A newer skill does not grant new direct-edit permission. Browser suggestion verification uses exact pending changes and their threads, not an accepted native text snapshot or atomic revision guard.
