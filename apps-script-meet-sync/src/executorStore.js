// Executor owns only its own tabs. Ingestion's A-P and ledgers are read-only here.
var EXECUTOR_TABLES = {
  'Executor Requests': ['request_id','task_id','deliverable_type','version','enabled','project','audience','context_set_id','requested_by','requested_at','no_known_completion_at','previous_execution_id','revision_reason','reviewer'],
  'Executor Context': ['source_key','context_set_id','file_id','folder_id','role','project','expected_hash','approved','completion_quote'],
  'Executor Executions': ['execution_key','execution_id','task_id','task','owner','due_date','state','reason','output_url','updated_at'],
  'Executor Sources': ['evidence_key','execution_id','evidence_json','evidence_hash'],
  'Executor Journal': ['event_id','execution_key','sequence','previous_hash','record_json','event_hash']
};
var EXECUTOR_DRAFT_HEADERS = ['execution_key','execution_id','Task ID','Task','Owner','Due date','Status','Next step','Document','updated_at'];
function executorError(code) { throw new Error('Executor ' + code); }
function executorJson(value) { return JSON.stringify(value); }
function executorHash(value) { return week2Hash(typeof value === 'string' ? value : executorJson(value)); }
function executorClone(value) { return JSON.parse(executorJson(value)); }
function executorNow() { return new Date().toISOString(); }
function executorId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value); }
function executorConfig(options) {
  options = options || {};
  var props = PropertiesService.getScriptProperties();
  // Require an explicit execution destination; never inherit ingestion's target.
  var targetId = options.spreadsheetId || props.getProperty('EXECUTOR_SPREADSHEET_ID');
  var protectedIds = (props.getProperty('EXECUTOR_PROTECTED_SPREADSHEET_IDS') || '').split(',').map(function(id) { return id.trim(); }).filter(Boolean);
  if (!executorId(targetId) || protectedIds.indexOf(targetId) >= 0) executorError('protected_destination');
  var board = getBoardBook(targetId);
  var config = {spreadsheetId:board.getId(),rootFolder:props.getProperty('EXECUTOR_FEATURE_FOLDER_ID'),
    outputFolder:props.getProperty('EXECUTOR_OUTPUT_FOLDER_ID'),contextFolder:props.getProperty('EXECUTOR_CONTEXT_FOLDER_ID'),
    completionFolder:props.getProperty('EXECUTOR_COMPLETION_FOLDER_ID'),transcriptFolder:props.getProperty('WEEK2_INBOX_FOLDER_ID'),
    taskIds:(props.getProperty('EXECUTOR_TASK_IDS') || '').split(',').map(function(x) { return x.trim(); }).filter(Boolean),
    owners:(props.getProperty('EXECUTOR_OWNERS') || 'Jordan').split(',').map(function(x) { return x.trim(); }),
    referenceDate:props.getProperty('EXECUTOR_REFERENCE_DATE') || '',budgetMs:240000};
  ['rootFolder','outputFolder','contextFolder','completionFolder','transcriptFolder'].forEach(function(k) { if (!executorId(config[k])) executorError('configuration'); });
  if (new Set([config.outputFolder,config.contextFolder,config.completionFolder,config.transcriptFolder]).size !== 4 || !config.taskIds.length || config.taskIds.some(function(id) { return !/^HM-\d+$/.test(id); }) || !validDate(config.referenceDate)) executorError('configuration');
  return config;
}
function executorRows(book, name, headers, optional) {
  var sheet = hiveSheet(book,name);
  if (!sheet) { if (optional) return []; executorError('missing_schema'); }
  if (sheet.getLastRow() > 1001) executorError('limit_records');
  var actualHeaders = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (executorJson(actualHeaders) !== executorJson(headers) && !(name === 'Executor Executions' && executorJson(actualHeaders) === executorJson(EXECUTOR_DRAFT_HEADERS))) executorError('schema');
  var n = sheet.getLastRow()-1;
  if (n < 1) return [];
  var range = sheet.getRange(2,1,n,headers.length), values = range.getValues(), formulas = range.getFormulas();
  // Formulas in controls/machine state are never interpreted as executable configuration.
  if (name !== 'Master Action Board' && formulas.some(function(r) { return r.some(Boolean); })) executorError('manual_formula');
  return values;
}
function executorUnique(rows) {
  var keys = rows.map(function(r) { return r[0]; });
  if (keys.some(function(k) { return !k; }) || new Set(keys).size !== keys.length) executorError('duplicate_key');
  return rows;
}
function executorRead(book, name) {
  var rows = executorUnique(executorRows(book,name,EXECUTOR_TABLES[name]));
  if (name === 'Executor Sources') rows.forEach(function(r) { if (executorHash(r[2]) !== r[3]) executorError('evidence_conflict'); });
  return rows;
}
function executorObject(headers, row) { var o = {}; headers.forEach(function(k,i) { o[k] = row[i]; }); return o; }
function executorRequests(book) { return executorRead(book,'Executor Requests').map(function(r) { return executorObject(EXECUTOR_TABLES['Executor Requests'],r); }); }
function executorKey(config, request) { return executorHash([config.spreadsheetId,request.task_id,request.deliverable_type,String(request.version)]); }
function executorHistory(book) {
  var latest = {}, events = executorRead(book,'Executor Journal');
  events.forEach(function(row) {
    var before = latest[row[1]], expected = before ? before.sequence+1 : 1;
    if (row[2] !== expected || row[3] !== (before ? before.hash : '') || row[5] !== executorHash(row.slice(0,5))) executorError('journal_integrity');
    var record;
    try { record = JSON.parse(row[4]); } catch (_) { executorError('journal_integrity'); }
    if (record.key !== row[1] || !executorId(record.id) || row[0] !== record.id + ':' + expected) executorError('journal_integrity');
    latest[row[1]] = {record:record,sequence:expected,hash:row[5]};
  });
  return latest;
}
function executorProjection(record) {
  var display = executorResult(record);
  return [record.key,record.id,record.task_id,record.task || '',record.owner || '',record.due || '',display.status,display.next_action,display.document_url,record.updated_at].map(safeCell);
}
// Frozen old display formats allow an exact, guarded migration of existing rows.
function executorLegacyProjection(record, original) {
  return [record.key,record.id,record.task_id,record.task || '',record.owner || '',record.due || '',record.state,(record.reason || '')+(executorLegacyNextAction(record.reason,original) ? ': '+executorLegacyNextAction(record.reason,original) : ''),record.output_url || '',record.updated_at].map(safeCell);
}
function executorKnownProjection(book, row) {
  return executorRead(book,'Executor Journal').some(function(event) {
    if (event[1] !== row[0]) return false;
    var record = JSON.parse(event[4]), current = executorJson(row);
    return [executorProjection(record),executorLegacyProjection(record,false),executorLegacyProjection(record,true)].some(function(values) { return executorJson(values) === current; });
  });
}
function executorProject(book, record) {
  var rows = executorRead(book,'Executor Executions'), index = rows.findIndex(function(r) { return r[0] === record.key; });
  var before = index < 0 ? null : rows[index].map(safeCell), allowed = !before;
  // Only known journal projections may be replaced; hand-edited cells are preserved.
  if (before && executorKnownProjection(book,before)) allowed = true;
  if (!allowed) executorError('projection_conflict');
  var after = executorProjection(record);
  if (executorJson(after) !== executorJson(before)) {
    var range = hiveSheet(book,'Executor Executions').getRange(index < 0 ? rows.length+2 : index+2,1,1,after.length);
    range.setNumberFormat('@'); range.setValues([after]); SpreadsheetApp.flush();
  }
}
function executorRefreshDisplay(book) {
  var rows = executorRead(book,'Executor Executions'), history = executorHistory(book);
  // Validate the entire display before updating any row or header.
  rows.forEach(function(row) { if (!history[row[0]] || !executorKnownProjection(book,row)) executorError('projection_conflict'); });
  var sheet = hiveSheet(book,'Executor Executions'), changed = 0;
  rows.forEach(function(row,i) {
    var after = executorProjection(history[row[0]].record);
    if (executorJson(after) === executorJson(row)) return;
    var range = sheet.getRange(i+2,1,1,10);
    if (executorJson(range.getValues()[0]) !== executorJson(row) || range.getFormulas()[0].some(Boolean)) executorError('projection_conflict');
    range.setValues([after]); changed++;
  });
  var header = sheet.getRange(1,1,1,10);
  if (executorJson(header.getValues()[0]) !== executorJson(EXECUTOR_DRAFT_HEADERS)) header.setValues([EXECUTOR_DRAFT_HEADERS]);
  SpreadsheetApp.flush();
  return changed;
}
function refreshExecutorStatus(options) {
  var config = executorConfig(options), book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock();
  try { lock.waitLock(1000); } catch (_) { return executorPrintResult(executorDescribeResult({state:'deferred',reason:'busy'})); }
  try {
    var changed = executorRefreshDisplay(book);
    return executorPrintResult({status:'Draft messages refreshed',message:changed+' saved display row(s) updated. Execution history, drafts and tasks were not changed.',next_action:'Open Drafts to see the current status and next step.',updated_rows:changed});
  } catch (error) { throw executorVisibleError(error); }
  finally { lock.releaseLock(); }
}
function executorSave(book, record, previous) {
  var current = executorHistory(book)[record.key];
  if ((current ? current.hash : '') !== (previous ? previous.hash : '')) executorError('concurrent_state');
  record.updated_at = executorNow();
  var seq = current ? current.sequence+1 : 1, json = executorJson(record);
  if (json.length > 39000) executorError('limit_journal');
  var row = [record.id+':'+seq,record.key,seq,current ? current.hash : '',json]; row.push(executorHash(row));
  var sheet = hiveSheet(book,'Executor Journal');
  if (sheet.getLastRow() >= 1001) executorError('limit_records');
  var range = sheet.getRange(sheet.getLastRow()+1,1,1,row.length);
  range.setNumberFormat('@'); range.setValues([row]); SpreadsheetApp.flush();
  // Journal is authoritative even if projection fails after this durable append.
  executorProject(book,record);
  return executorHistory(book)[record.key];
}
function executorEvidence(book, record, sources) {
  var rows = executorRead(book,'Executor Sources');
  sources.forEach(function(source,i) {
    var key = record.id+':'+executorHash([source.file_id,source.hash,source.role]).slice(0,32), json = executorJson(source), row = [key,record.id,json,executorHash(json)];
    if (json.length > 39000) executorError('limit_source');
    var existing = rows.filter(function(r) { return r[0] === key; })[0];
    if (existing) {
      if (existing[3] !== executorHash(existing[2])) executorError('evidence_conflict');
      var prior = JSON.parse(existing[2]);
      if (prior.file_id !== source.file_id || prior.hash !== source.hash || prior.text !== source.text || prior.role !== source.role) executorError('evidence_conflict');
    }
    if (!existing) { var sheet = hiveSheet(book,'Executor Sources'); if (sheet.getLastRow() >= 1001) executorError('limit_records'); var target = sheet.getRange(sheet.getLastRow()+1,1,1,4); target.setNumberFormat('@'); target.setValues([row]); rows.push(row); }
  });
  SpreadsheetApp.flush();
}
function setupExecutor(options) {
  var config = executorConfig(options), book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock(); lock.waitLock(1000);
  try {
    executorRows(book,'Master Action Board',HEADERS);
    Object.keys(EXECUTOR_TABLES).forEach(function(name) { if (hiveSheet(book,name)) executorRows(book,name,EXECUTOR_TABLES[name]); });
    Object.keys(EXECUTOR_TABLES).forEach(function(name) { if (name !== 'Executor Executions' || !hiveSheet(book,name)) ensureTab(book,name,EXECUTOR_TABLES[name]); });
    executorRefreshDisplay(book);
    setupExecutorNavigation(book);
    var tasks = hiveSheet(book,'Master Action Board');
    if (!tasks.getFilter()) tasks.getRange(1,1,tasks.getMaxRows(),HEADERS.length).createFilter();
    return {setup:true,spreadsheet_id:config.spreadsheetId,enabled_requests:executorRequests(book).filter(function(r) { return r.enabled === 'yes'; }).length};
  } finally { lock.releaseLock(); }
}
function inspectExecutor(options) {
  var config = executorConfig(options), book = getBoardBook(config.spreadsheetId);
  Object.keys(EXECUTOR_TABLES).forEach(function(name) { executorRead(book,name); });
  return {spreadsheet_id:config.spreadsheetId,requests:executorRequests(book),executions:Object.values(executorHistory(book)).map(function(e) { return executorLegacyProjection(e.record,false); }),live_permissions_verified:false};
}
