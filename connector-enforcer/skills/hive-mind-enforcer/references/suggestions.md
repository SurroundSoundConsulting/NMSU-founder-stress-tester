# Pending suggestions with rationale in the same thread

Use for `suggest_supported`, including scheduled desktop publication, same-version checks and recovery. The authoritative output is a pending native suggestion in the registered existing agenda, with its rationale in that suggestion's own reply thread. Human acceptance or rejection is separate.

## Prepare the publication

Read the frozen request/version/mode, saved source acceptance, confirmed criteria, independent findings and successful candidate check. Save exact before/proposed text, target tab and uniquely identified passage, surrounding context, protected ranges, source IDs/versions/quotes, and one stable marker `ENFORCER:<review_id>:<finding_id>`. Describe uncertainty/judgment explicitly. The hypothetical candidate is for validation, never a claim that suggestions have been accepted.

Verify the current target in the signed-in browser, actual Suggesting mode and suggestion-thread Reply control. Use one designated writer and preserve unrelated comments and suggestions. Targets touching human changes, ambiguous passages, unresolved suggestions or unsafe comment anchors are deferred. Unrelated threads may remain untouched when the target and surrounding structure can be independently verified. Record complete browser inspection; do not turn concatenated API insertion/deletion text into an accepted baseline. The optional `planSuggestions` helper deliberately supports only clean native targets; a helper rejection is not permission to modify through another route without the full browser checks.

Before side effects, save and read back `suggestion_intent` with the complete immutable plan manifest, operation/finding identities, current source/task/decision state, exact target and prior thread/marker inventory. Check for an existing suggestion and marker first. A matching marker on a standalone comment is not a completed publication. Changed evidence/target, missing access or competing/uncertain work stops publication.

## Publish and attach the rationale

1. Recheck freshness and **Suggesting** mode immediately before each bounded insertion, deletion or replacement. Use the selected registered Doc and smallest exact target. Browser actions do not provide the connector's atomic revision guard. Never substitute a direct connector edit or silently accept a suggestion.
2. Inspect the new pending suggestion and save the observed thread identity immediately when exposed, before adding rationale. Bind it to its saved finding/operation and exact before/proposed passage. If no native ID is exposed, save exact target/proposal, observation time and screenshot; leave ID null. Verify uniqueness rather than guessing a thread ID.
3. Open **that suggestion's Reply field**. Check existing replies for the stable marker. Add exactly one rationale containing the marker, why this proposal is supported, links to originals or exact message IDs plus accepted versions/quotes, any uncertainty/judgment, and the requested human acceptance/rejection. A standalone comment beside the document is not equivalent. Do not respond to unrelated human comments as part of this release.
4. Reload. Verify the same exact pending change, rationale inside its own thread, and Accept/Reject controls. Record actual native thread/reply IDs if exposed; otherwise exact proposal and rationale, marker, observed reply count, screenshot and time. A successful tool response or a visual chat claim alone is insufficient. Preserve all earlier threads and suggestions.
5. Save verified observations as a complete manifest, then `suggestions_pending_human_review`. Publish one report using the report procedure; final review phase may be `complete` with outcome `suggestions_pending_human_review`. “Complete” here means publication/report recording, not acceptance, correction applied, task completion or dependency release. On failure, retain intent and known thread IDs for recovery.

## Repeats and unknown outcomes

Reconstruct from the frozen request and saved plan/observations, inspect the same Doc and exact threads. Existing complete proposal+rationale means report-only recovery or read-only return, with zero duplicate publication. For an existing uniquely identified pending proposal without rationale, an authorized continuation may fill only its missing reply after rechecking freshness and complete reply inventory; it does not make the suggestion again.

Unknown action outcome requires inspection before retry. Missing marker does not prove no suggestion exists: inspect the saved thread ID or exact unique target/proposal and prior inventory. Ambiguity, duplicate markers, changed rationale/target, accepted/rejected/removed proposals, partial inventory or changed sources stop for reconciliation. Record later human decisions separately; preserve the historical review. Never recreate a proposal simply because the person accepted or rejected it.

If an Enforcer-created detached duplicate comment needs repair, first verify rationale in the correct suggestion thread. Resolve only the exact known Enforcer duplicate with a supersession note under explicit repair authorization; preserve other comments. Normal operation creates no detached comment.

## Capability and runtime boundary

The lab's observed connector test accepted an unsupported suggest-mode field but produced a direct insertion. Do not send invented `writeMode` fields or infer suggestion support from a successful update response. Use the tested browser route unless the intended connector independently proves pending native suggestions and attached replies on a disposable Doc.

A scheduled desktop run needs the app/machine available, browser permission and an authenticated intended Google session. Verify these in the actual scheduled context. The recorded desktop test proves narrow publication only; Work Cloud and full unattended recovery remain unverified. Stop on unavailable browser/authentication; never downgrade the requested mode. A schedule is a wake-up mechanism, not new review authority or concurrency protection.
