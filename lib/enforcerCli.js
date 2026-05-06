#!/usr/bin/env node
/**
 * CLI: npm run enforcer:run [--task=TASK_ID] [--force] [--ingest-feedback]
 *      npm run enforcer:feedback -- --task=TASK_ID [--no-rescore] [--no-revision]
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { runEnforcerOnce, runFeedbackIngestOnce } = require("./enforcerWorkbench");

const argv = process.argv.slice(2);
const feedback = argv.includes("--feedback");
const force = argv.includes("--force");
const ingestFeedback = argv.includes("--ingest-feedback");
const noRescore = argv.includes("--no-rescore");
const noRevision = argv.includes("--no-revision");

let taskId = process.env.ENFORCER_TASK_ID || "";
for (const a of argv) {
  if (a.startsWith("--task=")) taskId = a.slice("--task=".length).trim();
}

async function main() {
  if (feedback) {
    const out = await runFeedbackIngestOnce({
      taskId,
      rescore: noRescore ? false : undefined,
      revision: noRevision ? false : undefined,
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const out = await runEnforcerOnce({
    taskId: taskId || undefined,
    force,
    ingestFeedback,
  });
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
