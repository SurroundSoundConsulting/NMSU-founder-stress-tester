// Optional pure checks; Work coordinates connectors. No network, model API or credentials.
import {canonical, Stop, readEvents, eventRow} from '../connector-executor/protocol.mjs';
export const VERSION = 'connector-enforcer/1';
export const METHOD = '2.0';
const need = (v, c) => { if (!v) throw new Stop(c); };
const clone = x => JSON.parse(JSON.stringify(x));
const same = (a,b) => canonical(a) === canonical(b);
const unique = xs => new Set(xs).size === xs.length;
export const reviewKey = (board,r) => canonical([board,r.task_id,r.deliverable_type,r.executor_id,r.draft_id,String(r.version)]);

// Keep the Executor envelope version. Namespaced payloads carry their own protocol.
export function reviewEvent(events, args) {
  need(args.type.startsWith('enforcer_') && args.payload.protocol === VERSION,'enforcer_protocol');
  return eventRow(events,args);
}
export function restoreReview(rows, board, requestId) {
  const all=readEvents(rows), events=all.filter(e=>e.record_type.startsWith('enforcer_'));
  need(events.every(e=>e.payload.protocol===VERSION),'enforcer_protocol');
  const configs=events.filter(e=>e.record_type==='enforcer_configuration' && !e.payload.scope_request_id);
  need(configs.length===1,'configuration_missing_or_ambiguous');
  const requests=events.filter(e=>e.record_type==='enforcer_request' && e.request_id===requestId);
  need(requests.length===1,'request_missing_or_ambiguous');
  const r=requests[0].payload;
  need(r.request_id===requestId && r.task_id===requests[0].task_id,'request_identity');
  const scoped=events.filter(e=>e.record_type==='enforcer_configuration' && e.payload.scope_request_id===requestId);
  need(scoped.length<=1,'scoped_configuration_ambiguous');
  let config=configs[0].payload;
  if(scoped.length) {
    const grant=scoped[0].payload;
    need(scoped[0].request_id===requestId && grant.base_configuration_record===configs[0].record_id && grant.authorized_by && grant.authorized_at && grant.authorization,'scoped_configuration_authorization');
    const allowed=['protocol','scope_request_id','base_configuration_record','authorized_by','authorized_at','authorization','runtime_owner','active_method','instruction_id','fixture_ids','allowed_draft_ids','projection_predecessor_review_id'];
    need(Object.keys(grant).every(k=>allowed.includes(k)),'scoped_configuration_fields');
    need(Array.isArray(grant.allowed_draft_ids) && grant.allowed_draft_ids.length===1 && grant.allowed_draft_ids[0]===r.draft_id && grant.fixture_ids?.length===1 && grant.fixture_ids[0]===r.draft_id,'scoped_configuration_destination');
    config={...config,...grant};
  }
  const runs=new Map();
  const phases=['captured','review_intent','findings_saved','candidate_saved','edit_intent','edit_verified','report_candidate','report_create_intent','report_known','report_write_intent','report_verified','complete'];
  for(const e of events.filter(e=>e.record_type==='enforcer_run')) {
    const p=clone(e.payload), previous=runs.get(e.execution_id);
    need(e.execution_id && p.review_id===e.execution_id && p.request && p.request.request_id===e.request_id && p.request.task_id===e.task_id,'run_identity');
    const expectedKey=reviewKey(board,p.request);
    need(p.key!==undefined || p.stable_key!==undefined,'run_identity');
    if(p.key!==undefined)need(p.key===expectedKey,'run_identity');
    if(p.stable_key!==undefined)need(Array.isArray(p.stable_key) && canonical(p.stable_key)===expectedKey,'run_identity');
    p.key=expectedKey;
    if(p.agenda_id!==undefined){need(p.agenda_id===p.request.draft_id && (!p.draft_id || p.draft_id===p.agenda_id),'run_identity');p.draft_id=p.agenda_id;}
    if(p.draft_id!==undefined)need(p.draft_id===p.request.draft_id,'run_identity');
    if(['edit_intent','edit_verified'].includes(p.phase) && p.operation_id){need(!p.edit_operation_id || p.edit_operation_id===p.operation_id,'effect_identity_changed');p.edit_operation_id=p.operation_id;}
    if(p.edit_intent_record){need(!p.edit_intent_id || p.edit_intent_id===p.edit_intent_record,'effect_identity_changed');p.edit_intent_id=p.edit_intent_record;}
    need(!previous || same(previous.request,p.request),'frozen_request_changed');
    need(!previous || previous.phase!=='complete','completed_review_immutable');
    need(p.key===reviewKey(board,p.request),'run_identity');
    const suggestionRanks={suggestion_intent:4,suggestions_pending_human_review:5};
    const rank=suggestionRanks[p.phase] ?? phases.indexOf(p.phase);
    if(p.phase in suggestionRanks) {
      need(p.request.mode==='suggest_supported','publication_mode_conflict');
      need(p.suggestion_manifest || previous?.suggestion_manifest,'suggestion_manifest_missing');
    }
    if(p.phase==='suggestions_pending_human_review')need(p.suggestion_observations_manifest || previous?.suggestion_observations_manifest,'suggestion_observation_incomplete');
    if(p.phase==='complete' && p.request.mode==='suggest_supported')
      need(p.outcome==='suggestions_pending_human_review' && p.suggestion_manifest && p.suggestion_observations_manifest,'suggestions_not_accepted');
    if(['edit_intent','edit_verified'].includes(p.phase))need(p.request.mode==='correct_supported','publication_mode_conflict');
    if(previous?.suggestion_manifest && p.phase==='complete')need(p.outcome==='suggestions_pending_human_review','suggestions_not_accepted');
    need(rank>=0 || ['blocked','stale','needs_reconciliation','closed'].includes(p.phase),'unknown_phase');
    need(!previous || rank<0 || rank>=previous.max_phase_rank,'phase_regression');
    for(const key of ['draft_id','report_id','edit_operation_id','edit_intent_id','report_create_operation_id','report_write_operation_id','input_manifest','before_manifest','expected_manifest','batch_manifest','candidate_manifest','findings_record','after_manifest','suggestion_manifest','suggestion_observations_manifest'])
      need(!previous?.[key] || !(key in p) || same(previous[key],p[key]),'effect_identity_changed');
    need(p.phase!=='blocked' || !previous || previous.max_phase_rank<phases.indexOf('edit_intent'),'effect_requires_reconciliation');
    need(p.phase!=='complete' || (p.report_id || previous?.report_id),'report_missing');
    runs.set(e.execution_id,{...previous,...p,max_phase_rank:Math.max(rank,previous?.max_phase_rank??-1)});
  }
  return {board_id:board,config,request:r,runs:[...runs.values()],events:all};
}

