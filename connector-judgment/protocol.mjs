// Optional pure validation. Work owns connected reads, semantic assessment and writes.
import {canonical, readEvents, eventRow, Stop} from '../connector-executor/protocol.mjs';
import {nativeSnapshot, sameNative} from '../connector-enforcer/protocol.mjs';
export const VERSION = 'connector-judgment/1';
export const METHOD = '1.0';
const need=(ok,code)=>{if(!ok)throw new Stop(code);};
const present=x=>typeof x==='string' && x.trim().length>0;
const same=(a,b)=>canonical(a)===canonical(b);
const clone=x=>JSON.parse(JSON.stringify(x));
const date=x=>present(x)&&Number.isFinite(Date.parse(x));
const unique=xs=>new Set(xs).size===xs.length;
const types=['judgment_setup','judgment_configuration','judgment_request','judgment_entry','judgment_human_action','judgment_blob','judgment_manifest','judgment_log_intent','judgment_log_verified','judgment_commit','judgment_application'];
const actions=['propose','decide','confirm','reject','retire','supersede'];

export function validateScope(scope,board) {
  need(scope && scope.board_id===board,'scope_board');
  need(['task','task_type','board'].includes(scope.level),'scope_level');
  const allowed=['level','board_id','project','audience',...(scope.level==='task'?['task_id','doc_id']:scope.level==='task_type'?['task_type']:[])];
  need(Object.keys(scope).every(k=>allowed.includes(k)),'scope_fields');
  if(scope.level==='task')need(present(scope.task_id),'scope_task');
  if(scope.level==='task_type')need(present(scope.task_type),'scope_task_type');
  for(const key of Object.keys(scope))need(present(scope[key]),'scope_value');
  return clone(scope);
}
export function applies(scope,context) {
  validateScope(scope,scope.board_id);
  return scope.board_id===context.board_id && ['task_id','doc_id','task_type','project','audience'].every(k=>!scope[k]||scope[k]===context[k]);
}
export function originKey(board,origin) {
  need(origin && ['provider','artifact_id','post_id','version','topic'].every(k=>present(origin[k])),'origin_missing');
  return canonical([board,...['provider','artifact_id','post_id','version','topic'].map(k=>origin[k])]);
}
export function validateEntry(entry,board) {
  need(entry?.protocol===VERSION && entry.board_id===board && present(entry.entry_id),'entry_identity');
  need(['lesson','decision'].includes(entry.kind)&&Number.isInteger(entry.version)&&entry.version>0,'entry_version');
  validateScope(entry.scope,board);
  need(present(entry.text)&&entry.text.length<=2000&&present(entry.reason)&&entry.reason.length<=2000,'entry_content');
  need(!/\[\/?JUDGMENT:/.test(canonical(entry)),'reserved_log_marker');
  need(Array.isArray(entry.evidence)&&entry.evidence.length>0&&entry.evidence.length<=8,'entry_evidence');
  for(const ref of entry.evidence)need(['provider','artifact_id','version','quote'].every(k=>present(ref[k])),'entry_evidence');
  originKey(board,entry.origin);
  if(entry.version>1)need(present(entry.predecessor_entry_id)&&present(entry.revision_reason),'entry_predecessor');
  need(Array.isArray(entry.conflicts_with)&&unique(entry.conflicts_with)&&!entry.conflicts_with.includes(entry.entry_id),'entry_conflicts');
  return clone(entry);
}
export function confirmationPrompt(entry,action='confirm') {
  need(['confirm','decide','reject','retire','supersede'].includes(action),'human_action');
  return {entry_id:entry.entry_id,version:entry.version,text:entry.text,scope:clone(entry.scope),
    action,reply:`${action[0].toUpperCase()+action.slice(1)} ${entry.entry_id} version ${entry.version}`};
}
export function validateHuman(action,entry,config) {
  const prompt=confirmationPrompt(entry,action.action);
  need(action.human_id===config.designated_human_id&&date(action.at)&&present(action.reason),'human_authority');
  need(action.evidence && present(action.evidence.artifact_id)&&present(action.evidence.provider),'human_evidence');
  need(action.evidence.quote?.trim()===prompt.reply&&same(action.displayed,prompt),'exact_confirmation_required');
  // Identity comes from the board's human designation and an exact-action attestation,
  // not a display name, author.me or a model-created post.
  need(action.evidence.human_attested===true&&action.evidence.agent_created===false,'human_attestation');
  need((entry.kind==='lesson'&&action.action!=='decide')||(entry.kind==='decision'&&action.action!=='confirm'),'human_action_kind');
  return true;
}
function configOK(config,board) {
  need(config.protocol===VERSION&&config.board_id===board&&config.origin_board_id===board,'configuration_board');
  need(config.method===METHOD&&config.mode==='manual_single_writer'&&present(config.writer),'configuration_method');
  need(present(config.designated_human_id)&&present(config.log_doc_id)&&present(config.learning_folder_id),'configuration_missing');
  need(config.authorized_by===config.designated_human_id&&date(config.authorized_at)&&present(config.authorization_evidence_id),'configuration_authority');
  need(config.automatic_proposals===true&&same(config.consumer_methods,{executor:'1.4',enforcer:'2.1',feedback:'1.1'}),'configuration_consumers');
  const registration=config.log_registration;
  need(registration?.doc_id===config.log_doc_id&&registration.folder_id===config.learning_folder_id&&registration.confirmed_by===config.designated_human_id&&date(registration.confirmed_at)&&present(registration.evidence_id),'log_registration');
  need(['existing_doc','setup_run'].includes(registration.kind),'log_registration');
}

export function restoreSetup(rows,board,runId) {
  const events=readEvents(rows).filter(e=>e.record_type==='judgment_setup'&&e.execution_id===runId);
  need(events.length>0,'setup_missing');
  const ranks=['create_intent','doc_known','log_verified','complete'];let latest=null;
  for(const e of events) {
    const p=e.payload;need(p.protocol===VERSION&&p.board_id===board&&p.run_id===runId,'setup_identity');
    need(p.writer&&p.designated_human_id&&p.authorized_by===p.designated_human_id&&date(p.authorized_at)&&present(p.authorization_evidence_id)&&present(p.learning_folder_id)&&present(p.operation_id),'setup_authority');
    need(ranks.indexOf(p.phase)===(latest?ranks.indexOf(latest.phase)+1:0),'setup_phase');
    if(latest)for(const k of ['writer','designated_human_id','authorized_by','authorized_at','authorization_evidence_id','learning_folder_id','operation_id','expected_text'])need(same(p[k],latest[k]),'setup_changed');
    need(present(p.expected_text)&&p.expected_text.length<=20000,'setup_text');
    if(p.phase!=='create_intent')need(present(p.log_doc_id)&&(!latest.log_doc_id||latest.log_doc_id===p.log_doc_id),'setup_doc_identity');
    if(p.phase==='log_verified')need(p.native_doc?.documentId===p.log_doc_id&&nativeSnapshot(p.native_doc).text===p.expected_text,'setup_log_verification');
    if(p.phase==='complete')need(date(p.completed_at),'setup_completion');
    latest={...clone(p),event_id:e.record_id};
  }
  return {...latest,action:latest.phase==='complete'?'return_existing':latest.phase==='create_intent'?'reconcile_unknown_create':'inspect_known_doc'};
}

// Every event is validated on a fresh read; no prior conversation state is used.
export function restoreJudgment(rows,board) {
  const all=readEvents(rows);
  need(all.length<=1000,'ledger_limit');
  const events=all.filter(e=>e.record_type.startsWith('judgment_'));
  need(events.every(e=>types.includes(e.record_type)&&e.payload.protocol===VERSION&&e.payload.board_id===board),'judgment_protocol');
  const configs=events.filter(e=>e.record_type==='judgment_configuration');
  need(configs.length===1,'configuration_missing_or_ambiguous');
  const configuration=configs[0];configOK(configuration.payload,board);
  if(configuration.payload.log_registration.kind==='setup_run') {
    const setup=restoreSetup(rows,board,configuration.payload.log_registration.run_id);
    need(setup.phase==='complete'&&setup.log_doc_id===configuration.payload.log_doc_id&&setup.learning_folder_id===configuration.payload.learning_folder_id,'setup_incomplete');
  }
  const config=configuration.payload,requests=new Map(),entries=new Map(),human=new Map(),intents=new Map(),verified=new Map(),commits=new Map(),applications=[],blobs=new Map(),manifests=new Map();
  const statusOf=id=>{
    const last=[...commits.values()].filter(c=>c.entry_id===id).at(-1);
    return last?.action || null;
  };
  for(const event of events) {
    const p=event.payload;
    if(['judgment_configuration','judgment_setup'].includes(event.record_type))continue;
    need(p.configuration_id===configuration.record_id,'configuration_binding');
    if(event.record_type==='judgment_application') {
      need(['executor','enforcer','feedback'].includes(p.role)&&present(p.consumer_run_id)&&p.consumer_run_id===event.execution_id&&p.context?.board_id===board&&Array.isArray(p.applied)&&Array.isArray(p.excluded),'application_identity');
      need(p.context.method===config.consumer_methods[p.role]&&present(p.assessment_record_id)&&present(p.log_observation_record_id),'application_evidence');
      need(unique(p.applied.map(a=>a.entry_id)),'duplicate_application');
      for(const a of p.applied)need(entries.get(a.entry_id)?.version===a.version&&[...commits.values()].some(c=>c.event_id===a.commit_id&&c.entry_id===a.entry_id)&&['confirm','decide'].includes(statusOf(a.entry_id))&&applies(entries.get(a.entry_id).scope,p.context),'application_not_active');
      applications.push(clone(p));continue;
    }
    if(event.record_type==='judgment_request') {
      need(p.request_id===event.request_id&&present(p.request_id)&&!requests.has(p.request_id),'request_identity');
      need(p.enabled===true&&actions.includes(p.action)&&p.writer===config.writer&&present(p.authorization)&&date(p.requested_at)&&present(p.requested_by),'request_authorization');
      need(p.run_id===event.execution_id&&present(p.run_id)&&present(p.entry_id),'request_binding');
      requests.set(p.request_id,{...p,event_id:event.record_id});continue;
    }
    const request=requests.get(event.request_id);
    need(request&&event.execution_id===request.run_id&&p.entry_id===request.entry_id,'request_binding');
    if(event.record_type==='judgment_entry') {
      validateEntry(p,board);need(!entries.has(p.entry_id),'duplicate_entry');
      need(['propose','decide'].includes(request.action),'entry_request_action');
      need((p.kind==='lesson')===(request.action==='propose'),'entry_request_action');
      const family=[...entries.values()].filter(e=>originKey(board,e.origin)===originKey(board,p.origin));
      need(![...entries.values()].some(e=>e.kind===p.kind&&e.text===p.text&&same(e.scope,p.scope)),'duplicate_lesson');
      if(p.version===1)need(!family.length&&!p.predecessor_entry_id,'duplicate_origin');
      else {
        const parent=entries.get(p.predecessor_entry_id);
        need(parent&&same(parent.origin,p.origin)&&parent.kind===p.kind&&p.version===parent.version+1,'entry_predecessor');
        need(![...entries.values()].some(e=>e.predecessor_entry_id===parent.entry_id),'entry_fork');
      }
      need(p.producer&&['executor','enforcer','feedback','judgment'].includes(p.producer.role)&&present(p.producer.run_id),'producer_missing');
      if(p.kind==='lesson'&&p.producer.role!=='judgment')need(p.producer.phase==='active'&&p.producer.authorized_learning===true,'completed_work_not_new_learning');
      entries.set(p.entry_id,{...clone(p),record_id:event.record_id});continue;
    }
    const entry=entries.get(p.entry_id);need(entry,'entry_missing');
    if(event.record_type==='judgment_blob') {
      need(p.blob_id&&Number.isInteger(p.index)&&p.index>=0&&present(p.text)&&p.text.length<=10000,'blob_shape');
      need(![...blobs.values()].some(b=>b.blob_id===p.blob_id&&b.index===p.index),'duplicate_blob');
      blobs.set(event.record_id,{...clone(p),request_id:request.request_id});continue;
    }
    if(event.record_type==='judgment_manifest') {
      need(Array.isArray(p.record_ids)&&p.record_ids.length>0&&p.record_ids.length<=24&&unique(p.record_ids)&&p.count===p.record_ids.length,'manifest_shape');
      const parts=p.record_ids.map(id=>blobs.get(id));
      need(parts.every((b,i)=>b&&b.index===i&&b.blob_id===p.blob_id&&b.entry_id===entry.entry_id&&b.request_id===request.request_id),'manifest_incomplete');
      const text=parts.map(b=>b.text).join('');need(text.length===p.characters&&text.length<=240000,'manifest_incomplete');
      let value;try{value=JSON.parse(text);}catch{throw new Stop('manifest_incomplete');}
      manifests.set(event.record_id,{...clone(p),value,request_id:request.request_id});continue;
    }
    if(event.record_type==='judgment_human_action') {
      need(request.action===p.action,'human_request_action');
      validateHuman(p,entry,config);
      if(['confirm','decide','reject'].includes(p.action))need([null,'propose'].includes(statusOf(p.entry_id)),'already_decided');
      if(['retire','supersede'].includes(p.action))need(['confirm','decide'].includes(statusOf(p.entry_id)),'not_active');
      need(![...human].some(([id,h])=>h.entry_id===entry.entry_id&&![...commits.values()].some(c=>c.human_action_id===id)),'human_action_pending');
      if(p.action==='supersede') {
        const successor=entries.get(p.successor_entry_id);
        need(successor?.predecessor_entry_id===entry.entry_id&&['confirm','decide'].includes(statusOf(successor.entry_id)),'successor_not_confirmed');
      }
      human.set(event.record_id,clone(p));continue;
    }
    if(event.record_type==='judgment_log_intent') {
      need(p.operation_id===event.record_id&&!intents.has(p.operation_id),'operation_identity');
      need(p.log_doc_id===config.log_doc_id&&present(p.before_revision)&&typeof p.before_text==='string'&&typeof p.expected_text==='string'&&p.before_text!==p.expected_text,'log_intent');
      need(p.before_text.length<=20000&&p.expected_text.length<=20000&&present(p.native_manifest_id),'log_limit');
      const manifest=manifests.get(p.native_manifest_id),plan=manifest?.value;
      need(manifest?.request_id===request.request_id&&manifest.entry_id===entry.entry_id&&plan?.before&&plan.expected&&Array.isArray(plan.requests)&&plan.requests.length>0,'native_plan_missing');
      need(plan.before.file_id===p.log_doc_id&&plan.expected.file_id===p.log_doc_id&&plan.before.revision===p.before_revision&&plan.before.text===p.before_text&&plan.expected.text===p.expected_text,'native_plan_binding');
      need(p.action===request.action,'operation_action');
      need(![...intents.values()].some(i=>i.entry_id===entry.entry_id&&![...commits.values()].some(c=>c.operation_id===i.operation_id)),'operation_pending');
      need(![...intents.values()].some(i=>i.request_id===request.request_id),'request_already_processed');
      if(p.action==='propose')need(statusOf(entry.entry_id)===null,'already_proposed');
      if(p.action!=='propose')need(human.has(p.human_action_id)&&human.get(p.human_action_id).entry_id===entry.entry_id&&human.get(p.human_action_id).action===p.action,'confirmation_missing');
      const status={propose:'proposed',decide:'decided',confirm:'confirmed',reject:'rejected',retire:'retired',supersede:'superseded'}[p.action];
      need(p.expected_text.includes(logBlock(entry,status)),'log_entry_missing');
      intents.set(p.operation_id,{...clone(p),request_id:request.request_id});continue;
    }
    if(event.record_type==='judgment_log_verified') {
      const intent=intents.get(p.operation_id);
      need(intent&&intent.request_id===request.request_id&&intent.entry_id===entry.entry_id,'operation_missing');
      const actual=nativeSnapshot(p.native_doc),expected=manifests.get(intent.native_manifest_id).value.expected;
      need(!verified.has(p.operation_id)&&p.log_doc_id===intent.log_doc_id&&p.text===intent.expected_text&&actual.revision===p.revision&&sameNative(expected,actual),'log_verification');
      verified.set(p.operation_id,{...clone(p),event_id:event.record_id});continue;
    }
    if(event.record_type==='judgment_commit') {
      const intent=intents.get(p.operation_id),check=verified.get(p.operation_id);
      need(intent&&check&&intent.request_id===request.request_id&&intent.entry_id===entry.entry_id&&p.action===intent.action&&p.verification_id===check.event_id&&date(p.completed_at),'commit_unverified');
      need(!commits.has(p.operation_id),'duplicate_commit');
      commits.set(p.operation_id,{...clone(p),event_id:event.record_id,human_action_id:intent.human_action_id||null});continue;
    }
  }
  return {board_id:board,config,configuration_id:configuration.record_id,events:all,
    requests:[...requests.values()],entries:[...entries.values()],human_actions:[...human].map(([id,p])=>({id,...p})),intents:[...intents.values()],verified:[...verified.values()],commits:[...commits.values()],applications,manifests:[...manifests].map(([id,m])=>({id,...m}))};
}

export function judgmentEvent(rows,board,args) {
  need(types.includes(args.type)&&args.payload.protocol===VERSION,'judgment_protocol');
  const row=eventRow(readEvents(rows),args);
  restoreJudgment([...rows,row],board);
  return row;
}
export function entryState(state,entry) {
  const commits=state.commits.filter(c=>c.entry_id===entry.entry_id);
  const last=commits.at(-1);
  if(last)return {propose:'proposed',decide:'decided',confirm:'confirmed',reject:'rejected',retire:'retired',supersede:'superseded'}[last.action];
  return entry.kind==='decision'?'unresolved':'proposed';
}
export function proposalDisposition(state,candidate,context) {
  validateEntry(candidate,state.board_id);
  need(context.request_enabled===true&&context.writer===state.config.writer&&context.single_writer_clear===true,'writer_authority');
  need(context.evidence_current===true&&context.useful_lesson===true&&present(context.reason),'proposal_assessment');
  need(context.phase==='active'&&context.learning_authorized===true,'completed_work_not_new_learning');
  const sameOrigin=state.entries.find(e=>originKey(state.board_id,e.origin)===originKey(state.board_id,candidate.origin)&&e.version===candidate.version);
  if(sameOrigin) {
    need(sameOrigin.text===candidate.text&&same(sameOrigin.scope,candidate.scope),'proposal_origin_changed');
    return {action:'return_existing',entry_id:sameOrigin.entry_id,status:entryState(state,sameOrigin)};
  }
  const exact=state.entries.find(e=>e.kind===candidate.kind&&e.text===candidate.text&&same(e.scope,candidate.scope));
  if(exact)return {action:'return_existing',entry_id:exact.entry_id,status:entryState(state,exact),additional_evidence_requires_separate_request:true};
  return {action:'save_proposal',entry_id:candidate.entry_id};
}

// The semantic assessments are evidence from Work, not conclusions proved by JavaScript.
export function selectJudgment(state,context,assessment,log) {
  need(context.board_id===state.board_id,'scope_board');
  need(log?.doc_id===state.config.log_doc_id&&log.complete===true&&typeof log.text==='string','log_unavailable');
  need(assessment?.complete===true&&present(assessment.reason)&&Array.isArray(assessment.entries),'assessment_missing');
  need(unique(assessment.entries.map(a=>a.entry_id)),'duplicate_assessment');
  const applied=[],excluded=[];
  for(const entry of state.entries) {
    const status=entryState(state,entry);
    if(!applies(entry.scope,context)){excluded.push({entry_id:entry.entry_id,version:entry.version,reason:'outside_scope'});continue;}
    if(['rejected','retired','superseded'].includes(status)){excluded.push({entry_id:entry.entry_id,version:entry.version,reason:status});continue;}
    const uncertain=state.intents.filter(i=>i.entry_id===entry.entry_id&&!state.commits.some(c=>c.operation_id===i.operation_id));
    const pendingHuman=state.human_actions.filter(h=>h.entry_id===entry.entry_id&&!state.commits.some(c=>c.human_action_id===h.id));
    need(!uncertain.length&&!pendingHuman.length,'judgment_effect_uncertain');
    if(status==='proposed'){excluded.push({entry_id:entry.entry_id,version:entry.version,reason:'unconfirmed'});continue;}
    need(status!=='unresolved','judgment_unresolved');
    const check=assessment.entries.find(a=>a.entry_id===entry.entry_id&&a.version===entry.version);
    need(check&&present(check.reason)&&check.evidence_current===true&&check.facts_compatible===true&&check.instructions_compatible===true,'judgment_evidence_conflict');
    need(check.conflicts_clear===true&&Array.isArray(check.conflicting_entry_ids)&&check.conflicting_entry_ids.length===0,'judgment_conflict');
    const commit=state.commits.filter(c=>c.entry_id===entry.entry_id).at(-1);
    const intent=state.intents.find(i=>i.operation_id===commit.operation_id);
    // Readable entry block must still match the verified log projection.
    const block=logBlock(entry,status),open=`[JUDGMENT:${entry.entry_id}:v${entry.version}]`,close=`[/JUDGMENT:${entry.entry_id}:v${entry.version}]`;
    need(log.entry_blocks?.[entry.entry_id]===block&&log.text.includes(block)&&log.text.split(open).length===2&&log.text.split(close).length===2,'log_diverged');
    need(intent.expected_text.includes(logBlock(entry,status)),'log_diverged');
    if(entry.predecessor_entry_id) {
      const parent=state.entries.find(e=>e.entry_id===entry.predecessor_entry_id);
      need(!parent||!['confirmed','decided'].includes(entryState(state,parent)),'supersession_pending');
    }
    for(const conflict of entry.conflicts_with) {
      const other=state.entries.find(e=>e.entry_id===conflict);
      need(other,'conflict_missing');
      need(!applies(other.scope,context)||['rejected','retired','superseded'].includes(entryState(state,other)),'judgment_conflict');
    }
    applied.push({entry_id:entry.entry_id,version:entry.version,kind:entry.kind,text:entry.text,scope:clone(entry.scope),commit_id:commit.event_id,reason:check.reason});
  }
  return {protocol:VERSION,board_id:state.board_id,context:clone(context),applied,excluded};
}
export function assertJudgmentFresh(before,after) {
  const identity=x=>({role:x.role,board_id:x.board_id,context:x.context,applied:x.applied.map(({reason,...a})=>a)});
  need(same(identity(before),identity(after)),'judgment_changed');return true;
}
export function logBlock(entry,status='proposed') {
  const sources=entry.evidence.map(e=>`${e.provider}: ${e.artifact_id}, version ${e.version}; ${e.quote}`).join('\n');
  return `[JUDGMENT:${entry.entry_id}:v${entry.version}]\nKind: ${entry.kind}\nStatus: ${status}\nScope: ${canonical(entry.scope)}\n${entry.text}\nWhy: ${entry.reason}\nSources:\n${sources}\n[/JUDGMENT:${entry.entry_id}:v${entry.version}]\n`;
}
export function recoverLog(state,operationId,observed,context) {
  const intent=state.intents.find(i=>i.operation_id===operationId);need(intent,'operation_missing');
  const commit=state.commits.find(c=>c.operation_id===operationId);
  if(commit)return {action:'return_existing',entry_id:intent.entry_id,completed_at:commit.completed_at,writes:0};
  need(context?.writer===state.config.writer&&context.single_writer_clear===true&&context.authority_current===true&&context.evidence_current===true,'recovery_context');
  const expected=state.manifests.find(m=>m.id===intent.native_manifest_id)?.value.expected;
  if(observed?.native_doc&&sameNative(expected,nativeSnapshot(observed.native_doc)))return {action:'verify_then_commit_only',operation_id:operationId,doc_writes:0};
  return {action:'needs_reconciliation',operation_id:operationId,doc_writes:0};
}
export function snapshotParts(id,value) {
  const text=canonical(value);need(present(id)&&text.length<=240000,'snapshot_limit');
  const parts=[];for(let i=0;i<text.length;i+=10000)parts.push({blob_id:id,index:parts.length,text:text.slice(i,i+10000)});
  return {parts,manifest:{blob_id:id,count:parts.length,characters:text.length}};
}
export function consumerJudgment(state,role,context,assessment,log,prior) {
  need(['executor','enforcer','feedback'].includes(role),'consumer_role');
  if(prior?.phase==='complete')return {action:'return_existing',writes:0,proposals:0};
  need(context.method===state.config.consumer_methods[role],'consumer_method');
  const selection=selectJudgment(state,context,assessment,log);
  return {action:'continue',role,...selection};
}
