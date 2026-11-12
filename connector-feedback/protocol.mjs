// Optional pure checks. Work reads sources and coordinates connected tools.
// No network, model calls, credentials, document creation or application runtime.
import {canonical, Stop, readEvents, eventRow} from '../connector-executor/protocol.mjs';
import {nativeSnapshot, sameNative} from '../connector-enforcer/protocol.mjs';
export {nativeSnapshot, sameNative};
export const VERSION = 'connector-feedback/1';
export const METHOD = '1.0';
const need=(ok,code)=>{if(!ok)throw new Stop(code);};
const clone=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>canonical(a)===canonical(b);
const unique=xs=>new Set(xs).size===xs.length;
const present=x=>typeof x==='string' && x.trim().length>0;
const phases=['captured','plan_saved','edit_intent','edit_verified','reply_intent','reply_known','reply_verified','complete'];
const immutable=['doc_id','thread_id','reply_id','plan_record_id','edit_operation_id','reply_operation_id'];
const types=['feedback_configuration','feedback_request','feedback_plan','feedback_run','feedback_decision','feedback_check','feedback_blob','feedback_manifest'];
const validUTF16=s=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
const boundary=(s,i)=>!(i>0&&i<s.length&&/[\uD800-\uDBFF]/.test(s[i-1])&&/[\uDC00-\uDFFF]/.test(s[i]));
const count=(s,q)=>q ? s.split(q).length-1 : 0;
export const itemKey=(board,item)=>canonical([board,item.doc_id,item.provider,item.thread_id,item.post_id,String(item.version)]);
const stableItem=i=>Object.fromEntries(Object.entries(i).filter(([k])=>k!=='modified_at'));

export function feedbackEvent(events,args) {
  need(types.includes(args.type)&&args.payload.protocol===VERSION,'feedback_protocol');
  return eventRow(events,args);
}

export function restoreFeedback(rows,board,requestId) {
  const all=readEvents(rows);
  // Historical feedback_test/check observer records retain their test protocol.
  const events=all.filter(e=>types.includes(e.record_type)&&e.payload.protocol===VERSION);
  const requests=events.filter(e=>e.record_type==='feedback_request'&&e.request_id===requestId);
  need(requests.length===1,'request_missing_or_ambiguous');
  const request=requests[0].payload;
  need(request.request_id===requestId&&request.board_id===board,'request_identity');
  const configs=events.filter(e=>e.record_type==='feedback_configuration'&&e.record_id===request.configuration_id);
  need(configs.length===1,'configuration_missing_or_ambiguous');
  const plans=new Map();
  for(const e of events.filter(e=>e.record_type==='feedback_plan')) {
    need(!plans.has(e.record_id),'duplicate_plan');
    const value=e.payload.manifest_record_id ? readPlanManifest(events,e.payload.manifest_record_id) : e.payload;
    plans.set(e.record_id,value);
  }
  const runs=new Map();
  for(const e of events.filter(e=>e.record_type==='feedback_run')) {
    const p=clone(e.payload),old=runs.get(e.execution_id);
    need(e.execution_id&&p.run_id===e.execution_id&&p.request?.request_id===e.request_id&&p.request.task_id===e.task_id,'run_identity');
    need(p.doc_id===p.request.doc_id&&p.thread_id===p.item?.thread_id&&p.item.doc_id===p.doc_id,'run_identity');
    need(p.key===itemKey(board,p.item)&&p.request.board_id===board,'item_identity');
    need(!old||same(old.request,p.request)&&same(old.item,p.item)&&old.classification===p.classification,'frozen_input_changed');
    need(!old||old.phase!=='complete','completed_item_immutable');
    const rank=phases.indexOf(p.phase);
    need(rank>=0||['deferred','stale','needs_reconciliation','closed'].includes(p.phase),'unknown_phase');
    need(!old||rank<0||rank>=old.max_phase_rank,'phase_regression');
    for(const k of immutable)need(!old?.[k]||!(k in p)||same(old[k],p[k]),'effect_identity_changed');
    const merged={...old,...p,max_phase_rank:Math.max(old?.max_phase_rank??-1,rank)};
    if(merged.plan_record_id) {
      const plan=plans.get(merged.plan_record_id);
      need(plan&&plan.doc_id===p.doc_id&&plan.key===p.key&&plan.thread_id===p.thread_id&&same(plan.item,p.item),'plan_missing_or_crossed');
      merged.plan=plan;
    }
    if(rank>=2&&p.phase!=='complete')need(merged.plan,'plan_missing_or_crossed');
    if(p.phase==='edit_verified')need(p.native_verified===true,'native_verification_missing');
    if(p.phase==='reply_known')need(present(merged.reply_id),'reply_id_missing');
    if(p.phase==='reply_verified')need(present(merged.reply_id)&&p.thread_verified===true,'reply_verification_missing');
    if(p.phase==='edit_verified')merged.edit_verified=true;
    if(p.phase==='reply_verified')merged.reply_verified=true;
    if(p.phase==='complete') {
      need(p.completed_at&&['revised_replied','answered','clarification_replied','no_action'].includes(p.outcome),'completion_missing');
      if(p.outcome!=='no_action')need(merged.reply_verified,'reply_verification_missing');
      if(p.outcome==='revised_replied')need(merged.edit_verified,'native_verification_missing');
      if(p.outcome==='no_action')need(['acknowledgment','approval','suggestion_decision'].includes(p.classification)&&!merged.plan&&!merged.edit_operation_id&&!merged.reply_operation_id,'effect_not_no_action');
    }
    runs.set(e.execution_id,merged);
  }
  return {board_id:board,config:configs[0].payload,request,runs:[...runs.values()],events:all};
}

