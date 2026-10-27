const {test} = require('node:test');
const assert = require('node:assert/strict');
const {harness,item}=require('./helpers.cjs');
test('live adapter, schema, duplicate guard and human edits',()=>{
 const h=harness(); const first=h.ctx.processSyntheticMeeting(); assert.equal(first.added,1); assert.equal(h.calls(),1);
 const board=h.tabs.get('Master Action Board');assert.equal(board.rows[1].length,16);assert.equal(board.rows[1][11],'SYN-MTG-001');assert.ok(board.formats.some(f=>f.row===2 && f.col===1 && f.m===16 && f.format==='@'));
 board.rows[1][6]='Reviewed by me';const before=JSON.stringify(board.rows);
 assert.equal(h.ctx.processSyntheticMeeting().added,0);assert.equal(h.calls(),1);assert.equal(JSON.stringify(board.rows),before);
});
test('HTTP failure neither writes tasks nor marks processed; retry succeeds',()=>{
 const h=harness();h.setStatus(429);assert.throws(()=>h.ctx.processSyntheticMeeting(),/HTTP 429/);
 assert.equal(h.tabs.get('Master Action Board').rows.length,1);assert.equal(h.tabs.get('Processed Sources').rows.length,1);
 h.setStatus(200);assert.equal(h.ctx.processSyntheticMeeting().added,1);
});
test('header mismatch stops before network',()=>{const h=harness();h.ctx.setupBoard();h.tabs.get('Master Action Board').rows[0][0]='wrong';assert.throws(()=>h.ctx.processSyntheticMeeting(),/Headers mismatch/);assert.equal(h.calls(),0);});
test('invalid dates, unknown owners and fabricated quotes rejected',()=>{
 const h=harness();for(const patch of [{due_date:'2026-02-30'},{owner:'Imaginary'},{source_quote:'fabricated'},{urgency:11},{task:''}])assert.throws(()=>h.ctx.validateExtraction({actionItems:[{...item,...patch}]},h.ctx.SYNTHETIC));
});
test('partial completion marker failure cannot append duplicate rows',()=>{
 const h=harness();h.ctx.processSyntheticMeeting();h.tabs.get('Processed Sources').rows.pop();assert.throws(()=>h.ctx.processSyntheticMeeting(),/reconcile manually/);assert.equal(h.calls(),1);
});
test('refusal, truncation and invalid JSON do not write',()=>{
 for(const reply of ['not json',JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}),JSON.stringify({choices:[{finish_reason:'stop',message:{refusal:'no'}}]})]){const h=harness();h.setResponse(reply);assert.throws(()=>h.ctx.processSyntheticMeeting());assert.equal(h.tabs.get('Master Action Board').rows.length,1);}
});
test('formula-like model content is escaped',()=>{const h=harness();const row=h.ctx.buildRow({...item,task:'=IMPORTXML("x")'},h.ctx.SYNTHETIC,'HM-0001','now');assert.equal(row[1][0],"'");});

test('source quotes tolerate line-wrap whitespace but never changed words',()=>{
 const h=harness();
 const quote='Morgan: Our supplier quote looks high. Jordan, compare it with the second supplier quote and identify the main cost differences. Jordan: I can do that. No committed date yet.';
 assert.doesNotThrow(()=>h.ctx.validateExtraction({actionItems:[{...item,source_quote:quote}]},h.ctx.SYNTHETIC));
 assert.throws(()=>h.ctx.validateExtraction({actionItems:[{...item,source_quote:quote.replace('No committed date yet.','Due tomorrow.')}]},h.ctx.SYNTHETIC));
});

test('zero-task successes are marked and skip without another API request',()=>{
 const h=harness();h.setResponse(JSON.stringify({id:'empty-result',model:'test',choices:[{finish_reason:'stop',message:{content:JSON.stringify({actionItems:[]})}}]}));
 assert.equal(h.ctx.processSyntheticMeeting().added,0);assert.equal(h.ctx.processSyntheticMeeting().skipped,true);assert.equal(h.calls(),1);
});
test('source IDs cannot become Sheet formulas or malformed keys',()=>{
 const h=harness();for(const id of ['=1+1',' 123','x\n123','']) assert.throws(()=>h.ctx.processTranscript({...h.ctx.SYNTHETIC,id}),/Invalid transcript/);
 assert.equal(h.calls(),0);
});

test('repeated transcript utterances produce a valid unique quote enum',()=>{
 const h=harness();h.ctx.SYNTHETIC.text+='\n'+item.source_quote;assert.equal(h.ctx.processSyntheticMeeting().added,1);
});
