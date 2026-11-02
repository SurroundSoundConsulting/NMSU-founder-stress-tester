function executorResult(record) { return {execution_id:record.id,task_id:record.task_id,state:record.state,reason:record.reason || '',next_action:record.state === 'ready_for_review' ? 'Open the linked draft and review its facts and proposed agenda. Nothing has been sent.' : executorNextAction(record.reason),searched:record.searched || {},output_url:record.output_url || '',phase:record.phase}; }
function executorNextAction(reason) {
  var help = {context_missing:'Supply one approved scope with objective, audience, permitted demonstration, constraints, duration and sequence, plus all relevant original meeting sources.',context_approval:'Reviewer must inspect the synthetic source, pin its current text hash and explicitly approve the context binding.',access:'Check Apps Script scope consent, folder grants and file access. Do not broaden permissions or recreate a missing output automatically.',completion_unclassified:'Inspect the completion folder and explicitly bind or remove unrelated files from the search scope; no completion guess was made.',source_changed:'Inspect the changed source and its accepted fingerprint. Reapprove supporting context explicitly; reconcile changed completed transcripts through ingestion.',decision_scope:'Choose one authoritative scope/version explicitly. Do not select by title or modification time.',create_unknown:'Inspect the output folder and execution marker. Adopt only a verified unique match; no automatic second create is permitted.',review:'Resolve the relevant review or unfinished ingestion journal explicitly before execution.',dependency:'Provide/complete the prerequisite and clear current blockers with evidence; do not mark the dependent task done.'};
  return help[reason] || (reason && /^[a-z_]+$/.test(reason) ? 'Inspect the execution journal and evidence before retrying or requesting a new version.' : '');
}
function executorPermissions() {
  if (ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationStatus() !== ScriptApp.AuthorizationStatus.NOT_REQUIRED) executorError('access');
}
function executorReason(error) { var m = /^Executor ([a-z_]+)$/.exec(String(error && error.message || '')); return m ? m[1] : 'unexpected_failure'; }
function executorRetryable(record) { return ['blocked','failed','deferred'].indexOf(record.state) >= 0 && ['preflight','model'].indexOf(record.phase) >= 0; }
function executorFresh(book, r, config, expected, allowDone) {
  var actualRequest = executorRequests(book).filter(function(v) { return v.request_id === r.request_id; })[0];
  if (!actualRequest) executorError('stale');
  var snap = executorSnapshot(book,actualRequest,config);
  if (snap.block) executorError('stale');
  var ctx = executorContext(book,actualRequest,config,snap);
  if (ctx.hash !== expected || (ctx.done && !allowDone)) executorError('stale');
  return ctx;
}
function runExecutor(options) {
  options = options || {};
  var config = executorConfig(options), book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock();
  try { lock.waitLock(1000); } catch (_) { return {state:'deferred',reason:'busy'}; }
  var entry, record, started = Date.now();
  try {
    var selectedId = options.requestId || PropertiesService.getScriptProperties().getProperty('EXECUTOR_SELECTED_REQUEST_ID');
    executorRead(book,'Executor Sources');
    var previews = previewExecutorSelection(options), requests = executorRequests(book);
    var selected = selectedId ? previews.filter(function(p) { return p.request_id === selectedId; })[0] : previews.filter(function(p) { return p.reason === 'eligible'; })[0];
    if (!selected) return {state:'deferred',reason:selectedId ? 'request_not_found' : 'no_eligible_request',selection:previews};
    var r = requests.filter(function(v) { return v.request_id === selected.request_id; })[0], key = executorKey(config,r);
    entry = executorHistory(book)[key];
    if (entry) {
      record = executorClone(entry.record);
      if (['ready_for_review','possibly_done','stale_requires_review'].indexOf(record.state) < 0 && !executorRetryable(record)) return {state:'needs_reconciliation',reason:'unfinished_execution',execution_id:record.id,phase:record.phase,output_url:record.output_url || ''};
      if (record.state === 'stale_requires_review') return executorResult(record);
      if (record.state === 'ready_for_review' || record.state === 'possibly_done') {
        try {
          if (record.reason === 'task_done') { var done = executorSnapshot(book,r,config); if (done.block !== 'task_done' || done.hash !== record.input_hash) executorError('stale'); }
          else executorFresh(book,r,config,record.context_hash,record.state === 'possibly_done');
          if (record.output_id) { var meta = executorMeta(record.output_id); if (meta.trashed) executorError('access'); }
        }
        catch (e) {
          record.state = 'stale_requires_review'; record.reason = executorReason(e); entry = executorSave(book,record,entry);
        }
        return executorResult(record);
      }
      if (record.attempts >= 2 && record.state === 'failed') return {state:'blocked',reason:'attempt_limit',execution_id:record.id};
    }
    var snap = executorSnapshot(book,r,config);
    if (!record) record = {key:key,id:'EX-'+Utilities.getUuid(),task_id:r.task_id,task:snap.task[1],owner:snap.task[2],due:snap.task[5],request:executorClone(r),attempts:0,run_id:Utilities.getUuid(),started_at:executorNow()};
    record.state = 'checking'; record.phase = 'preflight'; record.reason = ''; record.request = executorClone(r); record.input_hash = snap.hash;
    record.task = snap.task[1]; record.owner = snap.task[2]; record.due = snap.task[5];
    record.searched = {context_folder:config.contextFolder,completion_folder:config.completionFolder,transcript_sources:snap.sourceIds};
    entry = executorSave(book,record,entry);
    if (snap.block) { record.state = snap.block === 'task_done' ? 'possibly_done' : 'blocked'; record.reason = snap.block; entry = executorSave(book,record,entry); return executorResult(record); }
    // An explicit version must point to a previously published version, never an unfinished claim.
    var other = Object.values(executorHistory(book)).map(function(e) { return e.record; }).filter(function(e) { return e.task_id === r.task_id && e.id !== record.id; });
    if (other.length && (String(r.version) === '1' || !other.some(function(e) { return e.id === r.previous_execution_id && ['ready_for_review','stale_requires_review','possibly_done'].indexOf(e.state) >= 0; }) || other.some(function(e) { return ['ready_for_review','stale_requires_review','possibly_done'].indexOf(e.state) < 0; }))) executorError('revision_request');
    executorPermissions();
    var context = executorContext(book,r,config,snap);
    record.input_hash = snap.hash; record.context_hash = context.hash; record.snapshot = snap.snapshot;
    executorEvidence(book,record,context.sources);
    if (context.done) {
      record.state = 'possibly_done'; record.reason = 'Completion evidence: '+context.done.url; record.phase = 'complete';
      entry = executorSave(book,record,entry); return executorResult(record);
    }
    executorFolder(config.outputFolder,config.rootFolder,true);
    if (!PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY')) executorError('model_key');
    if (Date.now()-started > 180000) executorError('limit_runtime');
    record.state = 'drafting'; record.phase = 'model'; record.attempts++; entry = executorSave(book,record,entry);
    var proposal = executorDraft(r,snap.task,context);
    record.model = proposal.evidence; record.rendered = executorRender(record,proposal.draft,context.sources); record.content_hash = executorHash(record.rendered.text);
    record.phase = 'proposal_ready'; entry = executorSave(book,record,entry);
    executorFresh(book,r,config,record.context_hash);
    if (Date.now()-started > 180000) executorError('limit_runtime');
    record.state = 'publishing'; record.phase = 'create_intent'; entry = executorSave(book,record,entry);
    record.output_id = executorCreate(record,config); record.output_url = 'https://docs.google.com/document/d/'+record.output_id+'/edit'; record.phase = 'doc_created'; entry = executorSave(book,record,entry);
    record.output_revision = executorWriteDocument(record); record.phase = 'content_written'; entry = executorSave(book,record,entry);
    executorFresh(book,r,config,record.context_hash);
    record.state = 'ready_for_review'; record.phase = 'complete'; record.reason = 'Draft only; human review required. No external delivery.'; record.finished_at = executorNow();
    entry = executorSave(book,record,entry); return executorResult(record);
  } catch (error) {
    var reason = executorReason(error);
    // Always recover the durable tail; a save may have committed before its projection failed.
    if (record) {
      var tail = executorHistory(book)[record.key];
      if (tail) { entry = tail; record = executorClone(tail.record); }
      if (error.executorModelEvidence) record.rejected_model_evidence = error.executorModelEvidence;
      var uncertain = ['create_intent','doc_created','content_written'].indexOf(record.phase) >= 0;
      record.state = reason === 'stale' ? 'stale_requires_review' : uncertain ? 'needs_reconciliation' : /^(context_|completion_|decision_|dependency|review|source_|access|identity|revision_)/.test(reason) ? 'blocked' : /^limit_/.test(reason) ? 'deferred' : 'failed';
      record.reason = uncertain && record.phase === 'create_intent' ? 'create_unknown' : reason;
      try { entry = executorSave(book,record,entry); } catch (_) { return {state:'needs_reconciliation',reason:'state_write_failure',execution_id:record.id,phase:record.phase,output_url:record.output_url || ''}; }
      return executorResult(record);
    }
    return {state:/^limit_/.test(reason)?'deferred':'failed',reason:reason};
  } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}
function inspectExecutorRecovery(executionId, options) {
  var config = executorConfig(options), book = getBoardBook(config.spreadsheetId);
  var entry = Object.values(executorHistory(book)).filter(function(e) { return e.record.id === executionId; })[0];
  if (!entry) executorError('execution_missing');
  var record = entry.record, files = executorList(config.outputFolder).filter(function(f) { return f.appProperties && f.appProperties.executor_id === record.id; });
  return {execution:executorResult(record),journal_hash:entry.hash,candidates:files.map(function(f) { return {id:f.id,metadata_match:f.appProperties.executor_key === record.key && f.appProperties.payload_hash === record.content_hash}; }),automatic_recreate_allowed:false};
}
// Explicit recovery never issues another create. Unexpected content is preserved.
function reconcileExecutor(executionId, decision, options) {
  if (!decision || !decision.reviewed_by || !decision.reason || ['adopt','finish_known','repair_projection'].indexOf(decision.action) < 0) executorError('human_decision');
  var config = executorConfig(options), book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock(); lock.waitLock(1000);
  try {
    var entry = Object.values(executorHistory(book)).filter(function(e) { return e.record.id === executionId; })[0];
    if (!entry) executorError('execution_missing');
    var record = executorClone(entry.record);
    if (decision.action === 'repair_projection') { executorProject(book,record); return executorResult(record); }
    if (record.state === 'ready_for_review') return executorResult(record);
    if (!record.rendered || !record.content_hash) executorError('proposal_missing');
    if (!record.output_id) {
      var inspection = inspectExecutorRecovery(executionId,options);
      if (inspection.candidates.length !== 1 || inspection.candidates[0].id !== decision.file_id || !inspection.candidates[0].metadata_match) executorError('ambiguous_output');
      record.output_id = decision.file_id; record.output_url = 'https://docs.google.com/document/d/'+decision.file_id+'/edit';
      record.phase = 'doc_created'; record.recovery = decision; entry = executorSave(book,record,entry);
    }
    var meta = executorMeta(record.output_id);
    if (meta.trashed || (meta.parents || []).indexOf(config.outputFolder) < 0 || !meta.appProperties || meta.appProperties.executor_id !== record.id || meta.appProperties.payload_hash !== record.content_hash) executorError('output_identity');
    var doc = executorDocument(record.output_id);
    if (doc.text.trim()) record.output_revision = executorVerifyDocument(record);
    else {
      // A human explicitly elects to populate this known blank; revision guard protects intervening edits.
      executorFresh(book,record.request,config,record.context_hash);
      record.output_revision = executorWriteDocument(record);
    }
    record.phase = 'content_written'; record.recovery = decision; entry = executorSave(book,record,entry);
    try { executorFresh(book,record.request,config,record.context_hash); record.state = 'ready_for_review'; record.reason = 'Reconciled by '+decision.reviewed_by; }
    catch (_) { record.state = 'stale_requires_review'; record.reason = 'Inputs changed; retained recovered artifact for human review.'; }
    record.phase = 'complete'; entry = executorSave(book,record,entry); return executorResult(record);
  } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}
function requestExecutorRevision(taskId, priorExecutionId, reason, reviewedBy, options) {
  if (!reason || !reviewedBy) executorError('human_decision');
  var config = executorConfig(options), book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock(); lock.waitLock(1000);
  try {
    var prior = Object.values(executorHistory(book)).map(function(e) { return e.record; }).filter(function(r) { return r.task_id === taskId && r.id === priorExecutionId; })[0];
    if (!prior || ['ready_for_review','stale_requires_review'].indexOf(prior.state) < 0) executorError('revision_request');
    var requests = executorRequests(book), existing = requests.filter(function(r) { return r.previous_execution_id === priorExecutionId; });
    if (existing.length) return existing[0];
    var next = executorClone(prior.request); next.request_id = 'REQ-'+Utilities.getUuid(); next.version = String(Number(next.version)+1); next.previous_execution_id = priorExecutionId; next.revision_reason = reason; next.requested_by = reviewedBy; next.requested_at = executorNow(); next.no_known_completion_at = next.requested_at;
    executorRequestValid(next);
    var sheet = hiveSheet(book,'Executor Requests'); sheet.getRange(sheet.getLastRow()+1,1,1,14).setValues([EXECUTOR_TABLES['Executor Requests'].map(function(k) { return safeCell(next[k]); })]); SpreadsheetApp.flush();
    return next;
  } finally { lock.releaseLock(); }
}
