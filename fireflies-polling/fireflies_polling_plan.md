# Fireflies polling (Week 4)

This folder holds the **Fireflies → Hive Mind → command-center sheet** batch workflow.

- **Entry:** `node fireflies-polling/run.js poll` or `... backfill` (see `package.json` scripts).
- **Configuration:** all variables live in the **project root `.env`** (not a separate file). See `lib/env.js` for names: `FIREFLIES_API_KEY`, `GOOGLE_SHEET_ID` (or `GOOGLE_SHEETS_SPREADSHEET_ID`), `POLL_LOOKBACK_MINUTES`, `BACKFILL_LOOKBACK_DAYS`, `GOOGLE_APPLICATION_CREDENTIALS`, `OPENAI_API_KEY`, etc.
- **Google Sheet:** create tabs per lab: `Master Action Board`, `Processed Transcripts`, `Polling Log`, `Config`. See `lib/sheetSchema.js` for required columns.

The web UI still uses `POST /hive-mind` for manual analysis. Polling reuses the same Hive Mind logic from `lib/hiveMind.js`.