// State supplies current sources/tasks/decisions from connected reads, never chat history.
export function preflight(s) {
  const {config:c,request:r}=s;
  need(!c?.scope_request_id || (c.scope_request_id===r.request_id && c.allowed_draft_ids?.includes(r.draft_id)),'scoped_configuration_destination');
  need(c?.protocol===VERSION && c.board_id===s.board_id && ['manual_single_writer','scheduled_desktop_single_writer'].includes(c.mode) && c.runtime_owner &&
    Array.isArray(c.protected_ids) && !c.protected_ids.includes(s.board_id) && !c.protected_ids.includes(r.draft_id),'destination');
  need(r.protocol===VERSION && r.enabled===true && ['review_only','correct_supported','suggest_supported'].includes(r.mode) &&
    /^[1-9]\d*$/.test(String(r.version)) && r.requested_by && r.requested_at && r.reviewer && r.authorization &&
    r.task_id && r.deliverable_type && r.executor_id && r.draft_id,'request_authorization');
  const family=s.runs.filter(x=>x.request.task_id===r.task_id && x.request.deliverable_type===r.deliverable_type && x.request.executor_id===r.executor_id && x.request.draft_id===r.draft_id);
  const existing=family.filter(x=>String(x.request.version)===String(r.version));
  need(existing.length<=1,'duplicate_review');
  if(existing.length) {
    need(same(existing[0].request,r),'frozen_request_changed');
    return {action:existing[0].phase==='complete'?'return_existing':'inspect_recovery',run:existing[0]};
  }
  if(family.length) {
    const parent=family.find(x=>x.review_id===r.previous_review_id);
    need(parent && ['complete','closed'].includes(parent.phase) && r.reason && Number(r.version)>Number(parent.request.version),'successor_decision');
    need(!family.some(x=>x.request.previous_review_id===r.previous_review_id),'existing_successor');
  }
  need(!s.runs.some(x=>{
    if(x.phase==='complete')return false;
    const effect=x.max_phase_rank>=4 || x.edit_intent_id || x.edit_operation_id || x.suggestion_manifest || x.report_create_operation_id || x.report_id || /edit_intent|suggestion_intent|report_.*intent/.test(x.last_phase||'');
    const reconciled=x.effects_reconciled?.actor && x.effects_reconciled.at && x.effects_reconciled.reason;
    return !['closed','blocked'].includes(x.phase) || (effect && !reconciled);
  }),'active_or_uncertain_run');
  need(c.active_method===r.method && r.method && c.instruction_id===r.instruction_id,'method_conflict');
  const execution=s.executions.filter(x=>x.execution_id===r.executor_id);
  need(execution.length===1 && execution[0].phase==='complete' && execution[0].task_id===r.task_id && execution[0].deliverable_type===r.deliverable_type,'executor_identity');
  need(execution[0].output_id===r.draft_id || (r.fixture===true && r.draft_origin_id===execution[0].output_id && c.fixture_ids?.includes(r.draft_id)),'draft_identity');
  need(same(r.accepted_source_records,execution[0].accepted_source_records) && r.accepted_source_records?.length,'source_binding');
  const byId=new Map(s.tasks.map(t=>[t.task_id,t]));need(byId.size===s.tasks.length,'duplicate_task');
  const task=byId.get(r.task_id);need(task?.status==='open' && !task.blockers,'task_ineligible');
  const closure=new Set();
  function walk(id,path=[]) {
    need(!path.includes(id),'dependency_cycle');const t=byId.get(id);need(t,'dependency_missing');closure.add(id);
    for(const dep of String(t.dependencies||'').split(/[\s,;]+/).filter(Boolean)) {
      need(/^HM-\d+$/.test(dep) && byId.get(dep)?.status==='done','dependency_incomplete');walk(dep,[...path,id]);
    }
  }
  walk(r.task_id);
  for(const v of s.reviews) {
    let ids;try{ids=JSON.parse(v.candidate_ids||'[]');}catch{throw new Stop('review_unreadable');}
    need(Array.isArray(ids),'review_unreadable');
    need(v.status!=='pending' || ![v.task_id,...ids].some(id=>closure.has(id)),'relevant_decision');
  }
  need(!s.source_journal.some(j=>j.phase!=='complete' && j.affected_task_ids.some(id=>closure.has(id))),'ingestion_interrupted');
  const histories=s.history.filter(h=>closure.has(h.task_id));need(histories.length,'history_missing');
  for(const h of histories) {
    need(s.processed_sources.some(x=>x.source_id===h.source_id),'unprocessed_source');
    need(!s.registry.some(x=>x.source_id===h.source_id && ['failed','changed_requires_review','needs_reconciliation'].includes(x.outcome)),'source_needs_review');
    need(s.sources.some(x=>x.source_id===h.source_id),'source_missing');
  }
  need(s.sources.length>0 && s.sources.length<=8 && unique(s.sources.map(x=>x.file_id)) && s.sources.filter(x=>x.role==='scope').length===1,'sources_missing');
  need(unique(r.accepted_source_records) && same([...r.accepted_source_records].sort(),s.sources.map(x=>x.record_id).sort()),'source_binding');
  let total=0;
  for(const x of s.sources) {
    need(x.access==='readable' && typeof x.text==='string' && x.text.trim(),'source_access');
    need(x.approved==='yes' && x.accepted_by && x.accepted_at && x.accepted_text===x.text && x.accepted_revision===x.revision,'source_changed_or_unaccepted');
    need(x.text.length<=20000,'source_limit');total+=x.text.length;
  }
  need(total<=80000,'source_limit');
  need(s.profile?.confirmed_by && s.profile.confirmed_at && s.profile.id===r.profile_id && s.profile.requirements?.length && unique(s.profile.requirements.map(q=>q.id)),'criteria_unconfirmed');
  for(const q of s.profile.requirements) need(s.sources.some(x=>x.file_id===q.file_id && q.quote?.trim() && x.text.includes(q.quote)),'criteria_evidence');
  need(s.doc?.file_id===r.draft_id && s.doc.revision && typeof s.original_text==='string','draft_unreadable');
  return {action:'review',task_ids:[...closure],
    publication:publicationRoute(r,s.publication_capabilities),
    edit_allowed:r.mode==='correct_supported' && s.comments_complete===true && s.comments.length===0,
    suggestion_allowed:r.mode==='suggest_supported' && s.comments_complete===true};
}

