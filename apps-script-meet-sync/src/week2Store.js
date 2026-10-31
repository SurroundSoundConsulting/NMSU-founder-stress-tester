function week2State(book) {
  var state = {};
  Object.keys(WEEK2_TABLES).forEach(function(name) {
    var existed = book.getSheetByName(name);
    var sheet = ensureTab(book,name,WEEK2_TABLES[name]);
    if (!existed) sheet.setFrozenRows(1);
    // Canonicalize literal formula-like text whether Sheets retains or consumes its escape.
    state[name] = dataRows(sheet,WEEK2_TABLES[name].length).map(function(row) { return row.map(safeCell); });
  });
  state._boardFormulas = {};
  if (state['Master Action Board'].length) {
    var formulas = book.getSheetByName('Master Action Board').getRange(2,1,state['Master Action Board'].length,16).getFormulas();
    state['Master Action Board'].forEach(function(row,i) { state._boardFormulas[row[0]] = formulas[i]; });
  }
  return state;
}

function week2ReadKey(book, name, key) {
  var sheet = ensureTab(book,name,WEEK2_TABLES[name]);
  var rows = dataRows(sheet,WEEK2_TABLES[name].length).map(function(row) { return row.map(safeCell); });
  var hits = rows.map(function(r,i) { return {row:i+2,values:r}; }).filter(function(r) { return r.values[0] === key; });
  if (hits.length > 1) throw new Error('Duplicate storage key in ' + name);
  return hits[0] || {row:sheet.getLastRow()+1,values:week2Blank(WEEK2_TABLES[name].length)};
}

function week2WriteKey(book, name, values) {
  var target = week2ReadKey(book,name,values[0]);
  var range = book.getSheetByName(name).getRange(target.row,1,1,values.length);
  range.setNumberFormat('@'); range.setValues([values]);
}

function week2AssertOperation(book, op, expected) {
  if (!WEEK2_TABLES[op.tab] || !Array.isArray(op.after) || op.after.length !== WEEK2_TABLES[op.tab].length) throw new Error('Invalid journal operation');
  var actual = week2ReadKey(book,op.tab,op.after[0]);
  if (!week2Equal(actual.values,expected)) throw new Error('Concurrent edit or unfinished write in ' + op.tab + '; inspect and reconcile manually');
  return actual.row;
}

function week2Commit(book, source, plan, now) {
  var serialized = JSON.stringify(plan);
  if (serialized.length > 44000) throw new Error('Source plan exceeds the journal cell limit; split the input');
  plan.ops.forEach(function(op) { week2AssertOperation(book,op,op.before); });
  // Durable intent comes before every board, baseline, history, review or marker write.
  week2WriteKey(book,'Source Journal',[source.id,source.fingerprint,'prepared',JSON.stringify(plan.task_ids),serialized,now,'']);
  SpreadsheetApp.flush();
  plan.ops.forEach(function(op) {
    var row = week2AssertOperation(book,op,op.before);
    var sheet = book.getSheetByName(op.tab);
    // On existing board rows write only changed cells, preserving unrelated manual columns.
    if (op.tab === 'Master Action Board' && op.before[0]) {
      op.after.forEach(function(value,col) {
        if (value !== op.before[col]) {
          var cell = sheet.getRange(row,col+1);
          if (cell.getFormula()) throw new Error('Concurrent manual formula; reconcile before overwriting');
          cell.setNumberFormat('@'); cell.setValue(value);
        }
      });
    } else {
      var range = sheet.getRange(row,1,1,op.after.length); range.setNumberFormat('@'); range.setValues([op.after]);
    }
    SpreadsheetApp.flush();
  });
  week2WriteKey(book,'Source Journal',[source.id,source.fingerprint,'complete',JSON.stringify(plan.task_ids),serialized,now,new Date().toISOString()]);
  SpreadsheetApp.flush();
}

function week2RecordOutcome(book, source, outcome, runId, message) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  var now = new Date().toISOString();
  week2WriteKey(book,'Source Registry',[source.id,source.fingerprint || '',safeCell(source.title || ''),source.date || '',source.url || '',outcome,now]);
  var sheet = ensureTab(book,'Run Log',WEEK2_TABLES['Run Log']);
  var row = [runId,now,source.id,'ingest',outcome,message || ''];
  var range = sheet.getRange(sheet.getLastRow()+1,1,1,row.length); range.setNumberFormat('@'); range.setValues([row]);
  } finally { lock.releaseLock(); }
}

function week2RecordDiscovery(book, files, runId) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sheet = ensureTab(book,'Source Registry',WEEK2_TABLES['Source Registry']);
    var known = dataRows(sheet,7).map(function(r) { return r[0]; }), now = new Date().toISOString();
    var discovered = files.filter(function(f) { return known.indexOf('DRIVE-' + f.id) < 0; });
    if (!discovered.length) return;
    var rows = discovered.map(function(f) { return ['DRIVE-' + f.id,'',safeCell(f.name || ''),'','https://docs.google.com/document/d/' + f.id + '/edit','discovered',now]; });
    var range = sheet.getRange(sheet.getLastRow()+1,1,rows.length,7); range.setNumberFormat('@'); range.setValues(rows);
    var log = ensureTab(book,'Run Log',WEEK2_TABLES['Run Log']);
    var logs = discovered.map(function(f) { return [runId,now,'DRIVE-' + f.id,'discovery','discovered','']; });
    var target = log.getRange(log.getLastRow()+1,1,logs.length,6); target.setNumberFormat('@'); target.setValues(logs);
  } finally { lock.releaseLock(); }
}

function inspectWeek2Recovery(sourceId, options) {
  var config = week2Config(options), book = getBoardBook(config.spreadsheetId);
  var journal = week2ReadKey(book,'Source Journal',sourceId).values;
  if (!journal[0]) throw new Error('Source journal not found');
  var plan = JSON.parse(journal[4]);
  return {source_id:sourceId,phase:journal[2],operations:plan.ops.map(function(op) {
    var observed = week2ReadKey(book,op.tab,op.after[0]).values;
    return {tab:op.tab,key:op.after[0],state:week2Equal(observed,op.after)?'applied':week2Equal(observed,op.before)?'not_applied':'changed',before:op.before,after:op.after,observed:observed};
  })};
}

// Explicit reconciliation only finishes a source whose work is already provably complete.
// Partial cells and human edits require manual inspection; nothing is blindly replayed.
function reconcileWeek2Source(sourceId, options) {
  var config = week2Config(options), book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var journal = week2ReadKey(book,'Source Journal',sourceId).values;
    if (!journal[0]) throw new Error('Source journal not found');
    if (journal[2] === 'complete') return {source_id:sourceId,already_complete:true};
    var plan = JSON.parse(journal[4]);
    var work = plan.ops.filter(function(op) { return op.tab !== 'Processed Sources'; });
    work.forEach(function(op) { week2AssertOperation(book,op,op.after); });
    var markers = plan.ops.filter(function(op) { return op.tab === 'Processed Sources'; });
    markers.forEach(function(op) {
      var actual = week2ReadKey(book,op.tab,op.after[0]).values;
      if (week2Equal(actual,op.before)) week2WriteKey(book,op.tab,op.after);
      else week2AssertOperation(book,op,op.after);
    });
    journal[2] = 'complete'; journal[6] = new Date().toISOString();
    week2WriteKey(book,'Source Journal',journal); SpreadsheetApp.flush();
    return {source_id:sourceId,reconciled:true};
  } finally { lock.releaseLock(); }
}
