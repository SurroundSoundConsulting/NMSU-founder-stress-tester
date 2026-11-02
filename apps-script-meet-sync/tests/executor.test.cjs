const {test}=require('node:test');
const assert=require('node:assert/strict');
const {executorHarness}=require('./executor-harness.cjs');
test('Executor setup/preview preserve ingestion; mocked services yield one grounded draft and rerun is a no-op',()=>{
  const h=executorHarness(), before=h.snapshot();h.ctx.setupExecutor();h.ctx.setupExecutor();
  assert.equal(h.ctx.previewExecutorSelection()[0].reason,'eligible');assert.deepEqual(h.counts(),{calls:0,creates:0,writes:0});
  const r=h.run();assert.equal(r.state,'ready_for_review',JSON.stringify(r));assert.equal(h.snapshot(),before);
  assert.deepEqual(h.counts(),{calls:1,creates:1,writes:1});
  const text=h.outputs.get('out-1').text;assert.match(text,/Draft agenda/);assert.match(text,/Sources and grounding/);assert.match(text,/\[S1\]/);
  assert.equal(h.run().output_url,r.output_url);assert.deepEqual(h.counts(),{calls:1,creates:1,writes:1});assert.equal(h.snapshot(),before);
});
test('model failure can be manually retried once after time advances, retaining immutable evidence',()=>{
  const h=executorHarness();h.setModel(()=>({status:429}));assert.equal(h.run().state,'failed');h.tick();h.setModel(null);const r=h.run();assert.equal(r.state,'ready_for_review',JSON.stringify(r));assert.deepEqual(h.counts(),{calls:2,creates:1,writes:1});
  const g=executorHarness();g.setModel(()=>({status:429}));g.run();g.tick();g.run();assert.equal(g.run().reason,'attempt_limit');assert.equal(g.counts().calls,2);
});
test('board-done and bound completion evidence suppress drafting, including repeated checks',()=>{
  const h=executorHarness();h.book.tabs.get('Tasks').rows[1][3]='done';assert.equal(h.run().state,'possibly_done');assert.equal(h.run().state,'possibly_done');assert.equal(h.counts().calls,0);
  const g=executorHarness();const text='Jordan: I finished the Arroyo agenda and Avery accepted it.\n';g.files.set('completed',{id:'completed',name:'Done',parents:['completion'],mimeType:'application/vnd.google-apps.document'});g.outputs.set('completed',{text,revision:'r1',title:'Done'});
  g.book.tabs.get('Executor Context').rows.push(['done-map','set1','completed','completion','completion','Arroyo pilot',g.ctx.executorHash(text),'yes',text.trim()]);assert.equal(g.run().state,'possibly_done');assert.equal(g.run().state,'possibly_done');assert.equal(g.counts().calls,0);
});
test('an unregistered completion artifact and a mismatched project cannot silently suppress or enable work',()=>{
  const h=executorHarness();h.files.set('unknown',{id:'unknown',name:'Similar agenda',parents:['completion'],mimeType:'application/vnd.google-apps.document'});assert.equal(h.run().reason,'completion_unclassified');assert.equal(h.counts().calls,0);
  const g=executorHarness();g.book.tabs.get('Executor Context').rows[1][5]='October 26 engagement';assert.equal(g.run().reason,'context_binding');assert.equal(g.counts().calls,0);
});
test('lost create response adopts the unique marked Doc; multiple candidates never select one automatically',()=>{
  const h=executorHarness(),fetch=h.ctx.UrlFetchApp.fetch;let lost=true;
  h.ctx.UrlFetchApp.fetch=(url,options)=>{const result=fetch(url,options);if(lost&&url.includes('/drive/v3/files?fields=id')&&options.method==='post'){lost=false;throw Error('response lost after create');}return result;};
  const r=h.run();assert.equal(r.state,'needs_reconciliation');assert.equal(h.ctx.inspectExecutorRecovery(r.execution_id).candidates.length,1);
  const fixed=h.ctx.reconcileExecutor(r.execution_id,{action:'adopt',file_id:'out-1',reviewed_by:'Instructor',reason:'Verified marker and intended payload'});assert.equal(fixed.state,'ready_for_review');assert.deepEqual(h.counts(),{calls:1,creates:1,writes:1});
  const g=executorHarness(),raw=g.ctx.UrlFetchApp.fetch;g.ctx.UrlFetchApp.fetch=(url,o)=>{const res=raw(url,o);if(url.includes('/drive/v3/files?fields=id')&&o.method==='post'){g.files.set('duplicate',{...g.files.get('out-1'),id:'duplicate'});throw Error('lost');}return res;};const uncertain=g.run();assert.throws(()=>g.ctx.reconcileExecutor(uncertain.execution_id,{action:'adopt',file_id:'out-1',reviewed_by:'Instructor',reason:'Inspect'}),/ambiguous_output/);assert.equal(g.counts().creates,1);
});
test('journal/projection tampering stops further publication and does not overwrite human state',()=>{
  const h=executorHarness();h.run();h.book.tabs.get('Executor Journal').rows[1][4]='{}';assert.throws(()=>h.ctx.inspectExecutor(),/journal_integrity/);
  const g=executorHarness();g.run();g.book.tabs.get('Drafts').rows[1][7]='Human note';g.book.tabs.get('Tasks').rows[1][5]='2026-11-12';assert.equal(g.run().state,'needs_reconciliation');assert.equal(g.book.tabs.get('Drafts').rows[1][7],'Human note');assert.equal(g.counts().creates,1);
});
test('source changes, oversized source and excess completion files stop visibly before model',()=>{
  const h=executorHarness();h.outputs.get('scope').text+='Changed fact\n';assert.equal(h.run().reason,'source_changed');assert.equal(h.counts().calls,0);
  const g=executorHarness();g.outputs.get('scope').text='x'.repeat(20001);assert.equal(g.run().state,'deferred');assert.equal(g.counts().calls,0);
  const f=executorHarness();for(let i=0;i<9;i++)f.files.set('f'+i,{id:'f'+i,parents:['completion']});assert.equal(f.run().reason,'limit_sources');assert.equal(f.counts().calls,0);
});
test('missing scope consent blocks before paid drafting and reports how to proceed',()=>{
  const h=executorHarness();h.ctx.authDenied=true;const r=h.run();assert.equal(r.state,'blocked');assert.equal(r.reason,'access');assert.match(r.next_action,/scope consent/);assert.equal(h.counts().calls,0);assert.equal(h.counts().creates,0);
});
test('source evidence remains intact on paid-call retries and literal cells never become formulas',()=>{
  const h=executorHarness();h.book.tabs.get('Tasks').rows[1][1]='=Draft the Arroyo pilot agenda';const before=h.snapshot();h.consumeTextEscapes();assert.equal(h.run().state,'ready_for_review');assert.equal(h.run().state,'ready_for_review');assert.equal(h.snapshot(),before);
  h.book.tabs.get('Executor Sources').rows[1][2]='tampered';assert.equal(h.run().reason,'evidence_conflict');assert.equal(h.counts().creates,1);
});
test('a four-source completed ingestion rerun leaves execution state untouched',()=>{
  const h=executorHarness();h.run();
  for(const id of ['A','B','C','D']){h.addDoc(id,'2026-11-04','Avery: No new work.');const f=h.docs.get(id);h.files.set(id,{id,name:id,parents:['inputs'],mimeType:f.mimeType});h.ctx.week2ProcessSource(h.ctx.week2ReadSource({id,mimeType:f.mimeType}),h.ctx.week2Config());}
  const before=JSON.stringify([...h.book.tabs].filter(([k])=>k.startsWith('Executor')).map(([k,s])=>[k,s.rows,s.formulas]));
  const result=h.ctx.processInbox({sourceIds:['A','B','C','D']});assert.equal(result.skipped,4);assert.equal(result.processed,0);assert.equal(JSON.stringify([...h.book.tabs].filter(([k])=>k.startsWith('Executor')).map(([k,s])=>[k,s.rows,s.formulas])),before);assert.equal(h.counts().creates,1);
});
test('missing/unapproved scope and unresolved dependencies/relevant reviews block; unrelated reviews remain untouched',()=>{
  for(const change of [h=>h.book.tabs.get('Executor Context').rows.splice(1,1),h=>h.book.tabs.get('Executor Context').rows[1][7]='no',h=>h.book.tabs.get('Tasks').rows[2][3]='open',h=>h.book.tabs.get('Reviews').rows.push(['rev','source','','["HM-0004"]','clarification','{}','pending','','',''])]){
    const h=executorHarness();change(h);const before=h.snapshot();const r=h.run();assert.equal(r.state,'blocked',JSON.stringify(r));assert.equal(h.counts().calls,0);assert.equal(h.counts().creates,0);assert.equal(h.snapshot(),before);
  }
  const h=executorHarness();h.book.tabs.get('Reviews').rows.push(['rev','source','HM-0099','["HM-0099"]','field_conflict','{}','pending','','','']);const before=h.snapshot();assert.equal(h.run().state,'ready_for_review');assert.equal(h.snapshot(),before);
});
test('duplicate requests and schema/formula conflicts stop before model; setup is additive and refuses incompatible existing tabs',()=>{
  const h=executorHarness();h.book.tabs.get('Executor Requests').rows.push(['req2',...h.request.slice(1)]);assert.equal(h.run().reason,'duplicate_request');assert.equal(h.counts().calls,0);
  const g=executorHarness();g.book.tabs.get('Executor Context').formulas['2:7']='=BAD()';assert.equal(g.run().reason,'manual_formula');
  const f=executorHarness();f.book.tabs.get('Executor Requests').rows[0][0]='wrong';assert.throws(()=>f.ctx.setupExecutor(),/schema/);
});
test('overlap defers and human A-P/formula edits are never overwritten',()=>{
  const h=executorHarness();h.setLocked(true);assert.equal(h.run().reason,'busy');assert.equal(h.counts().calls,0);h.setLocked(false);
  h.book.tabs.get('Tasks').formulas['2:7']='="human"';const before=h.snapshot();assert.equal(h.run().state,'ready_for_review');assert.equal(h.snapshot(),before);
});
test('model failures and fabricated grounding produce no documents and no ingestion writes',()=>{
  for(const reply of [()=>({status:429}),d=>({...d,agenda:d.agenda.map(x=>({...x,quote:'invented'}))}),d=>({...d,agenda:d.agenda.map(x=>({...x,text:'Promise 99 dollars'}))}),()=>({throw:true}),d=>({...d,extra:true})]){
    const h=executorHarness();h.setModel(reply);const before=h.snapshot(),r=h.run();assert.equal(r.state,'failed',JSON.stringify(r));assert.equal(h.counts().creates,0);assert.equal(h.snapshot(),before);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|sensitive|test-private/);
  }
});
test('human/source changes during drafting stop creation; edits after publication flag stale and keep existing Doc',()=>{
  const h=executorHarness();h.setModel(d=>{h.book.tabs.get('Tasks').rows[1][5]='2026-11-12';return d;});assert.equal(h.run().state,'stale_requires_review');assert.equal(h.counts().creates,0);
  const g=executorHarness();const r=g.run();g.outputs.get('out-1').text='Human rewritten agenda\n';g.book.tabs.get('Tasks').rows[1][5]='2026-11-12';const rerun=g.run();assert.equal(rerun.state,'stale_requires_review');assert.equal(rerun.output_url,r.output_url);assert.equal(g.outputs.get('out-1').text,'Human rewritten agenda\n');assert.equal(g.counts().creates,1);
});
test('unknown create outcome and an empty search never cause automatic re-creation',()=>{
  const h=executorHarness();h.setHook(({url,options})=>{if(url.includes('/drive/v3/files?fields=id')&&options.method==='post')throw Error('lost response');});
  const r=h.run();assert.equal(r.state,'needs_reconciliation');assert.equal(r.reason,'create_unknown');h.setHook(()=>{});assert.equal(h.run().state,'needs_reconciliation');assert.equal(h.counts().calls,1);assert.equal(h.counts().creates,0);
  const inspection=h.ctx.inspectExecutorRecovery(r.execution_id);assert.equal(inspection.candidates.length,0);assert.equal(inspection.automatic_recreate_allowed,false);
});
test('failure after content write repairs the known output without another model/create/append; repeat recovery is a no-op',()=>{
  const h=executorHarness();let fail=true;
  h.setFailure(e=>e.name==='Executor Journal'&&e.values[0][4]?.includes('"phase":"content_written"')&&fail);
  const r=h.run();assert.equal(r.state,'needs_reconciliation',JSON.stringify(r));fail=false;
  const d={action:'finish_known',reviewed_by:'Instructor',reason:'Inspected known draft'};
  const repaired=h.ctx.reconcileExecutor(r.execution_id,d);assert.equal(repaired.state,'ready_for_review');assert.deepEqual(h.counts(),{calls:1,creates:1,writes:1});
  assert.equal(h.ctx.reconcileExecutor(r.execution_id,d).output_url,repaired.output_url);assert.deepEqual(h.counts(),{calls:1,creates:1,writes:1});
});
test('intervening Doc edit is preserved by recovery; missing output is not recreated',()=>{
  const h=executorHarness();h.setHook(({url})=>{if(url.endsWith(':batchUpdate')){h.outputs.get('out-1').text='Human edit\n';throw Error('interrupted');}});const r=h.run();assert.equal(r.state,'needs_reconciliation');h.setHook(()=>{});
  assert.throws(()=>h.ctx.reconcileExecutor(r.execution_id,{action:'finish_known',reviewed_by:'Instructor',reason:'inspect'}),/document_changed/);assert.equal(h.outputs.get('out-1').text,'Human edit\n');assert.equal(h.counts().creates,1);
  const g=executorHarness();g.run();g.files.delete('out-1');assert.equal(g.run().state,'stale_requires_review');assert.equal(g.counts().creates,1);
});
test('explicit revision preserves the prior output and links exactly one new version',()=>{
  const h=executorHarness();const first=h.run();h.outputs.get('out-1').text='Human revised original\n';
  const next=h.ctx.requestExecutorRevision('HM-0004',first.execution_id,'Need another version','Instructor');
  assert.equal(h.ctx.requestExecutorRevision('HM-0004',first.execution_id,'Repeated click','Instructor').request_id,next.request_id);
  const r=h.ctx.runExecutor({requestId:next.request_id});assert.equal(r.state,'ready_for_review',JSON.stringify(r));assert.equal(h.outputs.get('out-1').text,'Human revised original\n');assert.deepEqual(h.counts(),{calls:2,creates:2,writes:2});
});
test('a late source edit retains the published artifact as stale; a revision conflict never overwrites the Doc',()=>{
  const h=executorHarness();let changed=false;h.setHook(({url})=>{if(!changed&&url.endsWith(':batchUpdate')){changed=true;h.book.tabs.get('Tasks').rows[1][5]='2026-11-12';}});const r=h.run();assert.equal(r.state,'stale_requires_review');assert.ok(r.output_url);assert.equal(h.counts().creates,1);
  const g=executorHarness();g.setHook(({url})=>{if(url.endsWith(':batchUpdate')){g.outputs.get('out-1').text='Human intervened\n';g.outputs.get('out-1').revision='r2';}});assert.equal(g.run().state,'needs_reconciliation');assert.equal(g.outputs.get('out-1').text,'Human intervened\n');assert.equal(g.counts().creates,1);
});
test('Executor cannot inherit the ingestion destination or override a protected demo baseline',()=>{
  const h=executorHarness();h.properties.delete('EXECUTOR_SPREADSHEET_ID');assert.throws(()=>h.ctx.setupExecutor(),/protected_destination/);assert.equal(h.counts().calls,0);
  h.properties.set('EXECUTOR_SPREADSHEET_ID','week2');h.properties.set('EXECUTOR_PROTECTED_SPREADSHEET_IDS','classroom,sandbox');assert.throws(()=>h.ctx.setupExecutor({spreadsheetId:'classroom'}),/protected_destination/);assert.equal(h.ctx.setupExecutor().setup,true);
});
test('ready-for-review gives review instructions rather than generic failure-recovery advice',()=>{
  const h=executorHarness(),r=h.run();assert.match(r.next_action,/Open the linked draft/);assert.doesNotMatch(h.book.tabs.get('Drafts').rows[1][7],/journal|retry/);assert.match(h.ctx.executorNextAction('draft_grounding'),/Inspect/);
});

