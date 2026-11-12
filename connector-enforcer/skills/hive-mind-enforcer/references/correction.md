# Correct the existing agenda and publish one report

## Explicit direct-correction mode

Use the agenda-edit procedure only for an enabled frozen request that explicitly authorizes `correct_supported`, with requester/time and authorization. New V2 classroom requests use `suggest_supported` and [suggestions.md](suggestions.md). Missing suggestion capability never authorizes a direct correction. Preserve historical modes; changing mode requires a deliberate linked successor version. The report-publication section below is shared by all modes.

## Exact supported corrections

The selected authorized agenda ID is the write destination. Never create another agenda as the correction result. Test copies are explicitly registered fixtures only. Work may construct native requests directly using these invariants; optional `planEdits` provides the bounded pure implementation.

Use current tab IDs and UTF-16 ranges. Map unique unchanged machine paragraphs from the saved original baseline; external changes and uncertain provenance remain read-only. Protect source appendix and human passages. Preserve all correct text, styles, lists, links and native controls.

Initial patch shapes:

- `replace`: an exact unique substring within one mapped paragraph and a single text-style run; exclude paragraph newline. Replacement inherits that run's style and link. No broad paragraph rewrite when a shorter supported correction suffices.
- `insert_before`: one new plain paragraph before an unambiguously mapped normal, non-list paragraph with one unlinked style run. Match that peer's native paragraph/text styles. Unsupported insertion locations stay findings. Insert required safe-stop into a list only if native list preservation is separately proven; otherwise defer it.

Reject duplicate/ambiguous/overlapping anchors, surrogate splits, multiline patch values, broad changes and unsupported style/control fields. Apply higher-index patches first; account for every earlier request's index shift. Predict complete exact text and native paragraph/style/list/link state, including terminal newlines. Never trim a mismatch away. Reuse correct structures; no flattening or full-document replacement.

Apply paragraph named styles before explicit text-run styles: a named-style update can reset font overrides. Preserve explicit false values as well as true values; absence may mean inheritance. If readback identifies a deterministic formatting mismatch confined to newly inserted Enforcer text, save a separate repair intent/before/expected state and use a new guarded formatting-only batch. Keep the original applied batch and mismatch evidence; never replay its insertions or repair human/unexpected content automatically.

Save findings, patches/deferred items, expected candidate and successful independent candidate check before touching the agenda. Re-read source/task/decision/profile/request/ownership state, current Doc/revision and complete comments immediately before publication. Any detected mismatch stops the write. A commented draft stays read-only in this release. Cross-service and comment-addition races remain outside the Doc revision guard; use the agreed single-writer correction window and report the limitation.

Save and read back `edit_intent`: operation ID, known draft/tab ID, frozen input manifest, before revision and exact native state, full expected state, exact native batch and candidate validation. Then call native Docs batch update with `write_control.requiredRevisionId` equal to the captured revision. Use direct edits; do not accept suggestions or use targetRevisionId to merge newer text.

Read back the resulting native Doc once. Verify exact expected text/native styles/links/structure, protected passages and comments. Recheck source/task freshness. Save actual observed revision and comparison. A stale-revision rejection means no batch edits; later changes after a successful batch mean stale/incomplete status, not rollback. An unknown response loads recovery before another write. Inspect Google-rendered relevant pages for page fit; record rendered validation separately from API checks.

## Report publication

One report per explicit review version, with the same agenda link, review identity, requested mode, source/criteria versions, initial findings, deferred decisions, verification limits and next action. In `suggest_supported`, list pending proposals and attached rationale/thread evidence separately from accepted text; say `suggestions_pending_human_review`, never that corrections were applied or accepted. Only explicit `correct_supported` reports describe **verified actual direct changes**. Preserve previous reports and human edits. A clean review records zero agenda changes; review-only or deferred cases say so. If publication succeeded but verification/report is incomplete, make that explicit in durable status and chat.

Save report candidate and `report_create_intent` with operation ID, title token, destination and review identity. Native create returns its actual response shape (possibly fileId); save the complete returned result and normalize ID/link immediately. OAuth creation omits unsupported parent-folder parameters. Inspect/move only this new report into its configured existing folder after saving its ID. Never create a folder implicitly.

Read known blank report revision, save report-write intent and exact expected native state, then populate with guarded native edits. Inserting at index 1 into a blank Doc retaining one terminal newline yields inserted text plus that observed newline. Read back exact content and native headings/links. Uncertain creation without ID never permits blind recreation. An agenda/report ID must survive any later Sheet/move/content error.

Finish only after agenda outcome, freshness and report readback are saved. Append final ledger outcome and update configured owned display cells (legacy Drafts K:M), preserving other columns and original completion timestamps. A suggestion-mode completed review retains outcome `suggestions_pending_human_review` and its plan/observation manifests. Return the existing agenda link and one report link. Repeated completed requests do not review, edit, suggest, reply, recreate reports or refresh successful timestamps.
