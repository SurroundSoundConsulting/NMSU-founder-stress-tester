# NMSU Hive Mind — Week 1 facilitator

Implements the October 27, 2026 [participant lab](https://docs.google.com/document/d/1HF4p66MCX4z0wCxU9GjpkNI9JtKe2S7xVinLmM5Tz-g/edit).
Google Apps Script runs the application; Node and clasp are development tools only.

`src/` is the entire upload boundary. The prior `Code.gs`, `LEGACY-README.md`
and discovery plan remain outside that boundary for later weeks. Do not upload
both implementations into one project. No triggers, discovery, messaging or
real-company transcripts are used by this Week 1 project.

## Local verification

From this directory, with Node 20 or newer:

```sh
npm ci
npm test
```

The built-in Node test runner executes the same plain JavaScript as Apps Script
inside a VM with mocked Google services. Local tests do not call OpenAI or Google.
They verify schema, API errors, malformed responses, source guards, recovery after
a missing completion marker, header rejection, and preservation of manual edits.

## One-time Google setup

1. Enable the Apps Script API at https://script.google.com/home/usersettings.
2. Run `npm run clasp -- login` and authorize your Google account. Credentials
   are stored in the git-ignored local `.clasprc.json`.
3. Create a dedicated sandbox Sheet named **Hive Mind — Week 1 (Synthetic)**.
   In that Sheet choose Extensions → Apps Script, and copy its Script ID from
   Project Settings. This is the test project, not an existing operational project.
4. Copy `.clasp.json.example` to `.clasp.json`, fill in the Script ID, retain
   `rootDir: "src"`. Run `npm run clasp -- status` to inspect upload contents.
5. Run `npm run deploy:test`. This runs local tests and uploads source with clasp.
6. In the Apps Script project's Script Properties set `OPENAI_API_KEY` privately,
   `SPREADSHEET_ID` to the sandbox Sheet ID, and `SANDBOX_SPREADSHEET_ID` to
   the same ID. Optional `OPENAI_MODEL` defaults to `gpt-4o-mini`.
   Never put keys in code, chat, shared lab documents or screenshots.
7. Run `setupBoard` once in the Apps Script editor and complete Google's consent.
   The manifest requests Sheets and external-request access only.
8. Run `processSyntheticMeeting`. Inspect the Master Action Board and Processed
   Sources. The latter records response ID, model and HTTP status as live-call
   evidence without recording keys, headers or transcript contents.

## Automated remote verification

`clasp push` is source upload, not an Execution API deployment. To enable
`npm run test:integration`:

1. Associate the script with a standard Google Cloud project in Project Settings.
2. Enable the Apps Script API in that Cloud project.
3. Configure an OAuth client in that same Cloud project and download its client
   credentials locally as `execution.credentials.json` (git-ignored).
4. Reauthorize using `npm run clasp -- login --creds execution.credentials.json
   --use-project-scopes --include-clasp-scopes` (one command).
5. In Apps Script choose Deploy → New deployment → API executable, access yourself.
6. Run `npm run test:integration`, or `npm run verify` to test, push, and run.

The integration function requires SPREADSHEET_ID and SANDBOX_SPREADSHEET_ID to
match. It uses a unique synthetic source ID each time and leaves its evidence
rows in the sandbox for inspection. Each invocation makes one paid API request.
It checks the three required tasks, allowed optional fourth task, dates, owners,
agenda dependency, rejection of the unapproved launch, zero appended rows on
rerun, and preservation of “Reviewed by me”. Review task source quotes and the
board yourself: structural validation cannot prove every semantic inference.

The classroom demonstration uses the fixed `SYN-MTG-001` source. Calling
`processSyntheticMeeting` again skips before the network request and preserves
all rows, including timestamps and edits. Zero-task successes are also recorded.
If rows exist but the completion marker is missing, processing stops for manual
reconciliation instead of risking duplicate work. No automatic retries occur.

## Runtime design

- `synthetic.js`: exact lab transcript and stable source metadata.
- `schema.js`: exact A–P contract, field validation, quote grounding (whitespace normalized, words unchanged), formula escaping.
- `extraction.js`: strict JSON-schema OpenAI call with evidence restricted to unique transcript utterances; HTTP/refusal/truncation validation.
- `sheets.js`: board access and non-destructive header validation.
- `Code.js`: explicit processing with script lock, append-only writes, completion guard.
- `integration.js`: live sandbox acceptance test and edit-preservation check.

All task data is validated before one batch append. The script lock covers both
source checks and writes. A completion record is written only after board flush.
Never delete a completion marker to force re-extraction over human-edited rows.

References: [Google clasp](https://github.com/google/clasp),
[Execution API prerequisites](https://developers.google.com/apps-script/api/how-tos/execute),
[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
