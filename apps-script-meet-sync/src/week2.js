function setupWeek2(options) {
  var config = week2Config(options), book = getBoardBook(config.spreadsheetId);
  week2State(book);
  return {spreadsheetUrl:book.getUrl(),inputFolderId:config.folderId};
}

function processInbox(options) { return week2Run(week2Config(options)); }
function processSelectedInbox() {
  var selected = PropertiesService.getScriptProperties().getProperty('WEEK2_SELECTED_FILE_IDS');
  if (!selected || !selected.trim()) throw new Error('Set WEEK2_SELECTED_FILE_IDS to the comma-separated Drive file IDs for this stage');
  return processInbox({sourceIds:selected.split(',').map(function(s) { return s.trim(); })});
}
function backfillInbox(options) {
  // Same completion checks and limits; createdAfter filters Drive creation time, not meeting date.
  return week2Run(week2Config(options));
}

function week2FailureMessage(error) {
  var message = String(error && error.message || '');
  var status = /^(Google input|OpenAI) HTTP (\d{3})\b/.exec(message);
  if (status) return status[1] + ' HTTP ' + status[2] + '; check access, service activation, credentials and quota, then retry manually.';
  if (/^(Require a title|Use exactly one document tab|Unsupported input|Transcript exceeds)/.test(message)) return 'Invalid source document; check native Docs format, single tab, title, meeting date, Transcript section and size.';
  if (/^(Concurrent edit|Concurrent manual formula)/.test(message)) return 'Concurrent manual edit detected; inspect the source journal before retrying.';
  if (/^Task has an unfinished/.test(message)) return 'A candidate task has unfinished writes from another source; reconcile it first.';
  return 'Input or proposal failed before completion; inspect access, metadata, API settings, task references and schema. Retry manually.';
}

function week2ProcessSource(source, config) {
  if (!source || typeof source.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(source.id) || typeof source.title !== 'string' || !source.title.trim() || !validDate(source.date) || typeof source.text !== 'string' || !source.text.trim() || source.text.length > 50000 || typeof source.url !== 'string' || !/^https:\/\/docs\.google\.com\/document\/d\/[\w-]+\/edit$/.test(source.url) || source.fingerprint !== week2Hash(JSON.stringify([source.title,source.date,source.text]))) throw new Error('Invalid Week 2 source');
  var book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var state = week2State(book), journals = state['Source Journal'];
    if (journals.some(function(r) { return r[0] === source.id && r[2] !== 'complete'; })) return {outcome:'needs_reconciliation',added:0};
    var marker = state['Processed Sources'].filter(function(r) { return r[0] === source.id; });
    if (marker.length > 1) throw new Error('Duplicate source completion key');
    if (marker.length) {
      var evidence = JSON.parse(marker[0][3]);
      return {outcome:evidence.fingerprint === source.fingerprint?'skipped':'changed_requires_review',added:0};
    }
    if (state['Master Action Board'].some(function(r) { return r[11] === source.id; }) || state['Task History'].some(function(r) { return r[1] === source.id; }) || state['Merge Reviews'].some(function(r) { return r[1] === source.id; })) return {outcome:'needs_reconciliation',added:0};
    var blockedIds = [];
    journals.filter(function(j) { return j[2] !== 'complete'; }).forEach(function(j) { blockedIds = blockedIds.concat(JSON.parse(j[3])); });
    var proposal = week2Propose(source,state['Master Action Board'],state['Task History']);
    var now = new Date().toISOString(), plan = week2Plan(source,state,proposal,now,blockedIds);
    var evidenceOut = {live_call:proposal.evidence,fingerprint:source.fingerprint,added:plan.added,updated:plan.updated,reviewed:plan.reviewed};
    plan.ops.push({tab:'Processed Sources',before:week2Blank(4),after:[source.id,now,proposal.actions.length,JSON.stringify(evidenceOut)]});
    week2Commit(book,source,plan,now);
    return {outcome:'processed',added:plan.added,updated:plan.updated,reviewed:plan.reviewed,evidence:proposal.evidence};
  } finally { lock.releaseLock(); }
}

function week2Run(config) {
  var started = Date.now(), runId = Utilities.getUuid(), book = getBoardBook(config.spreadsheetId);
  week2State(book);
  var files = week2Discover(config);
  var result = {run_id:runId,discovered:files.length,attempted:0,processed:0,skipped:0,failed:0,changed_requires_review:0,needs_reconciliation:0,deferred:0,added:0,updated:0,reviewed:0,results:[]};
  try { week2RecordDiscovery(book,files,runId); }
  catch (_) { result.discovery_log_failed = true; }
  for (var i=0;i<files.length;i++) {
    if (result.attempted >= config.maxSources || Date.now()-started >= config.budgetMs) { result.deferred = files.length-i; break; }
    var file = files[i], source = {id:'DRIVE-' + file.id,title:file.name,url:file.mimeType === 'application/vnd.google-apps.document'?'https://docs.google.com/document/d/' + file.id + '/edit':'https://drive.google.com/file/d/' + file.id + '/view'}, outcome;
    try {
      source = week2ReadSource(file);
      outcome = week2ProcessSource(source,config);
      // Completed sources do not use the attempt budget, so they cannot starve later inputs.
      if (outcome.outcome !== 'skipped') result.attempted++;
    } catch (error) {
      result.attempted++;
      var journal = week2ReadKey(book,'Source Journal',source.id).values;
      outcome = {outcome:journal[0] && journal[2] !== 'complete'?'needs_reconciliation':'failed',added:0};
      // Store only a controlled category, never provider bodies, tokens, or transcript text.
      outcome.message = outcome.outcome === 'failed'?week2FailureMessage(error):'Interrupted writes require inspectWeek2Recovery and explicit reconciliation.';
    }
    result[outcome.outcome]++;
    ['added','updated','reviewed'].forEach(function(k) { result[k] += outcome[k] || 0; });
    result.results.push({source_id:source.id,outcome:outcome.outcome,added:outcome.added || 0,updated:outcome.updated || 0,reviewed:outcome.reviewed || 0});
    if (outcome.message) result.results[result.results.length-1].message = outcome.message;
    try { week2RecordOutcome(book,source,outcome.outcome,runId,outcome.message || JSON.stringify({added:outcome.added || 0,updated:outcome.updated || 0,reviewed:outcome.reviewed || 0})); }
    catch (_) { result.results[result.results.length-1].log_failed = true; }
  }
  return result;
}
