function enforcerDeadline(started) { if (Date.now()-started > 180000) enforcerError('limit_runtime'); }
function enforcerReportMeta(record, c) {
  var meta = executorMeta(record.report_id), p = meta.appProperties || {};
  if (meta.trashed || (meta.parents || []).indexOf(c.outputs) < 0 || p.enforcer_id !== record.id || p.enforcer_key !== record.key || p.payload_hash !== record.report_hash) enforcerError('output_identity');
  return meta;
}
function enforcerVersions(book, r, key) {
  var others = Object.values(enforcerHistory(book)).filter(function(h) { return h.record && h.record.execution_id === r.execution_id && h.record.key !== key; });
  if (others.length && (!r.previous_review_id || !r.reason || !others.some(function(h) { return h.id === r.previous_review_id && ['complete','stale','closed'].indexOf(h.record.state) >= 0; }) || others.some(function(h) { return ['complete','stale','closed'].indexOf(h.record.state) < 0; }))) enforcerError('revision_request');
  if (!others.length && String(r.version) !== '1') enforcerError('revision_request');
  if (others.some(function(h) { return h.record.previous_review_id === r.previous_review_id && r.previous_review_id; })) enforcerError('revision_request');
}
function runEnforcer(options) {
  var c, book, r, record, lock = LockService.getScriptLock(), locked = false, started = Date.now();
  try {
    c = enforcerConfig(options); book = getBoardBook(c.spreadsheetId);
    try { lock.waitLock(1000); locked = true; } catch (_) { return enforcerPrint({state:'deferred',reason:'busy'}); }
    r = enforcerSelect(book,options);
    var key = enforcerKey(c,r), history = enforcerHistory(book), h = history[key];
    if (h && h.record) {
      record = executorClone(h.record);
      if (record.state === 'stale' || record.state === 'closed') return enforcerPrint(record);
      if (record.state === 'complete') {
        try {
          enforcerProject(book,record);
          enforcerFresh(book,r,c,record.input_hash); enforcerReportMeta(record,c);
          var actual = enforcerDocument(record.report_id);
          // A later report edit belongs to a person. Return it, without rewriting or treating it as a new model review.
          if (actual.text.replace(/\n+$/,'') !== h.report.text.replace(/\n+$/,'')) return enforcerPrint(Object.assign({},record,{state:'report_edited',reason:'report_edited'}));
        } catch (e) { record.state = enforcerReason(e) === 'access' || enforcerReason(e) === 'output_identity' ? 'needs_reconciliation' : 'stale'; record.reason = enforcerReason(e); enforcerSave(book,record); }
        return enforcerPrint(record);
      }
      if (record.state !== 'failed' && record.state !== 'blocked' && record.state !== 'deferred') return enforcerPrint(Object.assign({},record,{state:'needs_reconciliation',reason:'unfinished_review'}));
      if (['preflight','model_failed'].indexOf(record.phase) < 0) return enforcerPrint(Object.assign({},record,{state:'needs_reconciliation',reason:'unfinished_review'}));
      if (record.attempts >= 2) return enforcerPrint(Object.assign({},record,{state:'blocked',reason:'attempt_limit'}));
    }
    enforcerVersions(book,r,key);
    if (!record) record = {id:'ER-'+Utilities.getUuid(),key:key,execution_id:r.execution_id,version:String(r.version),previous_review_id:r.previous_review_id || '',state:'checking',phase:'preflight',attempts:0,started_at:executorNow()};
    record.state = 'checking'; record.phase = 'preflight'; record.reason = ''; enforcerSave(book,record);
    var input = enforcerInputs(book,r,c);
    if (record.input_hash && record.input_hash !== input.hash) { record.state = 'stale'; record.reason = 'stale'; enforcerSave(book,record); return enforcerPrint(record); }
    executorPermissions(); executorFolder(c.outputs,c.root,true);
    if (!record.input_hash) {
      enforcerAppend(book,record,'request',r); enforcerAppend(book,record,'draft',input.draft);
      enforcerAppend(book,record,'task',{task:input.task,tasks:input.tasks,formulas:input.formulas,history:input.history,registry:input.registry});
      // Source snapshots already live in immutable Executor Sources. Preserve their keys/hashes and reread versions here.
      enforcerAppend(book,record,'sources',input.sources.map(function(s) { return {evidence_key:s.evidence_key,evidence_hash:s.evidence_hash,file_id:s.file_id,hash:s.hash,accepted_revision:s.revision,current_revision:s.current_revision}; }));
      input.sources.filter(function(s) { return s.hash !== s.executor_accepted_hash; }).forEach(function(s) { enforcerAppend(book,record,'accepted_source_version',{file_id:s.file_id,text:s.text,hash:s.hash,revision:s.revision,tab_id:s.tab_id,original_evidence_key:s.evidence_key,profile_hash:r.profile_hash,confirmed_by:r.confirmed_by,confirmed_at:r.confirmed_at}); });
      record.input_hash = input.hash; record.task_id = input.task[0]; record.draft_id = input.draft.file_id;
    }
    enforcerDeadline(started); enforcerFresh(book,r,c,record.input_hash);
    if (!PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY')) enforcerError('model_key');
    record.state = 'reviewing'; record.phase = 'model_intent'; record.attempts++; record.run_id = Utilities.getUuid(); enforcerSave(book,record);
    var proposal;
    try { proposal = enforcerReview(input); }
    catch (e) {
      if (e.enforcerCode && /^(model_|review_|limit_|quota)/.test(e.enforcerCode)) { if (e.enforcerRejectedReview && executorJson(e.enforcerRejectedReview).length <= 26000) enforcerAppend(book,record,'rejected_proposal',{review:e.enforcerRejectedReview,evidence:e.enforcerModelEvidence,diagnostic:e.enforcerDiagnostic || e.enforcerCode}); record.phase = 'model_failed'; record.state = 'failed'; record.reason = e.enforcerCode; record.model = e.enforcerModelEvidence || {}; enforcerSave(book,record); }
      throw e;
    }
    if (proposal.provider_review) { enforcerAppend(book,record,'provider_review',proposal.provider_review); delete proposal.provider_review; }
    enforcerAppend(book,record,'proposal',proposal);
    record.model = proposal.evidence; record.findings = proposal.review.findings.length; record.human_checks = proposal.review.coverage.filter(function(v) { return v.status === 'not_assessable' || v.status === 'unclear'; }).length;
    var report = enforcerRender(record,input,proposal.review); record.report_hash = executorHash(report.text);
    enforcerAppend(book,record,'report',report); record.phase = 'proposal_ready'; enforcerSave(book,record);
    enforcerFresh(book,r,c,record.input_hash); enforcerDeadline(started);
    record.state = 'publishing'; record.phase = 'create_intent'; enforcerSave(book,record);
    var file = executorGoogle('post','https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',{name:report.title,mimeType:'application/vnd.google-apps.document',parents:[c.outputs],appProperties:{enforcer_id:record.id,enforcer_key:record.key,payload_hash:record.report_hash}});
    if (!executorId(file.id)) enforcerError('create_unknown');
    record.report_id = file.id; record.report_url = 'https://docs.google.com/document/d/'+file.id+'/edit'; record.phase = 'doc_created'; enforcerSave(book,record);
    enforcerReportMeta(record,c); record.report_revision = enforcerWriteReport(record,report); record.phase = 'content_written'; enforcerSave(book,record);
    enforcerFresh(book,r,c,record.input_hash);
    record.state = 'complete'; record.phase = 'complete'; record.reason = ''; record.finished_at = executorNow(); enforcerSave(book,record);
    return enforcerPrint(record);
  } catch (e) {
    var reason = enforcerReason(e);
    if (record && book) {
      try {
        var tail = enforcerHistory(book)[record.key]; if (tail && tail.record) record = executorClone(tail.record);
        var uncertain = ['model_intent','proposal_ready','create_intent','doc_created','content_written'].indexOf(record.phase) >= 0;
        record.state = reason === 'stale' || (record.report_id && reason === 'source_changed') ? 'stale' : uncertain ? 'needs_reconciliation' : /^limit_/.test(reason) ? 'deferred' : 'blocked';
        record.reason = reason; enforcerSave(book,record);
      } catch (_) { return enforcerPrint(Object.assign({},record,{state:'needs_reconciliation',reason:'state_write_failure'})); }
      return enforcerPrint(record);
    }
    return enforcerPrint({state:'blocked',reason:reason});
  } finally { if (locked) { SpreadsheetApp.flush(); lock.releaseLock(); } }
}
function enforcerCandidates(folder, reviewId) {
  if (!executorId(folder) || !executorId(reviewId)) enforcerError('output_identity');
  var files = [], token = '', seen = {};
  do {
    var q = "'"+folder+"' in parents and trashed = false and appProperties has { key='enforcer_id' and value='"+reviewId+"' }";
    var page = executorGoogle('get','https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(q)+'&pageSize=100&fields=files(id,name,mimeType,appProperties),nextPageToken,incompleteSearch&supportsAllDrives=true&includeItemsFromAllDrives=true'+(token?'&pageToken='+encodeURIComponent(token):''));
    if (!Array.isArray(page.files) || page.incompleteSearch || page.files.some(function(f) { return !f.appProperties || f.appProperties.enforcer_id !== reviewId; })) enforcerError('incomplete_discovery');
    files = files.concat(page.files); token = page.nextPageToken || '';
    if (files.length > 8 || seen[token]) enforcerError('ambiguous_output');
    if (token) seen[token] = true;
  } while (token);
  return files;
}
function inspectEnforcerRecovery(options) {
  var c = enforcerConfig(options), book = getBoardBook(c.spreadsheetId), r = enforcerSelect(book,options), h = enforcerHistory(book)[enforcerKey(c,r)];
  if (!h || !h.record) enforcerError('review_missing');
  return {review:enforcerDescribe(h.record),phase:h.record.phase,candidates:enforcerCandidates(c.outputs,h.id).map(function(f) { var p = f.appProperties; return {id:f.id,verified_marker:p.enforcer_key === h.record.key && p.payload_hash === h.record.report_hash}; }),automatic_recreate_allowed:false};
}
function reconcileEnforcer(reviewId, decision, options) {
  if (!decision || !decision.reviewed_by || !decision.reason || ['adopt','finish_known','repair_projection','retry_model','publish_saved','close_failed'].indexOf(decision.action) < 0) enforcerError('human_decision');
  var c = enforcerConfig(options), book = getBoardBook(c.spreadsheetId), lock = LockService.getScriptLock(); lock.waitLock(1000);
  try {
    var h = Object.values(enforcerHistory(book)).filter(function(h) { return h.id === reviewId; })[0];
    if (!h || !h.record) enforcerError('review_missing');
    var record = executorClone(h.record);
    if (decision.action === 'repair_projection') { enforcerProject(book,record,true); return enforcerPrint(record); }
    if (['complete','stale','closed'].indexOf(record.state) >= 0) return enforcerPrint(record);
    if (decision.action === 'close_failed') {
      // Only known failures before publication can close. Unknown model/create/write outcomes cannot be abandoned here.
      if (['preflight','model_failed'].indexOf(record.phase) < 0 || record.report_id || h.report || h.proposal) enforcerError('human_decision');
      enforcerAppend(book,record,'decision',decision); record.state = 'closed'; record.reason = 'failure_inspected'; record.closed_at = executorNow(); enforcerSave(book,record); return enforcerPrint(record);
    }
    var r = enforcerRequests(book).filter(function(r) { return enforcerKey(c,r) === record.key; });
    if (r.length !== 1) enforcerError('request'); r = r[0];
    if (decision.action === 'publish_saved') {
      // This action is safe only before any durable create intent, never after an ambiguous create.
      if (['model_intent','proposal_ready'].indexOf(record.phase) < 0 || !h.proposal || h.events.some(function(e) { return e.type === 'state' && ['create_intent','doc_created','content_written','complete'].indexOf(e.value.phase) >= 0; })) enforcerError('human_decision');
      var input = enforcerFresh(book,r,c,record.input_hash); enforcerValidate(h.proposal.review,input);
      record.model = h.proposal.evidence; record.findings = h.proposal.review.findings.length; record.human_checks = h.proposal.review.coverage.filter(function(v) { return v.status === 'not_assessable' || v.status === 'unclear'; }).length;
      var saved = h.report || enforcerRender(record,input,h.proposal.review); record.report_hash = executorHash(saved.text);
      if (!h.report) enforcerAppend(book,record,'report',saved);
      enforcerAppend(book,record,'decision',decision); executorFolder(c.outputs,c.root,true);
      record.state = 'publishing'; record.phase = 'create_intent'; enforcerSave(book,record);
      var made = executorGoogle('post','https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',{name:saved.title,mimeType:'application/vnd.google-apps.document',parents:[c.outputs],appProperties:{enforcer_id:record.id,enforcer_key:record.key,payload_hash:record.report_hash}});
      if (!executorId(made.id)) enforcerError('create_unknown');
      record.report_id = made.id; record.report_url = 'https://docs.google.com/document/d/'+made.id+'/edit'; record.phase = 'doc_created'; enforcerSave(book,record);
      h.report = saved;
    }
    if (decision.action === 'retry_model') {
      if (record.phase !== 'model_intent' || h.proposal || record.attempts >= 2) enforcerError('human_decision');
      enforcerFresh(book,r,c,record.input_hash); enforcerAppend(book,record,'decision',decision);
      record.state = 'failed'; record.phase = 'model_failed'; record.reason = 'explicit_model_retry'; enforcerSave(book,record); return enforcerPrint(record);
    }
    if (!h.report || executorHash(h.report.text) !== record.report_hash) enforcerError('proposal_missing');
    if (!record.report_id) {
      if (decision.action !== 'adopt' || record.phase !== 'create_intent') enforcerError('human_decision');
      var candidates = enforcerCandidates(c.outputs,record.id);
      if (candidates.length !== 1 || candidates[0].id !== decision.file_id) enforcerError('ambiguous_output');
      var p = candidates[0].appProperties;
      if (p.enforcer_key !== record.key || p.payload_hash !== record.report_hash) enforcerError('output_identity');
      record.report_id = decision.file_id; record.report_url = 'https://docs.google.com/document/d/'+decision.file_id+'/edit'; record.phase = 'doc_created'; enforcerSave(book,record);
    }
    enforcerReportMeta(record,c);
    var doc = enforcerDocument(record.report_id);
    if (!doc.text.trim()) { enforcerFresh(book,r,c,record.input_hash); record.report_revision = enforcerWriteReport(record,h.report); }
    else if (doc.text.replace(/\n+$/,'') !== h.report.text.replace(/\n+$/,'')) enforcerError('document_changed');
    enforcerAppend(book,record,'decision',decision);
    record.phase = 'complete';
    try { enforcerFresh(book,r,c,record.input_hash); record.state = 'complete'; record.reason = ''; }
    catch (_) { record.state = 'stale'; record.reason = 'stale'; }
    enforcerSave(book,record); return enforcerPrint(record);
  } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}
function requestEnforcerReview(reviewId, reason, requestedBy, options) {
  if (!reason || !requestedBy) enforcerError('human_decision');
  var c = enforcerConfig(options), book = getBoardBook(c.spreadsheetId), lock = LockService.getScriptLock(); lock.waitLock(1000);
  try {
    var h = Object.values(enforcerHistory(book)).filter(function(h) { return h.id === reviewId; })[0];
    if (!h || !h.record || ['complete','stale','closed'].indexOf(h.record.state) < 0) enforcerError('revision_request');
    var requests = enforcerRequests(book), existing = requests.filter(function(r) { return r.previous_review_id === reviewId; });
    if (existing.length) return existing[0];
    var prior = requests.filter(function(r) { return enforcerKey(c,r) === h.record.key; });
    if (prior.length !== 1) enforcerError('request');
    var r = executorClone(prior[0]); r.request_id = 'ERQ-'+Utilities.getUuid(); r.version = String(Number(r.version)+1); r.previous_review_id = reviewId; r.reason = reason; r.requested_by = requestedBy; r.requested_at = executorNow(); r.enabled = 'no';
    book.getSheetByName('Enforcer Requests').getRange(requests.length+2,1,1,ENFORCER_TABLES['Enforcer Requests'].length).setValues([ENFORCER_TABLES['Enforcer Requests'].map(function(k) { return safeCell(r[k]); })]);
    return r;
  } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}
