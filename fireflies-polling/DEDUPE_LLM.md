# LLM-based task deduplication (Master Action Board)

This document describes how Hive Mind’s Fireflies pipeline **merges new action items** into the **Master Action Board** using an **OpenAI chat completion** dedicated to deduplication—not the older rule-only matcher (`task` + `owner` + `due_date` string normalization).

---

## Goal (what we built)

We needed a **dedupe layer that uses an LLM prompt** (semantic judgment, not only string/character/regex matching):

1. **Ingest** existing board rows from the **latest N calendar days relative to the transcript meeting date** and inject them into the prompt for comparison with **newly extracted** tasks (from the current transcript’s Hive Mind run).

2. **Decide per candidate task**: **insert** a new row, or **update** an existing row that represents the **same underlying work**.

3. **Duplicate detection** considers **only the meaning of the `task` field**—not a triple cross-check of `task` + `owner` + `due_date`.

4. On **update**, refresh operational fields as merged by the model, e.g. **next step, owner, due date, urgency, status, blockers, dependencies, OKR link, risk flag**, while **preserving `task_id`** and **`created_at`** on the sheet.

5. Use **`gpt-4o`** as the default model for this step (configurable).

---

## Where it lives in the codebase

| Piece | Location |
|--------|-----------|
| Dedupe logic + Fireflies GraphQL date fix | [`lib/taskDedupeLlm.js`](../lib/taskDedupeLlm.js) |
| Env: lookback days, model, logging | [`lib/env.js`](../lib/env.js) (`getDedupeLlmLookbackDays`, `getDedupeLlmModel`, `isDedupeLlmLogVerbose`, `getDedupeLlmLogMaxChars`) |
| Sheet read/write (Master board) | [`lib/commandCenterSheets.js`](../lib/commandCenterSheets.js) |
| Row shape + `HM-####` IDs + deterministic fallback | [`lib/taskMerge.js`](../lib/taskMerge.js) |
| Orchestration (Hive Mind → dedupe → sheet) | [`fireflies-polling/run.js`](./run.js) → `mergeActionItemsToMaster` |

**Flow:** Fireflies fetch → `analyzeTranscriptToHiveMind` ([`lib/hiveMind.js`](../lib/hiveMind.js)) → `applyLlmDedupeMerge` → append/update rows → append **Processed Transcripts**.

If the dedupe LLM call **fails** (HTTP error, invalid JSON, validation failure), `run.js` logs a warning and falls back to **`matchOrAllocateTask`** in `taskMerge.js` (triple-style string match).

---

## N days relative to the transcript date

**Anchor:** `transcript_meeting_date` — taken from the current meeting’s **`meeting_date`** (YYYY-MM-DD) when present; otherwise **today’s** date (UTC) as a safe default.

**Window (inclusive):** all Master rows whose **anchor date for the row** falls in:

`[anchor - N calendar days, anchor]`

**Per-row anchor date** (`rowAnchorYmd` in code):

1. Prefer **`meeting_date`** on the board (column **M**, 1-based column 13, zero-based index **13** in the row array).
2. Else use the **date prefix** of **`created_at`** (column **O**, index **14**).

Rows with **no** parsable date in those fields are **excluded** from `existing_tasks` (they never appear in the LLM context for dedupe).

**N** is **`DEDUPE_LLM_LOOKBACK_DAYS`** (default **30**, max **365**).

**Cap:** At most **100** existing rows are sent, sorted by `meeting_date` then `created_at` descending (most recent first).

**Why this matters:** If your “old” tasks sit **outside** this window, the model never sees them and can only **insert**—raising N or fixing `meeting_date` / `created_at` on those rows fixes that.

---

## What gets sent to the model

### User message payload (JSON)

The user message is a JSON object (pretty-printed in logs) with:

- `transcript_meeting_date` — anchor `YYYY-MM-DD`
- `lookback_days` — N
- `existing_tasks` — array of board rows in the window (no `_sheetRow` in the JSON; used only server-side for updates)
- `candidate_tasks` — Hive Mind action items for **this** transcript only, each with `candidate_index` 0…K-1 and fields: `task`, `owner`, `status`, `urgency`, `due_date`, `next_step`, `blockers`, `dependencies`, `okr_link`, `risk_flag`

### System prompt (behavioral rules)

Implemented in **`buildDedupeSystemPrompt()`** in [`lib/taskDedupeLlm.js`](../lib/taskDedupeLlm.js). Summary:

- Duplicates are judged by **semantic equivalence of `task` text only**; **owner** and **due_date** are **not** required to match for a duplicate.
- Prefer **update** when the candidate is a **paraphrase / minor rewording** of the same deliverable; when unsure, bias toward **update** if any existing task plausibly refers to the same work.
- **`update`** must set `match_task_id` to a `task_id` that appears in **`existing_tasks`** (the model cannot point at a row it was not shown).
- Output **one JSON object** with a **`decisions`** array; each element: `candidate_index`, `action` (`insert` | `update`), optional `match_task_id`, optional `fields` for updates.

