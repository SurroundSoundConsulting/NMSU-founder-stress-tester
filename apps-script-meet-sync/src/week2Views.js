function setupWeek2Views(options) {
  var config = week2Config(options), book = getBoardBook(config.spreadsheetId);
  week2State(book);
  var settings = ensureTab(book,'View Settings',['setting','value']);
  var expected = ['reference_date','owner','okr_code'];
  if (settings.getLastRow() === 1) {
    var today = Utilities.formatDate(new Date(),'America/Denver','yyyy-MM-dd');
    var range = settings.getRange(2,1,3,2); range.setNumberFormat('@');
    range.setValues([['reference_date',today],['owner',''],['okr_code','']]);
  }
  var actual = settings.getRange(2,1,3,2).getValues();
  if (!week2Equal(actual.map(function(r) { return r[0]; }),expected) || !validDate(actual[0][1])) throw new Error('Invalid View Settings; use an ISO reference_date, owner, and okr_code in that order');
  var board = "'Master Action Board'!", data = board + 'A2:P', ids = board + 'A2:A', status = board + 'D2:D', due = board + 'F2:F';
  var monday = "DATEVALUE('View Settings'!B2)-WEEKDAY(DATEVALUE('View Settings'!B2),2)+1";
  var filters = {
    'Due This Week': 'FILTER(' + data + ',' + ids + '<>"",' + status + '<>"done",' + due + '>=TEXT(' + monday + ',"yyyy-mm-dd"),' + due + '<=TEXT(' + monday + '+6,"yyyy-mm-dd"))',
    'Blocked Work': 'FILTER(' + data + ',' + ids + '<>"",' + status + '="blocked")',
    'By Owner': 'SORT(FILTER(' + data + ',' + ids + '<>"",IF(\'View Settings\'!B3="",' + ids + '<>"",' + board + 'C2:C=\'View Settings\'!B3)),3,TRUE)',
    'At Risk': 'FILTER(' + data + ',' + ids + '<>"",' + status + '<>"done",REGEXMATCH(' + board + 'K2:K,"^(high|medium)$"))',
    'By OKR': 'FILTER(' + data + ',' + ids + '<>"",IF(\'View Settings\'!B4="",(' + board + 'J2:J<>"")*(' + board + 'J2:J<>"Unmapped"),' + board + 'J2:J=\'View Settings\'!B4))'
  };
  Object.keys(filters).forEach(function(name) {
    var sheet = ensureTab(book,name,HEADERS); sheet.setFrozenRows(1);
    var cell = sheet.getRange(2,1);
    if (cell.getValue() && !cell.getFormula()) throw new Error('View output contains manual values: ' + name);
    cell.setFormula('=IFERROR(' + filters[name] + ',"")');
  });
  return {spreadsheetUrl:book.getUrl(),reference_date:actual[0][1],views:Object.keys(filters)};
}
