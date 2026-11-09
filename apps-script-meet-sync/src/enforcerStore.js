// Enforcer owns only its two tables and Drafts K:M. Never ingestion or Executor records.
var ENFORCER_TABLES = {
  'Enforcer Requests':['request_id','execution_id','draft_id','version','enabled','profile_json','profile_hash','confirmed_by','confirmed_at','reviewer','requested_by','requested_at','previous_review_id','reason','draft_origin_id'],
  'Enforcer Journal':['event_id','review_key','sequence','previous_hash','event_json','event_hash']
};
var ENFORCER_HEADERS = ['Review status','Review next step','Review report'];
function enforcerError(code) { var e = new Error('Enforcer '+code); e.enforcerCode = code; throw e; }
function enforcerReason(e) { return e.enforcerCode || executorReason(e); }
function enforcerConfig(options) {
  var p = PropertiesService.getScriptProperties(), id = (options || {}).spreadsheetId || p.getProperty('ENFORCER_SPREADSHEET_ID');
  var protectedIds = (p.getProperty('ENFORCER_PROTECTED_SPREADSHEET_IDS') || '').split(',').map(function(v) { return v.trim(); }).filter(Boolean);
  if (!executorId(id) || !protectedIds.length || protectedIds.indexOf(id) >= 0) enforcerError('protected_destination');
  var c = {spreadsheetId:id,root:p.getProperty('ENFORCER_FOLDER_ID'),outputs:p.getProperty('ENFORCER_REPORT_FOLDER_ID'),fixtures:p.getProperty('ENFORCER_TEST_FOLDER_ID') || '',testMode:p.getProperty('ENFORCER_TEST_MODE') === 'yes'};
  if (!executorId(c.root) || !executorId(c.outputs) || c.root === c.outputs || (c.testMode && (!executorId(c.fixtures) || [c.root,c.outputs].indexOf(c.fixtures) >= 0))) enforcerError('configuration');
  return c;
}
function enforcerRead(book, name) { return executorUnique(executorRows(book,name,ENFORCER_TABLES[name])); }
function enforcerRequests(book) { return enforcerRead(book,'Enforcer Requests').map(function(row) { return executorObject(ENFORCER_TABLES['Enforcer Requests'],row); }); }
function enforcerSelect(book, options) {
  var id = (options || {}).requestId || PropertiesService.getScriptProperties().getProperty('ENFORCER_SELECTED_REQUEST_ID');
  var rows = enforcerRequests(book).filter(function(r) { return id ? r.request_id === id : r.enabled === 'yes'; });
  if (rows.length !== 1) enforcerError('select_request');
  return rows[0];
}
function enforcerKey(c, r) { return executorHash([c.spreadsheetId,r.execution_id,r.draft_id,String(r.version)]); }
function enforcerHistory(book) {
  var all = {};
  enforcerRead(book,'Enforcer Journal').forEach(function(row) {
    var h = all[row[1]] || {hash:'',sequence:0,events:[]}, event;
    if (row[2] !== h.sequence+1 || row[3] !== h.hash || row[5] !== executorHash(row.slice(0,5))) enforcerError('journal_integrity');
    try { event = JSON.parse(row[4]); } catch (_) { enforcerError('journal_integrity'); }
    if (!executorId(event.review_id) || row[0] !== event.review_id+':'+row[2] || (h.id && h.id !== event.review_id)) enforcerError('journal_integrity');
    h.id = event.review_id; h.sequence = row[2]; h.hash = row[5]; h.events.push(event);
    if (event.type === 'state') { if (event.value.key !== row[1] || event.value.id !== event.review_id) enforcerError('journal_integrity'); h.record = event.value; }
    if (event.type === 'report') h.report = event.value;
    if (event.type === 'proposal') h.proposal = event.value;
    all[row[1]] = h;
  });
  return all;
}
function enforcerAppend(book, record, type, value) {
  var h = enforcerHistory(book)[record.key], json = executorJson({review_id:record.id,type:type,value:value}), sequence = h ? h.sequence+1 : 1;
  if (json.length > 39000) enforcerError('limit_journal');
  var sheet = book.getSheetByName('Enforcer Journal');
  if (sheet.getLastRow() >= 1001) enforcerError('limit_records');
  var row = [record.id+':'+sequence,record.key,sequence,h ? h.hash : '',json]; row.push(executorHash(row));
  sheet.getRange(sheet.getLastRow()+1,1,1,6).setValues([row.map(safeCell)]); SpreadsheetApp.flush();
}
function enforcerDescribe(r) {
  var state = r.state, reason = r.reason || '', copy;
  if (state === 'complete') copy = [r.findings ? 'Findings need attention' : r.human_checks ? 'Human check needed' : 'No issues identified in checked criteria','Open the report and decide what to change. The draft is preserved; this is not approval to send.'];
  else if (state === 'stale') copy = ['Review is out of date','Check changed inputs and request a new review version deliberately. Keep the prior report.'];
  else if (state === 'needs_reconciliation') copy = ['Check saved review before continuing','Inspect saved events and any report before recovery. Do not create another report.'];
  else if (state === 'report_edited') copy = ['Report has human edits','Open the existing report. Human changes are preserved; the saved model review remains in history.'];
  else if (state === 'closed') copy = ['Review closed without a report','Inspect the recorded failure and decision. Further review needs an explicit linked request; attempts were not reset.'];
  else if (state === 'eligible') copy = ['Ready for manual review','Run runEnforcer when ready. This preview made no model call or report.'];
  else copy = ({busy:['Another run is active','Let it finish, then inspect Drafts before retrying.'],select_request:['Choose one review request','Select one Enforcer request in the private settings.'],not_enabled:['Review is not enabled','Review and enable the selected request deliberately.'],profile_approval:['Needs criteria approval','Confirm the exact review profile and fingerprint before enabling this request.'],source_changed:['Source changed — review needed','Reconcile the original source and accepted evidence; do not silently repin it.'],access:['Access needs attention','Check runtime access to the original sources, draft and report location.'],protected_destination:['Check the target sheet','Select the Enforcer build copy and keep the teaching checkpoints protected.'],document_content:['Document needs a human check','Resolve suggestions or unsupported document content before this text review.'],relevant_review:['Needs a human decision','Resolve the relevant task uncertainty before reviewing; leave unrelated Reviews alone.'],attempt_limit:['Retry limit reached','Inspect failed attempts before requesting further review.']})[reason] || [state === 'checking' ? 'Checking draft and sources' : state === 'reviewing' ? 'Reviewing the draft' : state === 'publishing' ? 'Saving the review report' : 'Review incomplete','Inspect the selected request, saved phase and reason ('+reason+'). Correct the cause before a deliberate retry.'];
  return {review_id:r.id || '',task_id:r.task_id || '',state:state,reason:reason,status:copy[0],next_action:copy[1],report_url:r.report_url || ''};
}
function enforcerPrint(r) { var result = enforcerDescribe(r); console.log('Status: '+result.status+'\nNext step: '+result.next_action+(result.report_url ? '\nReview report: '+result.report_url : '')); return result; }
function enforcerProjection(r) { var d = enforcerDescribe(r); return [d.status,d.next_action,d.report_url].map(safeCell); }
function enforcerDisplayRange(book, executionId) {
  var rows = executorRead(book,'Executor Executions'), index = rows.findIndex(function(row) { return row[1] === executionId; });
  if (index < 0) enforcerError('execution_missing');
  return hiveSheet(book,'Executor Executions').getRange(index+2,11,1,3);
}
function enforcerProject(book, r, repairBlank) {
  // An explicit rerun of an older review must not roll the visible latest review backward.
  if (Object.values(enforcerHistory(book)).some(function(h) { return h.record && h.record.execution_id === r.execution_id && Number(h.record.version) > Number(r.version); })) return;
  var range = enforcerDisplayRange(book,r.execution_id), before = range.getValues()[0], after = enforcerProjection(r);
  var states = [];
  Object.values(enforcerHistory(book)).forEach(function(h) { h.events.forEach(function(e) { if (e.type === 'state' && e.value.execution_id === r.execution_id) states.push(e.value); }); });
  var known = states.some(function(s) { return executorJson(enforcerProjection(s)) === executorJson(before.map(safeCell)); });
  if (range.getFormulas()[0].some(Boolean) || range.getNotes()[0].some(Boolean) || (!known && (before.some(Boolean) || (states.length > 1 && !repairBlank)))) enforcerError('projection_conflict');
  if (executorJson(before.map(safeCell)) !== executorJson(after)) range.setValues([after]);
}
function enforcerSave(book, r) { r.updated_at = executorNow(); enforcerAppend(book,r,'state',r); enforcerProject(book,r); return r; }
function setupEnforcer(options) {
  var c = enforcerConfig(options), book = getBoardBook(c.spreadsheetId), lock = LockService.getScriptLock(); lock.waitLock(1000);
  try {
    executorRead(book,'Executor Executions'); executorHistory(book); executorRead(book,'Executor Sources');
    Object.keys(ENFORCER_TABLES).forEach(function(name) { if (book.getSheetByName(name)) enforcerRead(book,name); });
    var sheet = hiveSheet(book,'Executor Executions'), range = sheet.getRange(1,11,Math.max(1,sheet.getLastRow()),3), values = range.getValues();
    if (range.getFormulas().some(function(row) { return row.some(Boolean); }) || range.getNotes().some(function(row) { return row.some(Boolean); })) enforcerError('projection_conflict');
    var existing = executorJson(values[0]) === executorJson(ENFORCER_HEADERS);
    if (!existing && values.some(function(row) { return row.some(Boolean); })) enforcerError('projection_conflict');
    if (existing) {
      enforcerHistory(book);
      executorRead(book,'Executor Executions').forEach(function(row) {
        var v = enforcerDisplayRange(book,row[1]).getValues()[0];
        if (v.some(Boolean) && !Object.values(enforcerHistory(book)).some(function(h) { return h.events.some(function(e) { return e.type === 'state' && e.value.execution_id === row[1] && executorJson(enforcerProjection(e.value)) === executorJson(v.map(safeCell)); }); })) enforcerError('projection_conflict');
      });
    }
    Object.keys(ENFORCER_TABLES).forEach(function(name) { ensureTab(book,name,ENFORCER_TABLES[name]); });
    if (!existing) sheet.getRange(1,11,1,3).setValues([ENFORCER_HEADERS]);
    setupExecutorNavigation(book); sheet.showColumns(11,3); sheet.setColumnWidth(11,210); sheet.setColumnWidth(12,340); sheet.setColumnWidth(13,260); sheet.getRange(1,11,Math.max(2,sheet.getLastRow()),3).setWrap(true);
    return {setup:true,spreadsheet_id:c.spreadsheetId};
  } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}