// Explicit canonical native representation; retain character styles but disregard API run splitting.
function nativeValue(x) {
  if(Array.isArray(x))return x.map(nativeValue);
  if(x && typeof x==='object')return Object.fromEntries(Object.keys(x).sort().flatMap(k=>{
    const v=nativeValue(x[k]);return v && typeof v==='object' && !Object.keys(v).length?[]:[[k,v]];
  }));
  return x;
}
function noOpaque(x) {
  if(!x || typeof x!=='object')return;
  for(const [k,v] of Object.entries(x)) {
    need(!(/^suggested/.test(k) && v && Object.keys(v).length),'suggestions_protected');
    need(!(['inlineObjectElement','positionedObjects','footnoteReference','headers','footers','footnotes','richLink','person','dateElement','table','tableOfContents'].includes(k) && v && Object.keys(v).length),'unsupported_native_structure');
    noOpaque(v);
  }
}
function mergeRuns(runs) {
  const out=[];for(const r of runs) {const p=out.at(-1);if(p && same(p.style,r.style))p.text+=r.text;else out.push(clone(r));}return out;
}
export function nativeSnapshot(doc) {
  noOpaque(doc);
  need(doc.documentId && doc.revisionId && doc.tabs?.length===1 && !doc.tabs[0].childTabs?.length,'unsupported_native_tabs');
  const t=doc.tabs[0], body=t.body||t.documentTab?.body;
  need(body && (t.tabId||t.tabProperties?.tabId),'native_tab_missing');
  const paragraphs=[],sections=[];let pos=1;
  for(const e of body.content||[]) {
    if(e.sectionBreak) {sections.push({start:e.startIndex??0,style:nativeValue(e.sectionBreak.sectionStyle||{})});continue;}
    need(e.paragraph && e.startIndex===pos,'unsupported_native_structure');
    const p={start:pos,text:'',style:nativeValue(e.paragraph.paragraphStyle||{}),bullet:nativeValue(e.paragraph.bullet||null),runs:[]};
    for(const run of e.paragraph.elements||[]) {
      need(run.textRun && run.startIndex===pos+p.text.length && run.endIndex===run.startIndex+run.textRun.content.length,'unsupported_native_element');
      p.text+=run.textRun.content;p.runs.push({text:run.textRun.content,style:nativeValue(run.textRun.textStyle||{})});
    }
    need(p.text.endsWith('\n') && !p.text.slice(0,-1).includes('\n') && e.endIndex===pos+p.text.length,'native_paragraph');
    p.runs=mergeRuns(p.runs);paragraphs.push(p);pos+=p.text.length;
  }
  need(paragraphs.length && pos<=20001,'draft_limit');
  return {file_id:doc.documentId,title:doc.title,revision:doc.revisionId,tab_id:t.tabId||t.tabProperties.tabId,
    text:paragraphs.map(p=>p.text).join(''),paragraphs,sections,
    properties:nativeValue({documentStyle:doc.documentStyle||{},namedStyles:doc.namedStyles||{},lists:t.lists||t.documentTab?.lists||doc.lists||{}})};
}
export function sameNative(a,b) {
  if(!a || !b)return false;
  const strip=x=>{const out=clone(x);delete out.revision;return out;};
  return same(strip(a),strip(b));
}
function occurrences(text,part) {let n=0,i=0;while((i=text.indexOf(part,i))>=0){n++;i+=Math.max(part.length,1);}return n;}
export function protection(before, original, appendix='Sources and grounding evidence\n') {
  need(typeof original==='string' && original.length>0,'machine_baseline_missing');
  const originals=original.match(/[^\n]*\n/g)||[];
  const at=before.text.indexOf(appendix);
  need(!original.includes(appendix) || (at>=0 && occurrences(before.text,appendix)===1),'appendix_ambiguous');
  return before.paragraphs.map(p=>({start:p.start,end:p.start+p.text.length,protected:
    (at>=0 && p.start-1>=at) || !p.text.trim() || originals.filter(x=>x===p.text).length!==1 || before.paragraphs.filter(q=>q.text===p.text).length!==1}));
}
export function validateReview(review, profile, sources, draft) {
  need(review && ['fits','mismatch','unclear'].includes(review.task_fit) && Array.isArray(review.checks) && Array.isArray(review.findings),'review_shape');
  need(unique(review.checks.map(q=>q.id)) && review.checks.length===profile.requirements.length && profile.requirements.every(q=>review.checks.some(c=>c.id===q.id)),'coverage_incomplete');
  const appendix=draft.text.indexOf('Sources and grounding evidence\n'), body=appendix<0?draft.text:draft.text.slice(0,appendix);
  for(const c of review.checks) {
    need(['satisfied','missing','conflicting','unclear','not_assessable'].includes(c.status) && c.reason,'coverage_shape');
    const q=profile.requirements.find(q=>q.id===c.id);
    need(c.status!=='satisfied' || q.mode==='prohibition' || (c.passage?.trim() && body.includes(c.passage)),'coverage_body');
    need(c.status!=='not_assessable' || q.mode==='human_layout','coverage_unassessed');
    need(q.mode!=='human_layout' || c.status==='not_assessable','layout_requires_render');
  }
  need(unique(review.findings.map(f=>f.id)) && review.findings.length<=24,'findings_shape');
  for(const f of review.findings) {
    need(f.id && ['missing','contradiction','unsupported','judgment','task_fit'].includes(f.kind) && f.reason && Array.isArray(f.evidence) && f.evidence.length,'finding_shape');
    for(const e of f.evidence)need(sources.some(s=>s.file_id===e.file_id && s.revision===e.revision && e.quote?.trim() && s.text.includes(e.quote)),'finding_evidence');
    need(!f.draft_quote || draft.text.includes(f.draft_quote),'finding_anchor');
    need(f.kind==='missing' || f.kind==='judgment' || f.draft_quote?.trim(),'finding_anchor');
    if(f.requirement_id)need(review.checks.some(c=>c.id===f.requirement_id && !['satisfied','not_assessable'].includes(c.status)),'finding_coverage_conflict');
  }
  for(const c of review.checks.filter(c=>['missing','conflicting','unclear'].includes(c.status)))need(review.findings.some(f=>f.requirement_id===c.id),'finding_missing');
  return review;
}
const TEXT_FIELDS='bold,italic,underline,strikethrough,smallCaps,backgroundColor,foregroundColor,fontSize,weightedFontFamily,baselineOffset,link';
const PARA_FIELDS='namedStyleType,alignment,lineSpacing,direction,spaceAbove,spaceBelow,indentStart,indentEnd,indentFirstLine,keepWithNext,avoidWidowAndOrphan,pageBreakBefore';
const writable=(obj,fields)=>Object.fromEntries(Object.entries(obj).filter(([k])=>fields.split(',').includes(k)));
const boundary=(s,i)=>!(i>0 && i<s.length && /[\uD800-\uDBFF]/.test(s[i-1]) && /[\uDC00-\uDFFF]/.test(s[i]));

