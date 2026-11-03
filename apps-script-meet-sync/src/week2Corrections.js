function previewArroyoCorrection(){
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    var book=getBoardBook(),key='correction:'+WEEK2_IDS[0],existing=week2Records(book,'Source Journal')[key];
    if(existing)return {phase:existing.phase,added:existing.added,dismissed:existing.dismissed};
    var source=readWeek2Source(WEEK2_IDS[0]),state=week2State(book),extracted=proposeWeek2(source,state),merged=planWeek2Merge(state,source,extracted.proposal,new Date().toISOString());
    if(merged.added!==2||merged.updated!==0||merged.reviews.length!==0)throw new Error('correction_plan_requires_inspection');
    var audit={actor:Session.getActiveUser().getEmail()||'facilitator',reason:'Proposed separate Arroyo work and dismissal of incorrect legacy matches; awaiting facilitator approval',confirmed:false,action:'dismiss'};
    merged.histories.forEach(function(h){h.key='correction:'+h.key;h.correction_audit=audit;});
    var ops=week2PlanOperations(book,source,week2Fingerprint(source),merged,extracted.evidence,state).filter(function(o){return !['Source Registry','Processed Sources'].includes(o.sheet);});
    var reviews=week2Records(book,'Merge Reviews'),dismissed=[];
    Object.keys(reviews).forEach(function(k){var r=reviews[k];if(r.source_id!==source.id||r.type!=='missing_baseline'||!['HM-0007','HM-0008','HM-0009'].includes(r.task_id))return;r.state='resolved';r.decision=audit;r.resolved_at=new Date().toISOString();var rows=dataRows(week2Table(book,'Merge Reviews'),2),index=rows.findIndex(function(row){return row[0]===k;});ops.push(week2Operation(book,'Merge Reviews',index+2,1,[[k,JSON.stringify(r)]]));dismissed.push(k);});
    if(dismissed.length!==5)throw new Error('unexpected_correction_review_count');
    var journal={source_id:key,phase:'awaiting-human',fingerprint:week2Fingerprint(source),evidence:extracted.evidence,taskIds:merged.taskIds,operations:ops,added:2,dismissed:5,audit:audit};week2Put(book,'Source Journal',key,journal);
    return {phase:journal.phase,added:2,dismissed:5,newTasks:merged.rows.slice(state.rows.length).map(function(r){return {id:r[0],task:r[1],owner:r[2],due:r[5],status:r[3],dependency:r[8]};}),evidence:extracted.evidence};
  }finally{lock.releaseLock();}
}
function applyArroyoCorrection(confirmation,previewEvidence){
  if(confirmation!=='APPROVE_ARROYO_CORRECTION')throw new Error('explicit_confirmation_required');
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try{var book=getBoardBook(),key='correction:'+WEEK2_IDS[0],j=week2Records(book,'Source Journal')[key];if(!j)throw new Error('preview_required');if(j.phase==='complete')return {outcome:'already-corrected'};if(j.phase!=='awaiting-human')throw new Error('inspect_recovery_required');var currentSource=readWeek2Source(WEEK2_IDS[0]),fingerprint=week2Fingerprint(currentSource);if(fingerprint!==(j.fingerprint||week2Records(book,'Source Registry')[WEEK2_IDS[0]].fingerprint))throw new Error('source_changed_since_preview');j.fingerprint=fingerprint;if(!j.evidence){if(!previewEvidence||previewEvidence.http_status!==200||!/^chatcmpl-/.test(previewEvidence.response_id)||typeof previewEvidence.model!=='string')throw new Error('preview_evidence_required');j.evidence=previewEvidence;}j.audit={actor:Session.getActiveUser().getEmail()||'facilitator',reason:'Facilitator explicitly approved the displayed Arroyo correction',confirmed:true,action:'dismiss',at:new Date().toISOString()};j.operations.forEach(function(op){if(['Task History','Merge Reviews'].includes(op.sheet)){var record=JSON.parse(op.after[0][1]);if(record.correction_audit)record.correction_audit=j.audit;if(record.decision)record.decision=j.audit;op.after[0][1]=JSON.stringify(record);}});j.phase='planned';week2Put(book,'Source Journal',key,j);SpreadsheetApp.flush();try{week2ApplyOperations(book,j);}catch(e){j.phase='needs-reconciliation';week2Put(book,'Source Journal',key,j);throw new Error('needs_reconciliation');}return {outcome:'corrected',added:j.added,dismissed:j.dismissed,completion_records_unchanged:true};}finally{lock.releaseLock();}
}

