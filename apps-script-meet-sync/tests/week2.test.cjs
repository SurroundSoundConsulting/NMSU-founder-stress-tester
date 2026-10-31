const {test}=require('node:test');
const assert=require('node:assert/strict');
const {week2Harness,action}=require('./week2-harness.cjs');

function initial(h) {
  const quote='Alex: I will compare the Northstar hardware quotes by November 6, 2026.';
  h.addDoc('one','2026-11-02',quote);
  h.setReply(()=>({actions:[action('new','',quote,{task:'Compare Northstar hardware quotes',owner:'Alex',status:'open',due_date:'2026-11-06'})]}));
  return h.run(['one']);
}

test('multi-meeting repeat, reassignment, distinct deliverable, human conflict, clarification and empty success',()=>{
  const h=week2Harness(), before=JSON.stringify([...h.books.get('classroom').tabs.values()].map(s=>s.rows));
  assert.equal(initial(h).added,1);
  const original=h.rows('Master Action Board')[0].slice(), id=original[0];
  const repeat='Alex: The Northstar hardware quote comparison is unchanged.';
  h.addDoc('two','2026-11-03',repeat);
  h.setReply(()=>({actions:[action('match',id,repeat)]}));
  assert.equal(h.run(['two']).updated,0);assert.deepEqual(h.rows('Master Action Board')[0],original);
  const change='Blair: I now own that existing Northstar hardware comparison, due November 9, 2026.';
  const separate='Alex: I will compare Northstar freight carriers by November 6, 2026, separately from hardware suppliers.';
  h.addDoc('three','2026-11-04',change+'\n'+separate);
  h.setReply(()=>({actions:[action('match',id,change,{owner:'Blair',due_date:'2026-11-09'}),action('new','',separate,{task:'Compare Northstar freight carriers',owner:'Alex',due_date:'2026-11-06'})]}));
  const third=h.run(['three']);assert.equal(third.added,1);assert.equal(third.updated,1);
  const row=h.rows('Master Action Board')[0];assert.equal(row[0],id);assert.equal(row[2],'Blair');assert.equal(row[5],'2026-11-09');assert.equal(row[14],original[14]);assert.notEqual(row[15],original[15]);assert.equal(row[11],original[11]);
  row[5]='2026-11-12';
  const conflict='Blair: Change that hardware comparison deadline to November 10, 2026.';
  const unclear='Alex: Which Northstar comparison should I send? We have not decided whether this is new work.';
  h.addDoc('four','2026-11-05',conflict+'\n'+unclear);
  const other=h.rows('Master Action Board')[1][0];
  h.setReply(()=>({actions:[action('match',id,conflict,{due_date:'2026-11-10'}),action('review','',unclear,{}, {candidate_ids:[id,other]})]}));
  assert.equal(h.run(['four']).reviewed,2);assert.equal(row[5],'2026-11-12');assert.equal(h.rows('Master Action Board').length,2);
  h.addDoc('empty','2026-11-06','Alex: No tasks or changes today.');h.setReply(()=>({actions:[]}));assert.equal(h.run(['empty']).processed,1);
  const calls=h.calls(), snapshot=JSON.stringify(['Master Action Board','Task History','Merge Reviews','Task Baselines','Processed Sources'].map(n=>h.rows(n)));
  assert.equal(h.run().skipped,5);assert.equal(h.calls(),calls);
  assert.equal(JSON.stringify(['Master Action Board','Task History','Merge Reviews','Task Baselines','Processed Sources'].map(n=>h.rows(n))),snapshot);
  assert.equal(JSON.stringify([...h.books.get('classroom').tabs.values()].map(s=>s.rows)),before);
  assert.ok(h.requests.filter(r=>r.url.includes('googleapis.com')).every(r=>r.options.method==='get'));
});

test('same source rename skips; changed content needs review without extraction or board changes',()=>{
  const h=week2Harness();initial(h);const before=JSON.stringify(h.rows('Master Action Board'));
  h.docs.get('one').name='renamed';assert.equal(h.run(['one']).skipped,1);assert.equal(h.calls(),1);
  h.docs.get('one').body+='\nAlex: A changed transcript.';assert.equal(h.run(['one']).changed_requires_review,1);assert.equal(h.calls(),1);assert.equal(JSON.stringify(h.rows('Master Action Board')),before);
});