test('simple navigation keeps three everyday sheets and setup never recreates duplicate displays',()=>{
  const h=executorHarness(),before=h.snapshot(),count=h.book.tabs.size;
  h.ctx.setupExecutor();h.ctx.setupExecutor();h.ctx.setupWeek2Views();
  assert.deepEqual(h.book.getSheets().filter(s=>!s.hidden).map(s=>s.name).sort(),['Drafts','Reviews','Tasks']);
  assert.equal(h.book.tabs.size,count);
  for(const name of ['Due This Week','Blocked Work','By Owner','At Risk','By OKR','Executor View','Master Action Board','Merge Reviews','Executor Executions'])assert.equal(h.book.tabs.has(name),false);
  assert.equal(h.snapshot(),before);assert.equal(h.book.tabs.get('Tasks').getFilter().m,16);
  assert.equal(h.run().state,'ready_for_review');assert.equal(h.run().state,'ready_for_review');assert.equal(h.counts().creates,1);
});

test('renamed board remains compatible with ingestion state and legacy naming remains supported',()=>{
  const h=executorHarness(),s=h.ctx.week2State(h.book);
  assert.equal(s['Master Action Board'][0][0],'HM-0004');
  assert.equal(h.ctx.ensureTab(h.book,'Merge Reviews',h.ctx.WEEK2_TABLES['Merge Reviews']).getName(),'Reviews');
  assert.equal(h.book.tabs.has('Merge Reviews'),false);
  const legacy=h.books.get('classroom');assert.equal(h.ctx.hiveSheet(legacy,'Master Action Board').getName(),'Master Action Board');
});

