// Filters live on the task board; setup does not create duplicate task tabs.
function setupWeek2Views(options) {
  var config = week2Config(options), book = getBoardBook(config.spreadsheetId);
  week2State(book);
  var board = hiveSheet(book,'Master Action Board');
  board.setFrozenRows(1);
  if (!board.getFilter()) board.getRange(1,1,board.getMaxRows(),HEADERS.length).createFilter();
  return {spreadsheetUrl:book.getUrl(),taskSheet:board.getName(),views:[],filters:['owner','status','due_date','risk_flag','okr_link']};
}
