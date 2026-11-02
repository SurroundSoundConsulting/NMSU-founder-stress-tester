var W2_VIEWS=['Due This Week','Blocked Work','By Owner','Risk View','OKR View'];
function setupWeek2Views(){
  var book=getBoardBook(),settings=week2Table(book,'View Settings'),M="'Master Action Board'!";
  var dates='IFERROR(DATEVALUE('+M+'F2:F),N('+M+'F2:F))',ref="DATEVALUE('View Settings'!B2)",monday='('+ref+'-WEEKDAY('+ref+',2)+1)';
  var formulas=[
    '=IFERROR(FILTER('+M+'A2:P,'+M+'A2:A<>"",'+M+'D2:D<>"done",'+M+'F2:F<>"",'+dates+'>='+monday+','+dates+'<='+monday+'+6),"")',
    '=IFERROR(FILTER('+M+'A2:P,'+M+'D2:D="blocked"),"")',
    '=IFERROR(SORT(FILTER('+M+'A2:P,'+M+'A2:A<>"",IF(\'View Settings\'!B3="",'+M+'A2:A<>"",'+M+'C2:C=\'View Settings\'!B3)),3,TRUE),"")',
    '=IFERROR(FILTER('+M+'A2:P,'+M+'D2:D<>"done",REGEXMATCH('+M+'K2:K,"^(medium|high)$")),"")',
    '=IFERROR(FILTER('+M+'A2:P,'+M+'A2:A<>"",'+M+'J2:J<>"",ISNUMBER(MATCH('+M+'J2:J,\'OKR Registry\'!A2:A,0)),IF(\'View Settings\'!B4="",'+M+'A2:A<>"",'+M+'J2:J=\'View Settings\'!B4)),"")'
  ];
  W2_VIEWS.forEach(function(n,i){var sheet=ensureTab(book,n,HEADERS);sheet.setFrozenRows(1);var cell=sheet.getRange(2,1);if(cell.getFormula()&&cell.getFormula()!==formulas[i])throw new Error('view_formula_mismatch');if(!cell.getFormula()&&cell.getValues()[0][0]!=='')throw new Error('view_data_conflict');cell.setFormula(formulas[i]);});
  return {views:W2_VIEWS,reference_date:settings.getRange(2,2).getValues()[0][0]};
}
function week2ViewRows(rows,settings,objectives){
  var ref=new Date(settings.reference_date+'T00:00:00Z'),day=(ref.getUTCDay()+6)%7,start=new Date(ref.getTime()-day*86400000).toISOString().slice(0,10),end=new Date(ref.getTime()+(6-day)*86400000).toISOString().slice(0,10);
  return {due:rows.filter(function(r){return r[3]!=='done'&&r[5]&&String(r[5])>=start&&String(r[5])<=end;}),blocked:rows.filter(function(r){return r[3]==='blocked';}),owner:rows.filter(function(r){return !settings.owner||r[2]===settings.owner;}),risk:rows.filter(function(r){return r[3]!=='done'&&['medium','high'].includes(r[10]);}),okr:rows.filter(function(r){return (objectives||[]).includes(r[9])&&(!settings.okr||r[9]===settings.okr);})};
}
function session2Snapshot(){return {spreadsheetUrl:getBoardBook().getUrl(),state:week2Capture(getBoardBook()),views:W2_VIEWS.reduce(function(out,n){var s=getBoardBook().getSheetByName(n);out[n]=s?dataRows(s,16):[];return out;},{})};}
function session2HumanDeadline(){
  var book=getBoardBook(),state=week2State(book),ids=Object.keys(state.baselines).filter(function(id){return /hardware/i.test(state.baselines[id].identity.deliverable)&&!/freight|shipping|logistics/i.test(state.baselines[id].identity.deliverable)&&/arroyo/i.test(state.baselines[id].identity.project);});
  if(ids.length!==1)throw new Error('hardware_target_ambiguous');var id=ids[0],index=state.rows.findIndex(function(r){return r[0]===id;});
  if(state.rows[index][5]!=='2026-11-09'||state.baselines[id].fields.due_date!=='2026-11-09')throw new Error('deadline_edit_precondition_failed');
  var lock=LockService.getScriptLock();lock.waitLock(30000);try{var cell=book.getSheetByName('Master Action Board').getRange(index+2,6);if(cell.getFormula()||cell.getValues()[0][0]!=='2026-11-09')throw new Error('human_edit_or_formula_precondition_failed');cell.setValue('2026-11-12');}finally{lock.releaseLock();}
  return {task_id:id,current:'2026-11-12',baseline:state.baselines[id].fields.due_date,actor:Session.getActiveUser().getEmail()||'facilitator',purpose:'Lab Part 4 human edit, explicitly authorized'};
}
function session2Status(){var book=getBoardBook(),state=week2State(book),reviews=Object.values(week2Records(book,'Merge Reviews'));return {taskCount:state.rows.length,completionCount:dataRows(book.getSheetByName('Processed Sources'),4).length,tasks:state.rows.map(function(r){return {id:r[0],task:r[1],owner:r[2],status:r[3],due:r[5],next_step:r[6],blockers:r[7],dependencies:r[8],created_at:r[14],updated_at:r[15],source:r[11]};}),reviews:reviews,baselines:state.baselines,model_requests:Number(PropertiesService.getScriptProperties().getProperty('W2_MODEL_REQUESTS')||0)};}
