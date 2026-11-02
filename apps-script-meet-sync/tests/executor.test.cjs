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
  const h=executorHarness();h.book.tabs.get('Master Action Board').rows[1][3]='done';assert.equal(h.run().state,'possibly_done');assert.equal(h.run().state,'possibly_done');assert.equal(h.counts().calls,0);
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
  const g=executorHarness();g.run();g.book.tabs.get('Executor Executions').rows[1][7]='Human note';g.book.tabs.get('Master Action Board').rows[1][5]='2026-11-12';assert.equal(g.run().state,'needs_reconciliation');assert.equal(g.book.tabs.get('Executor Executions').rows[1][7],'Human note');assert.equal(g.counts().creates,1);
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
  const h=executorHarness();h.book.tabs.get('Master Action Board').rows[1][1]='=Draft the Arroyo pilot agenda';const before=h.snapshot();h.consumeTextEscapes();assert.equal(h.run().state,'ready_for_review');assert.equal(h.run().state,'ready_for_review');assert.equal(h.snapshot(),before);
  h.book.tabs.get('Executor Sources').rows[1][2]='tampered';assert.equal(h.run().reason,'evidence_conflict');assert.equal(h.counts().creates,1);
});
test('a four-source completed ingestion rerun leaves execution state untouched',()=>{
  const h=executorHarness();h.run();
  for(const id of ['A','B','C','D']){h.addDoc(id,'2026-11-04','Avery: No new work.');const f=h.docs.get(id);h.files.set(id,{id,name:id,parents:['inputs'],mimeType:f.mimeType});h.ctx.week2ProcessSource(h.ctx.week2ReadSource({id,mimeType:f.mimeType}),h.ctx.week2Config());}
  const before=JSON.stringify([...h.book.tabs].filter(([k])=>k.startsWith('Executor')).map(([k,s])=>[k,s.rows,s.formulas]));
  const result=h.ctx.processInbox({sourceIds:['A','B','C','D']});assert.equal(result.skipped,4);assert.equal(result.processed,0);assert.equal(JSON.stringify([...h.book.tabs].filter(([k])=>k.startsWith('Executor')).map(([k,s])=>[k,s.rows,s.formulas])),before);assert.equal(h.counts().creates,1);
});
test('missing/unapproved scope and unresolved dependencies/relevant reviews block; unrelated reviews remain untouched',()=>{
  for(const change of [h=>h.book.tabs.get('Executor Context').rows.splice(1,1),h=>h.book.tabs.get('Executor Context').rows[1][7]='no',h=>h.book.tabs.get('Master Action Board').rows[2][3]='open',h=>h.book.tabs.get('Merge Reviews').rows.push(['rev','source','','["HM-0004"]','clarification','{}','pending','','',''])]){
    const h=executorHarness();change(h);const before=h.snapshot();const r=h.run();assert.equal(r.state,'blocked',JSON.stringify(r));assert.equal(h.counts().calls,0);assert.equal(h.counts().creates,0);assert.equal(h.snapshot(),before);
  }
  const h=executorHarness();h.book.tabs.get('Merge Reviews').rows.push(['rev','source','HM-0099','["HM-0099"]','field_conflict','{}','pending','','','']);const before=h.snapshot();assert.equal(h.run().state,'ready_for_review');assert.equal(h.snapshot(),before);
});
test('duplicate requests and schema/formula conflicts stop before model; setup is additive and refuses incompatible existing tabs',()=>{
  const h=executorHarness();h.book.tabs.get('Executor Requests').rows.push(['req2',...h.request.slice(1)]);assert.equal(h.run().reason,'duplicate_request');assert.equal(h.counts().calls,0);
  const g=executorHarness();g.book.tabs.get('Executor Context').formulas['2:7']='=BAD()';assert.equal(g.run().reason,'manual_formula');
  const f=executorHarness();f.book.tabs.get('Executor Requests').rows[0][0]='wrong';assert.throws(()=>f.ctx.setupExecutor(),/schema/);
});
test('overlap defers and human A-P/formula edits are never overwritten',()=>{
  const h=executorHarness();h.setLocked(true);assert.equal(h.run().reason,'busy');assert.equal(h.counts().calls,0);h.setLocked(false);
  h.book.tabs.get('Master Action Board').formulas['2:7']='="human"';const before=h.snapshot();assert.equal(h.run().state,'ready_for_review');assert.equal(h.snapshot(),before);
});
test('model failures and fabricated grounding produce no documents and no ingestion writes',()=>{
  for(const reply of [()=>({status:429}),d=>({...d,agenda:d.agenda.map(x=>({...x,quote:'invented'}))}),d=>({...d,agenda:d.agenda.map(x=>({...x,text:'Promise 99 dollars'}))}),()=>({throw:true}),d=>({...d,extra:true})]){
    const h=executorHarness();h.setModel(reply);const before=h.snapshot(),r=h.run();assert.equal(r.state,'failed',JSON.stringify(r));assert.equal(h.counts().creates,0);assert.equal(h.snapshot(),before);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|sensitive|test-private/);
  }
});
test('human/source changes during drafting stop creation; edits after publication flag stale and keep existing Doc',()=>{
  const h=executorHarness();h.setModel(d=>{h.book.tabs.get('Master Action Board').rows[1][5]='2026-11-12';return d;});assert.equal(h.run().state,'stale_requires_review');assert.equal(h.counts().creates,0);
  const g=executorHarness();const r=g.run();g.outputs.get('out-1').text='Human rewritten agenda\n';g.book.tabs.get('Master Action Board').rows[1][5]='2026-11-12';const rerun=g.run();assert.equal(rerun.state,'stale_requires_review');assert.equal(rerun.output_url,r.output_url);assert.equal(g.outputs.get('out-1').text,'Human rewritten agenda\n');assert.equal(g.counts().creates,1);
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
  const h=executorHarness();let changed=false;h.setHook(({url})=>{if(!changed&&url.endsWith(':batchUpdate')){changed=true;h.book.tabs.get('Master Action Board').rows[1][5]='2026-11-12';}});const r=h.run();assert.equal(r.state,'stale_requires_review');assert.ok(r.output_url);assert.equal(h.counts().creates,1);
  const g=executorHarness();g.setHook(({url})=>{if(url.endsWith(':batchUpdate')){g.outputs.get('out-1').text='Human intervened\n';g.outputs.get('out-1').revision='r2';}});assert.equal(g.run().state,'needs_reconciliation');assert.equal(g.outputs.get('out-1').text,'Human intervened\n');assert.equal(g.counts().creates,1);
});
test('Executor cannot inherit the ingestion destination or override a protected demo baseline',()=>{
  const h=executorHarness();h.properties.delete('EXECUTOR_SPREADSHEET_ID');assert.throws(()=>h.ctx.setupExecutor(),/protected_destination/);assert.equal(h.counts().calls,0);
  h.properties.set('EXECUTOR_SPREADSHEET_ID','week2');h.properties.set('EXECUTOR_PROTECTED_SPREADSHEET_IDS','classroom,sandbox');assert.throws(()=>h.ctx.setupExecutor({spreadsheetId:'classroom'}),/protected_destination/);assert.equal(h.ctx.setupExecutor().setup,true);
});
test('ready-for-review gives review instructions rather than generic failure-recovery advice',()=>{
  const h=executorHarness(),r=h.run();assert.match(r.next_action,/Open the linked draft/);assert.doesNotMatch(h.book.tabs.get('Executor Executions').rows[1][7],/journal|retry/);assert.match(h.ctx.executorNextAction('draft_grounding'),/Inspect/);
});
