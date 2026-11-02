function getBoardBook(spreadsheetId) {
  var id = spreadsheetId || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Set SPREADSHEET_ID for remote execution');
  return book;
}
// Storage keys remain stable while the everyday sheets use plain names.
function hiveSheet(book,name) {
  var alias = {'Master Action Board':'Tasks','Merge Reviews':'Reviews','Executor Executions':'Drafts'}[name];
  var legacy = book.getSheetByName(name), simple = alias && book.getSheetByName(alias);
  if (legacy && simple) throw new Error('Duplicate task-sheet names; reconcile ' + name + ' and ' + alias);
  return simple || legacy;
}
function ensureTab(book,name,headers) {
  var sheet = hiveSheet(book,name) || book.insertSheet(name);
  if (!sheet.getLastRow()) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  var actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (JSON.stringify(actual) !== JSON.stringify(headers)) throw new Error('Headers mismatch: ' + name);
  return sheet;
}
function setupExecutorNavigation(book) {
  ['Master Action Board','Merge Reviews','Executor Executions'].forEach(function(name) {
    var sheet = hiveSheet(book,name);
    if (!sheet) throw new Error('Missing required sheet: ' + name);
  });
  var names = {'Master Action Board':'Tasks','Merge Reviews':'Reviews','Executor Executions':'Drafts'};
  Object.keys(names).forEach(function(name) { hiveSheet(book,name).setName(names[name]).showSheet(); });
  book.getSheets().forEach(function(sheet) {
    if (['Tasks','Reviews','Drafts'].indexOf(sheet.getName()) < 0) sheet.hideSheet();
  });
}
function dataRows(sheet,width) { return sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,width).getValues() : []; }
function setupBoard(spreadsheetId) {
  var book = getBoardBook(spreadsheetId);
  ensureTab(book,'Master Action Board',HEADERS).setFrozenRows(1);
  ensureTab(book,'Processed Sources',['source_id','processed_at','task_count','evidence']);
  return {spreadsheetUrl:book.getUrl()};
}
