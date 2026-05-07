# Week 6 — implementation checklist, progress, and learnings

Cross-reference: [Week-6-guide.md](./Week-6-guide.md) (spec; updated as behavior evolved).

> **Git:** `scratch/` is normally gitignored. To commit this file: `git add -f scratch/Week-6-plan.md` (or keep a copy under `docs/` if you prefer not to force-add).

---

## Status (lab branch)

| # | Item | Status |
|---|------|--------|
| 1 | Schema — QA block, `MASTER_QA_START_INDEX`, merged scores, headers ([lib/sheetSchema.js](../lib/sheetSchema.js)) | Done |
| 2 | Env — `ENFORCER_*`, `LEARNINGS_*`, `ENFORCER_DRIVE_FOLDER_ID`, `LEARNINGS_PROJECT_RULES_MAX_CHARS` ([lib/env.js](../lib/env.js)) | Done |
| 3 | Sheets — `ensureMasterQaSchema` ([lib/commandCenterSheets.js](../lib/commandCenterSheets.js)) | Done |
| 4 | OpenAI — [lib/openAiChat.js](../lib/openAiChat.js); execution refactored to use it | Done |
| 5 | Drive — export, URL→id, execution body builder, `pickNewestGoogleDocAmongUrls`, export `getDriveDocsAuthClient` ([lib/googleDriveDocs.js](../lib/googleDriveDocs.js)) | Done |
| 6 | Learnings + feedback — [lib/learningsStore.js](../lib/learningsStore.js), [lib/feedbackIngest.js](../lib/feedbackIngest.js); find-or-create by file name to reduce duplicate Drive files | Done |
| 7 | Enforcer core — config, pipeline, drive, workbench ([lib/enforcerWorkbench.js](../lib/enforcerWorkbench.js), etc.) | Done |
| 8 | API + CLI — [server.js](../server.js), [lib/enforcerCli.js](../lib/enforcerCli.js), `npm run enforcer:*` | Done |
| 9 | Optional — Legacy three-column QA migration (guide §4.6); Enforcer UI in `public/` | Not started |

---

## Operator / integration learnings

1. **Shell (zsh):** `npm run enforcer:run -- [--task=…]` fails with `no matches found` — brackets are globs. Use `npm run enforcer:run -- --task=HM-0008` (no square brackets around flags).

2. **`getDriveDocsAuthClient`:** Must be exported from [lib/googleDriveDocs.js](../lib/googleDriveDocs.js); `enforcerDrive` / `learningsStore` require it. Missing export caused `getDriveDocsAuthClient is not a function`.

3. **Learnings files:** Prefer `LEARNINGS_JUDGMENT_LOG_FILE_ID` + `LEARNINGS_PROJECT_RULES_FILE_ID` in `.env` so every run updates the same files. Without pins, code now **finds** `judgment-log.json` / `project-rules.md` by name in `LEARNINGS_DRIVE_FOLDER_ID` before creating, to avoid a noisy folder of duplicates.

4. **Enforcer vs execution Drive roots:** `ENFORCER_DRIVE_FOLDER_ID` (e.g. Agentic Work Product folder) holds per-`task_id` subfolders and Enforcer revision Docs. If unset, falls back to `EXECUTION_DRIVE_FOLDER_ID` (Week 5 execution output).

5. **Which artifact Doc is used:** Among Best / Latest / Execution URLs (deduped), the code picks the Google Doc with the **latest Drive `modifiedTime`** (tie-break: Best → Latest → Execution). **Feedback markers** are read from **that single doc only** (no merge across older docs).

6. **“Knowledge” links in project rules:** Text from `project-rules.md` is injected into the LLM as **## Project rules (excerpt)**. URLs there are **not** auto-fetched via Drive. Only **Execution Context Doc Links** on the sheet triggers `files.export` for linked Google Docs. To confirm what reaches the model, set `ENFORCER_LOG_EVAL_BUNDLE=1` and inspect the one-line JSON log (section lengths + URL counts).

7. **Fair scoring / feedback matrix:** Implemented per guide (rescore-only stop reason, revision toggles, etc.); re-read [Week-6-guide.md](./Week-6-guide.md) §7 for edge cases.

---

## Still optional / follow-ups

- Sheet migration for legacy three numeric QA columns (§4.6).
- Auto-fetch Google Doc URLs discovered inside `project-rules.md` / feedback (caps + SA share), if product wants parity with “link = loaded body.”
- Public UI triggers for Enforcer / feedback runs.