export function preflight(s) {
  const {config:c,request:r,item:i}=s;
  need(c?.protocol===VERSION&&r?.protocol===VERSION,'feedback_protocol');
  need(c.board_id===s.board_id&&r.board_id===s.board_id&&i.board_id===s.board_id,'board_identity');
  need(r.doc_id===i.doc_id&&present(i.thread_id)&&present(i.post_id)&&present(i.provider)&&/^[1-9]\d*$/.test(String(i.version)),'item_identity');
  const key=itemKey(s.board_id,i),matches=s.runs.filter(run=>run.key===key);
  need(matches.length<=1,'duplicate_item');
  if(matches.length) {
    const run=matches[0];need(same(stableItem(run.item),stableItem(i)),'feedback_version_changed');
    return {action:run.phase==='complete'?'return_existing':'inspect_recovery',run};
  }
  const family=s.runs.filter(run=>run.item.doc_id===i.doc_id&&run.item.provider===i.provider&&run.item.post_id===i.post_id&&run.item.thread_id===i.thread_id);
  if(family.length) {
    const parent=family.find(run=>run.run_id===i.predecessor_run_id);
    need(parent&&['complete','closed'].includes(parent.phase)&&Number(i.version)>Number(parent.item.version)&&i.version_reason,'feedback_successor_required');
    need(!family.some(run=>run.item.predecessor_run_id===parent.run_id),'feedback_successor_fork');
  }
  need(r.enabled===true&&r.mode==='direct_supported'&&r.requested_by&&r.requested_at&&r.authorization,'request_authorization');
  need(c.method===METHOD&&r.method===METHOD&&c.instruction_id===r.instruction_id,'method_conflict');
  need(c.mode==='manual_single_writer'&&c.writer===r.writer&&c.writer===s.writer,'writer_authority');
  need(s.writer_check_complete===true&&!s.active_writers?.length&&!s.runs.some(run=>!['complete','closed'].includes(run.phase)||run.phase==='closed'&&(run.effects_uncertain===true||run.max_phase_rank>=2)&&!(run.effects_reconciled?.confirmed_by&&run.effects_reconciled.confirmed_at&&run.effects_reconciled.reason&&run.effects_reconciled.item_key===run.key)),'active_or_uncertain_writer');
  need(c.allowed_doc_ids?.includes(r.doc_id)&&!c.protected_ids?.includes(r.doc_id),'destination');
  const binding=s.registrations.filter(x=>x.doc_id===r.doc_id);
  need(binding.length===1&&binding[0].task_id===r.task_id&&binding[0].executor_id===r.executor_id&&binding[0].accepted_source_ids?.length,'draft_registration');
  need(s.inputs_current===true&&s.relevant_decisions_clear===true&&s.ingestion_complete===true,'inputs_not_current');
  need(s.comments?.complete===true&&s.comments.threads.length<=100&&unique(s.comments.threads.map(t=>t.id)),'comments_incomplete');
  const thread=s.comments.threads.find(t=>t.id===i.thread_id);
  need(thread&&!thread.deleted&&thread.resolved!==true,'thread_unavailable');
  const post=i.post_id===thread.id?thread:thread.replies?.find(p=>p.id===i.post_id);
  // Drive comment modifiedTime also changes for replies; content/author/version
  // identify feedback. Keep observed timestamps as evidence, not new-work keys.
  need(post&&!post.deleted&&post.content===i.content&&same(post.author,i.author),'feedback_changed');
  const grant=s.authority;
  need(grant?.confirmed_by&&grant.confirmed_at&&grant.evidence_id&&grant.doc_id===i.doc_id&&grant.thread_id===i.thread_id&&grant.post_id===i.post_id&&grant.content===i.content&&String(grant.version)===String(i.version)&&same(grant.author,i.author),'author_unverified');
  need(!s.agent_post_ids?.includes(i.post_id),'agent_feedback');
  need(s.semantic_check?.injection_free===true&&s.semantic_check.conflicts_clear===true&&present(s.semantic_check.reason),'feedback_conflict_or_injection');
  const kind=s.classification;
  need(['revision','question','clarification','acknowledgment','approval','suggestion_decision'].includes(kind),'classification_required');
  if(['acknowledgment','approval','suggestion_decision'].includes(kind))return {action:'record_only',kind,task_status_write:false,rule_activation:false};
  need(grant.actions?.includes('reply'),'reply_unauthorized');
  if(kind==='revision')need(grant.actions.includes('revise'),'edit_unauthorized');
  const sources=binding[0].accepted_source_ids.map(id=>s.sources.find(x=>x.record_id===id));
  need(sources.length<=8&&sources.every(Boolean),'sources_missing');
  for(const x of sources)need(x.approved===true&&x.accepted_by&&x.accepted_at&&x.revision===x.accepted_revision&&x.text===x.accepted_text&&x.text.length<=20000,'source_changed_or_unaccepted');
  need(sources.reduce((n,x)=>n+x.text.length,0)<=80000,'source_limit');
  return {action:kind==='revision'?'plan_revision':'plan_reply',key,thread,sources};
}