// Human-approved wording maintenance, separate from transcript processing.
function applyWeek2WordingCorrection(key,edits,decision){
  if(!/^[a-z0-9_-]+$/i.test(key)||!Array.isArray(edits)||!edits.length||!decision||decision.confirmed!==true||!decision.actor||!decision.reason)throw new Error('explicit_wording_approval_required');
  var lock=LockService.getScriptLock();lock.waitLock(30000);try{
    var book=getBoardBook(),journalKey='wording:'+key,existing=week2Records(book,'Source Journal')[journalKey];
    if(existing){if(JSON.stringify(existing.edits)!==JSON.stringify(edits))throw new Error('correction_key_reused');if(existing.phase!=='complete')throw new Error('needs_reconciliation');return {outcome:'already-corrected'};}
    var state=week2State(book),now=new Date().toISOString(),ops=[],changed={},audit={key:journalKey,at:now,decision:decision,edits:edits,before:[],after:[],review_refreshes:[]};
    edits.forEach(function(edit){var at=state.rows.findIndex(function(r){return r[0]===edit.task_id;}),base=state.baselines[edit.task_id];
      if(at<0||changed[edit.task_id]||!base||typeof edit.task!=='string'||!edit.task.trim()||state.rows[at][1]!==edit.expected||base.fields.task!==edit.expected||state.formulas[edit.task_id][1]||(state.blockedTaskIds||[]).includes(edit.task_id))throw new Error('wording_precondition_failed');
      var before=state.rows[at].slice(),after=before.slice();after[1]=safeCell(edit.task);after[15]=now;changed[edit.task_id]={before:before,after:after};audit.before.push(before);audit.after.push(after);
      ops.push(week2Operation(book,'Master Action Board',at+2,2,[[after[1]]]));ops.push(week2Operation(book,'Master Action Board',at+2,16,[[now]]));
      var next=JSON.parse(JSON.stringify(base));next.fields.task=after[1];var bases=dataRows(sheetByName(book,'Task Baselines'),2),bi=bases.findIndex(function(r){return r[0]===edit.task_id;});ops.push(week2Operation(book,'Task Baselines',bi+2,1,[[edit.task_id,JSON.stringify(next)]]));
    });
    var reviewRows=dataRows(sheetByName(book,'Merge Reviews'),2);reviewRows.forEach(function(row,i){var review=JSON.parse(row[1]);if(review.state!=='pending')return;var original=JSON.parse(JSON.stringify(review)),touched=false;
      Object.keys(review.candidate_snapshots||{}).forEach(function(id){if(!changed[id])return;var expected={values:changed[id].before.map(w2Scalar),formulas:state.formulas[id]};if(JSON.stringify(expected)!==JSON.stringify(review.candidate_snapshots[id]))throw new Error('stale_review');review.candidate_snapshots[id]={values:changed[id].after.map(w2Scalar),formulas:state.formulas[id]};touched=true;});
      if(touched){audit.review_refreshes.push({before:original,after:review});ops.push(week2Operation(book,'Merge Reviews',i+2,1,[[row[0],JSON.stringify(review)]]));}
    });
    ops.push(week2Operation(book,'Task History',sheetByName(book,'Task History').getLastRow()+1,1,[[journalKey,JSON.stringify(audit)]]));
    var journal={source_id:journalKey,taskIds:Object.keys(changed),phase:'planned',edits:edits,decision:decision,operations:ops};week2Put(book,'Source Journal',journalKey,journal);SpreadsheetApp.flush();
    try{week2ApplyOperations(book,journal);}catch(e){journal.phase='needs-reconciliation';week2Put(book,'Source Journal',journalKey,journal);throw new Error('needs_reconciliation');}
    return {outcome:'corrected',task_ids:Object.keys(changed),pending_reviews_resolved:0};
  }finally{lock.releaseLock();}
}
