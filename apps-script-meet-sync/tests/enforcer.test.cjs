const {test}=require('node:test');
const assert=require('node:assert/strict');
const {enforcerHarness}=require('./enforcer-harness.cjs');

test('independent review preserves Executor and ingestion, publishes one report and repeats without calls or journal churn',()=>{
  const h=enforcerHarness(),before=h.reviewSnapshot(),draft=h.outputs.get(h.execution.output_id).text;
  h.setReviewModel((r,p)=>{const input=JSON.parse(p.messages[1].content);assert.equal(input.draft.text,draft);assert.equal(p.messages.length,2);assert.equal(input.rendered,undefined);assert.equal(input.model,undefined);assert.ok(p.messages[0].content.includes('BOTH directions'));return r;});
  const r=h.review();assert.equal(r.state,'complete');assert.equal(h.reviewCalls(),1);assert.notEqual(h.reviewState().report_id,h.execution.output_id);assert.equal(h.reviewSnapshot(),before);assert.equal(h.outputs.get(h.execution.output_id).text,draft);
  const journal=JSON.stringify(h.book.tabs.get('Enforcer Journal').rows),counts=h.counts();
  assert.equal(h.review().report_url,r.report_url);assert.equal(h.reviewCalls(),1);assert.equal(JSON.stringify(h.book.tabs.get('Enforcer Journal').rows),journal);assert.deepEqual(h.counts(),counts);
});
test('omission fixture needs evidence-backed missing information; corrected control has no such finding',()=>{
  const h=enforcerHarness(),d=h.outputs.get(h.execution.output_id);d.text=d.text.split('Sources and grounding evidence')[0].replace('Collect questions within 20 minutes.','Collect questions.');
  assert.equal(h.review().state,'complete');assert.equal(h.reviewState().findings,1);assert.match(h.outputs.get(h.reviewState().report_id).text,/missing_information/);
  const clean=enforcerHarness();assert.equal(clean.review().state,'complete');assert.equal(clean.reviewState().findings,0);
});
test('setup is repeat safe, keeps three visible tabs, and later Executor setup preserves reviewer columns',()=>{
  const h=enforcerHarness(),before=h.reviewSnapshot();h.ctx.setupEnforcer();assert.equal(h.reviewSnapshot(),before);assert.equal([...h.book.tabs.values()].filter(s=>!s.hidden).length,3);
  h.review();const display=h.book.tabs.get('Drafts').rows.map(r=>r.slice(10));h.ctx.setupExecutor();assert.deepEqual(h.book.tabs.get('Drafts').rows.map(r=>r.slice(10)),display);
});
test('protected destination, pending profile, disabled request and busy lock make zero paid review calls',()=>{
  for(const variant of ['protected','approval','disabled','busy']){const h=enforcerHarness();if(variant==='protected')h.properties.set('ENFORCER_SPREADSHEET_ID','classroom');if(variant==='approval')h.req[7]='';if(variant==='disabled')h.req[4]='no';if(variant==='busy')h.setLocked(true);const r=h.review();assert.notEqual(r.state,'complete');assert.equal(h.reviewCalls(),0);}
});
test('fabricated evidence, invalid offsets, uncovered requirements and unsupported correction evidence reject publication',()=>{
  for(const mutate of [r=>{r.checks[0].draft_start=999;},r=>{r.checks=[];},r=>{r.checks.push({...r.checks[0]});},r=>{r.checks[0].status='missing';},r=>{r.checks[0].status='approved';}]){const h=enforcerHarness(),creates=h.counts().creates;h.setReviewModel(r=>{mutate(r);return r;});assert.notEqual(h.review().state,'complete');assert.equal(h.counts().creates,creates);}
  const h=enforcerHarness();h.outputs.get(h.execution.output_id).text='No duration.\n';h.setReviewModel(r=>{r.checks[0].issue.correction_evidence[0].source_id='invented';return r;});assert.notEqual(h.review().state,'complete');assert.equal(h.reviewState().phase,'model_failed');
});
test('draft edit makes review stale; deliberate successor preserves prior report and is disabled until selected',()=>{
  const h=enforcerHarness(),first=h.review(),id=h.reviewState().id;const old=h.outputs.get(h.reviewState().report_id).text;
  h.outputs.get(h.execution.output_id).text+='Human correction.\n';assert.equal(h.review().state,'stale');assert.equal(h.reviewCalls(),1);
  const next=h.ctx.requestEnforcerReview(id,'Review human correction','Instructor');assert.equal(next.enabled,'no');assert.equal(h.ctx.requestEnforcerReview(id,'again','Instructor').request_id,next.request_id);
  h.book.tabs.get('Enforcer Requests').rows.at(-1)[4]='yes';const r=h.ctx.runEnforcer({requestId:next.request_id});assert.equal(r.state,'complete');assert.notEqual(r.report_url,first.report_url);assert.equal(h.outputs.get(first.report_url.split('/')[5]).text,old);
});
test('input changes during a paid review stop before report create and retain the draft',()=>{
  const h=enforcerHarness(),creates=h.counts().creates;h.setReviewModel(r=>{h.outputs.get(h.execution.output_id).text+='Human intervened.\n';return r;});const r=h.review();assert.equal(r.state,'stale');assert.equal(h.counts().creates,creates);assert.match(h.outputs.get(h.execution.output_id).text,/Human intervened/);
});
test('changed original source blocks before model; accepted evidence is never repinned',()=>{
  const h=enforcerHarness(),before=JSON.stringify(h.book.tabs.get('Executor Sources').rows);h.outputs.get('scope').text+='Changed source.\n';assert.equal(h.review().reason,'source_changed');assert.equal(h.reviewCalls(),0);assert.equal(JSON.stringify(h.book.tabs.get('Executor Sources').rows),before);
});
test('human-edited projection, journal tampering, and formulas are preserved and stop work',()=>{
  for(const kind of ['projection','journal','formula']){const h=enforcerHarness();h.review();const calls=h.reviewCalls();if(kind==='projection'){h.book.tabs.get('Drafts').rows[1][10]='Human note';assert.throws(()=>h.ctx.setupEnforcer(),/projection_conflict/);}if(kind==='journal')h.book.tabs.get('Enforcer Journal').rows[1][5]='tampered';if(kind==='formula')h.book.tabs.get('Enforcer Requests').formulas['2:5']='=TRUE';assert.notEqual(h.review().state,'complete');assert.equal(h.reviewCalls(),calls);}
});
test('lost create response never creates again and unique report can be adopted explicitly',()=>{
  const h=enforcerHarness();let lost=false;h.setReviewHook(({url,options,stage})=>{if(!lost&&stage==='after'&&url.includes('/drive/v3/files?')&&options.method==='post'){lost=true;throw Error('lost response');}});
  assert.equal(h.review().state,'needs_reconciliation');const state=h.reviewState(),creates=h.counts().creates;h.setReviewHook(()=>{});assert.equal(h.review().state,'needs_reconciliation');assert.equal(h.counts().creates,creates);
  const inspection=h.ctx.inspectEnforcerRecovery({requestId:h.req[0]});assert.equal(inspection.candidates.length,1);assert.equal(inspection.automatic_recreate_allowed,false);
  const r=h.ctx.reconcileEnforcer(state.id,{action:'adopt',file_id:inspection.candidates[0].id,reviewed_by:'Instructor',reason:'Unique marker and payload verified'});assert.equal(r.state,'complete');assert.equal(h.reviewCalls(),1);assert.equal(h.counts().creates,creates);
  const count=h.counts();h.ctx.reconcileEnforcer(state.id,{action:'finish_known',reviewed_by:'Instructor',reason:'Repeat check'});assert.deepEqual(h.counts(),count);
});
test('write response loss repairs a known complete report without appending or repeating model',()=>{
  const h=enforcerHarness();let lost=false;h.setReviewHook(({url,stage})=>{if(!lost&&stage==='after'&&url.includes(':batchUpdate')){lost=true;throw Error('lost write response');}});assert.equal(h.review().state,'needs_reconciliation');const state=h.reviewState(),counts=h.counts();h.setReviewHook(()=>{});assert.equal(h.ctx.reconcileEnforcer(state.id,{action:'finish_known',reviewed_by:'Instructor',reason:'Readback matches saved report'}).state,'complete');assert.deepEqual(h.counts(),counts);assert.equal(h.reviewCalls(),1);
});
test('human report edits are preserved by reruns and recovery',()=>{
  const h=enforcerHarness();h.review();const d=h.outputs.get(h.reviewState().report_id);d.text+='Human report note.\n';assert.equal(h.review().state,'report_edited');assert.match(d.text,/Human report note/);assert.equal(h.reviewCalls(),1);
});
test('lost model response requires a recorded explicit retry and remains capped',()=>{
  const h=enforcerHarness();h.setReviewModel(()=>({throw:true}));assert.equal(h.review().state,'needs_reconciliation');assert.equal(h.review().state,'needs_reconciliation');assert.equal(h.reviewCalls(),1);h.ctx.reconcileEnforcer(h.reviewState().id,{action:'retry_model',reviewed_by:'Instructor',reason:'Acknowledge possibly charged attempt'});h.setReviewModel(r=>r);assert.equal(h.review().state,'complete');assert.equal(h.reviewCalls(),2);
});
test('known model failures retry only by invocation and stop after two attempts',()=>{
  const h=enforcerHarness();h.setReviewModel(()=>({status:429}));h.review();h.review();assert.equal(h.reviewCalls(),2);assert.equal(h.review().reason,'attempt_limit');assert.equal(h.reviewCalls(),2);
});
test('missing or multiple create matches cannot authorize a second report',()=>{
  for(const count of [0,2]){const h=enforcerHarness();h.setReviewHook(({url,options,stage})=>{if(stage==='after'&&url.includes('/drive/v3/files?')&&options.method==='post')throw Error('lost');});h.review();h.setReviewHook(()=>{});const state=h.reviewState();const report=[...h.files.values()].find(f=>f.appProperties?.enforcer_id===state.id);if(count===0){h.files.delete(report.id);}else{h.files.set('duplicate',{...report,id:'duplicate'});}const creates=h.counts().creates;assert.throws(()=>h.ctx.reconcileEnforcer(state.id,{action:'adopt',file_id:report.id,reviewed_by:'Instructor',reason:'Inspect'}),/ambiguous_output/);h.review();assert.equal(h.counts().creates,creates);}
});
test('current task/request/profile and destination changes invalidate a completed review',()=>{
  for(const change of [h=>h.book.tabs.get('Tasks').rows.find(r=>r[0]==='HM-0004')[5]='2026-11-07',h=>h.req[9]='New reviewer',h=>h.properties.set('ENFORCER_REPORT_FOLDER_ID','another-folder'),h=>h.request[6]='Changed audience']){const h=enforcerHarness();h.review();change(h);assert.equal(h.review().state,'stale');assert.equal(h.reviewCalls(),1);}
});
test('rerunning an old review never replaces the latest successor display',()=>{
  const h=enforcerHarness();h.review();const id=h.reviewState().id;h.outputs.get(h.execution.output_id).text+='Changed.\n';h.review();const next=h.ctx.requestEnforcerReview(id,'Check correction','Instructor');h.book.tabs.get('Enforcer Requests').rows.at(-1)[4]='yes';h.ctx.runEnforcer({requestId:next.request_id});const display=JSON.stringify(h.book.tabs.get('Drafts').rows[1].slice(10));h.review();assert.equal(JSON.stringify(h.book.tabs.get('Drafts').rows[1].slice(10)),display);
});
test('suggestions, multi-tab and inline objects are explicit unsupported-content blocks',()=>{
  for(const mutate of [raw=>{raw.tabs[0].documentTab.body.content[0].paragraph.elements[0].textRun.suggestedInsertionIds=['s1'];},raw=>{raw.tabs.push(raw.tabs[0]);},raw=>{raw.tabs[0].documentTab.body.content[0].paragraph.elements.push({inlineObjectElement:{inlineObjectId:'i1'}});}]){
    const h=enforcerHarness();h.setReviewHook(({url,stage,result})=>{if(stage==='after'&&url.includes('/documents/'+h.execution.output_id+'?')){const raw=JSON.parse(result.getContentText());mutate(raw);result.getContentText=()=>JSON.stringify(raw);}});assert.equal(h.review().reason,'document_content');assert.equal(h.reviewCalls(),0);
  }
});
test('oversized draft, incomplete model response and unconfirmed standards cannot produce a report',()=>{
  const h=enforcerHarness();h.outputs.get(h.execution.output_id).text='x'.repeat(20001);assert.equal(h.review().reason,'limit_source');assert.equal(h.reviewCalls(),0);
  const cut=enforcerHarness();cut.setReviewModel(()=>({finish:'length'}));assert.notEqual(cut.review().state,'complete');assert.equal(cut.reviewState().phase,'model_failed');
  const profile=enforcerHarness();profile.req[5]=profile.req[5].replace('"standards":[]','"standards":[{"id":"new","text":"new rule","applies_to":"body"}]');assert.equal(profile.review().reason,'profile_approval');assert.equal(profile.reviewCalls(),0);
});
test('unsupported claim may cite a real quote but corrections still require their own exact source evidence',()=>{
  const h=enforcerHarness();h.outputs.get(h.execution.output_id).text='No duration.\n';h.setReviewModel(r=>{r.checks[0].issue.correction_evidence=[];return r;});assert.notEqual(h.review().state,'complete');
});
test('human page-fit requirements cannot be certified by text review',()=>{
  const h=enforcerHarness();const p=JSON.parse(h.req[5]);p.requirements[0].mode='human_layout';h.req[5]=JSON.stringify(p);h.req[6]=h.ctx.executorHash(h.req[5]);assert.notEqual(h.review().state,'complete');
  const manual=enforcerHarness();const profile=JSON.parse(manual.req[5]);profile.requirements[0].mode='human_layout';manual.req[5]=JSON.stringify(profile);manual.req[6]=manual.ctx.executorHash(manual.req[5]);manual.setReviewModel(r=>{r.checks[0].status='not_assessable';r.checks[0].explanation='A human must inspect rendered page layout.';return r;});assert.equal(manual.review().state,'complete');assert.equal(manual.reviewState().human_checks,1);assert.equal(manual.review().status,'Human check needed');
});
test('explicit publication of saved proposal resumes without another model call',()=>{
  const h=enforcerHarness();let failed=false;h.setFailure(({name,values})=>{if(!failed&&name==='Enforcer Journal'&&JSON.stringify(values).includes('proposal_ready')){failed=true;return true;}return false;});assert.equal(h.review().state,'needs_reconciliation');h.setFailure(()=>false);const state=h.reviewState();assert.equal(h.reviewCalls(),1);const r=h.ctx.reconcileEnforcer(state.id,{action:'publish_saved',reviewed_by:'Instructor',reason:'Saved proposal verified before any create intent'});assert.equal(r.state,'complete');assert.equal(h.reviewCalls(),1);assert.equal(h.counts().creates,2);
});
test('human content in a partially written report is not overwritten by recovery',()=>{
  const h=enforcerHarness();let failed=false;h.setReviewHook(({url,stage})=>{if(!failed&&stage==='before'&&url.includes(':batchUpdate')){failed=true;throw Error('stopped before write');}});h.review();h.setReviewHook(()=>{});const state=h.reviewState();h.outputs.get(state.report_id).text='Human content.';const before=h.counts();assert.throws(()=>h.ctx.reconcileEnforcer(state.id,{action:'finish_known',reviewed_by:'Instructor',reason:'Inspect'}),/document_changed/);assert.equal(h.outputs.get(state.report_id).text,'Human content.');assert.deepEqual(h.counts(),before);
});
test('related pending review blocks while unrelated pending review does not',()=>{
  const h=enforcerHarness();h.book.tabs.get('Reviews').rows.push(['r1','meeting','HM-0005','[]','conflict','{}','pending','','','']);assert.equal(h.review().reason,'relevant_review');assert.equal(h.reviewCalls(),0);
  const other=enforcerHarness();other.book.tabs.get('Reviews').rows.push(['r1','meeting','HM-0009','[]','conflict','{}','pending','','','']);assert.equal(other.review().state,'complete');
});
test('new source versions require an explicit successor and confirmed profile, preserving Executor evidence',()=>{
  const h=enforcerHarness();h.review();const id=h.reviewState().id,before=JSON.stringify(h.book.tabs.get('Executor Sources').rows);h.outputs.get('scope').text+='New synthetic clarification.\n';assert.equal(h.review().state,'stale');const next=h.ctx.requestEnforcerReview(id,'Review source clarification','Instructor');const row=h.book.tabs.get('Enforcer Requests').rows.at(-1),p=JSON.parse(row[5]);p.source_versions=[{file_id:'scope',hash:h.ctx.executorHash(h.outputs.get('scope').text)}];row[5]=JSON.stringify(p);row[6]=h.ctx.executorHash(row[5]);row[4]='yes';assert.equal(h.ctx.runEnforcer({requestId:next.request_id}).state,'complete');assert.equal(JSON.stringify(h.book.tabs.get('Executor Sources').rows),before);assert.ok(h.book.tabs.get('Enforcer Journal').rows.some(r=>String(r[4]).includes('accepted_source_version')));
  const first=enforcerHarness(),profile=JSON.parse(first.req[5]);profile.source_versions=[{file_id:'scope',hash:first.ctx.executorHash(first.scope)}];first.req[5]=JSON.stringify(profile);first.req[6]=first.ctx.executorHash(first.req[5]);assert.equal(first.review().reason,'profile_approval');assert.equal(first.reviewCalls(),0);
});
test('an erased review display requires explicit projection repair without repeating work',()=>{
  const h=enforcerHarness();h.review();const id=h.reviewState().id;h.book.tabs.get('Drafts').rows[1].splice(10,3,'','','');assert.equal(h.review().state,'needs_reconciliation');h.ctx.reconcileEnforcer(id,{action:'repair_projection',reviewed_by:'Instructor',reason:'Restore cleared machine display'});assert.ok(h.book.tabs.get('Drafts').rows[1][10]);assert.equal(h.reviewCalls(),1);
});
test('provider chooses exact evidence while code supplies unique UTF-16 locations',()=>{
  const h=enforcerHarness();h.setReviewModel(r=>{assert.equal(r.checks[0].draft_start,undefined);assert.equal(r.task_fit.draft_start,undefined);return r;});assert.equal(h.review().state,'complete');
});