test('input failure does not block valid meetings; metadata and multi-tab guards',()=>{
  const h=week2Harness();
  h.addDoc('bad','2026-11-01','text',{body:'No metadata'});
  h.addDoc('empty','2026-11-01','',{body:'Title\nMeeting date: 2026-11-01\nTranscript\n'});
  h.addDoc('tabs','2026-11-01','valid',{tabCount:2});
  h.addDoc('unsupported','2026-11-01','text',{mimeType:'text/plain'});
  h.addDoc('denied','2026-11-01','text',{denied:true});
  initial(h);assert.equal(h.calls(),1);
  const r=h.run([], {maxSources:20});assert.equal(r.failed,5);assert.equal(r.skipped,1);assert.equal(h.calls(),1);
  assert.equal(h.rows('Processed Sources').length,1);
});

test('completed files do not consume the new-work budget and backfill shares the guard',()=>{
  const h=week2Harness();initial(h);h.addDoc('later','2026-11-03','Alex: Nothing assigned.');h.setReply(()=>({actions:[]}));
  const r=h.run([], {maxSources:1});assert.equal(r.skipped,1);assert.equal(r.processed,1);assert.equal(r.deferred,0);
  assert.equal(h.ctx.backfillInbox({maxSources:1}).skipped,2);assert.equal(h.calls(),2);
});

test('Drive discovery follows pages and refuses incomplete, missing selected sources and repeated tokens',()=>{
  const h=week2Harness();initial(h);const f={id:'one',createdTime:'2026-11-02',mimeType:'application/vnd.google-apps.document'};
  h.setPages({first:{files:[],nextPageToken:'next'},next:{files:[f]}});assert.equal(h.run(['one']).skipped,1);
  assert.throws(()=>h.run(['missing']),/not in the input folder/);
  h.setPages({first:{files:[],incompleteSearch:true}});assert.throws(()=>h.run(),/Incomplete/);
  h.setPages({first:{files:[],nextPageToken:'next'},next:{files:[],nextPageToken:'next'}});assert.throws(()=>h.run(),/Discovery limit/);
});

test('invalid proposals, unknown references, fabricated evidence and API failures write no tasks or completion',()=>{
  for(const mutate of [a=>{a.task_id='HM-9999';a.decision='match';a.values.task=null;},a=>{a.source_quotes=['fabricated'];},a=>{a.values.owner='Imaginary';},a=>{a.values.due_date='2026-02-30';},a=>{a.values.urgency=12;},a=>{a.dependency_ids=['HM-9999'];}]) {
    const h=week2Harness(),q='Alex: I will prepare the brief.';h.addDoc('one','2026-11-02',q);
    const a=action('new','',q,{task:'Prepare brief',owner:'Alex'});mutate(a);h.setReply(()=>({actions:[a]}));assert.equal(h.run().failed,1);assert.equal(h.rows('Master Action Board').length,0);assert.equal(h.rows('Processed Sources').length,0);assert.equal(h.rows('Source Journal').length,0);
  }
  for(const output of [{status:429},{raw:'invalid'},{raw:JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]})},{actions:'invalid'}]) {
    const h=week2Harness();h.addDoc('one','2026-11-02','Alex: Prepare a brief.');h.setReply(()=>output);assert.equal(h.run().failed,1);assert.equal(h.rows('Processed Sources').length,0);
    assert.ok(!JSON.stringify(h.rows('Run Log')).includes('private'));
  }
});

