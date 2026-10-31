const {test}=require('node:test');
const assert=require('node:assert/strict');
const {week2Harness,action}=require('./week2-harness.cjs');

function seedWeek1(h) {
  const book=h.books.get('classroom'),board=book.tabs.get('Master Action Board'),ledger=book.tabs.get('Processed Sources');
  board.rows.push(['HM-0008','Prepare the original project brief','Alex','open',0,'2026-10-30','Human-reviewed next step','','','','','SYN-MTG-001','Earlier project planning','2026-10-26','2026-10-27T12:00:00Z','2026-10-27T12:00:00Z']);
  ledger.rows.push(['SYN-MTG-001','2026-10-27T12:00:00Z',1,'{"provider":"OpenAI","http_status":200}']);
  board.formulas['2:7']='="Human-reviewed next step"';
  return {board,ledger};
}

test('in-place upgrade preserves Week 1 rows, formulas, completion records and private configuration',()=>{
  const h=week2Harness(),{board,ledger}=seedWeek1(h);
  const before=JSON.stringify([board.rows,board.formulas,ledger.rows]),key=h.properties.get('OPENAI_API_KEY');
  const result=h.ctx.upgradeWeek1();
  assert.equal(result.upgraded,true);assert.equal(result.existing_tasks,1);assert.equal(result.existing_completed_sources,1);
  assert.equal(h.properties.get('SPREADSHEET_ID'),'classroom');assert.equal(h.properties.get('WEEK2_SPREADSHEET_ID'),'classroom');assert.equal(h.properties.get('WEEK2_MODE'),'upgrade');assert.equal(h.properties.get('OPENAI_API_KEY'),key);
  assert.equal(JSON.stringify([board.rows,board.formulas,ledger.rows]),before);
  assert.equal(h.books.get('classroom').tabs.get('Task Baselines').rows.length,1);
  assert.equal(h.ctx.processSyntheticMeeting().skipped,true);assert.equal(h.calls(),0);
  const count=h.books.get('classroom').tabs.size;h.ctx.upgradeWeek1();assert.equal(h.books.get('classroom').tabs.size,count);assert.equal(JSON.stringify([board.rows,board.formulas,ledger.rows]),before);
});

test('new Week 2 work accumulates after existing IDs while legacy matches require review',()=>{
  const h=week2Harness(),{board,ledger}=seedWeek1(h);h.ctx.upgradeWeek1();
  const original=board.rows[1].slice(),q='Blair: Prepare a separate project budget by November 6, 2026.';
  h.addDoc('new','2026-11-02',q);h.setReply(()=>({actions:[action('new','',q,{task:'Prepare the new project budget',owner:'Blair',due_date:'2026-11-06'})]}));
  assert.equal(h.run(['new']).added,1);assert.equal(board.rows[2][0],'HM-0009');assert.deepEqual(board.rows[1],original);assert.equal(ledger.rows[1][0],'SYN-MTG-001');
  const update='Alex: Move the original project brief deadline to November 9, 2026.';
  h.addDoc('update','2026-11-03',update);h.setReply(()=>({actions:[action('match','HM-0008',update,{due_date:'2026-11-09'})]}));
  assert.equal(h.run(['update']).reviewed,1);assert.deepEqual(board.rows[1],original);assert.equal(board.rows.length,3);
  const reviews=h.books.get('classroom').tabs.get('Merge Reviews').rows;
  assert.equal(JSON.parse(reviews[1][5]).changes[0].issue,'missing_machine_baseline');
});

test('bound-sheet upgrade reuses the active Week 1 workbook without requiring a new spreadsheet property',()=>{
  const h=week2Harness();seedWeek1(h);h.properties.delete('SPREADSHEET_ID');h.properties.delete('WEEK2_SPREADSHEET_ID');
  assert.equal(h.ctx.upgradeWeek1().spreadsheetUrl,'classroom');assert.equal(h.properties.has('SPREADSHEET_ID'),false);assert.equal(h.ctx.week2Config().spreadsheetId,'classroom');
  assert.throws(()=>h.ctx.week2Config({mode:'sandbox',spreadsheetId:'classroom'}),/separate/);
});

test('upgrade refuses incompatible existing tabs before creating any support tabs',()=>{
  const h=week2Harness();seedWeek1(h);const book=h.books.get('classroom');book.insertSheet('OKR Registry').rows.push(['okr_id','objective']);
  const names=[...book.tabs.keys()];assert.throws(()=>h.ctx.upgradeWeek1(),/Headers mismatch/);assert.deepEqual([...book.tabs.keys()],names);assert.notEqual(h.properties.get('WEEK2_MODE'),'upgrade');
});

test('upgrade cannot redirect into another workbook and sandbox isolation remains enforced',()=>{
  const h=week2Harness();seedWeek1(h);
  assert.throws(()=>h.ctx.upgradeWeek1({spreadsheetId:'verification'}),/existing Week 1/);
  h.ctx.upgradeWeek1();assert.throws(()=>h.ctx.week2Config({mode:'sandbox',spreadsheetId:'classroom'}),/separate/);
  h.properties.set('WEEK2_TEST_SPREADSHEET_ID','verification');h.properties.set('WEEK2_TEST_INBOX_FOLDER_ID','test-inputs');
  assert.equal(h.ctx.week2Config({mode:'sandbox',spreadsheetId:'verification',folderId:'test-inputs'}).spreadsheetId,'verification');
});