test('quote location resolution rejects missing or ambiguous passages and retains rejection evidence',()=>{
  for(const [quote,reason] of [['S1','quote_ambiguous'],['invented evidence','quote_not_found']]){const h=enforcerHarness();h.setReviewModel(r=>{r.checks[0].draft_quote=quote;return r;});assert.notEqual(h.review().state,'complete');const events=Object.values(h.ctx.enforcerHistory(h.book))[0].events;assert.equal(events.find(e=>e.type==='rejected_proposal').value.diagnostic,reason);assert.equal(h.counts().creates,1);}
});
test('resolved quote offsets count UTF-16 units including non-BMP characters',()=>{
  const h=enforcerHarness();h.outputs.get(h.execution.output_id).text='😀é\n'+h.outputs.get(h.execution.output_id).text;assert.equal(h.review().state,'complete');const result=Object.values(h.ctx.enforcerHistory(h.book))[0].proposal.review.coverage[0];assert.equal(result.draft_start,h.outputs.get(h.execution.output_id).text.indexOf(result.draft_quote)+1);
});
test('absence satisfies only an explicitly confirmed prohibition and never permits a fabricated quote',()=>{
  const h=enforcerHarness(),p=JSON.parse(h.req[5]);p.requirements[0].mode='prohibition';h.req[5]=JSON.stringify(p);h.req[6]=h.ctx.executorHash(h.req[5]);h.setReviewModel(r=>{r.checks[0].draft_quote='';r.checks[0].explanation='Checked the full draft for a prohibited disclosure; none appears.';return r;});assert.equal(h.review().state,'complete');
  const positive=enforcerHarness();positive.setReviewModel(r=>{r.checks[0].draft_quote='';return r;});assert.notEqual(positive.review().state,'complete');
});
test('known failed review can close with an audit decision and explicit successor, without resetting attempts',()=>{
  const h=enforcerHarness();h.setReviewModel(()=>({status:429}));h.review();h.review();const old=h.reviewState();assert.equal(old.attempts,2);h.ctx.reconcileEnforcer(old.id,{action:'close_failed',reviewed_by:'Operator under approved rehearsal',reason:'Inspected known failures; corrected inputs need a separate request'});assert.equal(h.review().state,'closed');assert.equal(h.reviewCalls(),2);const next=h.ctx.requestEnforcerReview(old.id,'Corrected explicit review profile','Operator');const row=h.book.tabs.get('Enforcer Requests').rows.at(-1);row[4]='yes';h.setReviewModel(r=>r);assert.equal(h.ctx.runEnforcer({requestId:next.request_id}).state,'complete');assert.equal(Object.values(h.ctx.enforcerHistory(h.book)).find(h=>h.id===old.id).record.attempts,2);
});
test('closing a failed review cannot bypass unknown create or model outcomes',()=>{
  const h=enforcerHarness();h.setReviewModel(()=>({throw:true}));h.review();assert.throws(()=>h.ctx.reconcileEnforcer(h.reviewState().id,{action:'close_failed',reviewed_by:'Operator',reason:'Cannot abandon unknown result'}),/human_decision/);assert.equal(h.review().state,'needs_reconciliation');assert.equal(h.reviewCalls(),1);
});
test('review schema binds source IDs to exact passages and forbids reconstructed ellipsis quotes',()=>{
  const h=enforcerHarness();h.setReviewModel((r,p,input)=>{const schema=p.response_format.json_schema.schema;const quote=schema.properties.checks.items.anyOf.find(v=>v.properties.status.enum[0]==='satisfied').properties.draft_quote;assert.ok(quote.enum.includes(r.checks[0].draft_quote));assert.ok(!quote.enum.includes('Introduction...questions'));for(const v of schema.$defs.citation.anyOf){const source=input.sources.find(s=>s.evidence_id===v.properties.source_id.enum[0]);assert.ok(v.properties.quote.enum.every(q=>source.text.includes(q)));}return r;});assert.equal(h.review().state,'complete');
});

