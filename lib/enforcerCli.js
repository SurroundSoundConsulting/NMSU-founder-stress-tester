#!/usr/bin/env node
/**
 * Week 6 Enforcer CLI
 * Usage:
 *   node lib/enforcerCli.js run [--task=TASK_ID] [--force] [--ingest-feedback]
 *   node lib/enforcerCli.js feedback --task=TASK_ID [--no-rescore] [--no-revision]
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { runEnforcerWorkbenchOnce, runEnforcerFeedbackOnce } = require("./enforcerWorkbench");

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a.startsWith("--task=")) out.task = a.slice("--task=".length).trim();
    else if (a === "--force") out.force = true;
    else if (a === "--ingest-feedback") out.ingest_feedback = true;
    else if (a === "--no-rescore") out.no_rescore = true;
    else if (a === "--no-revision") out.no_revision = true;
  }
  return out;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (cmd === "run") {
    const summary = await runEnforcerWorkbenchOnce({
      taskId: args.task,
      force: !!args.force,
      ingest_feedback: !!args.ingest_feedback,
    });
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  if (cmd === "feedback") {
    if (!args.task) {
      console.error("Missing --task=TASK_ID");
      process.exit(1);
    }
    const out = await runEnforcerFeedbackOnce({
      taskId: args.task,
      rescore: args.no_rescore ? false : undefined,
      revision: args.no_revision ? false : undefined,
    });
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  console.error("Usage: node lib/enforcerCli.js run|feedback ...");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
