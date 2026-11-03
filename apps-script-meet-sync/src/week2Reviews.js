function resolveWeek2Review(key,decision){
  if(!decision||decision.confirmed!==true||!decision.actor||!decision.reason||!['keep','apply','link','create','dismiss'].includes(decision.action))throw new Error('explicit_human_decision_required');
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    var book=getBoardBook(),pending=week2Records(book,'Source Journal')['resolution:'+key];if(pending&&pending.phase!=='complete')throw new Error('needs_reconciliation');
    var reviews=week2Records(book,'Merge Reviews'),review=reviews[key];if(!review)throw new Error('review_not_found');
    if(review.state==='resolved'){if(JSON.stringify(review.decision)!==JSON.stringify(decision))throw new Error('different_resolution_already_applied');return {outcome:'already-resolved'};}
    var state=week2State(book),ops=[],id=review.task_id,index=state.rows.findIndex(function(r){return r[0]===id;}),now=new Date().toISOString();
    Object.keys(review.candidate_snapshots||{}).forEach(function(candidate){var r=state.rows.find(function(row){return row[0]===candidate;});var actual={values:r?r.map(w2Scalar):null,formulas:state.formulas[candidate]||Array(16).fill('')};if(JSON.stringify(actual)!==JSON.stringify(review.candidate_snapshots[candidate]))throw new Error('stale_review');});
    if(review.field){var col=HEADERS.indexOf(review.field);if(index<0||!w2Equal(state.rows[index][col],review.current)||((state.formulas[id]||[])[col]||'')!==(review.current_formula||''))throw new Error('stale_review');}
    if(decision.action==='apply'){
      if(!review.field||review.proposed==null||review.type==='changed_source')throw new Error('unsupported_apply');
      var col=HEADERS.indexOf(review.field);var approved=week2Operation(book,'Master Action Board',index+2,col+1,[[safeCell(review.proposed)]]);approved.allowFormula=true;ops.push(approved);ops.push(week2Operation(book,'Master Action Board',index+2,16,[[now]]));
      var baseline=state.baselines[id]||{identity:{action:'human-confirmed',deliverable:state.rows[index][1],project:'legacy',audience:'human-confirmed'},fields:{},dates:{}};
      baseline.fields[review.field]=safeCell(review.proposed);baseline.dates[review.field]=review.date;
      var table=week2Table(book,'Task Baselines'),bs=dataRows(table,2),at=bs.findIndex(function(r){return r[0]===id;});ops.push(week2Operation(book,'Task Baselines',at<0?table.getLastRow()+1:at+2,1,[[id,JSON.stringify(baseline)]]));
    }
    if(decision.action==='link'){if(!review.candidate_ids.includes(decision.task_id)||!state.rows.some(function(r){return r[0]===decision.task_id;}))throw new Error('invalid_link_target');id=decision.task_id;}
    if(decision.action==='create'){
      var task=decision.task;if(!task||!task.task||typeof task.task!=='string'||(task.due_date&&!validDate(task.due_date)))throw new Error('invalid_confirmed_task');
      var max=state.rows.reduce(function(n,r){var m=/^HM-(\d+)$/.exec(r[0]);return m?Math.max(n,+m[1]):n;},0);id='HM-'+String(max+1).padStart(4,'0');
      var full={task:task.task,owner:task.owner||'',status:'open',urgency:0,due_date:task.due_date||'',next_step:'',blockers:'',dependencies:'',okr_link:'',risk_flag:''};
      ops.push(week2Operation(book,'Master Action Board',state.rows.length+2,1,[buildRow(full,{id:review.source_id,title:'Human-confirmed follow-up',date:review.date},id,now)]));
    }
    review.state='resolved';review.decision=decision;review.resolved_at=now;
    var rows=dataRows(week2Table(book,'Merge Reviews'),2),at=rows.findIndex(function(r){return r[0]===key;});ops.push(week2Operation(book,'Merge Reviews',at+2,1,[[key,JSON.stringify(review)]]));
    var event={key:'resolution:'+key,task_id:id||'',review_key:key,decision:decision,at:now},hist=week2Table(book,'Task History');ops.push(week2Operation(book,'Task History',hist.getLastRow()+1,1,[[event.key,JSON.stringify(event)]]));
    var journal={source_id:event.key,phase:'planned',taskIds:id?[id]:[],operations:ops};week2Put(book,'Source Journal',event.key,journal);SpreadsheetApp.flush();
    try{week2ApplyOperations(book,journal);}catch(e){journal.phase='needs-reconciliation';week2Put(book,'Source Journal',event.key,journal);throw new Error('needs_reconciliation');}
    return {outcome:'resolved',action:decision.action,task_id:id||''};
  }finally{lock.releaseLock();}
}

// Enrich unresolved candidate suggestions; leaves the decision pending and retains the original record.
function enrichWeek2PendingReviews(){var lock=LockService.getScriptLock();lock.waitLock(30000);try{
  var book=getBoardBook(),state=week2State(book),reviews=week2Records(book,'Merge Reviews'),updated=[];if(Object.values(week2Records(book,'Source Journal')).some(function(j){return j.source_id.indexOf('candidate-enrichment:')===0&&j.phase!=='complete';}))throw new Error('needs_reconciliation');
  Object.keys(reviews).forEach(function(key){var old=reviews[key];if(old.state!=='pending'||old.type!=='clarification')return;
    var registry=week2Records(book,'Source Registry')[old.source_id],source=readWeek2Source(old.source_id);
    if(!registry||registry.fingerprint!==week2Fingerprint(source))throw new Error('review_source_changed');
    var ids=Array.from(new Set(old.candidate_ids.concat(week2ReviewCandidates(old.quotes,source.project,state.baselines))));if(ids.length===old.candidate_ids.length)return;
    var next=JSON.parse(JSON.stringify(old));next.candidate_ids=ids;next.candidate_snapshots={};ids.forEach(function(id){next.candidate_snapshots[id]={values:state.rows.find(function(r){return r[0]===id;}).map(w2Scalar),formulas:state.formulas[id]};});
    var event={key:'candidate-enrichment:'+key+':'+Utilities.getUuid(),source_id:old.source_id,reason:'Ground candidate suggestions in quoted deliverable terms; unresolved request remains pending',before:old,after:next,at:new Date().toISOString()};
    var journal={source_id:event.key,taskIds:[],phase:'planned',operations:[week2Operation(book,'Task History',sheetByName(book,'Task History').getLastRow()+1,1,[[event.key,JSON.stringify(event)]]),week2Operation(book,'Merge Reviews',dataRows(sheetByName(book,'Merge Reviews'),2).findIndex(function(r){return r[0]===key;})+2,1,[[key,JSON.stringify(next)]])]};
    week2Put(book,'Source Journal',journal.source_id,journal);week2ApplyOperations(book,journal);updated.push(key);
  });return {enriched:updated,decisions_resolved:0,extractions:0};
}finally{lock.releaseLock();}}
