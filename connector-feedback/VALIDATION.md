# Feedback 1.0 acceptance checkpoint

The manual method directly revises the registered native Doc from one authorized human post and replies once in that post's original thread. It preserves the same Doc identity and the existing Executor/Enforcer methods. Learning, automatic task completion, scheduling and browser publication are outside this release.

## Local validation

Run all five connector test files with Node's built-in test runner. At this checkpoint, 141 checks passed: the existing 87 Executor/Enforcer checks and 54 Feedback checks. The skill passed Skill Creator's frontmatter/reference validation. No new runtime dependencies or model calls were added.

Feedback checks exercise direct guarded native requests; author/post/version binding; source grounding; conflict/injection stops; missing/stale/overlapping anchors; protected human text and styles/links; safe deferral of pending suggestions/opaque structures; wrong-thread and duplicate replies; interrupted edit/reply/final save reconstruction; unknown outcomes; immutable known IDs/completions; chunk completeness; alias/version duplicate prevention; and review decisions based on change type. Recovery requires current authorization/source/writer context as well as exact observed effects.

These checks use synthetic local fixtures and pure validators, not Google outage injection or a hosted Work agent. They test protocol behavior, not whether a model's asserted semantic checks are correct. Work must still read the sources and assess the actual meaning.

## Connected evidence already demonstrated

The separately authorized disposable capability test demonstrated a native anchored comment, native comment discovery, one direct same-Doc edit and one original-thread reply with real returned IDs. A real human comment then produced one direct edit and one matching reply, with native formatting/link preservation, safe read-only return and an outdated-revision rejection. A fresh Work conversation returned the completed result without writes, as reported by the user and corroborated by current records/Doc/thread readback. The fresh Work tool trace itself was not independently audited.

The tests described in this section preceded installation of this reusable Feedback skill. They establish the connector route, not installed-skill or participant-account acceptance. Existing completed test records retain connector-feedback-test/1; production instructions use connector-feedback/1 and require a deliberately enabled request, author confirmation and registration. No historical test is automatically resumed or migrated.

## Original packaging and acceptance plan (historical)

package.py takes an inspected local nmsu-hive-mind 1.1.0 base and an unused output filename. It rejects changed existing skill bytes, runs the full suite before creating an archive, preserves the existing default prompt and retained files, adds Feedback, and writes candidate version 1.2.0 plus byte-verification/test evidence. It performs no network calls or publication.

The prepared candidate is based on the locally installed plugin snapshot. Before account publication, retrieve/reconcile the actual current account source and release, preserve its identity/configuration, and use the existing private plugin's update process. After authorized installation, prove a fresh read-only return, then one deliberately new disposable Feedback item with sources/authority and an interrupted-save continuation. Broader live failure injection, suggestion-aware editing, complex documents, simultaneous writers and unattended operation remain unverified.


## Installed manual acceptance — completed November 13, 2026

The existing private NMSU Hive Mind plugin was updated to version 1.2.0. Inspection of its published source confirmed that all 16 skill files matched the candidate: the four Feedback files were present and the 12 Executor/Enforcer files were unchanged. This verified release was `pluginrel_6af785a288208191a9eec3264f28d9e1`.

The original acceptance plan above was narrowed by explicit human authorization: complete one new installed-skill item with a direct edit and threaded reply in one run, without another deliberately interrupted recovery exercise. Local failure/recovery checks and the earlier connected evidence remain distinct from this installed manual acceptance. No further test round is required to close this narrow manual release.

Request `FEEDBACK-INSTALLED-20261113-1`, run `CF-INSTALLED-20261113-1`, completed in the same [disposable Doc](https://docs.google.com/document/d/1ZvDz3BhRLCxUa2pU-j9wLqHMNqP-K4S21sHpJ1AOtdU/edit). “Duration: 20 minutes.” became “Duration: 20 minutes, including questions.” The accepted scope supported that clarification; no new Enforcer review was required.

The original human thread was `doco.Wz_uPrY7DSZYdMK9dzXf_Q`. Exactly one explanatory reply, `doco.-As9h0hZbgWotAMrSmKkng`, was verified in that thread, which remained open. Native body, protected formatting and source link matched the saved expected result. The final saved phase was `complete`, with recorded outcome `completed`, at `2026-11-14T01:49:08.101Z` (November 13, 6:49:08 p.m. MST). A linked decision preserved the original request while replacing its deliberate pause instruction.

The [existing board](https://docs.google.com/spreadsheets/d/19mr14FiEakVeG6OBBgKokgiUnx61tRfDdkgqhaQ1uuw/edit) retains run sequences 1–9 at `'Executor Connector'!A268:K276`. Separate observer evidence is at row 277, record `CF-INSTALLED-20261113-1:manual-acceptance-observed`. Historical records and earlier test Docs were preserved. The observer verified current saved records and native Doc/thread state; the user's installed Work tool trace was not independently audited.

Manual reconstruction is demonstrated. Compatibility of the optional repository JS restore helper with the live, reference-oriented Work payload shape is not certified by this observation. Do not interpret the 141 local checks as a live hosted recovery test or as certification of that adapter. Broader documents, pending-suggestion editing, participant-account replication, concurrency and unattended operation remain unverified.

## Participant guide and release boundary

[LAB.md](LAB.md) is the initial participant guide for review. It starts with requirements, continues the existing Sheet, uses one authorized disposable fixture and provides setup/run/read-only return prompts. It requires no upfront code packet, submission, assigned week or date. The guide does not change the installed skill or authorize a new live run.

Feedback 1.0's narrow manual workflow is complete. Learning, business-task completion and scheduling remain separate. No new plugin package is needed for this documentation closeout.