test('older backfill cannot overwrite newer facts; same-date conflicts and reopening require review',()=>{
  const h=week2Harness();initial(h);const id=h.rows('Master Action Board')[0][0];
  const q='Alex: The deadline on the hardware comparison is November 4, 2026.';
  h.addDoc('old','2026-11-01',q);h.setReply(()=>({actions:[action('match',id,q,{due_date:'2026-11-04'})]}));assert.equal(h.run(['old']).updated,0);assert.equal(h.rows('Master Action Board')[0][5],'2026-11-06');
  h.addDoc('same','2026-11-02',q);assert.equal(h.run(['same']).reviewed,1);
  const done='Alex: The hardware comparison is complete.';h.addDoc('done','2026-11-03',done);h.setReply(()=>({actions:[action('match',id,done,{status:'done'})]}));assert.equal(h.run(['done']).updated,1);
  const reopen='Alex: Reopen the hardware comparison.';h.addDoc('reopen','2026-11-04',reopen);h.setReply(()=>({actions:[action('match',id,reopen,{status:'open'})]}));assert.equal(h.run(['reopen']).reviewed,1);assert.equal(h.rows('Master Action Board')[0][3],'done');
});

test('within-source references consolidate repeated work and forward dependencies use allocated IDs',()=>{
  const h=week2Harness(),q='Alex: Prepare the brief after Blair supplies the scope.';
  const q2='Blair: I will supply the scope.';h.addDoc('one','2026-11-02',q+'\n'+q2);
  h.setReply(()=>({actions:[action('new','',q,{task:'Prepare brief',owner:'Alex',status:'blocked'}, {dependency_ids:['item:1']}),action('new','',q2,{task:'Supply scope',owner:'Blair'}),action('match','item:0',q)]}));
  assert.equal(h.run().added,2);assert.equal(h.rows('Master Action Board')[0][8],h.rows('Master Action Board')[1][0]);assert.equal(h.rows('Task History').length,3);
});

test('unfinished merges block affected tasks, allow unrelated work, and do not re-extract on rerun',()=>{
  const h=week2Harness();initial(h);const id=h.rows('Master Action Board')[0][0], q='Alex: Move the hardware comparison deadline to November 9, 2026.';
  h.addDoc('update','2026-11-03',q);h.setReply(()=>({actions:[action('match',id,q,{due_date:'2026-11-09'})]}));
  h.setFailure(w=>w.name==='Task History');assert.equal(h.run(['update']).needs_reconciliation,1);
  assert.equal(h.rows('Master Action Board')[0][5],'2026-11-09');h.setFailure(()=>false);
  const calls=h.calls();assert.equal(h.run(['update']).needs_reconciliation,1);assert.equal(h.calls(),calls);
  const recovery=h.ctx.inspectWeek2Recovery('DRIVE-update');assert.ok(recovery.operations.some(o=>o.state==='not_applied'));
  assert.throws(()=>h.ctx.reconcileWeek2Source('DRIVE-update'),/reconcile manually/);
  h.addDoc('next','2026-11-04',q);assert.equal(h.run(['next']).failed,1);
  const other='Blair: Write a separate release note.';h.addDoc('independent','2026-11-04',other);h.setReply(()=>({actions:[action('new','',other,{task:'Write release note',owner:'Blair'})]}));assert.equal(h.run(['independent']).added,1);
});

test('completion-write failure can be explicitly reconciled after all work is verified',()=>{
  const h=week2Harness();h.setFailure(w=>w.name==='Processed Sources' && w.row>1);assert.equal(initial(h).needs_reconciliation,1);h.setFailure(()=>false);
  assert.equal(h.ctx.reconcileWeek2Source('DRIVE-one').reconciled,true);assert.equal(h.run(['one']).skipped,1);assert.equal(h.calls(),1);
});

test('concurrent human edit detected before journal commits; formula-like text stays literal',()=>{
  const h=week2Harness();initial(h);const row=h.rows('Master Action Board')[0],id=row[0],q='Alex: Move the hardware comparison deadline to November 9, 2026.';
  h.addDoc('two','2026-11-03',q);h.setReply(()=>{row[5]='2026-11-15';return {actions:[action('match',id,q,{due_date:'2026-11-09'})]};});
  assert.equal(h.run(['two']).failed,1);assert.equal(row[5],'2026-11-15');assert.equal(h.rows('Source Journal').length,1);
  const other='Blair: Prepare the separate brief.';h.addDoc('literal','2026-11-04',other);h.setReply(()=>({actions:[action('new','',other,{task:'=IMPORTXML("bad")',owner:'Blair'})]}));assert.equal(h.run(['literal']).added,1);assert.equal(h.rows('Master Action Board')[1][1][0],"'");
});

