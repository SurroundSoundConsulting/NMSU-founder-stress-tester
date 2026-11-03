function getBoardBook(spreadsheetId) {
  var id = spreadsheetId || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Set SPREADSHEET_ID for remote execution');
  return book;
}
function ensureTab(book,name,headers) {
  var sheet = sheetByName(book,name) || book.insertSheet(name);
  if (!sheet.getLastRow()) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  var actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (JSON.stringify(actual) !== JSON.stringify(headers)) throw new Error('Headers mismatch: ' + name);
  return sheet;
}
function dataRows(sheet,width) { return sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,width).getValues() : []; }
function setupBoard(spreadsheetId) {
  var book = getBoardBook(spreadsheetId);
  ensureTab(book,'Master Action Board',HEADERS).setFrozenRows(1);
  ensureTab(book,'Processed Sources',['source_id','processed_at','task_count','evidence']);
  return {spreadsheetUrl:book.getUrl()};
}

// Keep logical storage names stable, including previously recorded journal operations.
function sheetByName(book,name){var aliases={'Master Action Board':'Tasks','Tasks':'Master Action Board','Merge Reviews':'Reviews','Reviews':'Merge Reviews'},other=aliases[name],sheet=book.getSheetByName(name),alternate=other?book.getSheetByName(other):null;if(sheet&&alternate)throw new Error('duplicate_logical_sheet');return sheet||alternate;}
