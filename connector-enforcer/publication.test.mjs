import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION,publicationRoute,planEdits,planSuggestions,verifySuggestions,recoverSuggestions,recoverEdit,restoreReview,reviewEvent,reviewKey,preflight} from './protocol.mjs';
import {HEADERS,readEvents} from '../connector-executor/protocol.mjs';

const capabilities={browser:true,authenticated:true,suggesting:true,thread_replies:true};
const request={protocol:VERSION,request_id:'request',task_id:'HM-1',deliverable_type:'agenda',executor_id:'EX-1',draft_id:'draft',version:'1',enabled:true,mode:'suggest_supported',requested_by:'Owner',requested_at:'now',authorization:'Propose supported changes for human acceptance',reviewer:'Owner'};
const evidence={file_id:'scope',revision:'s1',quote:'Duration: 20 minutes.'};
const before={file_id:'draft',tab_id:'t.0',revision:'r1',text:'Duration: 30 minutes.\n',paragraphs:[{start:1,text:'Duration: 30 minutes.\n',style:{namedStyleType:'NORMAL_TEXT'},runs:[{text:'Duration: 30 minutes.\n',style:{}}]}],sections:[]};
const review={task_fit:'fits',findings:[{id:'duration',kind:'contradiction',severity:'must_address',confidence:'high',draft_quote:'Duration: 30 minutes.',evidence:[evidence]}]};
const patch={finding_id:'duration',operation:'replace',paragraph_start:1,old_text:'30',new_text:'20',reason:'Match the accepted duration.',support:[evidence]};
const comments={complete:true,threads:[]};
const plan=()=>planSuggestions(before,before.text,review,[patch],comments,request,'CE-1',capabilities);
function observation(p=plan()) {
  const item=p.suggestions[0];
  return {draft_id:'draft',tab_id:'t.0',reloaded:true,observed_at:'now',fresh_inputs:true,inventory_complete:true,threads:[{
    marker:item.marker,kind:'suggestion',state:'pending',accept_control:true,reject_control:true,
    old_text:item.old_text,new_text:item.new_text,before_passage:item.before_passage,
    thread_id:'thread-1',replies_complete:true,replies:[{reply_id:'reply-1',text:item.rationale}]
  }]};
}
const stops=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('V2 chooses browser suggestions and never falls back to direct edits',()=>{
  assert.equal(publicationRoute(request,capabilities),'browser_suggestions');
  for(const key of Object.keys(capabilities))stops(()=>publicationRoute(request,{...capabilities,[key]:false}),'suggestion_capability_unverified');
  stops(()=>publicationRoute({...request,mode:undefined},capabilities),'request_authorization');
  assert.equal(publicationRoute({...request,mode:'review_only'}),'none');
});
test('direct plan requires explicit enabled correct_supported authorization and the same Doc',()=>{
  for(const r of [undefined,request,{...request,mode:'review_only'},{...request,mode:'correct_supported',authorization:''},{...request,mode:'correct_supported',enabled:false}])
    stops(()=>planEdits(before,before.text,review,[patch],comments,r),'direct_edit_not_authorized');
  const direct={...request,mode:'correct_supported',authorization:'Directly correct this document'};
  assert.equal(planEdits(before,before.text,review,[patch],comments,direct).write_control.requiredRevisionId,'r1');
  stops(()=>planEdits(before,before.text,review,[patch],comments,{...direct,draft_id:'other'}),'draft_identity');
  const planned=planEdits(before,before.text,review,[patch],comments,direct);
  stops(()=>recoverEdit(planned,before,{action:'apply_saved_batch',actor:'Owner',reason:'Continue',at:'now'},request),'direct_edit_not_authorized');
});
test('suggestion plan retains exact target and source-backed rationale without executable direct requests',()=>{
  const p=plan();assert.equal(p.draft_id,'draft');assert.equal(p.suggestions[0].old_text,'30');assert.equal(p.suggestions[0].new_text,'20');
  assert.match(p.suggestions[0].rationale,/ENFORCER:CE-1:duration/);
  assert.match(p.suggestions[0].rationale,/https:\/\/docs.google.com\/document\/d\/scope\/edit/);
  assert.match(p.suggestions[0].rationale,/Accept or reject/);
  assert.equal(p.requests,undefined);assert.equal(p.write_control,undefined);
  assert.equal(p.before.text,before.text);assert.equal(p.candidate.text,'Duration: 20 minutes.\n');
});
test('suggestion insertion and deletion remain proposals with exact bounded target',()=>{
  for(const change of [{operation:'delete',old_text:'30',new_text:''},{operation:'insert_before',old_text:'',new_text:'Duration: 20 minutes.'}]) {
    const p=planSuggestions(before,before.text,review,[{...patch,...change}],comments,request,'CE-1',capabilities);
    assert.equal(p.suggestions[0].operation,change.operation);assert.equal(p.requests,undefined);
  }
  const deletion=planEdits(before,before.text,review,[{...patch,operation:'delete',new_text:''}],comments,{...request,mode:'correct_supported'});
  assert.equal(deletion.requests.length,1);assert.ok(deletion.requests[0].deleteContentRange);
});
test('human text, unsupported evidence and incomplete protection inspection block suggestions',()=>{
  stops(()=>planSuggestions(before,'Human changed baseline\n',review,[patch],comments,request,'CE-1',capabilities),'protected_passage');
  stops(()=>planSuggestions(before,before.text,review,[{...patch,support:[{...evidence,quote:'invented'}]}],comments,request,'CE-1',capabilities),'patch_evidence');
  stops(()=>planSuggestions(before,before.text,review,[patch],{complete:false,threads:[]},request,'CE-1',capabilities),'comments_protected');
});
test('only pending native suggestions with attached exact rationale count as published',()=>{
  const p=plan(),o=observation(p),verified=verifySuggestions(p,o);
  assert.equal(verified.phase,'suggestions_pending_human_review');assert.equal(verified.threads[0].thread_id,'thread-1');
  for(const mutate of [o=>o.threads[0].kind='comment',o=>o.threads[0].state='accepted',o=>o.threads[0].state='rejected',o=>o.threads[0].accept_control=false]) {
    const changed=observation(p);mutate(changed);stops(()=>verifySuggestions(p,changed),'suggestion_not_pending');
  }
  const detached=observation(p);detached.threads[0].replies=[];detached.threads.push({kind:'comment',text:p.suggestions[0].rationale});
  stops(()=>verifySuggestions(p,detached),'rationale_missing_or_duplicate');
});
test('verification requires reloaded fresh target and complete reply inventory',()=>{
  const p=plan();
  for(const [mutate,code] of [
    [o=>o.reloaded=false,'suggestion_observation_incomplete'],[o=>o.fresh_inputs=false,'suggestion_observation_incomplete'],
    [o=>o.draft_id='other','suggestion_observation_incomplete'],[o=>o.inventory_complete=false,'suggestion_inventory_incomplete'],
    [o=>o.threads[0].new_text='25','suggestion_target_changed'],[o=>o.threads[0].replies_complete=false,'suggestion_replies_incomplete'],
    [o=>o.threads.push(structuredClone(o.threads[0])),'suggestion_missing_or_duplicate'],
    [o=>o.threads[0].replies.push({...o.threads[0].replies[0]}),'rationale_missing_or_duplicate']
  ]){const o=observation(p);mutate(o);stops(()=>verifySuggestions(p,o),code);}
});
test('unexposed IDs stay null and require screenshot plus observed reply count',()=>{
  const p=plan(),o=observation(p);delete o.threads[0].thread_id;delete o.threads[0].replies[0].reply_id;
  stops(()=>verifySuggestions(p,o),'suggestion_evidence_missing');
  o.screenshot='observed-ui.png';o.threads[0].observed_reply_count=1;
  const verified=verifySuggestions(p,o);assert.equal(verified.threads[0].thread_id,null);assert.equal(verified.threads[0].reply_id,null);
});
test('fresh recovery returns existing suggestions and only fills missing attached rationale',()=>{
  const p=JSON.parse(JSON.stringify(plan())),o=observation(p);
  assert.equal(recoverSuggestions(p,o).action,'report_or_return_only');
  o.threads[0].replies=[];
  const recovery=recoverSuggestions(p,o);assert.equal(recovery.action,'reply_to_existing_suggestions_only');assert.equal(recovery.missing[0].thread_id,'thread-1');
  o.threads=[];assert.equal(recoverSuggestions(p,o).action,'stop');
  const accepted=observation(p);accepted.threads[0].state='accepted';assert.equal(recoverSuggestions(p,accepted).action,'stop');
  assert.equal(recoverSuggestions({...p,mode:'correct_supported'},observation(p)).action,'stop');
});

