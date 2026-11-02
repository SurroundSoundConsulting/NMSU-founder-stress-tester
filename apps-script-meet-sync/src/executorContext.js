function executorRequestValid(r) {
  if (!executorId(r.request_id) || !/^HM-\d+$/.test(r.task_id) || r.deliverable_type !== 'demo_agenda_v1' || !/^[1-9]\d{0,3}$/.test(String(r.version)) || ['yes','no'].indexOf(r.enabled) < 0 || !executorId(r.context_set_id) || r.project !== 'Arroyo pilot' || !r.audience || !r.reviewer || !r.requested_by || !/^\d{4}-\d\d-\d\dT/.test(r.requested_at) || !Number.isFinite(Date.parse(r.requested_at)) || !Number.isFinite(Date.parse(r.no_known_completion_at))) executorError('request');
  if (String(r.version) !== '1' && (!executorId(r.previous_execution_id) || !r.revision_reason)) executorError('revision_request');
  if (Object.values(r).some(function(v) { return String(v).length > 2000; })) executorError('request');
}
function executorSnapshot(book, r, config) {
  executorRequestValid(r);
  var board = executorUnique(executorRows(book,'Master Action Board',HEADERS));
  if (board.length > 100) executorError('limit_tasks');
  var byId = {}; board.forEach(function(row) { if (!/^HM-\d+$/.test(row[0])) executorError('task_id'); byId[row[0]] = row; });
  var task = byId[r.task_id]; if (!task) executorError('task_missing');
  var rows = {}, names = ['Task History','Merge Reviews','Source Registry','Source Journal','Processed Sources'];
  names.forEach(function(name) { rows[name] = executorUnique(executorRows(book,name,WEEK2_TABLES[name])); });
  var closure = [], visiting = {};
  function visit(id) {
    if (visiting[id]) executorError('dependency_cycle');
    if (closure.indexOf(id) >= 0) return;
    if (!byId[id]) executorError('dependency_missing');
    visiting[id] = true; closure.push(id);
    var dep = String(byId[id][8] || '').trim();
    if (dep && !/^HM-\d+(?:\s*,\s*HM-\d+)*$/.test(dep)) executorError('dependency_unresolved');
    if (dep) dep.split(/\s*,\s*/).forEach(visit);
    visiting[id] = false;
  }
  visit(r.task_id);
  var relevant = closure.map(function(id) { return byId[id]; });
  var reviews = rows['Merge Reviews'].filter(function(v) { return v[6] === 'pending' && [v[2]].concat(JSON.parse(v[3] || '[]')).some(function(id) { return closure.indexOf(id) >= 0; }); });
  var journals = rows['Source Journal'].filter(function(v) { return v[2] !== 'complete' && JSON.parse(v[3] || '[]').some(function(id) { return closure.indexOf(id) >= 0; }); });
  var history = rows['Task History'].filter(function(v) { return closure.indexOf(v[2]) >= 0; });
  var sourceIds = Array.from(new Set(history.map(function(h) { return h[1]; }).concat(relevant.map(function(t) { return t[11]; }))));
  var registry = rows['Source Registry'].filter(function(v) { return sourceIds.indexOf(v[0]) >= 0; });
  var contexts = executorRead(book,'Executor Context').filter(function(v) { return v[1] === r.context_set_id; });
  var completions = rows['Processed Sources'].filter(function(v) { return sourceIds.indexOf(v[0]) >= 0; });
  var formulas = book.getSheetByName('Master Action Board').getRange(2,1,board.length,16).getFormulas();
  var form = relevant.map(function(t) { return formulas[board.findIndex(function(b) { return b[0] === t[0]; })]; });
  var block = '';
  if (r.enabled !== 'yes' || config.taskIds.indexOf(r.task_id) < 0 || config.owners.indexOf(task[2]) < 0) block = 'not_enabled';
  else if (task[3] === 'done') block = 'task_done';
  else if (task[3] !== 'open' || task[7] || relevant.slice(1).some(function(t) { return t[3] !== 'done'; })) block = 'dependency';
  else if (reviews.length || journals.length) block = 'review';
  else if (registry.some(function(v) { return ['changed_requires_review','needs_reconciliation','failed'].indexOf(v[5]) >= 0; })) block = 'source_review';
  if (!history.some(function(h) { return h[2] === r.task_id && /Arroyo/i.test(h[5]); }) || !/agenda/i.test(task[1])) block = 'identity';
  var snapshot = {request:r,tasks:relevant,formulas:form,reviews:reviews,journals:journals,history:history,registry:registry,completions:completions,contexts:contexts};
  return {task:task,block:block,hash:executorHash(snapshot),snapshot:snapshot,sourceIds:sourceIds};
}
function executorDocument(id) {
  var doc = executorGoogle('get','https://docs.googleapis.com/v1/documents/'+id+'?includeTabsContent=true&suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS');
  var tabs = [];
  function visit(list) { (list || []).forEach(function(t) { if (t.documentTab) tabs.push(t); visit(t.childTabs); }); }
  visit(doc.tabs);
  if (!tabs.length && doc.body) tabs.push({tabProperties:{tabId:''},documentTab:{body:doc.body}});
  if (tabs.length !== 1) executorError('document_tabs');
  var paragraphs = [];
  function text(elements) { return (elements || []).map(function(e) {
    if (e.paragraph) { var t = (e.paragraph.elements || []).map(function(p) { return p.textRun ? p.textRun.content : ''; }).join(''); paragraphs.push({start:e.startIndex || 1,text:t}); return t; }
    if (e.table) return e.table.tableRows.map(function(r) { return r.tableCells.map(function(c) { return text(c.content); }).join('\n'); }).join('\n');
    return '';
  }).join(''); }
  var content = text(tabs[0].documentTab.body.content).replace(/\r\n?/g,'\n');
  if (content.length > 20000) executorError('limit_source');
  return {id:id,title:doc.title || '',text:content,tab_id:(tabs[0].tabProperties || {}).tabId || '',revision:doc.revisionId || '',paragraphs:paragraphs};
}
function executorMeta(id) { return executorGoogle('get','https://www.googleapis.com/drive/v3/files/'+id+'?fields=id,name,mimeType,parents,trashed,appProperties,capabilities(canAddChildren)&supportsAllDrives=true'); }
function executorFolder(id, parent, writable) {
  var f = executorMeta(id);
  if (f.trashed || f.mimeType !== 'application/vnd.google-apps.folder' || (parent && (f.parents || []).indexOf(parent) < 0) || (writable && !(f.capabilities && f.capabilities.canAddChildren))) executorError('access');
}
function executorList(folder) {
  var files = [], token = '', tokens = {};
  do {
    var q = "'"+folder+"' in parents and trashed = false";
    var page = executorGoogle('get','https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(q)+'&pageSize=100&fields=files(id,name,mimeType,appProperties),nextPageToken,incompleteSearch&supportsAllDrives=true&includeItemsFromAllDrives=true'+(token?'&pageToken='+encodeURIComponent(token):''));
    if (!Array.isArray(page.files) || page.incompleteSearch) executorError('incomplete_discovery');
    files = files.concat(page.files); token = page.nextPageToken || '';
    if (files.length > 8 || tokens[token]) executorError('limit_sources');
    if (token) tokens[token] = true;
  } while (token);
  return files.sort(function(a,b) { return a.id.localeCompare(b.id); });
}
function executorContext(book, r, config, snap) {
  executorFolder(config.contextFolder,config.rootFolder,false);
  executorFolder(config.completionFolder,config.rootFolder,false);
  var mappings = snap.snapshot.contexts.map(function(row) { return executorObject(EXECUTOR_TABLES['Executor Context'],row); });
  var completedFiles = executorList(config.completionFolder);
  if (mappings.length > 8 || new Set(mappings.map(function(m) { return m.file_id; })).size !== mappings.length) executorError('limit_sources');
  if (completedFiles.some(function(f) { return !mappings.some(function(m) { return m.role === 'completion' && m.file_id === f.id; }); })) executorError('completion_unclassified');
  var sources = [], total = 0;
  // Human-bound completion evidence is checked before requiring scope for new drafting.
  if (mappings.some(function(m) { return m.role === 'completion'; })) mappings = mappings.filter(function(m) { return m.role === 'completion'; });
  mappings.forEach(function(m,i) {
    if (!executorId(m.file_id) || ['scope','transcript','completion'].indexOf(m.role) < 0 || m.project !== r.project) executorError('context_binding');
    var expectedFolder = m.role === 'scope' ? config.contextFolder : m.role === 'completion' ? config.completionFolder : config.transcriptFolder;
    if (m.folder_id !== expectedFolder) executorError('context_binding');
    if (m.role === 'transcript' && snap.sourceIds.indexOf('DRIVE-'+m.file_id) < 0) executorError('context_binding');
    var meta = executorMeta(m.file_id);
    if (meta.trashed || meta.mimeType !== 'application/vnd.google-apps.document' || (meta.parents || []).indexOf(expectedFolder) < 0) executorError('access');
    var doc = executorDocument(m.file_id), hash = executorHash(doc.text);
    if (m.expected_hash && hash !== m.expected_hash) executorError('source_changed');
    if (m.role !== 'transcript' && (m.approved !== 'yes' || !m.expected_hash)) executorError('context_approval');
    if (m.role === 'transcript') {
      var parsed = week2ReadSource({id:m.file_id,mimeType:meta.mimeType});
      var marker = snap.snapshot.completions.filter(function(v) { return v[0] === parsed.id; })[0];
      if (!marker || JSON.parse(marker[3]).fingerprint !== parsed.fingerprint) executorError('source_changed');
      snap.snapshot.history.filter(function(h) { return h[1] === parsed.id; }).forEach(function(h) { JSON.parse(h[5]).forEach(function(q) { if (parsed.text.indexOf(q) < 0) executorError('history_grounding'); }); });
    }
    total += doc.text.length; if (total > 100000) executorError('limit_context');
    sources.push({evidence_id:'S'+(i+1),file_id:m.file_id,url:'https://docs.google.com/document/d/'+m.file_id+'/edit',title:doc.title || meta.name,tab_id:doc.tab_id,location:{start_index:1,paragraph_starts:doc.paragraphs.map(function(p) { return p.start; })},revision:doc.revision,hash:hash,text:doc.text,read_at:executorNow(),role:m.role,completion_quote:m.completion_quote || ''});
  });
  var done = sources.filter(function(s) { return s.role === 'completion'; });
  done.forEach(function(s) { if (!s.completion_quote || s.text.indexOf(s.completion_quote) < 0) executorError('completion_grounding'); });
  var contentFingerprint = sources.map(function(s) { return [s.file_id,s.hash,s.role]; });
  if (done.length) return {sources:sources,hash:executorHash([snap.hash,contentFingerprint,completedFiles]),done:done[0]};
  var scopes = sources.filter(function(s) { return s.role === 'scope'; });
  if (scopes.length !== 1) executorError(scopes.length ? 'decision_scope' : 'context_missing');
  var scope = scopes[0].text;
  var scopeFields = {};
  ['Project','Scope version','Scenario approver','Scenario approval date','Audience','Objective','Permitted demonstration','Constraints','Duration','Required sequence'].forEach(function(label) {
    var values = scope.split('\n').filter(function(line) { return line.indexOf(label+':') === 0; }).map(function(line) { return line.slice(label.length+1).trim(); });
    if (values.length !== 1 || !values[0]) executorError('context_missing');
    scopeFields[label] = values[0];
  });
  if (scopeFields.Project !== r.project || !validDate(scopeFields['Scenario approval date'])) executorError('context_binding');
  var expected = snap.sourceIds.filter(function(id) { return id.indexOf('DRIVE-') === 0; });
  if (expected.some(function(id) { return !sources.some(function(s) { return 'DRIVE-'+s.file_id === id && s.role === 'transcript'; }); })) executorError('context_missing');
  return {sources:sources,hash:executorHash([snap.hash,contentFingerprint,completedFiles]),done:done.length ? done[0] : null};
}
function previewExecutorSelection(options) {
  var config = executorConfig(options), book = getBoardBook(config.spreadsheetId), seen = {};
  return executorRequests(book).map(function(r) { executorRequestValid(r); var key = executorKey(config,r); if (seen[key]) executorError('duplicate_request'); seen[key] = true; var s = executorSnapshot(book,r,config); return {request_id:r.request_id,task_id:r.task_id,key:key,reason:s.block || 'eligible',urgency:s.task[4],due:s.task[5]}; }).sort(function(a,b) { return b.urgency-a.urgency || (a.due || '9999').localeCompare(b.due || '9999') || a.task_id.localeCompare(b.task_id); });
}