// Only single-run replacements and plain paragraph insertions. Everything else stays a finding.
export function planEdits(before, original, review, patches, comments={complete:false,threads:[]}, request) {
  need(request?.enabled===true && request.mode==='correct_supported' && request.authorization && request.requested_by && request.requested_at,'direct_edit_not_authorized');
  need(request.draft_id===before.file_id,'draft_identity');
  return {...planPatches(before,original,review,patches,comments),mode:'correct_supported',request:clone(request)};
}
function planPatches(before, original, review, patches, comments) {
  need(comments.complete===true && comments.threads.length===0,'comments_protected');
  need(review.task_fit==='fits' && patches.length<=8,'edit_ineligible');
  const guards=protection(before,original), expected=clone(before), requests=[];
  need(unique(patches.map(p=>p.finding_id)),'duplicate_patch');
  const built=patches.map(p=>{
    const f=review.findings.find(f=>f.id===p.finding_id);
    need(f && f.kind!=='judgment' && f.kind!=='task_fit' && f.confidence==='high' && f.severity==='must_address' && p.reason && p.support?.length,'edit_ineligible');
    for(const e of p.support)need(f.evidence.some(v=>same(v,e)),'patch_evidence');
    const i=before.paragraphs.findIndex(q=>q.start===p.paragraph_start), q=before.paragraphs[i];
    need(q && !guards[i].protected,'protected_passage');
    need(['replace','delete','insert_before'].includes(p.operation) && typeof p.new_text==='string' &&
      (p.operation==='delete' ? p.new_text==='' : p.new_text.trim()) && !/[\r\n\u0000-\u001f]/.test(p.new_text) && boundary(p.new_text,0),'patch_shape');
    need(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(p.new_text),'utf16_boundary');
    let offset=0,length=0,style={};
    if(p.operation==='replace' || p.operation==='delete') {
      need(p.old_text?.trim() && !p.old_text.includes('\n') && occurrences(q.text,p.old_text)===1 && f.draft_quote?.includes(p.old_text),'ambiguous_anchor');
      offset=q.text.indexOf(p.old_text);length=p.old_text.length;
      need(boundary(q.text,offset) && boundary(q.text,offset+length),'utf16_boundary');
      let pos=0,found=false;for(const r of q.runs) {if(offset>=pos && offset+length<=pos+r.text.length){style=r.style;found=true;}pos+=r.text.length;}
      need(found,'crosses_text_runs');
    } else {
      need(p.old_text==='' && !q.bullet && q.style.namedStyleType==='NORMAL_TEXT' && q.runs.length===1 && !q.runs[0].style.link,'insertion_structure');
      need(!q.style.pageBreakBefore && !q.style.headingId,'insertion_structure');style=q.runs[0].style;
      need(Object.keys(style).every(k=>TEXT_FIELDS.split(',').includes(k)) && Object.keys(q.style).every(k=>PARA_FIELDS.split(',').includes(k)),'insertion_style');
    }
    return {...p,index:i,start:q.start+offset,length,offset,style};
  }).sort((a,b)=>b.start-a.start);
  need(built.reduce((n,p)=>n+p.length+p.new_text.length,0)<=4000,'edit_limit');
  for(let i=1;i<built.length;i++)need(built[i].start+built[i].length<built[i-1].start,'overlapping_patches');
  for(const p of built) {
    const q=expected.paragraphs[p.index], range={tabId:before.tab_id,startIndex:p.start,endIndex:p.start+p.length};
    if(p.operation==='replace' || p.operation==='delete') {
      let pos=0;q.runs=q.runs.map(r=>{const v=clone(r);if(p.offset>=pos && p.offset+p.length<=pos+r.text.length)v.text=r.text.slice(0,p.offset-pos)+p.new_text+r.text.slice(p.offset-pos+p.length);pos+=r.text.length;return v;});
      q.runs=mergeRuns(q.runs);q.text=q.text.slice(0,p.offset)+p.new_text+q.text.slice(p.offset+p.length);
      requests.push({deleteContentRange:{range}});
    } else {
      expected.paragraphs.splice(p.index,0,{start:p.start,text:p.new_text+'\n',style:clone(q.style),bullet:null,runs:[{text:p.new_text+'\n',style:clone(p.style)}]});
    }
    const text=p.new_text+(p.operation==='insert_before'?'\n':'');
    if(text)requests.push({insertText:{location:{tabId:before.tab_id,index:p.start},text}});
    const inserted={tabId:before.tab_id,startIndex:p.start,endIndex:p.start+text.length};
    if(p.operation==='insert_before')requests.push({updateParagraphStyle:{range:inserted,paragraphStyle:writable(q.style,PARA_FIELDS),fields:PARA_FIELDS}});
    // Applying namedStyleType can reset character formatting; set the explicit run style last.
    if(text)requests.push({updateTextStyle:{range:inserted,textStyle:writable(p.style,TEXT_FIELDS),fields:TEXT_FIELDS}});
  }
  let pos=1;for(const p of expected.paragraphs){p.start=pos;pos+=p.text.length;}
  expected.text=expected.paragraphs.map(p=>p.text).join('');
  // Additional section breaks would require index remapping beyond this supported shape.
  need(before.sections.every(s=>s.start===0),'unsupported_sections');
  need(expected.text.length<=20000,'draft_limit');
  return {before,expected,patches:built,requests,write_control:{requiredRevisionId:before.revision}};
}
export function validateCandidate(initial, candidate, selectedIds) {
  need(candidate.task_fit==='fits','candidate_task_fit');
  const fixed=initial.findings.filter(f=>selectedIds.includes(f.id));
  for(const f of fixed) {
    if(f.requirement_id)need(candidate.checks.some(c=>c.id===f.requirement_id && c.status==='satisfied'),'candidate_defect_remains');
    need(!candidate.findings.some(c=>c.requirement_id ? c.requirement_id===f.requirement_id : c.kind===f.kind && c.draft_quote===f.draft_quote),'candidate_defect_remains');
  }
  for(const f of candidate.findings)need(initial.findings.some(old=>!selectedIds.includes(old.id) && old.kind===f.kind && old.requirement_id===f.requirement_id && old.draft_quote===f.draft_quote),'candidate_new_issue');
  return true;
}
export function recoverEdit(plan, actual, decision, request=plan.request) {
  need(request?.enabled===true && request.mode==='correct_supported' && request.authorization && request.requested_by && request.requested_at,'direct_edit_not_authorized');
  need(request.draft_id===plan.before.file_id,'draft_identity');
  if(sameNative(plan.expected,actual))return {action:'verify_and_report_only',draft_id:plan.before.file_id};
  if(sameNative(plan.before,actual) && actual.revision===plan.before.revision && decision?.action==='apply_saved_batch' && decision.actor && decision.reason && decision.at)
    return {action:'apply_saved_batch',draft_id:plan.before.file_id,requiredRevisionId:plan.before.revision};
  return {action:'stop',reason:'preserve_or_inspect_current_document',draft_id:plan.before.file_id};
}
export function projectionWrite(sheetId,rowIndex,current,lastOwned,next) {
  need(current.length===3 && next.length===3,'projection_shape');
  need(current.every(c=>!c.userEnteredValue?.formulaValue && !c.note && !c.dataValidation && !c.chipRuns?.length),'projection_protected');
  const values=current.map(c=>c.userEnteredValue?.stringValue??'');
  need(current.every(c=>!c.userEnteredValue || 'stringValue' in c.userEnteredValue),'projection_protected');
  need((!lastOwned && values.every(x=>!x)) || (lastOwned && same(values,lastOwned)),'projection_conflict');
  return {updateCells:{range:{sheetId,startRowIndex:rowIndex,endRowIndex:rowIndex+1,startColumnIndex:10,endColumnIndex:13},rows:[{values:next.map(v=>({userEnteredValue:{stringValue:v}}))}],fields:'userEnteredValue'}};
}

