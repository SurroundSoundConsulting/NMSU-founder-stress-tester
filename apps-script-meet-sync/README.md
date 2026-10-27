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
   `SPREADSHEET_ID` to the classroom Sheet ID. Run `createIntegrationSandbox`
   once to create a separate test Sheet and set `SANDBOX_SPREADSHEET_ID`.
   These IDs must differ. Optional `OPENAI_MODEL` defaults to `gpt-4o-mini`.
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
refer to different spreadsheets. It uses a unique synthetic source ID each time and leaves its evidence
rows only in the separate integration sandbox for inspection. It compares the
classroom rows before and after every run and fails if they change. Each invocation makes one paid API request.
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

## Diagnose and verify test isolation

The earlier test harness assigned a new source UUID on every invocation but
required the test Sheet ID to equal the classroom Sheet ID. Thus each verification
run appended another legitimate source batch to the visible classroom board.
Same-source idempotency passed while the complete facilitator workflow was wrong.

The regression tests now execute two full integration runs through the real
processing boundary and require the classroom rows, IDs and edits to stay intact.
CI runs these tests with the rest of `npm test`. The isolation gate refuses the
classroom destination before calling OpenAI. No shared properties are temporarily
changed during integration runs.

Run `npm run qa:isolation` after deployment for two live integration runs, with
classroom snapshots between runs, followed by a classroom duplicate/edit check.
A successful run saves local, git-ignored `qa-evidence.json` with the observed
counts, IDs, API response references and pass/fail checks.
The classroom edit check temporarily writes a sentinel to one next_step cell,
verifies it survives a rerun, and restores the original value. It refuses
formula-bearing cells and avoids overwriting concurrent changes.

For the one-time cleanup of earlier polluted classroom data, run
`npm run qa:isolation -- --archive`. This makes full archive tabs of both the
board and source ledger, verifies the board copy, then removes only `SYN-TEST-*`
rows from the live classroom tabs. It retains the original `SYN-MTG-001` IDs,
timestamps and human edits. Repeating cleanup is a no-op. Archive tabs are kept.

Retrospective: QA must assert the final state the facilitator sees, including
repeated invocations of the entire verification command. An isolated test passing
is insufficient evidence that its test-data lifecycle is safe.