test('ambiguous legacy and simple sheet names stop before changing either sheet',()=>{
  const h=executorHarness(),before=h.snapshot();h.book.insertSheet('Master Action Board').rows.push(['human data']);
  assert.throws(()=>h.ctx.setupExecutor(),/Duplicate task-sheet names/);
  assert.equal(h.book.tabs.get('Master Action Board').rows[0][0],'human data');assert.equal(h.book.tabs.get('Tasks').rows[1][0],'HM-0004');assert.equal(h.counts().calls,0);
});

test('source preparation accepts Doc links and pins pending context without approving or drafting',()=>{
  const h=executorHarness(),row=h.book.tabs.get('Executor Context').rows[1];h.request[4]='no';
  row[2]='https://docs.google.com/document/d/scope/edit?tab=t.0#heading=h.scope';row[3]='';row[5]='';row[6]='';row[7]='no';
  const before=h.snapshot(),r=h.ctx.prepareExecutorContext({requestId:'req1'});
  assert.equal(r.prepared_rows,1);assert.equal(row[2],'scope');assert.equal(row[3],'context');assert.equal(row[5],'Arroyo pilot');assert.equal(row[6],h.ctx.executorHash(h.scope));assert.equal(row[7],'no');
  assert.equal(r.sources[0].approval,'awaiting_human_review');assert.equal(h.snapshot(),before);assert.deepEqual(h.counts(),{calls:0,creates:0,writes:0});assert.equal(h.ctx.prepareExecutorContext({requestId:'req1'}).prepared_rows,0);
  h.request[4]='yes';assert.equal(h.run().reason,'context_approval');assert.equal(h.counts().calls,0);
  row[7]='yes';assert.equal(h.run().state,'ready_for_review');
});

