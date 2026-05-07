# Week 6 — implementation plan (execution order)

Ordered checklist for building the Enforcer, QA sheet columns, and human-feedback pipeline. Behavior and acceptance criteria: `scratch/Week-6-guide.md`.

1. **Configuration**
   - Wire command-center spreadsheet id, execution Drive folder, learnings folder, optional pinned learnings file ids (e.g. `lib/env.js` + `.env` examples).
   - Add Enforcer settings module (threshold, min improvement delta, max attempts, model, independent rescore/revision toggles after feedback).

2. **Sheet schema**
   - Define `MASTER_COLUMNS` and row-1 labels for execution + QA blocks; helpers for column letters and width.
   - Specify merged **Universal/Task/Artifact Score** cell format and migration rules from any legacy three-column layout.

3. **Google Sheets integration**
   - Header reconciliation for execution and QA zones; safe row read/write padded to width.
   - Optional migration: merge three score columns → one; delete or clear orphan tail columns after merge.

4. **Enforcer pipeline (LLM)**
   - Chat/JSON helper for the model provider.
   - Pipeline stages: universal QA, task-type rubric, task-specific criteria, combined judgment, artifact reviser.

5. **Drive artifacts**
   - Per-task folders and templated Google Docs for each revision.

6. **Learnings**
   - Judgment log append + project-rules merge from GENERAL RULE lines; Drive file lifecycle.

7. **Orchestration**
   - Main scored revision loop; sheet QA patches; feedback ingest; post-feedback revision loop (same stop rules); fair rescoring for best-URL comparison; sheet-safe revision delta strings; Stop Reason = loop exit when revision runs, **`Rescoring only - no revision`** when rescoring without revision.

8. **Surface area**
   - HTTP routes for Enforcer run and feedback ingest; CLI + npm scripts mirroring API options (`--no-rescore`, `--no-revision`).

9. **Verification**
   - Run through §11 checklist in `scratch/Week-6-guide.md`.
