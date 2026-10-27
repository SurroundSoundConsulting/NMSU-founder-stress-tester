const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness,item}=require('./helpers.cjs');
const tasks=[
 {...item,task:'Update customer interview questions',owner:'Morgan',due_date:'2026-10-30',source_quote:'Morgan: Yes. I will put the revised questions in the shared folder by October 30, and I will send Avery the link.'},
 {...item,task:'Draft a demo agenda',owner:'Jordan',dependencies:'Pilot scope from Avery'},
 {...item}
];
function seeded(options){
 const h=harness(options);
 h.ctx.processSyntheticMeeting();
 h.tabs.get('Master Action Board').rows[1][6]='Human note to preserve';
 h.setResponse(JSON.stringify({id:'live-test',model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify({actionItems:tasks})}}]}));
 return h;
}
test('two full integration runs leave classroom rows, IDs and edits unchanged',()=>{
 const h=seeded(); const before=JSON.stringify([...h.tabs]);
 assert.equal(h.ctx.runIntegrationTests().passed,true);
 assert.equal(h.ctx.runIntegrationTests().passed,true);
 assert.equal(JSON.stringify([...h.tabs]),before);
 assert.equal(h.sandboxTabs.get('Master Action Board').rows.length,7);
});
test('integration refuses the classroom as its test destination before any API call',()=>{
 const h=seeded({sameBook:true}); const before=JSON.stringify([...h.tabs]);const calls=h.calls();
 assert.throws(()=>h.ctx.runIntegrationTests(),/separate|different|distinct/i);
 assert.equal(h.calls(),calls);assert.equal(JSON.stringify([...h.tabs]),before);
});

test('archive removes only test batches and retains full copies and human edits',()=>{
 const h=seeded();
 const primary=JSON.stringify(h.tabs.get('Master Action Board').rows);
 h.ctx.processTranscript({...h.ctx.SYNTHETIC,id:'SYN-TEST-old'});
 const before=JSON.stringify(h.tabs.get('Master Action Board').rows);
 const result=h.ctx.archiveClassroomTestRuns();
 assert.equal(result.archived,3);assert.equal(result.remaining,1);assert.equal(result.preserved,true);
 assert.equal(JSON.stringify(h.tabs.get('Master Action Board').rows),primary);
 assert.equal(JSON.stringify(h.tabs.get(result.archiveBoard).rows),before);
 assert.equal(h.ctx.archiveClassroomTestRuns().archived,0);
});

test('classroom QA proves rerun/edit preservation and restores original cell value',()=>{
 const h=seeded();const before=JSON.stringify([...h.tabs]);
 assert.equal(h.ctx.verifyClassroomRerun().passed,true);
 assert.equal(JSON.stringify([...h.tabs]),before);
});

test('classroom QA refuses formula cells without replacing the formula or value',()=>{
 const h=seeded();const board=h.tabs.get('Master Action Board');board.formulas['2:7']='=CONCAT("Human"," note")';
 const before=JSON.stringify([...h.tabs]);
 assert.throws(()=>h.ctx.verifyClassroomRerun(),/formula-bearing/);
 assert.equal(JSON.stringify([...h.tabs]),before);
});