test('source links accept only native Docs URLs or IDs, never arbitrary websites or pasted text',()=>{
  const h=executorHarness();
  for(const input of ['scope','https://docs.google.com/document/d/scope','https://docs.google.com/document/u/1/d/scope/edit'])assert.equal(h.ctx.executorSourceId(input),'scope');
  for(const input of ['https://evil.example/document/d/scope/edit','https://docs.google.com.evil.example/document/d/scope/edit','http://docs.google.com/document/d/scope/edit','https://drive.google.com/file/d/scope/view','https://docs.google.com/document/d/scope/edit/extra','Here is my scope text',''])assert.throws(()=>h.ctx.executorSourceId(input),/source_link/);
});

test('preparation preserves accepted fingerprints and requires explicit pending approval for new links',()=>{
  const h=executorHarness(),row=h.book.tabs.get('Executor Context').rows[1],before=JSON.stringify(row);h.outputs.get('scope').text+='Changed facts';
  assert.throws(()=>h.ctx.prepareExecutorContext({requestId:'req1'}),error=>error.executorCode==='source_changed');assert.equal(JSON.stringify(row),before);
  const g=executorHarness(),m=g.book.tabs.get('Executor Context').rows[1];m[2]='https://docs.google.com/document/d/scope/edit';const original=JSON.stringify(m);
  assert.throws(()=>g.ctx.prepareExecutorContext({requestId:'req1'}),error=>error.executorCode==='context_approval');assert.equal(JSON.stringify(m),original);assert.equal(g.counts().calls,0);
});

