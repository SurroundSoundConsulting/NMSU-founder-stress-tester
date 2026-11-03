var W2_TABLES={'Task Baselines':['key','json'],'Task History':['key','json'],'Merge Reviews':['key','json'],'Source Registry':['key','json'],'Source Journal':['key','json'],'Run Log':['key','json'],'OKR Registry':['code','description'],'View Settings':['setting','value']};
function week2Table(book,name){return ensureTab(book,name,W2_TABLES[name]);}
function week2Records(book,name){var out={};dataRows(week2Table(book,name),2).forEach(function(r){if(r[0]){if(out[r[0]])throw new Error('duplicate_state_key');out[r[0]]=JSON.parse(r[1]);}});return out;}
function week2Put(book,name,key,record){var sheet=week2Table(book,name),rows=dataRows(sheet,2),i=rows.findIndex(function(r){return r[0]===key;}),row=i<0?sheet.getLastRow()+1:i+2;sheet.getRange(row,1,1,2).setValues([[key,JSON.stringify(record)]]);}
function week2State(book){
  var sheet=sheetByName(book,'Master Action Board'),rows=dataRows(sheet,16),formulas={},grid=rows.length?sheet.getRange(2,1,rows.length,16).getFormulas():[];
  rows.forEach(function(r,i){formulas[r[0]]=grid[i];});
  var blocked=[];Object.values(week2Records(book,'Source Journal')).forEach(function(j){if(j.phase!=='complete')blocked=blocked.concat(j.taskIds||[]);});
  return {rows:rows,formulas:formulas,baselines:week2Records(book,'Task Baselines'),objectives:dataRows(week2Table(book,'OKR Registry'),2).map(function(r){return r[0];}),blockedTaskIds:blocked};
}
function week2Capture(book){var names=['Master Action Board','Processed Sources'].concat(Object.keys(W2_TABLES).filter(function(n){return n!=='Run Log'&&n!=='View Settings'&&n!=='OKR Registry';})),out={};names.forEach(function(n){var s=sheetByName(book,n);if(s){var width=n==='Master Action Board'?16:n==='Processed Sources'?4:2,count=s.getLastRow();out[n]={values:count?s.getRange(1,1,count,width).getValues():[],formulas:count?s.getRange(1,1,count,width).getFormulas():[]};}});return out;}
function week2Operation(book,name,row,col,after){var range=sheetByName(book,name).getRange(row,col,after.length,after[0].length);return {sheet:name,row:row,col:col,before:range.getValues(),formulas:range.getFormulas(),after:after};}
function week2PlanOperations(book,source,fingerprint,merged,evidence,planningState){
  var operations=[],current=planningState||week2State(book),latest=week2State(book),board=sheetByName(book,'Master Action Board');
  if(JSON.stringify(latest.rows)!==JSON.stringify(current.rows)||JSON.stringify(latest.formulas)!==JSON.stringify(current.formulas)||JSON.stringify(latest.baselines)!==JSON.stringify(current.baselines))throw new Error('intervening_edit_before_commit');
  merged.rows.forEach(function(row,i){if(i>=current.rows.length){var append=week2Operation(book,'Master Action Board',i+2,1,[row]);append.before=[Array(16).fill('')];append.formulas=[Array(16).fill('')];operations.push(append);return;}row.forEach(function(v,col){if(!w2Equal(v,current.rows[i][col])){var op=week2Operation(book,'Master Action Board',i+2,col+1,[[v]]);op.before=[[current.rows[i][col]]];op.formulas=[[(current.formulas[row[0]]||[])[col]||'']];operations.push(op);}});});
  function records(name,entries){var old=dataRows(week2Table(book,name),2),next=old.length+2;entries.forEach(function(pair){var index=old.findIndex(function(r){return r[0]===pair[0];}),value=JSON.stringify(pair[1]);if(index>=0&&old[index][1]===value)return;operations.push(week2Operation(book,name,index>=0?index+2:next++,1,[[pair[0],value]]));});}
  records('Task Baselines',Object.keys(merged.baselines).map(function(id){return [id,merged.baselines[id]];}));
  records('Task History',merged.histories.map(function(h){return [h.key,h];}));
  records('Merge Reviews',merged.reviews.map(function(r){return [r.key,r];}));
  records('Source Registry',[[source.id,{id:source.id,url:source.url,title:source.title,date:source.date,fingerprint:fingerprint,fingerprint_version:2,project:source.project||'',intake_metadata:source.intake_metadata||null,outcome:'processed',evidence:evidence}]]);
  var ledger=sheetByName(book,'Processed Sources');
  operations.push(week2Operation(book,'Processed Sources',ledger.getLastRow()+1,1,[[source.id,new Date().toISOString(),merged.added,JSON.stringify(evidence)]]));
  return operations;
}
function week2ApplyOperations(book,journal){
  journal.operations.forEach(function(op){
    var range=sheetByName(book,op.sheet).getRange(op.row,op.col,op.after.length,op.after[0].length),actual=JSON.stringify(range.getValues()),formulas=range.getFormulas();
    if(actual===JSON.stringify(op.after)&&formulas.every(function(r){return r.every(function(f){return !f;});}))return;
    if(actual!==JSON.stringify(op.before)||JSON.stringify(formulas)!==JSON.stringify(op.formulas))throw new Error('intervening_edit_needs_reconciliation');
    if(!op.allowFormula&&formulas.some(function(r){return r.some(Boolean);}))throw new Error('formula_needs_reconciliation');
    range.setNumberFormat('@');range.setValues(op.after);SpreadsheetApp.flush();
  });
  journal.phase='complete';week2Put(book,'Source Journal',journal.source_id,journal);
}
function week2Commit(book,source,fingerprint,merged,evidence,planningState){
  var journal={source_id:source.id,fingerprint:fingerprint,taskIds:merged.taskIds,phase:'planned',operations:week2PlanOperations(book,source,fingerprint,merged,evidence,planningState)};
  week2Put(book,'Source Journal',source.id,journal);SpreadsheetApp.flush();
  try{week2ApplyOperations(book,journal);}catch(e){journal.phase='needs-reconciliation';journal.error='write_interrupted';week2Put(book,'Source Journal',source.id,journal);throw new Error('needs_reconciliation');}
}
function setupWeek2(){
  var book=getBoardBook();setupBoard();Object.keys(W2_TABLES).forEach(function(n){week2Table(book,n);});
  var props=PropertiesService.getScriptProperties();if(!props.getProperty('INPUT_FOLDER_ID'))props.setProperty('INPUT_FOLDER_ID',WEEK2_FOLDER);
  var settings=week2Table(book,'View Settings');if(settings.getLastRow()===1){settings.getRange(2,1,3,2).setNumberFormat('@');settings.getRange(2,1,3,2).setValues([['reference_date','2026-11-04'],['owner',''],['okr','']]);}
  return {spreadsheetUrl:book.getUrl(),oldTaskCount:dataRows(sheetByName(book,'Master Action Board'),16).length,oldCompletionCount:dataRows(sheetByName(book,'Processed Sources'),4).length,limits:WEEK2_LIMITS};
}
function week2ProcessOne(id,expected){
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    var book=getBoardBook(),journals=week2Records(book,'Source Journal');
    if(journals[id]&&journals[id].phase!=='complete')return {source:id,outcome:'needs-reconciliation',extractions:0};
    var source=readWeek2Source(id),fingerprint=week2Fingerprint(source),registry=week2Records(book,'Source Registry'),old=registry[id];
    if(old&&old.fingerprint===fingerprint)return {source:id,outcome:'skipped',extractions:0,added:0,updated:0,reviews:0};
    if(old){
      var key=id+':changed:'+fingerprint,record={key:key,type:'changed_source',source_id:id,fingerprint:fingerprint,previous:old.fingerprint,state:'pending',decision:null};
      var reviews=week2Records(book,'Merge Reviews');if(!reviews[key]){var sheet=week2Table(book,'Merge Reviews');var j={source_id:key,phase:'planned',taskIds:[],operations:[week2Operation(book,'Merge Reviews',sheet.getLastRow()+1,1,[[key,JSON.stringify(record)]])]};week2Put(book,'Source Journal',key,j);week2ApplyOperations(book,j);}
      return {source:id,outcome:'changed-needs-review',extractions:0};
    }
    var state=week2State(book),extracted=proposeWeek2(source,state),merged=planWeek2Merge(state,source,extracted.proposal,new Date().toISOString());
    if(expected&&['added','updated'].some(function(k){return merged[k]!==expected[k];})||expected&&merged.reviews.length!==expected.reviews)return {source:id,outcome:'failed',reason:'stage_acceptance_failed',extractions:1,expected:expected,planned:{added:merged.added,updated:merged.updated,reviews:merged.reviews.length},proposal:extracted.proposal,evidence:extracted.evidence,reviews:merged.reviews};
    week2Commit(book,source,fingerprint,merged,extracted.evidence,state);
    return {source:id,outcome:'processed',extractions:1,added:merged.added,updated:merged.updated,reviews:merged.reviews.length,evidence:extracted.evidence,taskIds:merged.taskIds};
  }finally{lock.releaseLock();}
}
function processSelectedWeek2(){var id=PropertiesService.getScriptProperties().getProperty('SELECTED_FILE_ID');if(!id)throw new Error('Set SELECTED_FILE_ID');return week2ProcessOne(id);}
function processWeek2A(){return processWeek2Batch([WEEK2_IDS[0]],{added:5,updated:0,reviews:0});}
function processWeek2B(){return processWeek2Batch([WEEK2_IDS[1]],{added:1,updated:1,reviews:0});}
function processWeek2C(){return processWeek2Batch([WEEK2_IDS[2]],{added:0,updated:3,reviews:2});}
function processWeek2D(){return processWeek2Batch([WEEK2_IDS[3]],{added:0,updated:0,reviews:0});}
function processAllWeek2(){return processWeek2Batch(WEEK2_IDS);}
function processWeek2Batch(ids,expected){
  if(!Array.isArray(ids)||ids.length>WEEK2_LIMITS.folder_files)throw new Error('source_count_limit');
  var start=Date.now(),attempts=0,out=[];
  ids.forEach(function(id){
    if(attempts>=WEEK2_LIMITS.attempts||Date.now()-start>WEEK2_LIMITS.runtime_ms){
      var reg=week2Records(getBoardBook(),'Source Registry');if(!reg[id]){out.push({source:id,outcome:'deferred',reason:'budget',extractions:0});return;}
    }
    var props=PropertiesService.getScriptProperties(),requestsBefore=Number(props.getProperty('W2_MODEL_REQUESTS')||0);
    var result;try{result=week2ProcessOne(id,expected);}catch(e){result={source:id,outcome:String(e.message).includes('deferred')?'deferred':String(e.message).includes('reconciliation')?'needs-reconciliation':'failed',reason:String(e.message).match(/^[a-z_0-9]+$/)?e.message:'validation_or_read_error',extractions:0};if(e.diagnostic){result.proposal=e.diagnostic.proposal;result.evidence=e.diagnostic.evidence;}}
    result.model_requests=Number(props.getProperty('W2_MODEL_REQUESTS')||0)-requestsBefore;
    if(result.outcome!=='skipped'&&result.outcome!=='changed-needs-review'&&result.outcome!=='needs-reconciliation')attempts++;
    out.push(result);
  });
  var run={id:Utilities.getUuid(),at:new Date().toISOString(),outcomes:out};week2Put(getBoardBook(),'Run Log',run.id,run);return run;
}
function processWeek2Folder(){var folder=PropertiesService.getScriptProperties().getProperty('INPUT_FOLDER_ID')||WEEK2_FOLDER;var listing=week2Google('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent("'"+folder+"' in parents and trashed=false and mimeType='application/vnd.google-apps.document'")+'&pageSize=100&fields=files(id),nextPageToken');if(listing.nextPageToken)throw new Error('folder_limit_deferred');return processWeek2Batch(listing.files.map(function(f){return f.id;}));}
function inspectWeek2Recovery(id){var book=getBoardBook(),j=week2Records(book,'Source Journal')[id];if(!j)throw new Error('journal_not_found');return {journal:j,actual:j.operations.map(function(op){var r=sheetByName(book,op.sheet).getRange(op.row,op.col,op.after.length,op.after[0].length);return {sheet:op.sheet,row:op.row,col:op.col,values:r.getValues(),formulas:r.getFormulas()};})};}
function recoverWeek2Source(id,confirmation){if(confirmation!=='INSPECTED_SAFE_TO_FINISH')throw new Error('explicit_recovery_confirmation_required');var lock=LockService.getScriptLock();lock.waitLock(30000);try{var book=getBoardBook(),j=week2Records(book,'Source Journal')[id];if(!j)throw new Error('journal_not_found');if(!['planned','needs-reconciliation','complete'].includes(j.phase))throw new Error('human_approval_required');week2ApplyOperations(book,j);return {source:id,outcome:'recovered'};}finally{lock.releaseLock();}}

// Explicit one-time upgrade for records created before Project was fingerprinted.
// Original fingerprint/evidence and all source journals remain available.
function upgradeWeek2Fingerprints(){
  var lock=LockService.getScriptLock();lock.waitLock(30000);try{
    var book=getBoardBook(),registry=week2Records(book,'Source Registry'),history=Object.values(week2Records(book,'Task History')),plans=[];
    Object.keys(registry).forEach(function(id){var record=registry[id];if(record.fingerprint_version===2)return;
      var source=readWeek2Source(id),projects=history.filter(function(h){return h.source_id===id&&h.identity;}).map(function(h){return h.identity.project.toLowerCase();});
      if(record.fingerprint!==week2LegacyFingerprint(source)||!projects.length||projects.some(function(p){return p!==source.project.toLowerCase();}))throw new Error('legacy_fingerprint_needs_review');
      var next=JSON.parse(JSON.stringify(record));next.legacy_fingerprint=record.fingerprint;next.fingerprint=week2Fingerprint(source);next.fingerprint_version=2;next.project=source.project;next.fingerprint_upgrade={at:new Date().toISOString(),reason:'Include Project header; legacy content and recorded project identities verified'};plans.push([id,next]);
    });
    plans.forEach(function(p){week2Put(book,'Source Registry',p[0],p[1]);});return {upgraded:plans.map(function(p){return p[0];}),extractions:0};
  }finally{lock.releaseLock();}
}