test('unsafe configuration, header mismatch and overlapping lock stop before paid extraction',()=>{
  const h=week2Harness();assert.throws(()=>h.run([], {spreadsheetId:'classroom'}),/separate/);assert.throws(()=>h.run([], {spreadsheetId:'sandbox'}),/separate/);assert.throws(()=>h.run([], {maxSources:100}),/limits/);
  h.ctx.setupWeek2();h.books.get('week2').tabs.get('Master Action Board').rows[0][0]='wrong';assert.throws(()=>h.run(),/Headers mismatch/);assert.equal(h.calls(),0);
  const k=week2Harness();k.setLocked(true);assert.equal(initial(k).failed,1);assert.equal(k.calls(),0);
});

test('human formulas remain protected even when their evaluated value equals the last machine value',()=>{
  const h=week2Harness();initial(h);const row=h.rows('Master Action Board')[0], id=row[0];
  h.books.get('week2').tabs.get('Master Action Board').formulas['2:6']='=TEXT(DATE(2026,11,6),"yyyy-mm-dd")';
  const q='Alex: Move that hardware comparison deadline to November 9, 2026.';h.addDoc('two','2026-11-03',q);h.setReply(()=>({actions:[action('match',id,q,{due_date:'2026-11-09'})]}));
  assert.equal(h.run(['two']).reviewed,1);assert.equal(row[5],'2026-11-06');
  const review=h.rows('Merge Reviews')[0][0];
  assert.throws(()=>h.ctx.resolveWeek2Review(review,{action:'apply_proposed',reason:'Approved',reviewed_by:'Facilitator'}),/manual formula/);
  assert.equal(h.ctx.resolveWeek2Review(review,{action:'keep_current',reason:'Keep the formula',reviewed_by:'Facilitator'}).resolved,true);
  assert.ok(h.books.get('week2').tabs.get('Master Action Board').formulas['2:6']);
});

test('explicit human resolution applies once and cannot overwrite a later manual edit',()=>{
  for (const choice of ['keep_current','apply_proposed']) {
    const h=week2Harness();initial(h);const id=h.rows('Master Action Board')[0][0];h.rows('Master Action Board')[0][5]='2026-11-12';
    const q='Alex: Move that hardware comparison deadline to November 9, 2026.';h.addDoc('two','2026-11-03',q);h.setReply(()=>({actions:[action('match',id,q,{due_date:'2026-11-09'})]}));h.run(['two']);
    const review=h.rows('Merge Reviews')[0][0], resolution={action:choice,reason:'Checked with the owner',reviewed_by:'Facilitator'};
    assert.equal(h.ctx.resolveWeek2Review(review,resolution).resolved,true);
    assert.equal(h.rows('Master Action Board')[0][5],choice==='keep_current'?'2026-11-12':'2026-11-09');
    const history=h.rows('Task History').length;assert.equal(h.ctx.resolveWeek2Review(review,resolution).already_resolved,true);assert.equal(h.rows('Task History').length,history);
  }
  const h=week2Harness();initial(h);const id=h.rows('Master Action Board')[0][0];h.rows('Master Action Board')[0][5]='2026-11-12';
  const q='Alex: Move that hardware comparison deadline to November 9, 2026.';h.addDoc('two','2026-11-03',q);h.setReply(()=>({actions:[action('match',id,q,{due_date:'2026-11-09'})]}));h.run(['two']);h.rows('Master Action Board')[0][5]='2026-11-15';
  assert.throws(()=>h.ctx.resolveWeek2Review(h.rows('Merge Reviews')[0][0],{action:'apply_proposed',reason:'Checked',reviewed_by:'Facilitator'}),/changed after/);
});