test('preparation validates all sources before writing and detects human edits during reads',()=>{
  const h=executorHarness(),row=h.book.tabs.get('Executor Context').rows[1];h.request[4]='no';row[2]='https://docs.google.com/document/d/scope/edit';row[7]='no';row[6]='';
  h.files.get('meeting').parents=['wrong-folder'];const before=JSON.stringify(h.book.tabs.get('Executor Context').rows);
  assert.throws(()=>h.ctx.prepareExecutorContext({requestId:'req1'}),error=>error.executorCode==='access');assert.equal(JSON.stringify(h.book.tabs.get('Executor Context').rows),before);
  const g=executorHarness(),m=g.book.tabs.get('Executor Context').rows[1];g.request[4]='no';m[2]='https://docs.google.com/document/d/scope/edit';m[7]='no';m[6]='';let changed=false;
  g.setHook(({url})=>{if(!changed&&url.includes('docs.googleapis.com')){changed=true;m[5]='Human changed project';}});
  assert.throws(()=>g.ctx.prepareExecutorContext({requestId:'req1'}),error=>error.executorCode==='context_edited');assert.equal(m[5],'Human changed project');assert.equal(m[6],'');assert.equal(g.counts().creates,0);
});

test('preparation requires a selected request and disabled request before changing pending settings',()=>{
  const h=executorHarness(),row=h.book.tabs.get('Executor Context').rows[1];row[7]='no';row[6]='';const before=JSON.stringify(row);
  assert.throws(()=>h.ctx.prepareExecutorContext({requestId:'req1'}),error=>error.executorCode==='disable_request');assert.equal(JSON.stringify(row),before);
  h.book.tabs.get('Executor Requests').rows.push(['req2',...h.request.slice(1)]);
  assert.throws(()=>h.ctx.prepareExecutorContext(),error=>error.executorCode==='select_request');assert.equal(h.counts().calls,0);
});

