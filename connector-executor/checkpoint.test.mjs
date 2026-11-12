import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDraftingCheckpoint,validateDraftingCheckpoint,compareCheckpoint,checkpointSummary,recordDigest,REQUEST_FIELDS,TASK_FIELDS} from './skills/hive-mind-executor/scripts/checkpoint.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inputChanges,HEADERS,eventRow,readEvents,restore} from './protocol.mjs';
const at='2026-01-01T00:00:00Z';
function fixture(){
  const request=Object.fromEntries(REQUEST_FIELDS.map(k=>[k,'']));Object.assign(request,{request_id:'new',task_id:'HM-1',deliverable_type:'agenda',version:'3',enabled:'yes',project:'Synthetic',audience:'Test audience',context_set_id:'accepted',requested_by:'Test operator',requested_at:at,previous_execution_id:'prior',revision_reason:'Disposable continuation',reviewer:'Test operator'});
  const task=id=>({...Object.fromEntries(TASK_FIELDS.map(k=>[k,''])),task_id:id,task:'Synthetic task',owner:'Jordan',status:'open',urgency:0});
  const tasks=[task('HM-1'),{...task('HM-2'),status:'done'},task('HM-99')];tasks[0].dependencies='HM-2';
  return {board_id:'board',request,tasks,reviews:[{review_id:'unrelated',task_id:'HM-99',candidate_ids:'[]',status:'pending',details:'UNRELATED PRIVATE CONTEXT'}],configuration_record:{record_id:'config',payload:{board_id:'board',mode:'manual_single_writer',completion_folder_id:'completion',output_folder_id:'output',runtime_owner:'user'}},authorization_record:{record_id:'authorization',payload:{action:'authorize_new_version',request_id:'new',version:'3',actor:'Test operator',recorded_at:at,predecessor:'prior',authorization:'ALREADY SAVED AUTHORIZATION'}},accepted_sources:[{record_id:'source',payload:{file_id:'scope',revision:'r1',role:'scope',context_set_id:'accepted',project:'Synthetic',approved:'yes',accepted_text:'ALREADY SAVED ORIGINAL TEXT\n',accepted_by:'Existing approver',accepted_at:at}}],completion_search:{folder_id:'completion',checked_at:at,complete:true,files:[]}};
}
const identity={execution_id:'new-execution',checked_at:at};
const stops=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('captured Work shape fails cleanly rather than throwing a task iteration TypeError',()=>{
  const malformed={input_snapshot:{request:fixture().request,task_rows:[['HM-1']],reviews:[['unrelated']]}};
  stops(()=>inputChanges({request:fixture().request,tasks:[],reviews:[],sources:[]},malformed),'invalid_input_snapshot');
  stops(()=>eventRow([],{id:'intent',type:'run',task:'HM-1',request:'new',execution:'new-execution',at,actor:'Test operator',payload:{...malformed,phase:'drafting'}}),'checkpoint_shape');
});
test('checkpoint builder freezes all request fields, named selected tasks and references only',()=>{
  const c=fixture(),p=buildDraftingCheckpoint(c,identity),serialized=JSON.stringify(p);
  assert.deepEqual(Object.keys(p.input_snapshot.request),REQUEST_FIELDS);
  assert.equal(p.input_snapshot.request.no_known_completion_at,'');
  assert.deepEqual(p.input_snapshot.tasks.map(t=>t.task_id),['HM-1','HM-2']);
  assert.ok(p.input_snapshot.tasks.every(t=>!Array.isArray(t)&&typeof t.urgency==='string'));
  assert.equal(p.input_snapshot.reviews.length,0);assert.equal(p.input_snapshot.sources[0].record_id,'source');
  for(const text of ['UNRELATED PRIVATE CONTEXT','ALREADY SAVED ORIGINAL TEXT','ALREADY SAVED AUTHORIZATION','Existing approver'])assert.ok(!serialized.includes(text));
  assert.equal(p.input_snapshot.authorization_ref.sha256,recordDigest(c.authorization_record.payload));
  assert.equal(checkpointSummary(p).document_created,false);assert.ok(serialized.length<5000);
});
test('missing fields, positional tasks, copied history and duplicated source text are rejected',()=>{
  const base=buildDraftingCheckpoint(fixture(),identity);
  for(const mutate of [p=>delete p.input_snapshot.request.reviewer,p=>delete p.input_snapshot.request.previous_execution_id,p=>p.input_snapshot.tasks=[['HM-1']],p=>p.input_snapshot.source_registry=[],p=>p.input_snapshot.sources[0].accepted_text='copied text',p=>p.source_manifest=[],p=>p.input_snapshot.decision_record={}]){const p=structuredClone(base);mutate(p);assert.throws(()=>validateDraftingCheckpoint(p));}
});
test('record digests are deterministic and detect changed authorization, config and accepted records',()=>{
  const c=fixture(),p=buildDraftingCheckpoint(c,identity);assert.deepEqual(compareCheckpoint(c,p),[]);
  assert.equal(recordDigest({a:1,b:2}),recordDigest({b:2,a:1}));
  for(const [mutate,label] of [[c=>c.authorization_record.payload.authorization='Changed','authorization'],[c=>c.configuration_record.payload.output_folder_id='other','configuration'],[c=>c.accepted_sources[0].payload.accepted_text+='Changed','accepted_sources'],[c=>c.accepted_sources[0].payload.revision='r2','accepted_sources']]){const current=fixture();mutate(current);assert.ok(compareCheckpoint(current,p).includes(label));}
});
test('fresh comparison catches changed request, tasks and newly relevant pending review',()=>{
  const c=fixture(),p=buildDraftingCheckpoint(c,identity);
  c.request.reviewer='Changed';c.tasks[0].owner='Changed';c.reviews[0].candidate_ids='["HM-2"]';
  assert.deepEqual(compareCheckpoint(c,p),['request','tasks','relevant_reviews']);
});
test('non-draftable authorization, missing completion time and relevant decisions cannot produce intent',()=>{
  for(const mutate of [c=>c.authorization_record.payload.predecessor='wrong',c=>delete c.completion_search.checked_at,c=>c.completion_search.complete=false,c=>c.reviews[0].task_id='HM-2',c=>c.accepted_sources[0].payload.approved='no']){const c=fixture();mutate(c);assert.throws(()=>buildDraftingCheckpoint(c,identity));}
});
test('a minimal checkpoint survives actual ledger restoration and current-input comparison',()=>{
  const c=fixture(),p=buildDraftingCheckpoint(c,identity),rows=[HEADERS];
  function add(id,type,payload,execution=''){rows.push(eventRow(readEvents(rows),{id,type,task:'HM-1',request:'new',execution,at,actor:'Test operator',payload}));}
  add('config','configuration',c.configuration_record.payload);add('authorization','decision',c.authorization_record.payload);add('source','accepted_source',c.accepted_sources[0].payload);add('run','run',p,'new-execution');
  const table=(records,headers)=>[headers,...records.map(r=>headers.map(k=>r[k]??''))];
  const tables={'Executor Connector':rows,'Executor Requests':table([c.request],REQUEST_FIELDS),'Executor Journal':[['event_id','execution_key','sequence','previous_hash','record_json','event_hash']],'Tasks':table(c.tasks,TASK_FIELDS),'Reviews':table(c.reviews,['review_id','source_id','task_id','candidate_ids','status']),'Task History':[['history_id','source_id','task_id']],'Source Journal':[['source_id','fingerprint','phase','task_ids']],'Source Registry':[['source_id']],'Processed Sources':[['source_id']]};
  const current={file_id:'scope',revision:'r1',text:c.accepted_sources[0].payload.accepted_text,access:'readable'};
  const fresh=restore('board',tables,'new',[current],c.completion_search);
  assert.deepEqual(inputChanges(fresh,fresh.executions[0]),[]);
  assert.equal(fresh.executions[0].previous_execution_id,'prior');assert.deepEqual(fresh.executions[0].accepted_source_records,['source']);
  fresh.sources[0].text+='External change';assert.ok(inputChanges(fresh,fresh.executions[0]).includes('source:scope'));
});