const TEXT_FIELDS='bold,italic,underline,strikethrough,smallCaps,backgroundColor,foregroundColor,fontSize,weightedFontFamily,baselineOffset,link';
function threadOverlap(s,before,target,start,end) {
  const map=s.thread_ranges||[];
  for(const t of s.comments.threads.filter(t=>t.id!==target)) {
    const found=map.filter(m=>m.thread_id===t.id);
    need(found.length===1,'other_anchor_unknown');const m=found[0];
    need(m.revision===before.revision&&m.tab_id===before.tab_id&&m.start<m.end&&before.text.slice(m.start-1,m.end-1)===m.text,'other_anchor_stale');
    need(end<m.start||start>m.end,'conflicting_comment_range');
  }
}
export function planRevision(s,patch,validation) {
  const decision=preflight(s);need(decision.action==='plan_revision','revision_ineligible');
  const before=nativeSnapshot(s.native_doc);
  need(before.file_id===s.request.doc_id,'destination');
  need(before.sections.every(section=>section.start===0),'unsupported_sections');
  const {thread,sources}=decision;
  need(thread.anchor&&present(thread.quotedFileContent?.value),'anchor_missing');
  const quote=thread.quotedFileContent.value;
  const paragraphs=before.paragraphs.filter(p=>p.text.includes(quote));
  need(paragraphs.length===1&&count(paragraphs[0].text,quote)===1,'anchor_ambiguous_or_stale');
  const q=paragraphs[0];
  need(patch.paragraph_start===q.start&&present(patch.old_text)&&q.text.includes(patch.old_text)&&count(q.text,patch.old_text)===1,'patch_anchor');
  need(typeof patch.new_text==='string'&&patch.old_text!==patch.new_text&&!/[\r\n\u0000-\u001f]/.test(patch.new_text+patch.old_text)&&validUTF16(patch.old_text)&&validUTF16(patch.new_text),'patch_shape');
  const oldAt=q.text.indexOf(patch.old_text),quoteAt=q.text.indexOf(quote);
  need(oldAt>=quoteAt&&oldAt+patch.old_text.length<=quoteAt+quote.length,'patch_outside_comment');
  need(validation?.supported===true&&validation.preserves_meaning_checked===true&&present(validation.reason),'candidate_not_validated');
  need(['wording','fact','commitment','scope','safety','disclosure','prior_finding'].includes(validation.change_kind),'change_kind_missing');
  if(validation.change_kind!=='wording')need(patch.support?.length,'source_support_missing');
  for(const e of patch.support||[])need(sources.some(x=>x.record_id===e.record_id&&x.file_id===e.file_id&&x.revision===e.revision&&present(e.quote)&&x.text.includes(e.quote)),'source_support_mismatch');
  // Keep unchanged prefix/suffix so the existing native comment anchor survives.
  let prefix=0,suffix=0;
  while(prefix<Math.min(patch.old_text.length,patch.new_text.length)&&patch.old_text[prefix]===patch.new_text[prefix])prefix++;
  while(!boundary(patch.old_text,prefix)||!boundary(patch.new_text,prefix))prefix--;
  while(suffix<Math.min(patch.old_text.length-prefix,patch.new_text.length-prefix)&&patch.old_text.at(-1-suffix)===patch.new_text.at(-1-suffix))suffix++;
  while(!boundary(patch.old_text,patch.old_text.length-suffix)||!boundary(patch.new_text,patch.new_text.length-suffix))suffix--;
  const offset=oldAt+prefix,removed=patch.old_text.length-prefix-suffix,inserted=patch.new_text.slice(prefix,patch.new_text.length-suffix),start=q.start+offset,end=start+removed;
  need(removed+inserted.length<=4000,'edit_limit');
  need(!(s.protected_ranges||[]).some(r=>r.tab_id===before.tab_id&&start<=r.end&&end>=r.start),'protected_passage');
  threadOverlap(s,before,thread.id,start,end);
  let runStart=0,selected;
  for(const run of q.runs){if(!selected&&offset>=runStart&&offset+removed<=runStart+run.text.length&&offset<runStart+run.text.length)selected={run,runStart};runStart+=run.text.length;}
  need(selected,'crosses_text_runs');
  need(Object.keys(selected.run.style).every(k=>TEXT_FIELDS.split(',').includes(k)),'unsupported_text_style');
  const requests=[],range={tabId:before.tab_id,startIndex:start,endIndex:end};
  if(removed)requests.push({deleteContentRange:{range}});
  if(inserted)requests.push({insertText:{location:{tabId:before.tab_id,index:start},text:inserted}},{updateTextStyle:{range:{tabId:before.tab_id,startIndex:start,endIndex:start+inserted.length},textStyle:clone(selected.run.style),fields:TEXT_FIELDS}});
  const expected=clone(before),p=expected.paragraphs.find(p=>p.start===q.start);let pos=0;
  for(const r of p.runs){if(pos===selected.runStart)r.text=r.text.slice(0,offset-pos)+inserted+r.text.slice(offset-pos+removed);pos+=r.text.length-(pos===selected.runStart?inserted.length-removed:0);}
  p.text=p.text.slice(0,offset)+inserted+p.text.slice(offset+removed);
  const merged=[];for(const run of p.runs.filter(r=>r.text)){const previous=merged.at(-1);if(previous&&same(previous.style,run.style))previous.text+=run.text;else merged.push(run);}p.runs=merged;
  let next=1;for(const p of expected.paragraphs){p.start=next;next+=p.text.length;}
  expected.text=expected.paragraphs.map(p=>p.text).join('');need(expected.text.length<=20000,'draft_limit');
  const review_required=['commitment','scope','safety','disclosure','prior_finding'].includes(validation.change_kind)||validation.substantial===true||validation.uncertain===true;
  return {protocol:VERSION,key:decision.key,item:clone(s.item),doc_id:before.file_id,thread_id:thread.id,mode:'direct_supported',before,expected,comments:clone(s.comments),requests,write_control:{requiredRevisionId:before.revision},patch:clone(patch),validation:clone(validation),review_required};
}