### Model API

- **Endpoint:** `https://api.openai.com/v1/chat/completions` (same as Hive Mind).
- **Default model:** `gpt-4o` (`DEDUPE_LLM_MODEL` in `.env` overrides).
- **`response_format`:** `{ "type": "json_object" }`
- **`temperature`:** `0.1`

---

## Output contract (`decisions`)

The model must return JSON shaped like:

```json
{
  "decisions": [
    { "candidate_index": 0, "action": "insert" },
    {
      "candidate_index": 1,
      "action": "update",
      "match_task_id": "HM-0003",
      "fields": {
        "task": "...",
        "owner": "...",
        "status": "open",
        "urgency": "5",
        "due_date": "2026-02-01",
        "next_step": "...",
        "blockers": "...",
        "dependencies": "...",
        "okr_link": "...",
        "risk_flag": "low"
      }
    }
  ]
}
```

**Validation** (server-side):

- Exactly **one** decision per `candidate_index` from `0` to `len(candidates)-1`.
- Every **`update`** must reference a **`match_task_id`** in the **windowed** `existing_tasks` set (so the model cannot hallucinate an id outside the prompt).

**Apply step:**

- **`insert`:** allocate next **`HM-####`** via `getNextTaskId`, **`appendMasterRows`**, push onto in-memory snapshot.
- **`update`:** resolve sheet row by `task_id`, merge **`fields`** with the Hive candidate via `mergeFieldsFromLlm`, **`buildMasterRow`** (keeps `created_at`, sets `updated_at`, overwrites source meeting columns with the **current** transcript), **`updateMasterRow`**.

---

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENAI_API_KEY` | Required for dedupe LLM (and Hive Mind) | (none) |
| `DEDUPE_LLM_MODEL` | Chat model for dedupe only | `gpt-4o` |
| `DEDUPE_LLM_LOOKBACK_DAYS` | N calendar days for `existing_tasks` window | `30` |
| `DEDUPE_LLM_LOG` | `1` / `true` / unset = full prompts + raw response in terminal; `0` / `false` / `off` / `summary` = short lines only | verbose on |
| `DEDUPE_LLM_LOG_MAX_CHARS` | Truncate printed user JSON if huge | `120000` |

See also [`lib/env.js`](../lib/env.js).

---

## Logging (debugging dedupe)

When verbose logging is on (default), the terminal prints:

- `[dedupe]` summary line: model, anchor, window, counts.
- Full **SYSTEM** and **USER** prompts (user body may truncate with a note).
- Raw **assistant** `message.content`.
- Compact **decisions** line and pretty-printed **decisions** JSON.
- On validation failure: logged decisions + hint about allowed `task_id`s.

Use **`DEDUPE_LLM_LOG=0`** for quieter runs once you trust the behavior.

---

## Fireflies list query (related fix)

Fireflies GraphQL expects **`DateTime`** for `transcripts(fromDate:, toDate:)`, not `String`. [`fireflies-polling/fireflies.js`](./fireflies.js) was updated to declare variables as **`DateTime`** so the primary list query succeeds instead of always falling back to “list 50 + client filter.”

---

## How to run end-to-end

```bash
npm run fireflies:poll
# or
npm run fireflies:backfill
```

Requires `.env` with Fireflies + Google + OpenAI keys, sheet tabs per lab, and **Processed Transcripts** idempotency. See [`fireflies_polling_plan.md`](./fireflies_polling_plan.md).

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Too many **inserts**, few **updates** | Rows to match are **outside** `[anchor−N, anchor]`; increase **`DEDUPE_LLM_LOOKBACK_DAYS`** or set **`meeting_date`** / **`created_at`** on board rows. |
| Dedupe always **inserts** | **`existing_tasks`** empty in logged user JSON — same as above, or wrong sheet/tab. |
| Falls back to “rule-based merge” | Dedupe API/JSON/validation error — read **`[dedupe]`** logs and OpenAI error body. |
| Same transcript not re-run | **Processed Transcripts** still has that Fireflies id — remove row to reprocess (transcript-level idempotency, not dedupe). |

---

## Design notes

- **Two layers:** transcript idempotency = **Processed Transcripts** tab; task dedupe = **LLM** (+ numeric fallback).
- **Task-only semantics** for duplicate *detection*; **updates** still refresh **owner, due dates, urgency**, etc., via **`fields`**.
- **Cost/latency:** one extra OpenAI call **per transcript** processed, proportional to candidate count and size of `existing_tasks` JSON.