test('a clarified request can be linked, explicitly created, or dismissed without guessing',()=>{
  for (const choice of ['link_existing','create_task','dismiss']) {
    const h=week2Harness();initial(h);const id=h.rows('Master Action Board')[0][0],q='Alex: It is unclear whether I should send this comparison or create a separate note.';
    h.addDoc('two','2026-11-03',q);h.setReply(()=>({actions:[action('review','',q,{}, {candidate_ids:[id]})]}));h.run(['two']);
    const review=h.rows('Merge Reviews')[0][0];
    const resolution={action:choice,reason:'Clarified with the requester',reviewed_by:'Facilitator',task_id:id,values:{task:'Send the approved comparison',owner:'Alex',due_date:'2026-11-06'}};
    assert.equal(h.ctx.resolveWeek2Review(review,resolution).resolved,true);assert.equal(h.rows('Master Action Board').length,choice==='create_task'?2:1);assert.equal(h.rows('Merge Reviews')[0][6],'resolved');
  }
});

test('circular or self dependencies fail before writes and unknown objectives are not invented',()=>{
  for(const dependency of ['item:0','item:1']) {
    const h=week2Harness(),q='Alex: Prepare a brief.';h.addDoc('one','2026-11-02',q);
    h.setReply(()=>({actions:[action('new','',q,{task:'Prepare brief',owner:'Alex'},{dependency_ids:[dependency]}),action('new','',q,{task:'Prepare scope',owner:'Alex'},{dependency_ids:['item:0']})]}));
    assert.equal(h.run().failed,1);assert.equal(h.rows('Master Action Board').length,0);
  }
  const h=week2Harness(),q='Alex: Prepare a brief.';h.addDoc('one','2026-11-02',q);h.setReply(()=>({actions:[action('new','',q,{task:'Prepare brief',owner:'Alex',okr_link:'UNCONFIRMED'})]}));assert.equal(h.run().failed,1);assert.equal(h.rows('OKR Registry').length,0);
});

test('advisory log failure never causes completed work to be repeated',()=>{
  const h=week2Harness();h.setFailure(w=>w.name==='Run Log' && w.row>1);assert.equal(initial(h).processed,1);h.setFailure(()=>false);assert.equal(h.run(['one']).skipped,1);assert.equal(h.calls(),1);
});

test('staged entry point requires selected IDs rather than silently ingesting the whole folder',()=>{
  const h=week2Harness();assert.throws(()=>h.ctx.processSelectedInbox(),/WEEK2_SELECTED_FILE_IDS/);
  initial(h);h.properties.set('WEEK2_SELECTED_FILE_IDS','one');assert.equal(h.ctx.processSelectedInbox().skipped,1);
});

test('live integration refuses classroom output destinations before extraction or setup writes',()=>{
  const h=week2Harness(), before=JSON.stringify([...h.books].map(([id,b])=>[id,[...b.tabs.values()].map(t=>t.rows)]));
  assert.throws(()=>h.ctx.runWeek2IntegrationTests(),/separate test/);
  h.properties.set('WEEK2_TEST_SPREADSHEET_ID','classroom');h.properties.set('WEEK2_TEST_INBOX_FOLDER_ID','test-inputs');
  assert.throws(()=>h.ctx.runWeek2IntegrationTests(),/separate/);
  h.properties.set('WEEK2_TEST_SPREADSHEET_ID','week2');h.properties.set('WEEK2_TEST_INBOX_FOLDER_ID','inputs');
  assert.throws(()=>h.ctx.runWeek2IntegrationTests(),/separate test/);
  assert.equal(h.calls(),0);assert.equal(JSON.stringify([...h.books].map(([id,b])=>[id,[...b.tabs.values()].map(t=>t.rows)])),before);
});

test('literal text survives a Sheets apostrophe escape round-trip and completion repair',()=>{
  const h=week2Harness();h.consumeTextEscapes();const q='Alex: Prepare a separate brief.';
  h.addDoc('one','2026-11-02',q);h.setReply(()=>({actions:[action('new','',q,{task:'=literal task text',owner:'Alex'}, {reason:'=literal rationale'})]}));
  h.setFailure(w=>w.name==='Processed Sources' && w.row>1);assert.equal(h.run().needs_reconciliation,1);h.setFailure(()=>false);
  assert.equal(h.ctx.reconcileWeek2Source('DRIVE-one').reconciled,true);assert.equal(h.run().skipped,1);assert.equal(h.calls(),1);
});
