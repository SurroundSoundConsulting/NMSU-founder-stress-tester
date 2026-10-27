// npm adds the local clasp binary to PATH. Never print credentials or tokens.
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
function call(name) {
 const r=spawnSync('clasp',['-A','.clasprc.json','--json','run',name],{encoding:'utf8'});
 let body;try{body=JSON.parse(r.stdout);}catch(_){throw new Error(r.stderr || 'Invalid clasp response');}
 if(r.status!==0 || body.error || !body.response)throw new Error(JSON.stringify(body.error || body));
 return body.response;
}
const report={};
report.sandbox=call('createIntegrationSandbox');
if(process.argv.includes('--archive')) report.archive=call('archiveClassroomTestRuns');
const before=call('classroomSnapshot');
report.classroom_rows_before=before.rows.length;
report.integration=[];
for(let i=0;i<2;i++) {
 const run=call('runIntegrationTests');assert.equal(run.passed,true);assert.equal(run.classroom_unchanged,true);
 assert.deepEqual(call('classroomSnapshot'),before,'Integration changed visible classroom board');
 report.integration.push(run);
}
report.classroom_rerun=call('verifyClassroomRerun');assert.equal(report.classroom_rerun.passed,true);
assert.deepEqual(call('classroomSnapshot'),before,'QA changed classroom values');
report.classroom_rows_after=before.rows.length;
report.task_ids=before.rows.map(r=>r[0]);report.passed=true;
report.verified_at=new Date().toISOString();
require('node:fs').writeFileSync('qa-evidence.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