export function planResponse(s,validation) {
  const result=preflight(s);need(result.action==='plan_reply','response_ineligible');
  need(validation?.supported===true&&present(validation.reason),'candidate_not_validated');
  for(const e of validation.support||[])need(result.sources.some(x=>x.record_id===e.record_id&&x.file_id===e.file_id&&x.revision===e.revision&&present(e.quote)&&x.text.includes(e.quote)),'source_support_mismatch');
  if(s.classification==='question'&&validation.factual_answer===true)need(validation.support?.length,'source_support_missing');
  const before=nativeSnapshot(s.native_doc);need(before.file_id===s.request.doc_id,'destination');
  return {protocol:VERSION,key:result.key,item:clone(s.item),doc_id:before.file_id,thread_id:result.thread.id,mode:'reply_only',before,expected:clone(before),comments:clone(s.comments),requests:[],validation:clone(validation),review_required:false};
}

const stableThread=t=>Object.fromEntries(Object.entries(t).filter(([k])=>!['replies','modifiedTime','resolved'].includes(k)));
export function verifyInventory(before,after,target,reply) {
  need(before.complete===true&&after.complete===true&&unique(after.threads.map(t=>t.id)),'comments_incomplete');
  need(before.threads.length===after.threads.length,'comment_inventory_changed');
  for(const t of before.threads) {
    const a=after.threads.find(x=>x.id===t.id);need(a,'comment_inventory_changed');
    if(t.id!==target){need(same(t,a),'other_thread_changed');continue;}
    need(same(stableThread(t),stableThread(a))&&a.resolved!==true,'target_thread_changed');
    const expected=reply?[...t.replies,reply]:t.replies;
    need(same(a.replies,expected),'reply_inventory_changed');
  }
  return true;
}
function recoveryPermission(context,plan,inventory) {
  need(context&&same(stableItem(context.item),stableItem(plan.item)),'recovery_context_missing_or_changed');
  const check=preflight({...context,comments:inventory,runs:context.runs.filter(run=>run.key!==plan.key)});
  need(['plan_revision','plan_reply'].includes(check.action),'recovery_authorization');
}
export function recoverEdit(plan,current,inventory,decision,context) {
  try {
    recoveryPermission(context,plan,inventory);
    need(plan.mode==='direct_supported','edit_unauthorized');verifyInventory(plan.comments,inventory,plan.thread_id);
    const actual=nativeSnapshot(current);
    if(sameNative(plan.expected,actual))return {action:'verify_edit_then_reply_only',doc_id:plan.doc_id,revision:actual.revision};
    if(sameNative(plan.before,actual)&&actual.revision===plan.before.revision&&decision?.action==='retry_saved_edit'&&decision.confirmed_by&&decision.confirmed_at&&decision.reason&&decision.item_key===plan.key)
      return {action:'apply_saved_guarded_batch',doc_id:plan.doc_id,requests:plan.requests,write_control:plan.write_control};
    return {action:'stop',reason:'preserve_changed_or_uncertain_document',doc_id:plan.doc_id};
  }catch(e){return {action:'stop',reason:e.code||'unreadable_document',doc_id:plan.doc_id};}
}
export function replyPlan(plan,operationId,content,inventory,current,context) {
  recoveryPermission(context,plan,inventory);
  need(present(operationId)&&present(content)&&content.length<=1800,'reply_shape');
  need(sameNative(plan.expected,nativeSnapshot(current)),'edit_or_response_not_verified');
  verifyInventory(plan.comments,inventory,plan.thread_id);
  const marker=`FEEDBACK:${operationId}`;need(!inventory.threads.some(t=>t.replies.some(r=>r.content?.includes(marker))),'existing_reply_marker');
  const text=`${content} [${marker}]`;
  return {protocol:VERSION,doc_id:plan.doc_id,thread_id:plan.thread_id,item:clone(plan.item),key:plan.key,operation_id:operationId,content:text,marker,comments:clone(inventory),request:{addCommentReply:{commentId:plan.thread_id,post:{content:text}}}};
}
export function recoverReply(plan,inventory,knownReplyId,context) {
  try {
    recoveryPermission(context,plan,inventory);
    need(inventory.complete===true,'comments_incomplete');
    const matches=inventory.threads.flatMap(t=>t.replies.filter(r=>r.content?.includes(plan.marker)).map(r=>({thread:t,reply:r})));
    need(matches.length<=1,'duplicate_reply_marker');
    if(!matches.length)return {action:'stop',reason:knownReplyId?'known_reply_missing':'reply_outcome_unknown',doc_id:plan.doc_id};
    const {thread,reply}=matches[0];
    need(thread.id===plan.thread_id,'wrong_reply_thread');
    need(reply.id&&reply.content===plan.content&&!reply.deleted&&(!knownReplyId||reply.id===knownReplyId),'reply_changed');
    verifyInventory(plan.comments,inventory,plan.thread_id,reply);
    return {action:'verify_reply_then_save_only',doc_id:plan.doc_id,thread_id:thread.id,reply_id:reply.id};
  }catch(e){return {action:'stop',reason:e.code||'reply_reconciliation_required',doc_id:plan.doc_id};}
}

