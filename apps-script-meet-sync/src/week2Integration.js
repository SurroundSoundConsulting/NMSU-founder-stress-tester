// Runs the class A-D acceptance sequence using configured test copies and a dedicated sheet.
// A second invocation rechecks the completed state without repeating extraction or edits.
function runWeek2IntegrationTests() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WEEK2_TEST_SPREADSHEET_ID'), folder = props.getProperty('WEEK2_TEST_INBOX_FOLDER_ID');
  if (!id || !folder || id === props.getProperty('WEEK2_SPREADSHEET_ID') || folder === props.getProperty('WEEK2_INBOX_FOLDER_ID')) throw new Error('Week 2 integration requires separate test spreadsheet and input copies');
  var config = week2Config({spreadsheetId:id,folderId:folder,maxSources:4});
  var sequence = (props.getProperty('WEEK2_TEST_SEQUENCE') || '').split(',').map(function(s) { return s.trim(); });
  if (sequence.length !== 4 || new Set(sequence).size !== 4 || sequence.some(function(s) { return !/^[\w-]+$/.test(s); })) throw new Error('Set WEEK2_TEST_SEQUENCE to the four copied A-D file IDs in order');
  // Read-only snapshots must not initialize or modify any classroom tabs.
  function snapshot(bookId) {
    if (!bookId) return '';
    var book = getBoardBook(bookId), state = {};
    Object.keys(WEEK2_TABLES).forEach(function(name) {
      var sheet = book.getSheetByName(name);
      if (!sheet) state[name] = null;
      else {
        var range = sheet.getRange(1,1,Math.max(1,sheet.getLastRow()),WEEK2_TABLES[name].length);
        state[name] = {values:range.getValues(),formulas:range.getFormulas()};
      }
    });
    return JSON.stringify(state);
  }
  var protectedIds = [props.getProperty('SPREADSHEET_ID'),props.getProperty('SANDBOX_SPREADSHEET_ID'),props.getProperty('WEEK2_SPREADSHEET_ID')];
  var before = protectedIds.map(snapshot), book = getBoardBook(id);
  try {
    var state = week2State(book), completed = state['Processed Sources'];
    var expectedSources = sequence.map(function(s) { return 'DRIVE-' + s; });
    var reused = completed.length > 0;
    if (reused && (completed.length !== 4 || completed.some(function(r) { return expectedSources.indexOf(r[0]) < 0; }))) throw new Error('Use a fresh test sheet or reconcile the incomplete acceptance sequence first');
    var taskIds = [], stages = [];
    function oneTask(rows, pattern) {
      var found = rows.filter(function(r) { return pattern.test(r[1]); });
      if (found.length !== 1) throw new Error('Acceptance task identity is missing or ambiguous');
      return found[0];
    }
    if (!reused) {
      for (var index=0;index<4;index++) {
        var result = processInbox({spreadsheetId:id,folderId:folder,maxSources:1,sourceIds:[sequence[index]]});
        stages.push(result);
        if (result.processed !== 1 || result.failed || result.needs_reconciliation || result.changed_requires_review) throw new Error('Live acceptance stage failed; inspect the test sheet logs');
        var rows = dataRows(book.getSheetByName('Master Action Board'),16);
        if (index === 0) {
          if (rows.length !== 5) throw new Error('Meeting A must create five distinct tasks');
          taskIds = rows.map(function(r) { return {id:r[0],created:r[14],source:r[11]}; });
        }
        if (index === 1) {
          if (rows.length !== 6) throw new Error('Meeting B must retain five tasks and add one distinct task');
          var hardware = oneTask(rows,/hardware|supplier|Sierra|Desert/i);
          if (hardware[2] !== 'Morgan' || hardware[5] !== '2026-11-09') throw new Error('Hardware reassignment/deadline update failed');
          var boardRow = rows.findIndex(function(r) { return r[0] === hardware[0]; })+2;
          book.getSheetByName('Master Action Board').getRange(boardRow,6).setValue('2026-11-12');
        }
      }
    }
    var final = week2State(book), rows = final['Master Action Board'];
    if (rows.length !== 6 || final['Processed Sources'].length !== 4 || final['Merge Reviews'].filter(function(r) { return r[6] === 'pending'; }).length !== 2) throw new Error('Expected six tasks, four completed sources and two pending reviews');
    taskIds.forEach(function(t) {
      var row = rows.filter(function(r) { return r[0] === t.id; })[0];
      if (!row || row[14] !== t.created || row[11] !== t.source) throw new Error('Task ID, creation time or original provenance changed');
    });
    var agenda = oneTask(rows,/agenda/i), hardware = oneTask(rows,/hardware|supplier|Sierra|Desert/i), internal = oneTask(rows,/internal|readiness|bench|packing/i), customer = oneTask(rows,/customer|onboarding/i), scope = oneTask(rows,/^share.*scope|^send.*scope/i), freight = oneTask(rows,/freight|shipping|transit/i);
    if (agenda[3] !== 'open' || agenda[5] !== '2026-11-06' || agenda[7] || hardware[2] !== 'Morgan' || hardware[5] !== '2026-11-12' || internal[3] !== 'done' || customer[3] !== 'open' || scope[3] !== 'done' || freight[2] !== 'Jordan' || freight[5] !== '2026-11-06') throw new Error('Final semantic task state failed; inspect source evidence');
    var taskSnapshot = JSON.stringify(['Master Action Board','Task Baselines','Task History','Merge Reviews','Processed Sources'].map(function(n) { return final[n]; }));
    var rerun = processInbox({spreadsheetId:id,folderId:folder,maxSources:4,sourceIds:sequence});
    var after = week2State(book);
    if (rerun.skipped !== 4 || taskSnapshot !== JSON.stringify(['Master Action Board','Task Baselines','Task History','Merge Reviews','Processed Sources'].map(function(n) { return after[n]; }))) throw new Error('Full rerun changed persistent task state');
    setupWeek2Views({spreadsheetId:id,folderId:folder});
    book.getSheetByName('View Settings').getRange(2,2).setValue('2026-11-04');
    return {passed:true,reused_completed_sequence:reused,task_count:6,pending_reviews:2,classroom_unchanged:true,stages:stages,source_evidence:after['Processed Sources'].map(function(r) { return {source_id:r[0],evidence:JSON.parse(r[3])}; }),views_require_visual_check:true,spreadsheetUrl:book.getUrl()};
  } finally {
    if (!week2Equal(protectedIds.map(snapshot),before)) throw new Error('Integration changed a protected classroom sheet');
  }
}
