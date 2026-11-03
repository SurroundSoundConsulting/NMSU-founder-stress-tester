const fs = require("node:fs"),
  assert = require("node:assert/strict");
const path = process.argv[2] || "session2-private/executor-qa-paths.json",
  p = JSON.parse(fs.readFileSync(path)),
  read = (file) => JSON.parse(fs.readFileSync(file));
const original = read(p.before),
  before = read(p.before_rerun_snapshot),
  after = read(p.after_rerun_snapshot),
  initial = read(p.live_run),
  repeat = read(p.rerun),
  edited = read(p.before_rerun_inspection),
  finalDoc = read(p.after_rerun_inspection),
  marker = read("session2-private/executor-reviewer-marker.json").marker;
assert.deepEqual(before.ingestion, original.state);
assert.deepEqual(after.ingestion, original.state);
assert.deepEqual(
  after.executor,
  before.executor,
  "Successful execution, source evidence, decisions or configuration changed on rerun",
);
assert.equal(before.model_requests, 1);
assert.equal(after.model_requests, 1);
assert.equal(initial.code, "ready");
assert.equal(repeat.code, "ready");
assert.equal(repeat.drafting_calls, 0);
assert.equal(repeat.document, initial.document);
assert.equal(repeat.execution_id, initial.execution_id);
assert.equal(initial.evidence.http_status, 200);
assert.ok(initial.evidence.response_id);
const states = Object.values(after.executor["Executor State"]);
assert.equal(states.length, 1);
const state = states[0];
assert.equal(state.phase, "ready");
assert.equal(state.attempts.length, 1);
assert.equal(state.execution_id, initial.execution_id);
assert.equal(state.output_id, finalDoc.journal.output_id);
assert.equal(finalDoc.journal.phase, "complete");
assert.equal(edited.actual_text, finalDoc.actual_text);
assert.equal(edited.document.revisionId, finalDoc.document.revisionId);
assert.equal(finalDoc.actual_text.split(marker).length - 1, 1);
const task = after.ingestion["Master Action Board"].values.find(
  (r) => r[0] === "HM-0013",
);
assert.equal(task[2], "Jordan");
assert.equal(task[3], "open");
assert.equal(task[5], "2026-11-06");
assert.ok(task[8].includes("HM-0010"));
const pending = after.ingestion["Merge Reviews"].values
  .slice(1)
  .map((r) => JSON.parse(r[1]))
  .filter((r) => r.state === "pending");
assert.equal(pending.length, 2);
const sourceEvidence = Object.values(after.executor["Executor Evidence"]);
assert.equal(sourceEvidence.length, 4);
assert.equal(sourceEvidence.filter((s) => s.role === "scope").length, 1);
assert.equal(sourceEvidence.filter((s) => s.role === "transcript").length, 3);
const scope = sourceEvidence.find((s) => s.role === "scope");
for (const segment of state.proposal.segments) {
  assert.equal(segment.source_key, scope.key);
  assert.ok(scope.text.includes(segment.quote));
}
assert.equal(
  state.proposal.segments.reduce((sum, s) => sum + s.minutes, 0),
  20,
);
assert.deepEqual(
  state.proposal.segments.map((s) => s.phase),
  ["introduction", "walkthrough", "safe_stop", "questions"],
);
const body = finalDoc.actual_text.split("Sources and grounding")[0];
assert.match(
  body,
  /Audience: Arroyo site manager and the Mesa Verde Robotics pilot team/,
);
assert.match(body, /20-minute demonstration session, including questions/);
assert.match(body, /2026-11-06 \(not an event date\)/);
assert.match(body, /tabletop simulation only/);
assert.match(body, /Event date\/time and venue: not supplied/);
assert.ok(state.body_words <= 380);
const context = after.executor["Executor Context"].values.slice(1);
assert.equal(context.length, 4);
for (const row of context) {
  assert.equal(row[6], "yes");
  assert.equal(sourceEvidence.find((s) => s.key === row[1]).hash, row[7]);
}
assert.deepEqual(state.completion_search.matches, []);
assert.match(
  state.completion_search.statement,
  /unconnected work was not searched/,
);
const files = read(p.output_listing).files;
assert.equal(files.length, 1);
assert.equal(files[0].id, state.output_id);
assert.equal(files[0].mimeType, "application/vnd.google-apps.document");
assert.equal(files[0].appProperties.execution_id, state.execution_id);
assert.deepEqual(
  after.sheets
    .filter((s) => !s.hidden)
    .map((s) => s.name)
    .sort(),
  ["Drafts", "Reviews", "Tasks"],
);
assert.equal(
  after.sheets.find((s) => s.name === "Tasks").id,
  read(p.setup_snapshot).sheets.find((s) => s.name === "Tasks").id,
);
assert.equal(p.native_render.agenda_body_one_page, true);
assert.equal(p.native_render.separate_sources_page, true);
assert.equal(p.quality_judgment.verdict, "supported and useful");
const report = {
  passed: true,
  task_id: "HM-0013",
  business_task_status: "open",
  tasks: after.ingestion["Master Action Board"].values.length - 1,
  completed_sources: after.ingestion["Processed Sources"].values.length - 1,
  pending_reviews: 2,
  successful_drafting_calls: 1,
  extra_drafting_calls_on_rerun: 0,
  output_docs: 1,
  document: state.output_url,
  execution_id: state.execution_id,
  provider: state.provider_evidence,
  body_words: state.body_words,
  google_rendered_body_one_page: true,
  separate_source_appendix: true,
  reviewer_edit_preserved: true,
  output_revision_unchanged_on_rerun: true,
  ingestion_exactly_preserved: true,
  executor_state_exactly_preserved_on_rerun: true,
  quality_judgment: p.quality_judgment,
  facilitator_final_draft_review_pending: true,
};
fs.writeFileSync(
  "session2-private/acceptance-executor.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