test('preparation cannot change a published context and does not rewrite accepted settings on rerun',()=>{
  const h=executorHarness();h.run();const before=JSON.stringify([...h.book.tabs].map(([k,s])=>[k,s.rows]));
  assert.equal(h.ctx.prepareExecutorContext({requestId:'req1'}).prepared_rows,0);assert.equal(JSON.stringify([...h.book.tabs].map(([k,s])=>[k,s.rows])),before);
  h.request[4]='no';const row=h.book.tabs.get('Executor Context').rows[1];row[7]='no';row[6]='';
  assert.throws(()=>h.ctx.prepareExecutorContext({requestId:'req1'}),error=>error.executorCode==='published_context');assert.equal(row[6],'');assert.equal(h.counts().creates,1);
});

test('manual drafting logs actionable results even when selection stops before an execution exists',()=>{
  const h=executorHarness(),logs=[];h.ctx.console.log=value=>logs.push(value);
  const missing=h.ctx.runExecutor({requestId:'missing'});assert.equal(missing.reason,'request_not_found');assert.match(logs[0],/Selected request not found/);assert.equal(h.counts().calls,0);
  const ready=h.run();assert.match(logs.at(-1),/Ready for review/);assert.ok(logs.at(-1).includes(ready.output_url));assert.doesNotMatch(logs.at(-1),/ready_for_review|request_not_found/);
});

