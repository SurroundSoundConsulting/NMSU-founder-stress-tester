function enforcerDocument(id) {
  var raw = executorGoogle('get','https://docs.googleapis.com/v1/documents/'+id+'?includeTabsContent=true&suggestionsViewMode=SUGGESTIONS_INLINE');
  // Never flatten unresolved suggestions, images, drawings, headers or footnotes into a falsely complete review.
  function check(value) {
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(function(k) {
      if ((/^suggested/.test(k) && Object.keys(value[k] || {}).length) || ['inlineObjectElement','positionedObjects','footnoteReference','headers','footers','footnotes','richLink','person','dateElement'].indexOf(k) >= 0) enforcerError('document_content');
      check(value[k]);
    });
  }
  check(raw);
  var tabs = [];
  function visit(list) { (list || []).forEach(function(t) { if (t.documentTab) tabs.push(t); visit(t.childTabs); }); }
  visit(raw.tabs);
  if (!tabs.length && raw.body) tabs.push({tabProperties:{tabId:''},documentTab:{body:raw.body}});
  if (tabs.length !== 1) enforcerError('document_content');
  function text(elements) { return (elements || []).map(function(e) {
    if (e.paragraph) return (e.paragraph.elements || []).map(function(p) { if (p.textRun) return p.textRun.content; if (p.startIndex === undefined && p.endIndex === undefined) return ''; enforcerError('document_content'); }).join('');
    if (e.table) return e.table.tableRows.map(function(row) { return row.tableCells.map(function(cell) { return text(cell.content); }).join('\n'); }).join('\n');
    if (e.sectionBreak) return '';
    enforcerError('document_content');
  }).join(''); }
  // Locations below are 1-based UTF-16 offsets in this normalized snapshot, not native Docs write indexes.
  var content = text(tabs[0].documentTab.body.content).replace(/\r\n?/g,'\n');
  if (content.length > 20000 || !raw.revisionId) enforcerError('limit_source');
  return {file_id:id,title:raw.title || '',text:content,hash:executorHash(content),revision:raw.revisionId,tab_id:tabs[0].tabProperties.tabId || ''};
}
function enforcerProfile(r, sources) {
  var p;
  if (!r.confirmed_by || !Number.isFinite(Date.parse(r.confirmed_at)) || executorHash(r.profile_json) !== r.profile_hash) enforcerError('profile_approval');
  try { p = JSON.parse(r.profile_json); } catch (_) { enforcerError('profile_approval'); }
  if (!p.version || !p.audience || !p.boundary || !Array.isArray(p.requirements) || !p.requirements.length || p.requirements.length > 20 || !Array.isArray(p.standards) || p.standards.length > 8) enforcerError('profile_approval');
  var seen = {};
  p.requirements.forEach(function(q) {
    var s = sources.filter(function(v) { return v.evidence_id === q.source_id; })[0];
    if (!executorId(q.id) || seen[q.id] || typeof q.text !== 'string' || !q.text.trim() || q.text.length > 1000 || ['semantic','coverage','prohibition','human_layout'].indexOf(q.mode) < 0 || !s || typeof q.quote !== 'string' || !q.quote.trim() || s.text.indexOf(q.quote) < 0) enforcerError('profile_approval');
    if (q.category !== undefined && ['grounding','requirement','commitment','disclosure','task_fit'].indexOf(q.category) < 0) enforcerError('profile_approval');
    seen[q.id] = true;
  });
  var checked = {}, visiting = {};
  function dependencies(id) {
    if (visiting[id]) enforcerError('profile_approval');
    if (checked[id]) return;
    var q = p.requirements.filter(function(q) { return q.id === id; })[0], required = q.requires || [];
    if (!Array.isArray(required) || required.length > 20 || new Set(required).size !== required.length || required.some(function(v) { return !executorId(v) || !seen[v] || v === id; })) enforcerError('profile_approval');
    visiting[id] = true; required.forEach(dependencies); delete visiting[id]; checked[id] = true;
  }
  p.requirements.forEach(function(q) { dependencies(q.id); });
  p.standards.forEach(function(s) { if (!executorId(s.id) || typeof s.text !== 'string' || !s.text.trim() || s.text.length > 1500 || !s.applies_to) enforcerError('profile_approval'); });
  if (r.profile_json.length > 20000) enforcerError('limit_context');
  return p;
}
function enforcerSourceVersions(r) {
  var p;
  if (!r.confirmed_by || !Number.isFinite(Date.parse(r.confirmed_at)) || executorHash(r.profile_json) !== r.profile_hash) enforcerError('profile_approval');
  try { p = JSON.parse(r.profile_json); } catch (_) { enforcerError('profile_approval'); }
  var versions = p.source_versions || [], seen = {};
  if (!Array.isArray(versions) || versions.length > 8 || (versions.length && (Number(r.version) < 2 || !r.previous_review_id))) enforcerError('profile_approval');
  versions.forEach(function(v) { if (!executorId(v.file_id) || !/^[a-f0-9]{64}$/.test(v.hash) || seen[v.file_id]) enforcerError('profile_approval'); seen[v.file_id] = true; });
  return versions;
}
function enforcerInputs(book, r, c, allowDisabled) {
  if (!executorId(r.request_id) || !executorId(r.execution_id) || !executorId(r.draft_id) || !/^[1-9]\d{0,3}$/.test(String(r.version)) || ['yes','no'].indexOf(r.enabled) < 0 || !r.reviewer || !r.requested_by || !Number.isFinite(Date.parse(r.requested_at))) enforcerError('request');
  if (!allowDisabled && r.enabled !== 'yes') enforcerError('not_enabled');
  var execution = Object.values(executorHistory(book)).map(function(h) { return h.record; }).filter(function(e) { return e.id === r.execution_id; });
  if (execution.length !== 1 || ['ready_for_review','stale_requires_review'].indexOf(execution[0].state) < 0 || !execution[0].output_id) enforcerError('execution_missing');
  var e = execution[0], board = executorUnique(executorRows(book,'Master Action Board',HEADERS));
  if (board.length > 100) enforcerError('limit_tasks');
  var task = board.filter(function(t) { return t[0] === e.task_id; });
  if (task.length !== 1) enforcerError('task_missing');
  var fixture = r.draft_id !== e.output_id, meta = executorMeta(r.draft_id);
  if (meta.trashed || meta.mimeType !== 'application/vnd.google-apps.document') enforcerError('access');
  if (fixture && (!c.testMode || r.draft_origin_id !== e.output_id || (meta.parents || []).indexOf(c.fixtures) < 0)) enforcerError('draft_identity');
  if (!fixture && (!meta.appProperties || meta.appProperties.executor_id !== e.id)) enforcerError('draft_identity');
  var sourceRows = executorRead(book,'Executor Sources').filter(function(row) { return row[1] === e.id; }), sources = [];
  if (!sourceRows.length || sourceRows.length > 8) enforcerError('limit_sources');
  var total = 0, ids = {}, versions = enforcerSourceVersions(r);
  sourceRows.forEach(function(row) {
    var s = JSON.parse(row[2]);
    if (!executorId(s.file_id) || !executorId(s.evidence_id) || s.evidence_id === 'P1' || ids[s.evidence_id] || ids[s.file_id] || executorHash(s.text) !== s.hash || ['scope','transcript'].indexOf(s.role) < 0) enforcerError('evidence_conflict');
    ids[s.evidence_id] = true; ids[s.file_id] = true;
    var binding = (e.snapshot.contexts || []).filter(function(v) { return v[2] === s.file_id && v[4] === s.role; });
    var m = executorMeta(s.file_id);
    if (binding.length !== 1 || m.trashed || m.mimeType !== 'application/vnd.google-apps.document' || (m.parents || []).indexOf(binding[0][3]) < 0) enforcerError('access');
    var current = enforcerDocument(s.file_id);
    var accepted = versions.filter(function(v) { return v.file_id === s.file_id; })[0];
    if (current.hash !== (accepted ? accepted.hash : s.hash)) enforcerError('source_changed');
    total += current.text.length; if (total > 100000) enforcerError('limit_context');
    sources.push(Object.assign({},s,{text:current.text,hash:current.hash,revision:accepted ? current.revision : s.revision,executor_accepted_hash:s.hash,current_revision:current.revision,evidence_key:row[0],evidence_hash:row[3]}));
  });
  if (versions.some(function(v) { return !sources.some(function(s) { return s.file_id === v.file_id; }); })) enforcerError('profile_approval');
  var profile = enforcerProfile(r,sources), draft = enforcerDocument(r.draft_id);
  var closure = (e.snapshot.tasks || []).map(function(t) { return t[0]; }); closure.push(e.task_id);
  var reviews = executorRows(book,'Merge Reviews',WEEK2_TABLES['Merge Reviews']).filter(function(v) { return v[6] === 'pending' && [v[2]].concat(JSON.parse(v[3] || '[]')).some(function(id) { return closure.indexOf(id) >= 0; }); });
  var unfinished = executorRows(book,'Source Journal',WEEK2_TABLES['Source Journal']).filter(function(v) { return v[2] !== 'complete' && JSON.parse(v[3] || '[]').some(function(id) { return closure.indexOf(id) >= 0; }); });
  if (reviews.length || unfinished.length) enforcerError('relevant_review');
  var history = executorRows(book,'Task History',WEEK2_TABLES['Task History']).filter(function(v) { return closure.indexOf(v[2]) >= 0; });
  var registry = executorRows(book,'Source Registry',WEEK2_TABLES['Source Registry']).filter(function(v) { return sources.some(function(s) { return v[0] === 'DRIVE-'+s.file_id; }); });
  if (registry.some(function(v) { return ['changed_requires_review','needs_reconciliation','failed'].indexOf(v[5]) >= 0; })) enforcerError('source_changed');
  var relevantTasks = board.filter(function(t) { return closure.indexOf(t[0]) >= 0; });
  var formulas = relevantTasks.map(function(t) { return hiveSheet(book,'Master Action Board').getRange(board.indexOf(t)+2,1,1,16).getFormulas()[0]; });
  var currentRequests = executorRequests(book).filter(function(v) { return v.request_id === e.request.request_id; });
  if (currentRequests.length !== 1) enforcerError('request');
  var currentContext = executorRead(book,'Executor Context').filter(function(v) { return v[1] === e.request.context_set_id; });
  var input = {task:task[0],tasks:relevantTasks,formulas:formulas,history:history,registry:registry,request:r,executor_request:currentRequests[0],context_bindings:currentContext,destination:c,draft:draft,sources:sources,profile:profile,fixture:fixture,execution_id:e.id,original_draft_id:e.output_id};
  input.hash = executorHash(input);
  return input;
}
function enforcerFresh(book, r, c, expected) {
  var current = enforcerRequests(book).filter(function(v) { return v.request_id === r.request_id; });
  if (current.length !== 1) enforcerError('stale');
  var input = enforcerInputs(book,current[0],c);
  if (input.hash !== expected) enforcerError('stale');
  return input;
}
function previewEnforcerReview(options) {
  try {
    var c = enforcerConfig(options), book = getBoardBook(c.spreadsheetId), r = enforcerSelect(book,options), input = enforcerInputs(book,r,c,true);
    return enforcerPrint({state:r.enabled === 'yes' ? 'eligible' : 'blocked',reason:r.enabled === 'yes' ? 'ready' : 'not_enabled',task_id:input.task[0]});
  } catch (e) { return enforcerPrint({state:'blocked',reason:enforcerReason(e)}); }
}
