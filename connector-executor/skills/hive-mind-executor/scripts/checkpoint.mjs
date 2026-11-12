// Deterministic checkpoint contract. No network, credentials or Google writes.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const CHECKPOINT_SCHEMA='executor-drafting/1';
export const REQUEST_FIELDS=['request_id','task_id','deliverable_type','version','enabled','project','audience','context_set_id','requested_by','requested_at','no_known_completion_at','previous_execution_id','revision_reason','reviewer'];
export const TASK_FIELDS=['task_id','task','owner','status','urgency','due_date','next_step','blockers','dependencies','okr_link','risk_flag','source_transcript_id','meeting_title','meeting_date','created_at','updated_at'];
const REVIEW_FIELDS=['review_id','task_id','candidate_ids','status'];
export class CheckpointError extends Error {constructor(code){super(code);this.code=code;}}
const need=(value,code)=>{if(!value)throw new CheckpointError(code);};
const object=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const keys=(x,fields,code)=>need(object(x) && Object.keys(x).length===fields.length && fields.every(k=>Object.hasOwn(x,k)),code);
const strings=(x,fields,code)=>{keys(x,fields,code);need(fields.every(k=>typeof x[k]==='string'),code);};
const nonblank=x=>typeof x==='string' && x.trim().length>0;
const unique=xs=>new Set(xs).size===xs.length;
const date=x=>nonblank(x) && !Number.isNaN(Date.parse(x));
export function stableJSON(x){
  if(Array.isArray(x))return '['+x.map(stableJSON).join(',')+']';
  if(object(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stableJSON(x[k])).join(',')+'}';
  need(x!==undefined && (typeof x!=='number'||Number.isFinite(x)),'checkpoint_value');return JSON.stringify(x);
}
const same=(a,b)=>stableJSON(a)===stableJSON(b);
export const recordDigest=payload=>createHash('sha256').update(stableJSON(payload),'utf8').digest('hex');
const project=(x,fields)=>Object.fromEntries(fields.map(k=>{
  need(object(x) && Object.hasOwn(x,k) && (x[k]===null || ['string','number','boolean'].includes(typeof x[k])),'checkpoint_live_field_missing');
  return [k,String(x[k]??'')];
}));
const reference=record=>{need(nonblank(record?.record_id)&&object(record.payload),'checkpoint_record_missing');return {record_id:record.record_id,sha256:recordDigest(record.payload)};};
function checkRef(ref){strings(ref,['record_id','sha256'],'checkpoint_reference');need(nonblank(ref.record_id)&&/^[0-9a-f]{64}$/.test(ref.sha256),'checkpoint_reference');}
function candidateIds(review){let ids;try{ids=JSON.parse(review.candidate_ids);}catch{throw new CheckpointError('checkpoint_review_shape');}need(Array.isArray(ids)&&ids.every(nonblank),'checkpoint_review_shape');return ids;}
function selectedTasks(request,tasks){
  need(Array.isArray(tasks)&&tasks.every(object)&&unique(tasks.map(t=>t.task_id)),'checkpoint_task_shape');
  const byId=new Map(tasks.map(t=>[t.task_id,t])),selected=new Map();
  function visit(id,path=[]){
    need(!path.includes(id),'checkpoint_dependency_cycle');const task=byId.get(id);need(task,'checkpoint_dependency_missing');selected.set(id,project(task,TASK_FIELDS));
    for(const dep of String(task.dependencies||'').split(/[\s,;]+/).filter(Boolean))visit(dep,[...path,id]);
  }
  visit(request.task_id);return [...selected.values()].sort((a,b)=>a.task_id.localeCompare(b.task_id));
}
function selectedReviews(reviews,ids){
  need(Array.isArray(reviews)&&reviews.every(object),'checkpoint_review_shape');
  return reviews.filter(r=>r.status==='pending' && [r.task_id,...candidateIds(r)].some(id=>ids.has(id)))
    .map(r=>project(r,REVIEW_FIELDS)).sort((a,b)=>a.review_id.localeCompare(b.review_id));
}

export function validateDraftingCheckpoint(payload){
  keys(payload,['checkpoint_schema','phase','execution_id','instruction_revision','attempt','generation_status','provider_response_id','input_snapshot'],'checkpoint_shape');
  need(payload.checkpoint_schema===CHECKPOINT_SCHEMA && payload.instruction_revision==='1.3','checkpoint_schema');
  need(payload.phase==='drafting'&&nonblank(payload.execution_id)&&payload.attempt===1&&payload.generation_status==='not_started'&&payload.provider_response_id===null,'checkpoint_phase');
  const s=payload.input_snapshot;
  keys(s,['board_id','request','tasks','reviews','configuration_ref','authorization_ref','sources','completion_check'],'checkpoint_snapshot_shape');
  need(nonblank(s.board_id),'checkpoint_board');strings(s.request,REQUEST_FIELDS,'checkpoint_request_fields');
  const r=s.request;
  need(['request_id','task_id','deliverable_type','project','audience','context_set_id','requested_by','reviewer'].every(k=>nonblank(r[k])) && /^[1-9]\d*$/.test(r.version) && r.enabled==='yes'&&date(r.requested_at),'checkpoint_request_fields');
  need(!r.no_known_completion_at||date(r.no_known_completion_at),'checkpoint_request_fields');
  need(Number(r.version)===1 || (nonblank(r.previous_execution_id)&&nonblank(r.revision_reason)),'checkpoint_predecessor');
  need(Array.isArray(s.tasks)&&s.tasks.length>0&&s.tasks.length<=32,'checkpoint_task_shape');
  for(const t of s.tasks)strings(t,TASK_FIELDS,'checkpoint_task_shape');
  need(unique(s.tasks.map(t=>t.task_id))&&same(selectedTasks(r,s.tasks),s.tasks),'checkpoint_task_scope');
  need(Array.isArray(s.reviews)&&s.reviews.length===0,'checkpoint_relevant_decision');
  checkRef(s.configuration_ref);checkRef(s.authorization_ref);
  need(Array.isArray(s.sources)&&s.sources.length>0&&s.sources.length<=8&&unique(s.sources.map(x=>x.file_id))&&unique(s.sources.map(x=>x.record_id)),'checkpoint_source_shape');
  for(const src of s.sources){strings(src,['record_id','file_id','revision','sha256'],'checkpoint_source_shape');checkRef({record_id:src.record_id,sha256:src.sha256});need(nonblank(src.file_id)&&nonblank(src.revision),'checkpoint_source_shape');}
  const c=s.completion_check;
  keys(c,['folder_id','checked_at','complete','files'],'checkpoint_completion_shape');
  need(nonblank(c.folder_id)&&date(c.checked_at)&&c.complete===true&&Array.isArray(c.files)&&c.files.length<=32&&unique(c.files.map(f=>f.file_id)),'checkpoint_completion_shape');
  for(const f of c.files){strings(f,['file_id','classification','checked_at'],'checkpoint_completion_shape');need(nonblank(f.file_id)&&nonblank(f.classification)&&date(f.checked_at)&&f.classification!=='same_task_completed','checkpoint_completion_shape');}
  need(stableJSON(payload).length<=12000,'checkpoint_limit');return payload;
}

// current contains live named rows and existing immutable ledger records. Full
// source records are read for digests but their text is never copied into output.
export function buildDraftingCheckpoint(current,{execution_id,checked_at}){
  need(nonblank(execution_id)&&date(checked_at),'checkpoint_identity');
  const request=project(current.request,REQUEST_FIELDS),tasks=selectedTasks(request,current.tasks);
  const reviews=selectedReviews(current.reviews,new Set(tasks.map(t=>t.task_id)));
  const cfg=current.configuration_record,auth=current.authorization_record;
  need(cfg?.payload?.board_id===current.board_id && cfg.payload.mode==='manual_single_writer','checkpoint_configuration');
  const a=auth?.payload;
  need(a && ['authorize_new_version','authorize_execution'].includes(a.action)&&a.request_id===request.request_id&&String(a.version)===request.version&&nonblank(a.actor)&&date(a.recorded_at),'checkpoint_authorization');
  need(Number(request.version)===1 || a.predecessor===request.previous_execution_id,'checkpoint_authorization');
  need(Array.isArray(current.accepted_sources),'checkpoint_source_shape');
  const sources=current.accepted_sources.map(record=>{
    const p=record.payload;
    need(p?.context_set_id===request.context_set_id&&p.project===request.project&&p.approved==='yes'&&nonblank(p.accepted_text)&&nonblank(p.accepted_by)&&date(p.accepted_at),'checkpoint_source_acceptance');
    return {...reference(record),file_id:p.file_id,revision:p.revision};
  }).sort((a,b)=>a.record_id.localeCompare(b.record_id));
  need(current.accepted_sources.filter(r=>r.payload.role==='scope').length===1,'checkpoint_scope');
  const c=current.completion_search;
  need(c?.complete===true && c.folder_id===cfg.payload.completion_folder_id && date(c.checked_at) && Array.isArray(c.files),'checkpoint_completion_shape');
  return validateDraftingCheckpoint({checkpoint_schema:CHECKPOINT_SCHEMA,phase:'drafting',execution_id,instruction_revision:'1.3',attempt:1,generation_status:'not_started',provider_response_id:null,input_snapshot:{
    board_id:current.board_id,request,tasks,reviews,configuration_ref:reference(cfg),authorization_ref:reference(auth),sources,
    completion_check:{folder_id:c.folder_id,checked_at:c.checked_at,complete:true,files:c.files.map(f=>project(f,['file_id','classification','checked_at']))}
  }});
}

export function compareCheckpoint(current,p){
  validateDraftingCheckpoint(p);const before=p.input_snapshot,changes=[];
  if(current.board_id!==before.board_id)changes.push('board');
  if(!same(project(current.request,REQUEST_FIELDS),before.request))changes.push('request');
  const tasks=selectedTasks(current.request,current.tasks);
  if(!same(tasks,before.tasks))changes.push('tasks');
  if(!same(selectedReviews(current.reviews,new Set(tasks.map(t=>t.task_id))),before.reviews))changes.push('relevant_reviews');
  if(!same(reference(current.configuration_record),before.configuration_ref))changes.push('configuration');
  if(!same(reference(current.authorization_record),before.authorization_ref))changes.push('authorization');
  const sources=current.accepted_sources.map(r=>({...reference(r),file_id:r.payload.file_id,revision:r.payload.revision})).sort((a,b)=>a.record_id.localeCompare(b.record_id));
  if(!same(sources,before.sources))changes.push('accepted_sources');
  return changes;
}

export function checkpointSummary(payload){
  validateDraftingCheckpoint(payload);const s=payload.input_snapshot;
  return {execution_id:payload.execution_id,request_id:s.request.request_id,version:s.request.version,task_ids:s.tasks.map(t=>t.task_id),source_record_ids:s.sources.map(x=>x.record_id),configuration_record_id:s.configuration_ref.record_id,authorization_record_id:s.authorization_ref.record_id,relevant_pending_reviews:0,completion_items:s.completion_check.files.length,characters:stableJSON(payload).length,generation:'not started',document_created:false,scope:'One drafting-intent record only; no permissions, source approvals, ownership changes or broader authority'};
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  try{
    const [action,path]=process.argv.slice(2);need(['build','validate'].includes(action)&&path,'usage_build_or_validate_json_file');
    const input=JSON.parse(readFileSync(path,'utf8'));
    const payload=action==='build'?buildDraftingCheckpoint(input.current,input.identity):validateDraftingCheckpoint(input);
    process.stdout.write(JSON.stringify({payload,summary:checkpointSummary(payload)},null,2)+'\n');
  }catch(error){process.stderr.write(JSON.stringify({error:error.code||error.message})+'\n');process.exitCode=1;}
}
