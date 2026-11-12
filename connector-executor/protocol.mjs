// Pure protocol helpers. ChatGPT Work owns connector calls; this module has no network or credentials.
import {CHECKPOINT_SCHEMA,validateDraftingCheckpoint,compareCheckpoint} from './skills/hive-mind-executor/scripts/checkpoint.mjs';
export {CHECKPOINT_SCHEMA,buildDraftingCheckpoint,validateDraftingCheckpoint,checkpointSummary} from './skills/hive-mind-executor/scripts/checkpoint.mjs';
export const VERSION = 'connector-executor/1';
export const HEADERS = ['record_id','record_type','task_id','request_id','execution_id','sequence','previous_record_id','recorded_at','actor','schema_version','payload_json'];
export class Stop extends Error {
  constructor(code, detail = '') { super(`${code}${detail ? ': '+detail : ''}`); this.code = code; }
}
const need = (ok, code, detail) => { if (!ok) throw new Stop(code, detail); };
export function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  need(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'invalid_value');
  return JSON.stringify(value);
}
export const identity = (board, request) => canonical([board,request.task_id,request.deliverable_type,String(request.version)]);
export function createdFile(result) {
  const id=result?.fileId || result?.id || result?.documentId;
  need(typeof id==='string' && /^[A-Za-z0-9_-]+$/.test(id) && typeof result?.url==='string','unknown_create_result');
  need(result.url.includes('/'+id+'/'),'output_identity');
  return {output_id:id,output_url:result.url};
}
export function expectedNativeText(inserted, before) {
  need(typeof inserted==='string' && before==='\n','not_known_blank');
  // Inserting at index 1 retains the blank Doc's original terminal paragraph.
  return inserted+before;
}
export function table(rows, required) {
  need(Array.isArray(rows) && Array.isArray(rows[0]), 'missing_table');
  need(required.every((h,i)=>rows[0][i] === h), 'schema_changed');
  const result = rows.slice(1).filter(r=>r.some(v=>v!=='' && v!==null)).map(r=>Object.fromEntries(rows[0].map((h,i)=>[h,r[i] ?? ''])));
  need(result.every(r=>r[required[0]]) && new Set(result.map(r=>r[required[0]])).size === result.length,'duplicate_identity');
  return result;
}
export function cellsToRows(sheet) {
  const data = sheet.data || [];
  const out = [];
  for (const block of data) for (let i=0;i<(block.rowData || []).length;i++) {
    const n=(block.startRow || 0)+i; out[n] ||= [];
    for (let j=0;j<(block.rowData[i].values || []).length;j++) {
      const cell=block.rowData[i].values[j], v=cell.userEnteredValue || {};
      need(!('formulaValue' in v),'formula_in_control');
      out[n][(block.startColumn || 0)+j]=v.stringValue ?? v.numberValue ?? v.boolValue ?? '';
    }
  }
  return out;
}
export function readEvents(rows) {
  const events=table(rows,HEADERS); const ids=new Set(); const latest=new Map();
  for (const e of events) {
    need(e.schema_version === VERSION,'unsupported_protocol');
    need(!ids.has(e.record_id),'duplicate_event'); ids.add(e.record_id);
    const group=e.execution_id || `${e.record_type}:${e.request_id || 'configuration'}`;
    const prior=latest.get(group);
    need(Number(e.sequence) === (prior ? Number(prior.sequence)+1 : 1) && e.previous_record_id === (prior?.record_id || ''),'interrupted_ledger');
    try { e.payload=JSON.parse(e.payload_json); } catch { throw new Stop('incomplete_record'); }
    latest.set(group,e);
  }
  return events;
}
// Reconstruct from current connector reads, not a prior invocation's in-memory snapshot.
export function restore(board_id, tables, request_id, currentSources, completion_search) {
  const events=readEvents(tables['Executor Connector']);
  const config=events.filter(e=>e.record_type==='configuration').at(-1)?.payload;
  need(config,'configuration_missing');
  const objects=(name,headers)=>table(tables[name],headers);
  const requests=objects('Executor Requests',['request_id','task_id']);
  const request=requests.find(r=>r.request_id===request_id); need(request,'request_missing');
  const legacy=new Map();
  for(const row of objects('Executor Journal',['event_id','execution_key','sequence','previous_hash','record_json','event_hash'])) {
    let r;try{r=JSON.parse(row.record_json);}catch{throw new Stop('legacy_journal_unreadable');}
    need(r.id && r.request,'legacy_journal_unreadable');
    legacy.set(r.id,{...r,execution_id:r.id,deliverable_type:r.request.deliverable_type,version:String(r.request.version)});
  }
  const active=new Map();
  for(const e of events.filter(e=>e.record_type==='run')) {
    const previous=active.get(e.execution_id) || {};
    if(e.payload.checkpoint_schema || e.payload.instruction_revision==='1.3') {
      if(e.payload.phase==='drafting')validateDraftingCheckpoint(e.payload);
    }
    if(previous.checkpoint_schema && e.payload.input_snapshot)need(canonical(e.payload.input_snapshot)===canonical(previous.input_snapshot),'frozen_input_changed');
    const savedRequest=e.payload.input_snapshot?.request || previous.input_snapshot?.request;
    need(savedRequest && savedRequest.task_id===e.task_id && savedRequest.request_id===e.request_id,'run_identity_missing');
    active.set(e.execution_id,{...previous,...e.payload,execution_id:e.execution_id,task_id:e.task_id,request_id:e.request_id,
      deliverable_type:savedRequest.deliverable_type,version:String(savedRequest.version),
      previous_execution_id:savedRequest.previous_execution_id || previous.previous_execution_id || e.payload.previous_execution_id || '',
      ...(e.payload.checkpoint_schema && e.payload.input_snapshot ? {accepted_source_records:e.payload.input_snapshot.sources.map(s=>s.record_id)} : {})});
  }
  const accepted=events.filter(e=>e.record_type==='accepted_source').map(e=>e.payload);
  const sources=accepted.filter(x=>x.context_set_id===request.context_set_id).map(x=>{
    const current=currentSources.find(y=>y.file_id===x.file_id);
    return {...x,record_id:events.find(e=>e.record_type==='accepted_source' && e.payload===x).record_id,
      accepted_revision:x.revision,text:current?.text ?? '',revision:current?.revision || '',access:current?.access || 'denied'};
  });
  return {board_id,config,request,tasks:objects('Tasks',['task_id','task','owner','status']),
    history:objects('Task History',['history_id','source_id','task_id']),reviews:objects('Reviews',['review_id','source_id','task_id','candidate_ids']),
    source_journal:objects('Source Journal',['source_id','fingerprint','phase','task_ids']).map(j=>{
      let ids;try{ids=JSON.parse(j.task_ids || '[]');}catch{throw new Stop('ingestion_journal_unreadable');}
      need(Array.isArray(ids),'ingestion_journal_unreadable');return {...j,affected_task_ids:ids};}),
    registry:objects('Source Registry',['source_id']),processed_sources:objects('Processed Sources',['source_id']),
    executions:[...legacy.values(),...active.values()],decisions:events.filter(e=>e.record_type==='decision').map(e=>e.payload),sources,completion_search,events};
}
export function eventRow(events, {id,type,task='',request='',execution='',at,actor,payload}) {
  if(type==='run' && payload?.phase==='drafting')validateDraftingCheckpoint(payload);
  need(id && type && at && actor && !Number.isNaN(Date.parse(at)), 'invalid_event');
  need(!events.some(e=>e.record_id===id),'duplicate_event');
  const group=execution || `${type}:${request || 'configuration'}`;
  const prev=events.filter(e=>(e.execution_id || `${e.record_type}:${e.request_id || 'configuration'}`)===group).at(-1);
  const body=canonical(payload); need(body.length<=30000,'record_limit');
  return [id,type,task,request,execution,(Number(prev?.sequence)||0)+1,prev?.record_id || '',at,actor,VERSION,body];
}
export function appendRequest(sheetId, rows) {
  need(Number.isInteger(sheetId) && rows.length && rows.every(r=>r.length===HEADERS.length),'invalid_append');
  return {appendCells:{sheetId,rows:rows.map(r=>({values:r.map(v=>({userEnteredValue:{stringValue:String(v)}}))})),fields:'userEnteredValue'}};
}
export function nativeDocument(doc) {
  const tabs=[];
  function visit(ts) { for(const t of ts || []) { if(t.body || t.documentTab?.body) tabs.push(t); visit(t.childTabs); } }
  visit(doc.tabs); if(!tabs.length && doc.body) tabs.push({body:doc.body,tabId:''});
  need(tabs.length===1,'unsupported_document_tabs');
  let text=''; const paragraphs=[];
  for(const e of (tabs[0].body || tabs[0].documentTab.body).content || []) {
    if(e.sectionBreak) continue;
    need(e.paragraph,'unsupported_source_structure');
    need(!e.paragraph.suggestedParagraphStyleChanges,'source_suggestions');
    let value='';
    for(const r of e.paragraph.elements || []) {
      need(!r.suggestedInsertionIds?.length && !r.suggestedDeletionIds?.length && !r.suggestedTextStyleChanges,'source_suggestions');
      need(r.textRun || r.pageBreak,'unsupported_source_structure');
      value+=r.textRun?.content || '';
    }
    paragraphs.push({start:e.startIndex,text:value}); text+=value;
  }
  text=text.replace(/\r\n?/g,'\n'); need(text.length<=20000,'source_limit');
  return {file_id:doc.documentId,title:doc.title,tab_id:tabs[0].tabId ?? tabs[0].tabProperties?.tabId ?? '',revision:doc.revisionId || '',text,paragraphs};
}
export function preflight(s) {
  const {config:c,request:r}=s;
  need(c && c.protocol===VERSION && c.mode==='manual_single_writer' && c.board_id===s.board_id && !c.protected_board_ids?.includes(s.board_id),'destination');
  need(r && r.enabled==='yes' && c.task_ids.includes(r.task_id) && c.deliverable_types.includes(r.deliverable_type),'not_enabled');
  need(/^[1-9]\d*$/.test(String(r.version)) && r.requested_by && r.reviewer && r.requested_at,'invalid_request');
  const all=s.executions.filter(e=>e.task_id===r.task_id && e.deliverable_type===r.deliverable_type);
  const matches=all.filter(e=>String(e.version)===String(r.version));
  need(matches.length<=1,'duplicate_execution');
  const prior=matches[0];
  // A known identity wins before any new draft. Changes affect the message, never permission to recreate.
  if(prior) {
    if(prior.phase==='complete' && prior.output_id) return {action:'return_existing',execution:prior,check_inputs:true};
    return {action:'inspect_recovery',execution:prior};
  }
  if(all.length) {
    need(r.previous_execution_id && r.revision_reason,'existing_draft_requires_decision');
    const parent=all.find(e=>e.execution_id===r.previous_execution_id);
    need(parent?.phase==='complete' && parent.output_id && Number(r.version)>Number(parent.version),'invalid_predecessor');
    need(!all.some(e=>e.previous_execution_id===r.previous_execution_id),'existing_successor');
    need(s.decisions.some(d=>d.request_id===r.request_id && d.version===String(r.version) && d.action==='authorize_new_version' && d.actor && d.reason),'new_version_not_authorized');
  }
  need(!s.executions.some(e=>!['complete','blocked','cancelled'].includes(e.phase)),'active_or_uncertain_run');
  const byId=new Map(s.tasks.map(t=>[t.task_id,t])); need(byId.size===s.tasks.length,'duplicate_task');
  const t=byId.get(r.task_id); need(t,'task_missing');
  if(t.status==='done') return {action:'possibly_done',reason:'task_done'};
  need(c.owners.includes(t.owner) && t.status==='open' && !t.blockers,'task_blocked');
  const closure=new Set();
  function walk(id,path=[]) {
    need(!path.includes(id),'dependency_cycle'); const task=byId.get(id); need(task,'dependency_missing');
    closure.add(id);
    for(const dep of String(task.dependencies || '').split(/[\s,;]+/).filter(Boolean)) {
      need(/^HM-\d+$/.test(dep),'dependency_unclear'); const child=byId.get(dep); need(child?.status==='done','dependency_incomplete'); walk(dep,[...path,id]);
    }
  }
  walk(t.task_id);
  need(s.history.some(h=>h.task_id===t.task_id && h.source_quotes),'identity_evidence_missing');
  for(const review of s.reviews.filter(v=>v.status==='pending')) {
    let candidates; try { candidates=JSON.parse(review.candidate_ids || '[]'); } catch { throw new Stop('review_unreadable'); }
    need(![review.task_id,...candidates].some(id=>closure.has(id)),'relevant_decision');
  }
  const sourceIds=new Set(s.history.filter(h=>closure.has(h.task_id)).map(h=>h.source_id));
  need(sourceIds.size>0,'source_history_missing');
  need(!s.source_journal.some(j=>j.phase!=='complete' && j.affected_task_ids.some(id=>closure.has(id))),'ingestion_interrupted');
  for(const id of sourceIds) {
    need(s.processed_sources.some(x=>x.source_id===id),'source_not_processed');
    need(!s.registry.some(x=>x.source_id===id && ['failed','changed_requires_review','needs_reconciliation'].includes(x.outcome)),'source_needs_review');
  }
  need(s.completion_search?.complete && s.completion_search.folder_id===c.completion_folder_id,'completion_search_incomplete');
  need(s.completion_search.files.every(f=>f.classification && f.checked_at && f.file_id),'completion_unclassified');
  const done=s.completion_search.files.filter(f=>f.classification==='same_task_completed');
  if(done.length) return {action:'possibly_done',evidence:done};
  const sources=s.sources.filter(x=>x.context_set_id===r.context_set_id);
  need(sources.length>0 && sources.length<=8 && new Set(sources.map(x=>x.file_id)).size===sources.length,'sources_missing_or_ambiguous');
  need(sources.filter(x=>x.role==='scope').length===1,'scope_missing_or_ambiguous');
  let total=0;
  for(const x of sources) {
    need(x.approved==='yes' && x.accepted_by && x.accepted_at,'source_not_accepted',x.file_id);
    need(x.project===r.project && typeof x.text==='string' && x.text.trim() && typeof x.accepted_text==='string','source_missing',x.file_id);
    need(x.text===x.accepted_text,'source_changed',x.file_id);
    need(x.access==='readable','source_access',x.file_id); total+=x.text.length;
    need(x.text.length<=20000,'source_limit');
  }
  need(total<=80000,'context_limit');
  for(const id of sourceIds) need(sources.some(x=>x.source_id===id && x.role==='transcript'),'transcript_missing',id);
  need(c.requirements?.length && new Set(c.requirements.map(x=>x.id)).size===c.requirements.length,'requirements_missing');
  for(const q of c.requirements) need(sources.some(x=>x.file_id===q.source_file_id && x.text.includes(q.quote) && q.quote.trim()),'requirement_not_grounded',q.id);
  return {action:'draft',task:t,sources,task_ids:[...closure]};
}
export function inputChanges(snapshot, execution) {
  const before=execution.input_snapshot;
  if(!before) return ['inspect_historical_snapshot'];
  if(execution.checkpoint_schema===CHECKPOINT_SCHEMA){
    const frozen=Object.fromEntries(['checkpoint_schema','execution_id','instruction_revision','attempt','input_snapshot'].map(k=>[k,execution[k]]));
    Object.assign(frozen,{phase:'drafting',generation_status:'not_started',provider_response_id:null});
    const byId=id=>snapshot.events?.find(e=>e.record_id===id);
    const cfg=snapshot.events?.filter(e=>e.record_type==='configuration').at(-1);
    const accepted=snapshot.events?.filter(e=>e.record_type==='accepted_source' && e.payload.context_set_id===snapshot.request.context_set_id)||[];
    const changes=compareCheckpoint({...snapshot,configuration_record:cfg,authorization_record:byId(before.authorization_ref.record_id),accepted_sources:accepted},frozen);
    for(const src of snapshot.sources){
      const ref=before.sources.find(x=>x.record_id===src.record_id);
      if(!ref || src.access!=='readable' || src.text!==src.accepted_text || src.revision!==ref.revision)changes.push('source:'+src.file_id);
    }
    if(!snapshot.sources.length)changes.push('accepted_sources_missing');
    return [...new Set(changes)];
  }
  need(before.request && Array.isArray(before.tasks) && before.tasks.every(t=>t && !Array.isArray(t) && t.task_id) && Array.isArray(before.reviews) && before.reviews.every(r=>r && !Array.isArray(r) && r.review_id),'invalid_input_snapshot');
  const normalize=r=>Object.fromEntries(Object.entries(r).sort().map(([k,v])=>[k,String(v ?? '')]));
  const equal=(a,b)=>canonical(normalize(a))===canonical(normalize(b));
  const changes=[];
  if(!equal(before.request,snapshot.request))changes.push('request');
  for(const task of before.tasks) {
    const current=snapshot.tasks.find(x=>x.task_id===task.task_id);
    if(!current || !equal(task,current))changes.push('task:'+task.task_id);
  }
  const ids=new Set(before.tasks.map(x=>x.task_id));
  const relevant=reviews=>reviews.filter(r=>{
    let candidates;try{candidates=JSON.parse(r.candidate_ids || '[]');}catch{throw new Stop('review_unreadable');}
    return r.status==='pending' && [r.task_id,...candidates].some(id=>ids.has(id));
  }).map(normalize).sort((a,b)=>a.review_id.localeCompare(b.review_id));
  if(canonical(relevant(before.reviews))!==canonical(relevant(snapshot.reviews)))changes.push('relevant_reviews');
  for(const source of snapshot.sources) if(source.access!=='readable' || source.text!==source.accepted_text)changes.push('source:'+source.file_id);
  if(!snapshot.sources.length)changes.push('accepted_sources_missing');
  return changes;
}
export function checkCandidate(candidate, config, sources) {
  need(candidate && Array.isArray(candidate.paragraphs) && candidate.paragraphs.length>0,'candidate_missing');
  const text=candidate.paragraphs.map(p=>p.text+'\n').join('');
  need(text.length<=12000 && candidate.paragraphs.every(p=>typeof p.text==='string' && p.text.trim() && !/[\r\n]/.test(p.text)),'candidate_shape');
  for(const p of candidate.paragraphs) for(const ref of p.evidence || []) {
    need(sources.some(x=>x.file_id===ref.file_id && ref.quote?.trim() && x.text.includes(ref.quote)),'candidate_evidence');
  }
  for(const q of config.requirements) {
    const checks=(candidate.checks || []).filter(x=>x.id===q.id);
    need(checks.length===1 && checks[0].result==='pass' && checks[0].reason,'requirement_unchecked',q.id);
    if(q.mode!=='prohibition') need(checks[0].passage && text.includes(checks[0].passage),'required_content_missing',q.id);
    need(checks[0].source_file_id===q.source_file_id && checks[0].quote===q.quote,'requirement_evidence_mismatch',q.id);
  }
  // This establishes traceability/coverage. Semantic support still requires actual source inspection by Work.
  return text;
}
export function publicationDecision({phase,output_id,expected_text,expected_native_text,before_revision}, observed, decision) {
  if(!output_id) return {action:'stop',reason:phase==='create_intent'?'create_unknown':'no_registered_document'};
  if(!observed?.readable) return {action:'stop',reason:'output_access',output_id};
  need(typeof (expected_native_text ?? expected_text)==='string','missing_expected_state');
  if(observed.text===(expected_native_text ?? expected_text)) return {action:'finish_ledger_only',output_id};
  if(!observed.text.trim() && observed.revision===before_revision && decision?.action==='populate_known_blank' && decision.actor && decision.reason)
    return {action:'write_saved_candidate',output_id,requiredRevisionId:before_revision};
  return {action:'stop',reason:'preserve_changed_document',output_id};
}
export function render(candidate, tabId) {
  let text=''; const ranges=candidate.paragraphs.map(p=>{const start=text.length+1;text+=p.text+'\n';return {...p,start,end:text.length+1};});
  const range=(p)=>({tabId,startIndex:p.start,endIndex:p.end});
  const requests=[{insertText:{location:{index:1,tabId},text}},
    {updateParagraphStyle:{range:{tabId,startIndex:1,endIndex:text.length+1},paragraphStyle:{spaceAbove:{magnitude:0,unit:'PT'},spaceBelow:{magnitude:4,unit:'PT'}},fields:'spaceAbove,spaceBelow'}},
    {updateTextStyle:{range:{tabId,startIndex:1,endIndex:text.length+1},textStyle:{fontSize:{magnitude:10,unit:'PT'}},fields:'fontSize'}}];
  for(const p of ranges) {
    if(p.style) requests.push({updateParagraphStyle:{range:range(p),paragraphStyle:{namedStyleType:p.style},fields:'namedStyleType'}},
      {updateTextStyle:{range:{...range(p),endIndex:p.end-1},textStyle:{fontSize:{magnitude:p.style==='TITLE'?22:14,unit:'PT'}},fields:'fontSize'}});
    if(p.bullet) requests.push({createParagraphBullets:{range:range(p),bulletPreset:'BULLET_DISC_CIRCLE_SQUARE'}});
    if(p.pageBreak) requests.push({updateParagraphStyle:{range:range(p),paragraphStyle:{pageBreakBefore:true},fields:'pageBreakBefore'}});
    for(const link of p.links || []) {const at=p.text.indexOf(link.label);need(at>=0 && p.text.lastIndexOf(link.label)===at,'ambiguous_link');requests.push({updateTextStyle:{range:{tabId,startIndex:p.start+at,endIndex:p.start+at+link.label.length},textStyle:{link:{url:link.url}},fields:'link'}});}
  }
  return {text,requests};
}
