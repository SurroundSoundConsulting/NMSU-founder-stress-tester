const fs=require('node:fs'),assert=require('node:assert/strict');
const [beforePath,runPath,afterPath]=process.argv.slice(2);
if(!afterPath)throw new Error('Pass before snapshot, rerun response, after snapshot');
const read=p=>JSON.parse(fs.readFileSync(p));const before=read(beforePath),run=read(runPath),after=read(afterPath);
assert.equal(run.outcomes.length,4);for(const outcome of run.outcomes){assert.equal(outcome.outcome,'skipped');assert.equal(outcome.extractions,0);assert.equal(outcome.model_requests,0);}
assert.deepEqual(after.state,before.state,'Durable board, ledger or support state changed');assert.deepEqual(after.views,before.views,'View values changed');
const report={passed:true,skipped:4,model_requests:0,extractions:0,durable_state_identical:true,views_identical:true,before:beforePath,run:runPath,after:afterPath};fs.writeFileSync('session2-private/acceptance-rerun.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