export function planParts(blobId,plan) {
  const text=canonical(plan);need(present(blobId)&&text.length<=240000,'snapshot_limit');
  const parts=[];for(let i=0;i<text.length;i+=10000)parts.push({protocol:VERSION,blob_id:blobId,index:parts.length,text:text.slice(i,i+10000)});
  return {parts,manifest:{protocol:VERSION,blob_id:blobId,count:parts.length,characters:text.length}};
}
export function readPlanManifest(events,manifestId) {
  const found=events.filter(e=>e.record_id===manifestId&&e.record_type==='feedback_manifest');
  need(found.length===1,'incomplete_plan');const m=found[0].payload;
  need(m.protocol===VERSION&&Array.isArray(m.record_ids)&&unique(m.record_ids)&&m.record_ids.length===m.count,'incomplete_plan');
  const parts=m.record_ids.map(id=>events.find(e=>e.record_id===id&&e.record_type==='feedback_blob'));
  need(parts.every((e,i)=>e&&e.payload.protocol===VERSION&&e.payload.blob_id===m.blob_id&&e.payload.index===i),'incomplete_plan');
  const text=parts.map(e=>e.payload.text).join('');need(text.length===m.characters,'incomplete_plan');
  try{return JSON.parse(text);}catch{throw new Stop('incomplete_plan');}
}