test('multi-suggestion recovery leaves completed replies intact and identifies only the missing one',()=>{
  const p=plan(),second={...p.suggestions[0],marker:'ENFORCER:CE-1:second',finding_id:'second',rationale:'[ENFORCER:CE-1:second] Why and source support'};
  p.suggestions.push(second);const o=observation(p);
  o.threads.push({...structuredClone(o.threads[0]),marker:second.marker,thread_id:'thread-2',replies:[]});
  const recovery=recoverSuggestions(p,o);assert.equal(recovery.action,'reply_to_existing_suggestions_only');
  assert.equal(recovery.missing.length,1);assert.equal(recovery.missing[0].thread_id,'thread-2');
  o.threads[1].replies=[{reply_id:'reply-2',text:second.rationale}];assert.equal(verifySuggestions(p,o).threads.length,2);
});

function ledger(mode='suggest_supported') {
  const r={...request,mode},rows=[HEADERS];
  const add=(id,phase,extra={})=>rows.push(reviewEvent(readEvents(rows),{id,type:'enforcer_run',task:r.task_id,request:r.request_id,execution:'CE-1',at:'2026-01-01T00:00:00Z',actor:'Owner',payload:{protocol:VERSION,review_id:'CE-1',key:reviewKey('board',r),request:r,phase,...extra}}));
  rows.push(reviewEvent(readEvents(rows),{id:'config',type:'enforcer_configuration',at:'2026-01-01T00:00:00Z',actor:'Owner',payload:{protocol:VERSION,board_id:'board'}}));
  rows.push(reviewEvent(readEvents(rows),{id:'request',type:'enforcer_request',task:r.task_id,request:r.request_id,at:'2026-01-01T00:00:00Z',actor:'Owner',payload:r}));
  return {rows,add,r};
}
test('suggestion phases reconstruct from durable records without becoming applied edits',()=>{
  const {rows,add,r}=ledger();add('intent','suggestion_intent',{suggestion_manifest:'plan'});
  add('observed','suggestions_pending_human_review',{suggestion_observations_manifest:'observation'});
  add('done','complete',{suggestion_manifest:'plan',suggestion_observations_manifest:'observation',report_id:'report',outcome:'suggestions_pending_human_review'});
  const saved=restoreReview(rows,'board','request');assert.equal(saved.runs[0].phase,'complete');assert.equal(saved.runs[0].outcome,'suggestions_pending_human_review');
  assert.equal(preflight({...saved,config:{...saved.config,mode:'manual_single_writer',runtime_owner:'Owner',protected_ids:[]},request:r}).action,'return_existing');
});
test('ledger rejects direct-edit phases for suggestion requests and falsely accepted outcomes',()=>{
  for(const phase of ['edit_intent','edit_verified']) {const {rows,add}=ledger();add('bad',phase);stops(()=>restoreReview(rows,'board','request'),'publication_mode_conflict');}
  const {rows,add}=ledger();add('bad','complete',{report_id:'report',outcome:'edit_verified'});
  stops(()=>restoreReview(rows,'board','request'),'suggestions_not_accepted');
  const direct=ledger('correct_supported');direct.add('bad','suggestion_intent',{suggestion_manifest:'plan'});
  stops(()=>restoreReview(direct.rows,'board','request'),'publication_mode_conflict');
});
test('historical completed direct correction remains readable under its original mode',()=>{
  const {rows,add}=ledger('correct_supported');add('old','edit_verified',{edit_operation_id:'op'});add('done','complete',{report_id:'report'});
  const saved=restoreReview(rows,'board','request');assert.equal(saved.runs[0].request.mode,'correct_supported');assert.equal(saved.runs[0].edit_operation_id,'op');
});