test('satisfied checklist assessments cannot be published as must-address judgment findings',()=>{
  const h=enforcerHarness();h.setReviewModel((r,p,input)=>{assert.match(p.messages[0].content,/Findings are exceptions, not a checklist/);const source=input.sources.find(s=>s.role==='scope');r.checks[0].issue={claim_type:'factual_error',category:'requirement',confidence:'high',evidence:[{source_id:source.evidence_id,quote:'Duration: 20 minutes including questions.'}],correction:'',correction_evidence:[]};return r;});assert.equal(h.review().reason,'review_consistency');assert.equal(h.counts().creates,1);
});

test('provider assessments let code assign finding identifiers and check external-use instructions across the whole draft',()=>{
  const h=enforcerHarness();h.setReviewModel((r,p)=>{assert.ok(p.response_format.json_schema.schema.properties.checks);assert.equal(p.response_format.json_schema.schema.properties.findings,undefined);assert.match(p.messages[0].content,/proposing external use/);assert.match(p.messages[0].content,/sole assessment/);return r;});assert.equal(h.review().state,'complete');
});

test('omissions derive missing_information from a single assessment instead of a second type decision',()=>{
  const h=enforcerHarness();h.outputs.get(h.execution.output_id).text=h.outputs.get(h.execution.output_id).text.replaceAll('20 minutes','twenty');h.setReviewModel(r=>{assert.equal(r.checks[0].status,'missing');assert.equal(r.checks[0].issue.claim_type,'factual_error');return r;});assert.equal(h.review().state,'complete');assert.equal(Object.values(h.ctx.enforcerHistory(h.book))[0].proposal.review.findings[0].kind,'missing_information');
});

