function getBoardBook() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Set SPREADSHEET_ID for remote execution');
  return book;
}
function ensureTab(book,name,headers) {
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (!sheet.getLastRow()) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  var actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (JSON.stringify(actual) !== JSON.stringify(headers)) throw new Error('Headers mismatch: ' + name);
  return sheet;
}
function dataRows(sheet,width) { return sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,width).getValues() : []; }
function setupBoard() {
  var book = getBoardBook();
  ensureTab(book,'Master Action Board',HEADERS).setFrozenRows(1);
  ensureTab(book,'Processed Sources',['source_id','processed_at','task_count','evidence']);
  return {spreadsheetUrl:book.getUrl()};
}