test('Drafts displays human status/actions while journal codes and ordinary reruns stay unchanged',()=>{
  const h=executorHarness(),r=h.run(),sheet=h.book.tabs.get('Drafts');
  assert.equal(sheet.rows[0][6],'Status');assert.equal(sheet.rows[0][7],'Next step');assert.equal(sheet.rows[1][6],'Ready for review');assert.match(sheet.rows[1][7],/Open the linked draft/);
  assert.equal(r.state,'ready_for_review');assert.equal(r.status,'Ready for review');assert.equal(h.state().state,'ready_for_review');assert.equal(h.ctx.inspectExecutor().executions[0][6],'ready_for_review');
  const before=JSON.stringify([sheet.rows,h.book.tabs.get('Executor Journal').rows]);h.run();assert.equal(JSON.stringify([sheet.rows,h.book.tabs.get('Executor Journal').rows]),before);assert.equal(h.counts().creates,1);
});

test('blocked task/source messages give specific next steps and never make a drafting call',()=>{
  for(const [change,status,action] of [[h=>h.book.tabs.get('Executor Context').rows.splice(1,1),'Needs source information',/scope Doc/],[h=>h.book.tabs.get('Executor Context').rows[1][7]='no','Needs source approval',/review the actual source/],[h=>h.book.tabs.get('Tasks').rows[2][3]='open','Waiting for a prerequisite',/Open Tasks/],[h=>h.book.tabs.get('Reviews').rows.push(['r','s','HM-0004','[]','clarification','{}','pending','','','']),'Needs a human decision',/Open Reviews/]]){
    const h=executorHarness();change(h);const r=h.run();assert.equal(r.status,status);assert.match(r.next_action,action);assert.equal(h.book.tabs.get('Drafts').rows[1][6],status);assert.equal(h.counts().calls,0);assert.equal(h.counts().creates,0);
  }
});

test('refresh migrates both old display formats without new journal events, timestamps or model work',()=>{
  for(const original of [false,true]){
    const h=executorHarness();h.book.tabs.get('Executor Context').rows[1][7]='no';h.run();
    const record=h.state(),sheet=h.book.tabs.get('Drafts');sheet.rows[0]=Array.from(h.ctx.EXECUTOR_TABLES['Executor Executions']);sheet.rows[1]=Array.from(h.ctx.executorLegacyProjection(record,original));
    const before=JSON.stringify(h.book.tabs.get('Executor Journal').rows),time=record.updated_at;
    assert.equal(h.ctx.refreshExecutorStatus().updated_rows,1);assert.equal(sheet.rows[1][6],'Needs source approval');assert.equal(sheet.rows[1][9],time);assert.equal(JSON.stringify(h.book.tabs.get('Executor Journal').rows),before);
    assert.equal(h.ctx.refreshExecutorStatus().updated_rows,0);assert.deepEqual(h.counts(),{calls:0,creates:0,writes:0});
    h.ctx.setupExecutor();assert.equal(sheet.rows[0][6],'Status');
  }
});

