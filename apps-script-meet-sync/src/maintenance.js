// Facilitator operations: explicitly invoked, never run by ingestion or tests.
function createIntegrationSandbox() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var classroom = getBoardBook();
    var id = props.getProperty('SANDBOX_SPREADSHEET_ID');
    if (!id || id === classroom.getId()) {
      id = SpreadsheetApp.create('Hive Mind — Integration Tests Only').getId();
      props.setProperty('SANDBOX_SPREADSHEET_ID',id);
    }
    setupBoard(id);
    return {classroomUrl:classroom.getUrl(),sandboxUrl:getBoardBook(id).getUrl(),separate:id !== classroom.getId()};
  } finally { lock.releaseLock(); }
}
function archiveClassroomTestRuns() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var book = getBoardBook();
    var board = ensureTab(book,'Master Action Board',HEADERS);
    var processed = ensureTab(book,'Processed Sources',['source_id','processed_at','task_count','evidence']);
    var before = dataRows(board,16);
    var isTest = function(id) { return /^SYN-TEST-[A-Za-z0-9-]+$/.test(String(id)); };
    var keep = before.filter(function(r) { return !isTest(r[11]); });
    if (keep.length === before.length) return {archived:0,remaining:keep.length,unchanged:true};
    var suffix = new Date().toISOString().replace(/[:.]/g,'-');
    var archiveBoard = board.copyTo(book).setName('Archive Board ' + suffix);
    var archiveSources = processed.copyTo(book).setName('Archive Sources ' + suffix);
    SpreadsheetApp.flush(); // Full copies, including human edits, exist before rows are removed.
    if (JSON.stringify(dataRows(archiveBoard,16)) !== JSON.stringify(before)) throw new Error('Archive verification failed; no rows removed');
    for (var i=before.length-1;i>=0;i--) if (isTest(before[i][11])) board.deleteRow(i+2);
    var sourceRows = dataRows(processed,4);
    for (var j=sourceRows.length-1;j>=0;j--) if (isTest(sourceRows[j][0])) processed.deleteRow(j+2);
    SpreadsheetApp.flush();
    if (JSON.stringify(dataRows(board,16)) !== JSON.stringify(keep)) throw new Error('Classroom preservation check failed; inspect archive copies');
    return {archived:before.length-keep.length,remaining:keep.length,preserved:true,archiveBoard:archiveBoard.getName(),archiveSources:archiveSources.getName()};
  } finally { lock.releaseLock(); }
}
function classroomSnapshot() {
  var book=getBoardBook();
  return {spreadsheetUrl:book.getUrl(),rows:dataRows(hiveSheet(book,'Master Action Board'),16)};
}
function verifyClassroomRerun() {
  var book=getBoardBook(),board=hiveSheet(book,'Master Action Board');
  var before=dataRows(board,16);
  var first=processSyntheticMeeting();
  if (!first.skipped || first.added !== 0 || JSON.stringify(dataRows(board,16)) !== JSON.stringify(before)) throw new Error('Classroom rerun changed rows');
  var index=before.findIndex(function(r) { return r[11] === SYNTHETIC.id; });
  if (index < 0) throw new Error('Classroom source missing');
  var cell=board.getRange(index+2,7),original=before[index][6],sentinel='Reviewed by me — QA preservation check';
  if (cell.getFormula()) throw new Error('QA refuses to modify a formula-bearing next_step cell');
  cell.setValue(sentinel);
  try {
    SpreadsheetApp.flush();
    var edited=JSON.stringify(dataRows(board,16));
    var second=processSyntheticMeeting();
    if (!second.skipped || second.added !== 0 || JSON.stringify(dataRows(board,16)) !== edited) throw new Error('Classroom edit was not preserved');
  } finally {
    if (cell.getValues()[0][0] !== sentinel) throw new Error('QA edit changed concurrently; cell left untouched, inspect before restoring');
    cell.setValue(original);
    SpreadsheetApp.flush();
  }
  if (JSON.stringify(dataRows(board,16)) !== JSON.stringify(before)) throw new Error('QA did not restore original classroom values');
  return {passed:true,rows_before:before.length,rows_after:board.getLastRow()-1,task_ids:before.map(function(r){return r[0];}),added:0,human_edit_preserved:true,original_values_restored:true};
}
