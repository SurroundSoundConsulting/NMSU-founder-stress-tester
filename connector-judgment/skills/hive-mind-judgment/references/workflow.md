# Record, propose, confirm and recover

Read records.md first. Reconstruct the exact request, authority, entry versions and prior effects. Normal invocation uses board + request/version + durable instructions only. Native title similarity and new request labels do not establish permission or new work.

## Setup, separately authorized

Inspect actual metadata, occupied cells/formulas/notes/validations, ledger headers, the configured Learning destination and all prior Log registrations. Show exact setup records and disposable targets before enabling live setup. Use this existing board and folder; do not create another folder or change sharing. Confirm the board's designated human, manual writer, task-type mapping and explicit proposal-write grants for the three consumers.

Prefer a deliberately registered existing Log. If a new Log is needed, first save/read back a judgment_setup create_intent with authorization, board/origin, destination and stable operation marker. Save doc_known with the returned Doc ID immediately before move/population. Preserve known IDs through failures. Guard content writes by requiredRevisionId and verify exact native state; save log_verified and complete. Save registration/configuration only after these checks. An uncertain create with no ID requires explicit reconciliation, never another blind create. Setup records are distinct from enabled production requests. The optional restoreSetup validates the saved sequence; it performs no creation or other network action.

## Decision or automatic proposal

Open current accepted evidence and exact human direction. For a factual question, answer from evidence or identify the missing fact. For a true choice, show options, a conditional recommendation, reason, strongest objection and what would change it. Scale detail to the choice. Record a human's bounded decision separately from the facts; use a decision entry and explicit `Decide <ID> version <N>` action bound to its displayed text/scope.

For learning, check that this new parent item is enabled, learning is explicitly authorized, no parent completion already exists and the same designated writer can append Judgment records/edit the Log. Assess usefulness and semantic duplicates against existing proposals and rules. A small correction may support a broad principle, but propose the narrowest useful scope and show the supporting example. Save one immutable lesson entry and its automatic-proposal request, citing the parent's grant. A machine-generated proposal never supplies its own confirmation.

Render an entry with stable `[JUDGMENT:<entry_id>:v<version>]` and closing markers, kind/status, exact scope, wording, why, source references and example when available. Retain all previous entries and human notes. Use native headings/bullets/links, not literal Markdown. To update a status, target only that exact entry block at its current revision; preserve other content and store the original version and human action in the ledger. When wording changes, add a new version block and preserve its predecessor. Human changes inside a block require reconciliation; changes outside remain protected.

Save the complete native before state, exact requests and expected native result in bounded chunks/manifests; save/read back `judgment_log_intent`. Recheck authority, sources, conflicts, writer and target. Apply the smallest native batch with requiredRevisionId. Read back exact text, styles, lists, links, markers and preserved human content; save verification, then final commit. A committed proposal remains Proposed.

## Human action and activation

Show exact wording, version and scope before asking for confirmation. Save the displayed prompt and original human evidence; if no stable provider ID exists, record a board-issued attestation ID and the limitation. Confirm the designated human actually made this action; editor access, display name or author.me alone is insufficient. An approval comment, accepted suggestion, resolved thread or `looks good` is not the rule-confirmation command.

Save the exact human action; recheck its unchanged target version before Log publication. Follow the native intent/write/verify/commit sequence above. The final `confirm` commit activates a rule; `decide` commits a scoped human decision. No active state exists from a human action or Log label alone. Consumers require the verified Log block and final commit.

Reject an unconfirmed lesson with the same explicit action process. Retire an active entry without deleting it. For replacement, propose the changed successor version, confirm it, then explicitly supersede the named predecessor. While both confirmations exist without the supersession commit, block affected use. Preserve old wording, human reasons and historical applications. A conflict resolution must explicitly retire/supersede the conflicting entry or establish a separately confirmed bounded exception; never silently omit it from the selected set.

## Recover only missing work

| Durable state | Next permitted action |
| --- | --- |
| Partial record/chunk save | Inspect exact IDs/bytes and complete only known missing content; no Doc effect from an incomplete manifest. |
| Human action saved, Log intent absent | Recheck authority/evidence; save the same exact intended update. Dependent use stays blocked. |
| Log intent, response unknown | Inspect the same Doc against complete saved native before/expected states before another write. |
| Exact expected native result | Record verification and final commit only; zero Doc writes. |
| Before-state or changed/partial native result | Preserve current work. Require an explicit operation-bound recovery decision and new guarded attempt if justified; no automatic retry or rollback. |
| Log verified, final commit absent | Recheck freshness and save only the missing commit. No active rule until that save succeeds. |
| Complete | Return same entry/action/Log IDs and original completion time read-only. Label later changes without reopening. |

An uncertain Sheet append is resolved by exact event ID/predecessor and bytes. Sheet unavailability stops external effects. Pending retirement/supersession and uncertain writes block affected consumers even if the Log still displays an older status. Do not release an uncertain writer after a timeout. No transaction spans Sheets and Docs; scheduled and concurrent operation remain outside this release.