test('report leads with findings and uses explicit clickable source and draft links',()=>{
  const h=enforcerHarness();let linkSeen=false;h.setReviewHook(({url,options,stage})=>{if(stage==='before'&&url.includes(':batchUpdate')){const p=JSON.parse(options.payload);linkSeen=p.requests.some(r=>r.updateTextStyle?.textStyle?.link?.url);}});assert.equal(h.review().state,'complete');const text=h.outputs.get(h.reviewState().report_id).text;assert.ok(text.indexOf('Findings\n')<text.indexOf('Reviewed text SHA-256:'));assert.equal(linkSeen,true);
});
test('a satisfied requirement cannot publish a routine human-decision finding',()=>{
  const h=enforcerHarness();h.setReviewModel((r,p,input)=>{const source=input.sources.find(s=>s.role==='scope');r.checks[0].issue={claim_type:'unsupported_claim',category:'requirement',confidence:'high',evidence:[{source_id:source.evidence_id,quote:'Duration: 20 minutes including questions.'}],correction:'',correction_evidence:[]};return r;});assert.equal(h.review().reason,'review_consistency');assert.equal(h.counts().creates,1);
});
test('task fit needs actual body evidence and cannot pass on a copied title or source appendix',()=>{
  for(const quote of ['HM-0004: Arroyo pilot demo agenda','S1']){const h=enforcerHarness();h.setReviewModel(r=>{r.task_fit.draft_quote=quote;return r;});assert.notEqual(h.review().state,'complete');assert.equal(h.reviewState().reason,'review_task_fit');}
});
test('body-required coverage cannot use a real quotation found only in the source appendix',()=>{
  const h=enforcerHarness();h.outputs.get(h.execution.output_id).text+='Duration appendix-only check: 20 minutes.\n';h.setReviewModel(r=>{r.checks[0].draft_quote='Duration appendix-only check: 20 minutes.';return r;});assert.notEqual(h.review().state,'complete');
});
test('review recovery still finds its unique report when the folder contains more than eight historical reports',()=>{
  const h=enforcerHarness();h.review();for(let i=0;i<12;i++)h.files.set('historical-'+i,{id:'historical-'+i,mimeType:'application/vnd.google-apps.document',parents:['reports'],appProperties:{enforcer_id:'earlier-'+i}});const r=h.ctx.inspectEnforcerRecovery({requestId:h.req[0]});assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].id,h.reviewState().report_id);
});
test('saved legacy report output with satisfied-check judgments is rejected by the strengthened validator',()=>{
  const h=enforcerHarness();h.review();const history=Object.values(h.ctx.enforcerHistory(h.book))[0],result=JSON.parse(JSON.stringify(history.proposal.review)),input=h.ctx.enforcerInputs(h.book,h.ctx.enforcerSelect(h.book,{requestId:h.req[0]}),h.ctx.enforcerConfig());const q=input.profile.requirements[0];result.findings.push({id:'F1',kind:'judgment',category:'requirement',severity:'human_decision',confidence:'high',reason:'The required duration is already present.',draft_quote:result.coverage[0].draft_quote,draft_start:result.coverage[0].draft_start,requirement_id:q.id,evidence:[{source_id:q.source_id,quote:q.quote,start:input.sources.find(s=>s.evidence_id===q.source_id).text.indexOf(q.quote)+1}],correction:'',correction_evidence:[]});assert.throws(()=>h.ctx.enforcerValidate(result,input),/review_consistency/);
});
test('coverage-only requirements can report omissions but cannot label a partial sequence as a factual conflict',()=>{
  const h=enforcerHarness(),p=JSON.parse(h.req[5]);p.requirements[0].mode='coverage';h.req[5]=JSON.stringify(p);h.req[6]=h.ctx.executorHash(h.req[5]);h.outputs.get(h.execution.output_id).text=h.outputs.get(h.execution.output_id).text.replaceAll('20 minutes','thirty minutes');h.setReviewModel((r,payload)=>{assert.ok(!payload.response_format.json_schema.schema.properties.checks.items.anyOf.find(v=>v.properties.status.enum[0]==='conflicting'));return r;});assert.equal(h.review().state,'complete');assert.equal(Object.values(h.ctx.enforcerHistory(h.book))[0].proposal.review.findings[0].kind,'missing_information');
});
test('extra assertion checks on an already flagged passage merge evidence and reasons without duplicate findings',()=>{
  const h=enforcerHarness();h.outputs.get(h.execution.output_id).text=h.outputs.get(h.execution.output_id).text.replaceAll('20 minutes','30 minutes');h.setReviewModel((r,p,input)=>{const quote=input.draft.text.split('\n').find(x=>x.includes('30 minutes'));r.checks[0].status='conflicting';r.checks[0].draft_quote=quote;r.checks[0].explanation='The stated duration conflicts with the source.';r.claims=[{draft_quote:quote,explanation:'This is the same unsupported duration assertion.',issue:JSON.parse(JSON.stringify(r.checks[0].issue))}];return r;});assert.equal(h.review().state,'complete');const findings=Object.values(h.ctx.enforcerHistory(h.book))[0].proposal.review.findings;assert.equal(findings.length,1);assert.match(findings[0].reason,/same unsupported duration/);
});
test('active issues missing their detail object fail visibly as known validation errors',()=>{
  const h=enforcerHarness();h.setReviewModel(r=>{r.checks[0].status='conflicting';r.checks[0].issue=null;return r;});assert.equal(h.review().reason,'review_invalid');assert.equal(h.reviewState().phase,'model_failed');assert.equal(h.counts().creates,1);
});
test('satisfied composite coverage cannot contradict a missing prerequisite requirement',()=>{
  const h=enforcerHarness(),p=JSON.parse(h.req[5]);p.requirements.push({...p.requirements[0],id:'sequence',mode:'coverage',requires:['duration']});h.req[5]=JSON.stringify(p);h.req[6]=h.ctx.executorHash(h.req[5]);h.outputs.get(h.execution.output_id).text=h.outputs.get(h.execution.output_id).text.replaceAll('20 minutes','thirty minutes');h.setReviewModel(r=>{r.checks.push({requirement_id:'sequence',status:'satisfied',draft_quote:r.task_fit.draft_quote,explanation:'Existing steps are in order.',issue:null});return r;});assert.equal(h.review().reason,'review_consistency');assert.equal(h.counts().creates,1);
});
test('unknown, self and cyclic requirement dependencies stop before any paid review',()=>{
  for(const variant of ['unknown','self','cycle']){const h=enforcerHarness(),p=JSON.parse(h.req[5]);p.requirements[0].requires=[variant==='unknown'?'unknown':variant==='self'?'duration':'sequence'];if(variant==='cycle')p.requirements.push({...p.requirements[0],id:'sequence',requires:['duration']});h.req[5]=JSON.stringify(p);h.req[6]=h.ctx.executorHash(h.req[5]);assert.equal(h.review().reason,'profile_approval');assert.equal(h.reviewCalls(),0);}
});
test('stronger reviewer uses the supported bounded reasoning request without changing Executor model settings',()=>{
  const h=enforcerHarness(),original=h.properties.get('EXECUTOR_OPENAI_MODEL');h.properties.set('ENFORCER_OPENAI_MODEL','gpt-5.4-2026-03-05');h.setReviewModel((r,p)=>{assert.equal(p.reasoning_effort,'low');assert.equal(p.max_completion_tokens,10000);return r;});assert.equal(h.review().state,'complete');assert.equal(h.properties.get('EXECUTOR_OPENAI_MODEL'),original);
});
