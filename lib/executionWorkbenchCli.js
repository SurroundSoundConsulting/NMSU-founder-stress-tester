#!/usr/bin/env node
/**
 * CLI: npm run execution:run
 * Loads .env from project root and runs one execution workbench pass.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { runExecutionWorkbenchOnce } = require("./executionWorkbench");

runExecutionWorkbenchOnce()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