test('the packaged CLI actually builds and validates the same checkpoint bytes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hm-checkpoint-test-')),input=join(dir,'input.json'),output=join(dir,'payload.json');
  const data={current:fixture(),identity};writeFileSync(input,JSON.stringify(data));
  const script=fileURLToPath(new URL('./skills/hive-mind-executor/scripts/checkpoint.mjs',import.meta.url));
  const built=spawnSync(process.execPath,[script,'build',input],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  const result=JSON.parse(built.stdout);assert.deepEqual(result.payload,buildDraftingCheckpoint(data.current,identity));
  writeFileSync(output,JSON.stringify(result.payload));const validated=spawnSync(process.execPath,[script,'validate',output],{encoding:'utf8'});
  assert.equal(validated.status,0,validated.stderr);assert.deepEqual(JSON.parse(validated.stdout).summary,result.summary);
  writeFileSync(output,JSON.stringify({...result.payload,input_snapshot:{...result.payload.input_snapshot,task_history:['unexpected copy']}}));
  const rejected=spawnSync(process.execPath,[script,'validate',output],{encoding:'utf8'});assert.notEqual(rejected.status,0);assert.equal(JSON.parse(rejected.stderr).error,'checkpoint_snapshot_shape');
});

test('the packaged synthetic input validates without apps or copied private context',()=>{
  const data=JSON.parse(readFileSync(new URL('./skills/hive-mind-executor/scripts/self-test-input.json',import.meta.url),'utf8'));
  const payload=buildDraftingCheckpoint(data.current,data.identity),summary=checkpointSummary(payload);
  assert.equal(summary.task_ids.length,2);assert.equal(summary.source_record_ids.length,1);
  assert.ok(!JSON.stringify(payload).includes(data.current.authorization_record.payload.authorization));
  assert.ok(!JSON.stringify(payload).includes(data.current.accepted_sources[0].payload.accepted_text));
  assert.equal(Object.keys(payload.input_snapshot.request).length,14);
});