export function blobParts(id,value) {
  const text=canonical(value);need(id && text.length<=240000,'snapshot_limit');
  const parts=[];for(let i=0;i<text.length;i+=10000)parts.push({protocol:VERSION,blob_id:id,index:parts.length,text:text.slice(i,i+10000)});
  return {parts,manifest:{protocol:VERSION,blob_id:id,count:parts.length,characters:text.length}};
}
export function readBlob(manifest,parts) {
  const selected=parts.filter(p=>p.blob_id===manifest.blob_id).sort((a,b)=>a.index-b.index);
  need(selected.length===manifest.count && selected.every((p,i)=>p.protocol===VERSION && p.index===i),'incomplete_snapshot');
  const text=selected.map(p=>p.text).join('');need(text.length===manifest.characters,'incomplete_snapshot');
  try{return JSON.parse(text);}catch{throw new Stop('incomplete_snapshot');}
}


// Pure publication plans and observed UI evidence, not browser/API execution.
// An explicit request is required; new V2 requests should select suggest_supported.
export function publicationRoute(request, capabilities={}) {
  need(request?.enabled===true && request.authorization && request.requested_by && request.requested_at,'request_authorization');
  if(request.mode==='review_only')return 'none';
  if(request.mode==='correct_supported')return 'guarded_direct';
  need(request.mode==='suggest_supported','request_authorization');
  need(capabilities.browser===true && capabilities.authenticated===true && capabilities.suggesting===true && capabilities.thread_replies===true,'suggestion_capability_unverified');
  return 'browser_suggestions';
}

