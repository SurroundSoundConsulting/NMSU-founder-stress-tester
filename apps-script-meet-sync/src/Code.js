function processSyntheticMeeting() { return processTranscript(SYNTHETIC); }
function processTranscript(source) {
  if (!source || typeof source.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(source.id) || typeof source.text !== 'string' || !source.text.trim() || typeof source.title !== 'string' || !validDate(source.date)) throw new Error('Invalid transcript');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var book = getBoardBook();
    var board = ensureTab(book,'Master Action Board',HEADERS);
    var processed = ensureTab(book,'Processed Sources',['source_id','processed_at','task_count','evidence']);
    var rows = dataRows(board,16);
    if (dataRows(processed,4).some(function(r) { return r[0] === source.id; })) return {source_id:source.id,added:0,skipped:true};
    // Rows can survive a failed processed-marker write. Never overwrite or append again.
    if (rows.some(function(r) { return r[11] === source.id; })) throw new Error('Source rows exist without completion marker; inspect and reconcile manually');
    var extraction = extractTasks(source);
    var maxId = rows.reduce(function(n,r) { var m = /^HM-(\d+)$/.exec(r[0]); return m ? Math.max(n,Number(m[1])) : n; },0);
    var now = new Date().toISOString();
    var added = extraction.items.map(function(item,i) { return buildRow(item,source,'HM-' + String(maxId+i+1).padStart(4,'0'),now); });
    if (added.length) {
      var target = board.getRange(board.getLastRow()+1,1,added.length,16);
      target.setNumberFormat('@'); // Preserve ISO date strings; avoid Sheet/time-zone coercion.
      target.setValues(added);
    }
    SpreadsheetApp.flush();
    var marker = processed.getRange(processed.getLastRow()+1,1,1,4);
    marker.setNumberFormat('@');
    marker.setValues([[source.id,now,added.length,JSON.stringify(extraction.evidence)]]);
    console.log(JSON.stringify({source_id:source.id,added:added.length,evidence:extraction.evidence}));
    return {source_id:source.id,added:added.length,evidence:extraction.evidence};
  } finally { lock.releaseLock(); }
}
