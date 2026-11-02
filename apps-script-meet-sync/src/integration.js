function runIntegrationTests() {
  var props = PropertiesService.getScriptProperties();
  var sandbox = props.getProperty('SANDBOX_SPREADSHEET_ID');
  var classroom = getBoardBook();
  if (!sandbox || sandbox === classroom.getId()) throw new Error('Integration requires a separate sandbox spreadsheet');
  var beforeClassroom = JSON.stringify(dataRows(hiveSheet(classroom,'Master Action Board'),16));
  setupBoard(sandbox);
  var source = {id:'SYN-TEST-' + Utilities.getUuid(),title:SYNTHETIC.title,date:SYNTHETIC.date,text:SYNTHETIC.text};
  var first = processTranscript(source,sandbox);
  if (!first.evidence || first.evidence.http_status !== 200) throw new Error('Live API call not verified');
  var board = hiveSheet(getBoardBook(sandbox),'Master Action Board');
  var rows = dataRows(board,16);
  var tasks = rows.filter(function(r) { return r[11] === source.id; });
  if (tasks.length < 3 || tasks.length > 4) throw new Error('Expected 3 or 4 source-grounded tasks; inspect board');
  if (!tasks.some(function(r) { return /question/i.test(r[1]) && r[2] === 'Morgan' && r[5] === '2026-10-30'; }) ||
      !tasks.some(function(r) { return /agenda/i.test(r[1]) && r[2] === 'Jordan' && /scope/i.test(r[8]) && !r[5]; }) ||
      !tasks.some(function(r) { return /quote|supplier/i.test(r[1]) && r[2] === 'Jordan' && !r[5]; }) ||
      tasks.some(function(r) { return r[5] === '2026-11-02' || /launch/i.test(r[1]); })) throw new Error('Source fidelity acceptance failed; inspect extraction');
  var target = rows.findIndex(function(r) { return r[11] === source.id; }) + 2;
  board.getRange(target,7).setValue('Reviewed by me');
  var before = JSON.stringify(dataRows(board,16));
  var rerun = processTranscript(source,sandbox);
  if (!rerun.skipped || rerun.added !== 0 || JSON.stringify(dataRows(board,16)) !== before) throw new Error('Rerun changed human-edited rows');
  if (JSON.stringify(dataRows(hiveSheet(classroom,'Master Action Board'),16)) !== beforeClassroom) throw new Error('Integration changed classroom rows');
  return {classroom_unchanged:true,passed:true,task_count:tasks.length,source_id:source.id,live_call:first.evidence,duplicate_free:true,human_edit_preserved:true,spreadsheetUrl:getBoardBook(sandbox).getUrl()};
}
