function executorResult(record) { return executorDescribeResult({execution_id:record.id,task_id:record.task_id,state:record.state,reason:record.reason || '',searched:record.searched || {},output_url:record.output_url || '',phase:record.phase}); }
function executorLegacyNextAction(reason, original) {
  var help = {context_missing:'Supply one approved scope with objective, audience, permitted demonstration, constraints, duration and sequence, plus all relevant original meeting sources.',context_approval:'Reviewer must inspect the synthetic source, pin its current text hash and explicitly approve the context binding.',access:'Check Apps Script scope consent, folder grants and file access. Do not broaden permissions or recreate a missing output automatically.',completion_unclassified:'Inspect the completion folder and explicitly bind or remove unrelated files from the search scope; no completion guess was made.',source_changed:'Inspect the changed source and its accepted fingerprint. Reapprove supporting context explicitly; reconcile changed completed transcripts through ingestion.',decision_scope:'Choose one authoritative scope/version explicitly. Do not select by title or modification time.',create_unknown:'Inspect the output folder and execution marker. Adopt only a verified unique match; no automatic second create is permitted.',review:'Resolve the relevant review or unfinished ingestion journal explicitly before execution.',dependency:'Provide/complete the prerequisite and clear current blockers with evidence; do not mark the dependent task done.'};
  Object.assign(help,{source_link:'Paste a Google Docs document link or file ID in file_id; pasted source text and other websites are not accepted.',select_request:'Select one request using EXECUTOR_SELECTED_REQUEST_ID before preparing its sources.',disable_request:'Set this request enabled=no before preparing changed source settings.',context_edited:'Source settings changed during preparation. Inspect them and prepare again; human edits were not overwritten.',published_context:'Use a separate context set for an explicitly reviewed new version. Published draft context is preserved.'});
  help.context_approval = 'Keep approved=no, paste the Doc link, and run prepareExecutorContext to fill its ID and fingerprint. Open and review the source before setting approved=yes yourself.';
  if (original && reason === 'context_approval') return 'Reviewer must inspect the synthetic source, pin its current text hash and explicitly approve the context binding.';
  return help[reason] || (reason && /^[a-z_]+$/.test(reason) ? 'Inspect the execution journal and evidence before retrying or requesting a new version.' : '');
}
function executorPermissions() {
  if (ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationStatus() !== ScriptApp.AuthorizationStatus.NOT_REQUIRED) executorError('access');
}
function executorReason(error) { if (error && /^[a-z_]+$/.test(error.executorCode || '')) return error.executorCode; var m = /^Executor ([a-z_]+)$/.exec(String(error && error.message || '')); return m ? m[1] : 'unexpected_failure'; }
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
  var result;
  try { result = executeExecutorRequest(options); }
  catch (error) { result = {state:'failed',reason:executorReason(error)}; }
  return executorPrintResult(executorDescribeResult(result));
}
function executeExecutorRequest(options) {
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

// Human-facing copy is separate from the machine state and journal reason codes.
function executorDescribeResult(result) {
  var state = result.state, reason = result.reason || '', output = result.output_url || '';
  var evidence = /^Completion evidence: (https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\/edit)$/.exec(reason);
  var copy;
  if (state === 'ready_for_review') copy = ['Ready for review','Your draft is saved. The business task has not been marked done.','Open the linked draft and review its facts and proposed agenda. Nothing has been sent.'];
  else if (state === 'stale_requires_review') copy = output ? ['Draft needs another check','The task, sources or access changed after this draft was saved. Your existing draft is retained.','Open the existing draft and check the changed inputs. Request a new version deliberately; do not replace reviewer edits.'] : ['Inputs changed — review needed','The current task or sources no longer match the saved result.','Review the changed inputs and the previous result before requesting further drafting.'];
  else if (state === 'needs_reconciliation') copy = ['Check saved work before continuing','A write may be incomplete, or saved records do not match expectations. A draft may already exist.','Stop and inspect the linked document or Drafts folder with your coding assistant. Confirm what was saved before recovery; do not create another draft.'];
  else if (state === 'possibly_done') copy = reason === 'task_done' ? ['Task already marked done','The task board marks this work done. No new draft was created.','Check the task status and finished work before requesting any further drafting.'] : ['Work may already be complete','Completion evidence was found in the configured sources. No new draft was created.','Open the completion evidence and confirm whether this same work is finished.'];
  var messages = {
    context_missing:['Needs source information','The required scope or meeting context is missing or incomplete.','Add the required scope Doc and relevant original meetings. Check the scope audience, objective, permitted activities, limits, duration and sequence, then prepare and approve it.'],
    context_approval:['Needs source approval','A supporting source has not been prepared and accepted for this version.','Keep source approval at no and disable the request. Prepare the Doc link, open and review the actual source, then set approval to yes yourself.'],
    source_changed:['Source changed — review needed','A source no longer matches its accepted version.','Review the changed Doc before approving it again. Reconcile changed meeting transcripts through ingestion; preserve any existing draft.'],
    source_link:['Needs a Google Docs link','The source reference is not a supported Google Docs link or file ID.','Paste the native Google Doc link in the source settings. Put the actual source text in the Doc, not in that cell.'],
    context_binding:['Check the source selection','A source role, project or folder does not match this request.','Check that each source belongs to the intended work and configured folder. Correct the source settings before preparing again.'],
    decision_scope:['Choose the approved scope','More than one scope is bound to this request.','Choose one authoritative scope and version. Do not choose by title or modification time alone.'],
    dependency:['Waiting for a prerequisite','The task is blocked, is not open, or a prerequisite is unfinished.','Open Tasks and check this task and its prerequisites. Resolve the blocker with evidence before drafting.'],
    dependency_missing:['Prerequisite not found','A referenced prerequisite is missing from the task board.','Check the dependency task IDs in Tasks and restore or correct the missing reference.'],
    dependency_unresolved:['Clarify the prerequisite','The dependency does not identify specific task IDs.','Clarify which existing task must finish first, then update the dependency in Tasks.'],
    dependency_cycle:['Fix the dependency loop','The task depends on itself through a chain of prerequisites.','Review the dependency chain in Tasks and resolve the loop before drafting.'],
    review:['Needs a human decision','A relevant review or unfinished meeting update affects this work.','Open Reviews and resolve the decision for this task or its prerequisite. Ask your coding assistant to inspect an interrupted meeting update; leave unrelated reviews alone.'],
    source_review:['Meeting source needs attention','A relevant meeting source has a failed, changed or interrupted processing result.','Inspect that meeting’s processing result and reconcile it before drafting.'],
    not_enabled:['Not enabled for drafting','This request, task or owner is not currently allowed to proceed.','Check the request is enabled and the intended task and owner are allowed. Enable only work whose sources you have reviewed.'],
    disable_request:['Pause the request first','Pending source settings need preparation while drafting is disabled.','Set this request enabled=no, prepare and review the source, then enable it when ready.'],
    select_request:['Choose one request','Source preparation cannot determine which request you intended.','Select the intended request in the existing execution settings with your coding assistant, then prepare its sources.'],
    request_not_found:['Selected request not found','The selected request is not in the request settings.','Check the selected request ID against the existing request settings. No draft was created.'],
    no_eligible_request:['No task ready for drafting','No request passed the task-selection checks. Source readiness has not been established.','Check enabled requests, allowed tasks and owners, open status, prerequisites and relevant Reviews.'],
    eligible:['Task eligible','Task-selection checks passed. Supporting sources and access still need checking.','Run drafting when ready; it will check context before making a model call.'],
    busy:['Another run is active','This run waited because the application is already working.','Let the active run finish, then check Drafts before running again.'],
    access:['Access needs attention','A required file or service could not be accessed.','Check Apps Script scope consent and access to the configured folders and documents. If a draft already exists, restore access rather than recreating it.'],
    model_key:['Model access needs setup','The application does not have its required model credential.','Check the private provider configuration with your coding assistant. Never paste credentials into a sheet, document or log.'],
    model_http:['Model service did not complete','The model service returned an unsuccessful response before a draft was saved.','Inspect the service result with your coding assistant and correct the cause before a permitted retry.'],
    quota:['Service limit reached','A provider or Google service reported a usage limit.','Wait for the service limit to clear and inspect the saved result before a deliberate retry. Repeated attempts remain limited.'],
    attempt_limit:['Retry limit reached','This execution has used its permitted model attempts.','Inspect the failed results and correct the cause with your coding assistant before requesting any further work.'],
    completion_unclassified:['Check possible finished work','The completed-work folder contains a document that has not been classified for this request.','Inspect that document. Bind it as completion evidence for the correct work or remove it from this search scope; do not guess.'],
    completion_grounding:['Completion evidence needs checking','The claimed completion passage was not found in its source.','Open the completion Doc and correct the evidence binding before using it to suppress drafting.'],
    published_context:['Keep the existing context intact','This context set has already been used by published or unfinished work.','Use a separate context set for an explicitly reviewed new version. Keep the existing draft and history.'],
    context_edited:['Source settings changed','Someone edited the settings while preparation was reading sources.','Review the current settings, then prepare again. Human edits were not overwritten.'],
    revision_request:['Check the draft version','This request does not identify an allowed new version of the existing work.','Open the existing draft first. Use the explicit new-version control with a reason and predecessor rather than making a duplicate request.'],
    identity:['Check which task this is','The task and source history do not establish the supported Arroyo agenda work.','Check the task ID, deliverable and source history. A similarly named task for another engagement is different work.'],
    task_missing:['Task not found','The requested task is absent from Tasks.','Select an existing task by its stable ID; do not substitute a row number.'],
    document_tabs:['Use a supported source Doc','The source has more than one document tab, which this source reader does not support.','Provide a suitable single-tab source Doc and review its source binding.'],
    configuration:['Check execution settings','Required execution settings are missing or inconsistent.','Ask your coding assistant to check the existing sheet destination, source/output folders, task selection and reference date.'],
    protected_destination:['Check the target sheet','Execution has no explicit destination or points at a protected workbook.','Choose the intended active execution sheet. Keep the original teaching checkpoint protected.'],
    unexpected_failure:['Run stopped — inspection needed','The application stopped unexpectedly. Do not assume the work was completed.','Inspect Drafts and the saved result with your coding assistant before trying again.']
  };
  if (!copy) copy = messages[reason];
  if (!copy && /^draft_|^model_/.test(reason)) copy = ['Draft could not be accepted','The model response failed a format, grounding or content check.','Inspect the rejected proposal and its sources with your coding assistant. Correct the cause before a permitted retry.'];
  if (!copy && /^limit_/.test(reason)) copy = ['Run limit reached','The work exceeds a configured size, record or time limit.','Narrow the selected work or source set with your coding assistant. Do not discard required context or blindly rerun.'];
  if (!copy && /^(schema|missing_schema|manual_formula|duplicate_key|duplicate_request|task_id|journal_integrity|evidence_conflict|projection_conflict|concurrent_state|state_write_failure|history_grounding|output_identity|document_changed|ambiguous_output|proposal_missing|execution_missing|human_decision|create_unknown|unfinished_execution)$/.test(reason)) copy = ['Saved work needs inspection','Stored settings, source evidence or saved output could not be verified.','Stop and inspect the existing records and any draft with your coding assistant. Preserve human edits; do not clear history or create another draft to bypass this result.'];
  if (!copy && /^(google_http|google_response|incomplete_discovery)$/.test(reason)) copy = ['Service check did not finish','Google did not return a complete, usable response.','Check service access and the saved outcome before deciding whether a retry is safe.'];
  if (!copy) copy = {checking:['Checking task and sources','The application is checking whether this work can proceed.','Wait for the result; do not start another run.'],drafting:['Writing the draft','The application is requesting a draft from the model.','Wait for the result; do not start another run.'],publishing:['Saving the draft','The application is saving the document and its link.','Wait for the result. If interrupted, check what was saved before retrying.']}[state] || ['Run needs attention','The application returned a result that needs inspection.','Check Drafts and the saved result with your coding assistant before continuing.'];
  return Object.assign({},result,{status:copy[0],message:copy[1],next_action:copy[2],document_url:output || (evidence ? evidence[1] : '')});
}
function executorNextAction(reason) { return executorDescribeResult({state:'blocked',reason:reason}).next_action; }
function executorPrintResult(result) {
  console.log('Status: '+result.status+'\n'+result.message+'\nNext step: '+result.next_action+(result.document_url ? '\nDocument: '+result.document_url : ''));
  (result.selection || []).slice(0,10).forEach(function(item) { console.log((item.task || item.task_id)+': '+item.status+'\nNext step: '+item.next_action); });
  return result;
}
function executorVisibleError(error) {
  var reason = executorReason(error), display = executorDescribeResult({state:'blocked',reason:reason});
  var visible = new Error(display.status+'. '+display.message+' Next step: '+display.next_action);
  visible.executorCode = reason;
  return visible;
}
