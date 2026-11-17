---
name: hive-mind-judgment
description: Record scoped human decisions, automatically propose useful lessons during authorized Hive Mind work, and activate exact human-confirmed rules in the board's Judgment Log.
---

# Hive Mind Judgment

Method `1.0`, payload `connector-judgment/1`. GPT Work uses connected Google Sheets, Docs and Drive. Sheets remembers authority, exact versions and effects; one registered Judgment Log Doc per board presents decisions, proposed lessons and confirmed rules. Apps Script retains ingestion/merging. Start manually with one designated writer.

Read [records.md](references/records.md) on each invocation to reconstruct configuration, exact request, entries, human actions and unfinished effects. Read [workflow.md](references/workflow.md) before proposing a lesson, recording a decision, confirming or changing a rule, or recovering a Log write. Read [consumer.md](references/consumer.md) when Executor, Enforcer or Feedback needs Judgment context.

## Meaning and authority

A decision records what a human chose for an identified task/document and why. A lesson proposes a reusable instruction. A rule is an exact lesson version and scope explicitly confirmed by this board's designated human and durably activated after Log verification. Each participant board can designate its own confirming human immediately.

Use three scopes: this task/document; this task type on this board; all tasks on this board. Project/audience conditions can narrow each. Recommend the narrowest useful scope. A copied board needs its own human authority and explicit adoption; rules do not spread between boards automatically.

Proposed lessons have no authority. Accepted sources and higher-priority instructions govern facts and permissions. Recording a decision or confirming a rule does not approve a document, authorize its revision, complete a task, resolve an ingestion Review or accept/reject a suggestion. Preserve Tasks A–P, Reviews, Drafts, sources, prior outcomes and all known IDs.

## Automatic proposals

During new authorized Executor, Enforcer or Feedback work, assess whether explicit human direction, a correction, a resolved ambiguity or a substantive finding supports a useful lesson. This happens during a manually started run, not a new schedule. Check existing entries first. Save at most one useful proposal per run initially; retain source provenance. Prefer no proposal to trivial or speculative standards. A machine finding can justify a proposal, never human confirmation.

Keep the requested primary work separate from learning. A supported Feedback edit can finish while its lesson remains Proposed. Save proposal effects under their own Judgment operation before the parent workflow's final completion; if the primary result is already complete, return it unchanged and report separately saved learning progress. Completed historical returns produce zero proposals/writes. Historical lesson extraction needs a separate explicitly authorized Judgment request.

## Human review

Present exact wording, scope, reason and supporting example. Ask the designated human to confirm, revise, narrow or decline the identified version. Use a clear reply such as `Confirm L-006 version 1`, bound to the saved full prompt and exact action evidence. An explicit equivalent statement can be shown as a new exact prompt for confirmation; do not infer the binding from ambiguous assent. Display names/editor access/author.me alone do not establish a human action.

Save confirmation evidence and verify the matching Log update before final activation in Sheets. Edited wording or scope requires a new proposed version. Rejection, retirement and explicit supersession are durable actions; retain all earlier versions and applications. Relevant unresolved decisions or conflicts stop dependent work, leaving unrelated work untouched.

## Finish

Return the same working Doc, Judgment Log link, actual decision/proposal/rule ID and version, scope, durable status and next human action. A completed same request returns original IDs/times read-only. Missing instructions, incomplete records, conflicting authority, unavailable Sheets or uncertain effects stop dependent writes. Single-writer operation is not atomic locking; no cross-service transaction, new model API, browser route or downstream Apps Script helper is introduced.