export function planSuggestions(before, original, review, patches, comments, request, reviewId, capabilities) {
  need(request?.mode==='suggest_supported','publication_mode_conflict');
  publicationRoute(request,capabilities);
  need(request.draft_id===before.file_id && request.version && reviewId,'draft_identity');
  // This optional helper supports an unambiguous clean target only. Existing
  // suggested/opaque text requires browser inspection, never flattened API text.
  const candidate=planPatches(before,original,review,patches,comments);
  const suggestions=candidate.patches.map(p=>{
    const marker=`ENFORCER:${reviewId}:${p.finding_id}`;
    const support=p.support.map(e=>`https://docs.google.com/document/d/${encodeURIComponent(e.file_id)}/edit (accepted revision ${e.revision}): ${e.quote}`).join('\n');
    return {marker,finding_id:p.finding_id,operation:p.operation,paragraph_start:p.paragraph_start,
      before_passage:before.paragraphs[p.index].text,old_text:p.old_text,new_text:p.new_text,
      rationale:`[${marker}]\nWhy: ${p.reason}\nSource support:\n${support}\nUncertainty/judgment: ${p.uncertainty || 'No unresolved judgment identified for this bounded change.'}\nDecision requested: Accept or reject this pending suggestion.`};
  });
  return {mode:'suggest_supported',route:'browser_suggestions',draft_id:before.file_id,tab_id:before.tab_id,
    request:clone(request),review_id:reviewId,before:clone(before),candidate:candidate.expected,suggestions};
}

