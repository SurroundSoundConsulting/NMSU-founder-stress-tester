# Hive Mind — Roadmap & Architecture Decision

**Last updated:** 2026-10-17
**Status of record:** PR #1 (`claude/angry-jang` → `main`) open and cleanly mergeable; execution workbench running in Apps Script; a decision has been made on where execution goes next.

This document captures *why* the project is built the way it is and *where it is going*, so the reasoning survives outside chat history. It is a decision record, not a spec — the per-feature specs live under `docs/superpowers/specs/` and `docs/superpowers/plans/`.

---

## 1. The purpose, in one paragraph

The Hive Mind turns meetings into action. Its original job was ingestion: Google Meet transcript → LLM extraction → tasks on a Master Action Board. The ambition driving current work is to make it an **active operating system** rather than a passive to-do list — a system that (a) produces a *first draft* of work an LLM can do, (b) names the *blocking context* it would need rather than silently guessing, and (c) eventually runs an **enforcer** that judges the output and feeds the specific gap back into the loop. The payoff is attacking the blank page, which is the expensive part of knowledge work, not the send.

---

## 2. Current architecture (what exists today)

Three layers, historically all in one Apps Script file (`apps-script-meet-sync/Code.gs`).

| Layer | Function(s) | Owns board columns | State |
|---|---|---|---|
| 1 — Ingestion | `syncMeetArtifacts`, `discoverFromCalendar`, `discoverFromDrive`, `copyToInbox` | — (writes to inbox + `Processed Sources`) | Shipping |
| 2 — Extraction | `processInbox`, `parseWithHiveMind`, `writeTasksToMasterBoard` | **A–P** | Shipping |
| 3 — Execution Workbench | `runExecutionWorkbench` (classify → gate → execute → Doc → writeback) | **Q–Z** | Shipping (in PR #1) |

**The load-bearing invariant:** ingestion writes A–P, the workbench writes Q–Z, and they never touch each other's columns. This clean split is what makes it safe to replace Layer 3 without disturbing Layers 1–2.

Key properties worth preserving in any rewrite:
- **Idempotency** via the `Processed Sources` ledger and content fingerprinting.
- **The human-in-the-loop gate:** rows that need a fact land in `Missing Info`; the operator fills column R (`Execution Context`), sets `Force Re-run` (Z), and the next pass drafts it. The flag self-clears.
- **Owner scoping:** execution is limited to an allowlist (`Rodrigo Fuentes`, `Rod`) — a judgment call, not a technical one. Drafting work nobody owns produces artifacts nobody reviews.
- **Observability:** every decision is logged to the `Sync Log` tab. This is what caught the batch-cap stall (every individual run reported success; only the aggregate was wrong).

---

## 3. The decision: execution moves to Claude Cowork; the Apps Script execution loop is retired

### 3.1 What changes

- **Layers 1–2 stay in Apps Script.** They work, they're done, and they own A–P.
- **Layer 3 (execution) moves to a Claude Cowork skill** running on a schedule. Cowork reads the board and writes Q–Z **directly through the native Google Sheets connector**. The OpenAI/GPT-5 calls in the execution loop are removed; execution is done by Claude.
- **No `bridge.gs`.** The earlier design proposed an Apps Script web app (`doGet`/`doPost`) as a seam between Cowork and the board. That is abandoned. The board *is* the API — connectors read and write it directly.

### 3.2 Why — the seam is deleted, not patched

An earlier review of the `bridge.gs` + Cowork design found five defects. The decision to go **single-engine, connector-native** resolves them by removing the components that had them:

| # | Original defect (in the bridge design) | Resolution under single-engine + connectors |
|---|---|---|
| 1 | Two execution engines (Apps Script trigger + Cowork) race the same rows with no claim/lease | **Dissolved.** Only Cowork executes. Apps Script writes A–P, Cowork writes Q–Z. No two writers to the same columns. (Residual: self-overlap — see §4.) |
| 2 | Owner allowlist bypassed on the Cowork path | **Non-issue.** Applied as a filter on the fetch. |
| 3 | `Ready for Review` accepted with no output link → row stranded forever | **Resolvable invariant.** The writer refuses to mark `Ready for Review` without a non-empty output link. Engine-agnostic. |
| 4 | Non-atomic `EX-####` ID minting races between engines | **Dissolved** once #1 does. (Same self-overlap residual.) |
| 5 | `BRIDGE_URL?token=` is a bearer credential that leaks into logs and pasted transcripts | **Eliminated.** With native connectors there is no web app and no token to leak. |

The meta-point: four of the five were defects *of the bridge*. Deleting the bridge is the correct response to a component with five defects. The result is fewer moving parts, one model vendor (so the GPT-5 Responses-API output-extraction workarounds also disappear), and the board remains the single source of truth.

### 3.3 Verification backing this decision (2026-10-17)

- **Connectors are live, not theoretical.** A Drive connector call authenticated as `rodrigo.fuentes@kompatoai.com` returned real files including the **"Rod's Hive Mind - 2026"** spreadsheet. The CRUD surface is present for Sheets, Docs, Slides, Drive, Gmail, and Calendar.
- **Unverified and load-bearing:** whether a **scheduled, headless Cowork routine** inherits the same connector auth as an interactive session. Background runs can have a different auth story. **This must be proven before the Cowork build proceeds** (§5, step 4).

---

## 4. Residuals the single-engine model does NOT remove

Granting the architecture does not mean zero coordination work.

1. **Self-overlap concurrency.** "Single engine" kills *cross-engine* races; it does not kill *self-overlap*. A schedule firing every N minutes can start run #2 while run #1 is still working — reintroducing defects #1 and #4 *inside* one engine. Mitigation (pick one, deliberately):
   - a "skip if a run is already active" guard, or
   - non-overlapping scheduling, or
   - a lightweight per-row claim marker with a stale-claim expiry.
   The claim/lease idea doesn't die; it shrinks to a single-engine guard.

2. **Audit trail.** The Apps Script workbench logged every decision to `Sync Log`. A Cowork agent is more autonomous and less structured by default. The skill **must** log what it did and why, back to the sheet, or we lose the observability that caught the batch-cap stall. Non-negotiable for anything writing to a live board.

3. **Prompt re-tuning.** The classifier rubric and prompts were tuned against GPT-5's quirks. Moving execution to Claude removes the quirks (good) but the prompts should be re-validated for Claude.

---

## 5. Go-forward plan (ordered)

1. **Merge PR #1.** It is open, clean, and it is the landed baseline. Everything below builds on a merged `main`, not a parallel branch.
2. **Clean pre-existing duplicate rows.** The `feaa1b7` fix is *forward-only*: it stops new duplicates and flags them `duplicate`, but does not retroactively remove duplicate rows created before it. A one-time pass clears the backlog.
3. **Prove scheduled-run connector auth** (the §3.3 unverified assumption). If a headless routine cannot use the connectors, the schedule design changes before any code is written.
4. **Retire the Apps Script execution loop (Q–Z writes); keep Apps Script ingestion (A–P).** Clean seam at the board.
5. **Build the Cowork execution skill with three things designed in from day one:**
   - the single-engine concurrency guard (§4.1),
   - the `Ready for Review` requires-output-link invariant (§3.2 #3),
   - a sheet-based audit log (§4.2).
6. **Add the retrieval stage.** Native connectors let the executor *fetch* missing context (the real Gmail thread, the real Drive doc) instead of asking the operator to paste it into column R. Pairs with `evidence` / `named_entities` extraction columns — which must be added at indices **26–27, after column Z**, or every `EXECUTION_COLS` index shifts and ingestion starts writing into execution columns.
7. **Add the enforcer — as a log-only judge first.** See §6.

---

## 6. The enforcer (Layer 4, not yet built)

The workbench today has one quality judgment and it happens *before* the work: the 4-way gate ("should we attempt this?"). The enforcer is the *post*-check ("is this draft good, and if not, what exactly is wrong?"). Today that post-check is a human reading the Doc.

**It reuses the existing loop.** The enforcer writes the specific gap into column R and sets `Force Re-run` — the same `Missing Info → R → re-run` channel built for humans. That turns a human-in-the-loop system into a self-correcting one.

**Design constraints:**
- **Concrete rubric, not vibes.** Judging quality is far harder to specify than judging feasibility. Checkable: unsupported claims, unauthorized commitments (a date, a price, a promise not in the source), whether it accomplishes the task's actual intent. Out of scope: "is the tone right?"
- **It must distinguish two failure modes:** (a) fixable with more context → write to R, re-run; (b) not fixable by drafting (needs a decision, authority, or a nonexistent fact) → escalate to the human. This mirrors the classifier's `Missing Info` vs `Not Automatable` split, applied to output.
- **Circuit breaker required.** Without a re-run cap, an enforcer that demands an unfindable fact loops forever while every run reports success — the batch-cap stall again. Hard cap + escalation.
- **Connectors make it strong.** An Apps Script enforcer could only re-read the transcript. A Cowork enforcer can check a draft's claims against ground truth (the real thread, the real doc). This is why the enforcer belongs on the Cowork path — *after* §4's guards exist, since it is a third writer to the board.
- **Ship it log-only first.** Let it emit verdicts without writing back. Observe whether it is too harsh, too lenient, or looping, then give it the wheel. An automated judge that writes back is a feedback loop, and feedback loops get observed before they drive.

---

## 7. Open questions

- Does a scheduled/headless Cowork routine have connector auth? (§3.3 — blocks §5.4+.)
- Does ingestion (Layers 1–2) eventually move to Cowork too, or stay in Apps Script indefinitely? Not required now; connectors could read Drive/Calendar, but Layers 1–2 work and are done.
- Where does the audit log live — the existing `Sync Log` tab, or a separate store? Reusing `Sync Log` keeps one pane of glass.
