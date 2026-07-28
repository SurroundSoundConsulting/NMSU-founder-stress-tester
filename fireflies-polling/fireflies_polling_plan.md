# Fireflies polling (Week 4)

This folder holds the **Fireflies → Hive Mind → command-center sheet** batch workflow.

- **Entry:** `node fireflies-polling/run.js poll` or `... backfill` (see `package.json` scripts).
- **Configuration:** all variables live in the **project root `.env`** (not a separate file). See `lib/env.js` for names: `FIREFLIES_API_KEY`, `GOOGLE_SHEET_ID` (or `GOOGLE_SHEETS_SPREADSHEET_ID`), `POLL_LOOKBACK_MINUTES`, `BACKFILL_LOOKBACK_DAYS`, `GOOGLE_APPLICATION_CREDENTIALS`, `OPENAI_API_KEY`, etc.
- **Task dedupe:** `DEDUPE_LLM_LOOKBACK_DAYS` (default 30) limits which existing Master rows are sent to the dedupe model, anchored on the transcript `meeting_date`. `DEDUPE_LLM_MODEL` defaults to `gpt-4o`. Logging: `DEDUPE_LLM_LOG=1` (default) prints full system + user prompts and raw model JSON to the terminal; set `DEDUPE_LLM_LOG=0` for a short summary only. `DEDUPE_LLM_LOG_MAX_CHARS` caps user message length (default 120000). If the dedupe call fails, the runner falls back to rule-based merge (`task`+`owner`+`due` match).
- **Google Sheet:** create tabs per lab: `Master Action Board`, `Processed Transcripts`, `Polling Log`, `Config`. See `lib/sheetSchema.js` for required columns.

The web UI still uses `POST /hive-mind` for manual analysis. Polling reuses the same Hive Mind logic from `lib/hiveMind.js`.

**LLM dedupe (task merge):** see [DEDUPE_LLM.md](./DEDUPE_LLM.md) for the full design, env vars, logging, and troubleshooting.