function inspectSuggestion(plan, item, observation) {
  need(observation?.reloaded===true && observation.draft_id===plan.draft_id && observation.tab_id===plan.tab_id && observation.observed_at && observation.fresh_inputs===true,'suggestion_observation_incomplete');
  need(observation.inventory_complete===true && Array.isArray(observation.threads),'suggestion_inventory_incomplete');
  const matches=observation.threads.filter(t=>t.marker===item.marker);
  need(matches.length===1,'suggestion_missing_or_duplicate');
  const t=matches[0];
  need(t.kind==='suggestion' && t.state==='pending' && t.accept_control===true && t.reject_control===true,'suggestion_not_pending');
  need(t.old_text===item.old_text && t.new_text===item.new_text && t.before_passage===item.before_passage,'suggestion_target_changed');
  need(t.replies_complete===true && Array.isArray(t.replies),'suggestion_replies_incomplete');
  need(t.thread_id || (observation.screenshot && Number.isInteger(t.observed_reply_count) && t.observed_reply_count===t.replies.length),'suggestion_evidence_missing');
  return t;
}

export function verifySuggestions(plan, observation) {
  need(plan.mode==='suggest_supported' && plan.request.mode==='suggest_supported','publication_mode_conflict');
  need(plan.suggestions.length>0,'suggestions_missing');
  const threads=plan.suggestions.map(item=>{
    const t=inspectSuggestion(plan,item,observation);
    const replies=t.replies.filter(r=>r.text.includes(`[${item.marker}]`));
    need(replies.length===1 && replies[0].text===item.rationale,'rationale_missing_or_duplicate');
    need((t.thread_id && replies[0].reply_id) || observation.screenshot,'suggestion_evidence_missing');
    return {marker:item.marker,thread_id:t.thread_id??null,reply_id:replies[0].reply_id??null,
      observed_reply_count:t.replies.length,old_text:item.old_text,new_text:item.new_text,rationale:item.rationale};
  });
  return {phase:'suggestions_pending_human_review',outcome:'suggestions_pending_human_review',
    draft_id:plan.draft_id,review_id:plan.review_id,observed_at:observation.observed_at,
    screenshot:observation.screenshot??null,threads};
}

export function recoverSuggestions(plan, observation) {
  try {
    need(plan.mode==='suggest_supported' && plan.request.mode==='suggest_supported' && plan.suggestions.length>0,'publication_mode_conflict');
    const missing=[];
    for(const item of plan.suggestions) {
      const t=inspectSuggestion(plan,item,observation);
      const replies=t.replies.filter(r=>r.text.includes(`[${item.marker}]`));
      if(replies.length===0)missing.push({marker:item.marker,thread_id:t.thread_id??null,rationale:item.rationale});
      else need(replies.length===1 && replies[0].text===item.rationale,'rationale_missing_or_duplicate');
    }
    if(missing.length)return {action:'reply_to_existing_suggestions_only',draft_id:plan.draft_id,missing};
    return {action:'report_or_return_only',verification:verifySuggestions(plan,observation)};
  } catch(error) {
    return {action:'stop',reason:error.code||'suggestion_reconciliation_required',draft_id:plan.draft_id};
  }
}
