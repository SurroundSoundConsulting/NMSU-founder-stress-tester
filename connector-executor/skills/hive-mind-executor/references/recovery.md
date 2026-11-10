# Interrupted-run recovery

Read before recovery; a new request does not bypass unresolved work.

## Recovery

- Unknown create without ID: stop and inspect bounded candidates. Require explicit reconciliation; title similarity, zero results or 404 cannot authorize another create. Adopt only a uniquely established match.
- Known blank: explicit populate_known_blank decision with actor/reason permits saved candidate under the original verified revision, without new generation/Doc.
- Unknown content write: read same ID. Exact expected content/structure permits ledger-only completion. Preserve human/different content. Blank text with a new revision is not proof nothing happened.
- Saved content but incomplete ledger/display: repair missing records/owned cells only after expected-state checks. Preserve human-edited display cells.
- Changed task/request/source: retain output and explain staleness. A new version requires a predecessor-linked decision.