test('refresh refuses a human-edited row before updating any row or header',()=>{
  const h=executorHarness();h.run();const sheet=h.book.tabs.get('Drafts');sheet.rows[0]=Array.from(h.ctx.EXECUTOR_TABLES['Executor Executions']);sheet.rows[1][7]='Human explanation';
  const before=JSON.stringify([...h.book.tabs].map(([k,s])=>[k,s.rows]));
  assert.throws(()=>h.ctx.refreshExecutorStatus(),error=>error.executorCode==='projection_conflict' && /Stop and inspect/.test(error.message));
  assert.equal(JSON.stringify([...h.book.tabs].map(([k,s])=>[k,s.rows])),before);assert.equal(h.counts().creates,1);
});

test('completion evidence is a related document, never reported as a generated draft',()=>{
  const h=executorHarness(),url='https://docs.google.com/document/d/completed/edit';
  const result=h.ctx.executorDescribeResult({state:'possibly_done',reason:'Completion evidence: '+url});
  assert.equal(result.status,'Work may already be complete');assert.equal(result.document_url,url);assert.match(result.next_action,/completion evidence/);assert.match(result.message,/No new draft/);
  const done=h.ctx.executorDescribeResult({state:'possibly_done',reason:'task_done'});assert.equal(done.status,'Task already marked done');assert.equal(done.document_url,'');
});

test('uncertain writes and changed drafts always advise preservation even for otherwise retryable causes',()=>{
  const h=executorHarness();for(const reason of ['quota','limit_runtime','model_http','create_unknown']){
    const r=h.ctx.executorDescribeResult({state:'needs_reconciliation',reason,output_url:'https://docs.google.com/document/d/known/edit'});
    assert.equal(r.status,'Check saved work before continuing');assert.match(r.next_action,/Stop and inspect/);assert.match(r.next_action,/do not create another draft/);assert.ok(r.document_url);
  }
  assert.equal(h.ctx.executorDescribeResult({state:'stale_requires_review',reason:'access'}).status,'Inputs changed — review needed');
  assert.equal(h.ctx.executorDescribeResult({state:'stale_requires_review',reason:'access',output_url:'known'}).status,'Draft needs another check');
});

test('unknown errors are actionable without echoing private provider text; preview remains explicitly limited',()=>{
  const h=executorHarness(),logs=[];h.ctx.console.log=value=>logs.push(value);
  const r=h.ctx.executorDescribeResult({state:'failed',reason:'PRIVATE provider detail'});h.ctx.executorPrintResult(r);assert.ok(r.status);assert.ok(r.next_action);assert.doesNotMatch(logs.join('\n'),/PRIVATE/);
  const preview=h.ctx.previewExecutorSelection()[0];assert.equal(preview.status,'Task eligible');assert.match(preview.message,/Supporting sources and access still need checking/);assert.equal(h.counts().calls,0);
});

test('source preparation uses plain messages and handles overlapping manual controls without changes',()=>{
  const h=executorHarness(),logs=[];h.ctx.console.log=value=>logs.push(value);
  h.request[4]='no';const row=h.book.tabs.get('Executor Context').rows[1];row[2]='https://docs.google.com/document/d/scope/edit';row[7]='no';row[6]='';
  const r=h.ctx.prepareExecutorContext({requestId:'req1'});assert.equal(r.status,'Sources need your review');assert.match(logs.join('\n'),/Needs your review/);assert.doesNotMatch(logs.join('\n'),/awaiting_human_review/);assert.equal(row[7],'no');
  const before=JSON.stringify([...h.book.tabs].map(([k,s])=>[k,s.rows]));h.setLocked(true);assert.equal(h.ctx.prepareExecutorContext().status,'Another run is active');assert.equal(h.ctx.refreshExecutorStatus().status,'Another run is active');h.setLocked(false);
  assert.equal(JSON.stringify([...h.book.tabs].map(([k,s])=>[k,s.rows])),before);assert.deepEqual(h.counts(),{calls:0,creates:0,writes:0});
});
