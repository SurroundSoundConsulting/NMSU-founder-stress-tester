# Feedback 1.0 acceptance checkpoint

The manual method directly revises the registered native Doc from one authorized human post and replies once in that post's original thread. It preserves the same Doc identity and the existing Executor/Enforcer methods. Learning, automatic task completion, scheduling and browser publication are outside this release.

## Local validation

Run all five connector test files with Node's built-in test runner. At this checkpoint, 141 checks passed: the existing 87 Executor/Enforcer checks and 54 Feedback checks. The skill passed Skill Creator's frontmatter/reference validation. No new runtime dependencies or model calls were added.

Feedback checks exercise direct guarded native requests; author/post/version binding; source grounding; conflict/injection stops; missing/stale/overlapping anchors; protected human text and styles/links; safe deferral of pending suggestions/opaque structures; wrong-thread and duplicate replies; interrupted edit/reply/final save reconstruction; unknown outcomes; immutable known IDs/completions; chunk completeness; alias/version duplicate prevention; and review decisions based on change type. Recovery requires current authorization/source/writer context as well as exact observed effects.

These checks use synthetic local fixtures and pure validators, not Google outage injection or a hosted Work agent. They test protocol behavior, not whether a model's asserted semantic checks are correct. Work must still read the sources and assess the actual meaning.

## Connected evidence already demonstrated

The separately authorized disposable capability test demonstrated a native anchored comment, native comment discovery, one direct same-Doc edit and one original-thread reply with real returned IDs. A real human comment then produced one direct edit and one matching reply, with native formatting/link preservation, safe read-only return and an outdated-revision rejection. A fresh Work conversation returned the completed result without writes, as reported by the user and corroborated by current records/Doc/thread readback. The fresh Work tool trace itself was not independently audited.

Those tests preceded installation of this reusable Feedback skill. They establish the connector route, not installed-skill or participant-account acceptance. Existing completed test records retain connector-feedback-test/1; production instructions use connector-feedback/1 and require a deliberately enabled request, author confirmation and registration. No historical test is automatically resumed or migrated.

## Packaging and next acceptance

package.py takes an inspected local nmsu-hive-mind 1.1.0 base and an unused output filename. It rejects changed existing skill bytes, runs the full suite before creating an archive, preserves the existing default prompt and retained files, adds Feedback, and writes candidate version 1.2.0 plus byte-verification/test evidence. It performs no network calls or publication.

The prepared candidate is based on the locally installed plugin snapshot. Before account publication, retrieve/reconcile the actual current account source and release, preserve its identity/configuration, and use the existing private plugin's update process. After authorized installation, prove a fresh read-only return, then one deliberately new disposable Feedback item with sources/authority and an interrupted-save continuation. Broader live failure injection, suggestion-aware editing, complex documents, simultaneous writers and unattended operation remain unverified.
