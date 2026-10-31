// Additive upgrade of the participant's existing Week 1 application and workbook.
// Backups and integration copies are facilitator/recovery tools, not a weekly restart.
function week2UpgradeSnapshot(book) {
  var snapshot = {};
  ['Master Action Board','Processed Sources'].forEach(function(name) {
    var sheet = book.getSheetByName(name);
    if (!sheet || !sheet.getLastRow()) throw new Error('Complete the Week 1 setup before upgrading');
    var width = name === 'Master Action Board' ? 16 : 4;
    var range = sheet.getRange(1,1,sheet.getLastRow(),width);
    snapshot[name] = {values:range.getValues(),formulas:range.getFormulas()};
  });
  return snapshot;
}

function week2UpgradePreflight(book) {
  var snapshot = week2UpgradeSnapshot(book);
  // Validate every existing destination before adding any tabs. Never rewrite a header.
  Object.keys(WEEK2_TABLES).forEach(function(name) {
    var sheet = book.getSheetByName(name);
    if (sheet && sheet.getLastRow() && !week2Equal(sheet.getRange(1,1,1,WEEK2_TABLES[name].length).getValues()[0],WEEK2_TABLES[name])) throw new Error('Headers mismatch: ' + name);
  });
  var rows = snapshot['Master Action Board'].values.slice(1), ids = rows.map(function(r) { return r[0]; });
  if (new Set(ids).size !== ids.length || ids.some(function(id) { return typeof id !== 'string' || !/^HM-\d+$/.test(id); })) throw new Error('Invalid or duplicate existing task IDs; reconcile before upgrade');
  var sources = snapshot['Processed Sources'].values.slice(1).map(function(r) { return r[0]; });
  if (new Set(sources).size !== sources.length || sources.some(function(id) { return typeof id !== 'string' || !id; })) throw new Error('Invalid or duplicate source completion records');
  return snapshot;
}

function upgradeWeek1(options) {
  options = Object.assign({},options || {},{mode:'upgrade'});
  // This command chooses the original board even if an old sandbox setting remains.
  if (!options.spreadsheetId) options.spreadsheetId = getBoardBook().getId();
  var config = week2Config(options), book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var before = week2UpgradePreflight(book);
    var state = week2State(book);
    if (!week2Equal(week2UpgradeSnapshot(book),before)) throw new Error('Existing Week 1 data changed during upgrade; inspect before proceeding');
    // Deliberately do not manufacture machine baselines for old, potentially edited rows.
    PropertiesService.getScriptProperties().setProperties({WEEK2_MODE:'upgrade',WEEK2_SPREADSHEET_ID:config.spreadsheetId,WEEK2_INBOX_FOLDER_ID:config.folderId},false);
    return {upgraded:true,spreadsheetUrl:book.getUrl(),existing_tasks:before['Master Action Board'].values.length-1,existing_completed_sources:before['Processed Sources'].values.length-1,old_values_and_formulas_preserved:true,legacy_tasks_without_baseline:state['Master Action Board'].filter(function(row) { return !state['Task Baselines'].some(function(b) { return b[0] === row[0]; }); }).map(function(r) { return r[0]; })};
  } finally { lock.releaseLock(); }
}
