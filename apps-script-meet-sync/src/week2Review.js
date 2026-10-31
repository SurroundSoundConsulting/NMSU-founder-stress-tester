// Human-only command: no model call is involved in resolving a review.
function resolveWeek2Review(reviewId, resolution, options) {
  if (!resolution || ['keep_current','apply_proposed','link_existing','create_task','dismiss'].indexOf(resolution.action) < 0 || typeof resolution.reason !== 'string' || !resolution.reason.trim() || resolution.reason.length > 2000 || typeof resolution.reviewed_by !== 'string' || !resolution.reviewed_by.trim() || resolution.reviewed_by.length > 200) throw new Error('Provide an explicit review action, reason and reviewed_by');
  var config = week2Config(options), book = getBoardBook(config.spreadsheetId), lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var state = week2State(book), review = state['Merge Reviews'].filter(function(r) { return r[0] === reviewId; })[0];
    if (!review) throw new Error('Review not found');
    var eventId = 'REVIEW-' + week2Hash(reviewId).slice(0,32);
    if (state['Source Journal'].some(function(j) { return j[0] === eventId && j[2] !== 'complete'; })) throw new Error('Review resolution has unfinished writes; inspect and reconcile manually');
    if (review[6] === 'resolved') return {review_id:reviewId,already_resolved:true};
    if (review[6] !== 'pending') throw new Error('Review state is not pending');
    var next = week2Copy(state), details = JSON.parse(review[5]);
    var boardIds = next['Master Action Board'].map(function(r) { return r[0]; });
    if (new Set(boardIds).size !== boardIds.length || boardIds.some(function(id) { return !/^HM-\d+$/.test(id); })) throw new Error('Invalid or duplicate board task ID');
    var sourceHistory = state['Task History'].filter(function(h) { return h[1] === review[1]; });
    if (!sourceHistory.length) throw new Error('Missing original review source history');
    var source = {id:eventId,fingerprint:week2Hash(JSON.stringify(resolution)),url:sourceHistory[0][3],date:sourceHistory[0][4],title:'Human review resolution'};
    var taskId = review[2], now = new Date().toISOString(), touched = [];
    var row = next['Master Action Board'].filter(function(r) { return r[0] === taskId; })[0];
    function baselineFor(id) {
      var b = next['Task Baselines'].filter(function(r) { return r[0] === id; })[0];
      if (b) return {row:b,values:JSON.parse(b[1]),dates:JSON.parse(b[2])};
      b = [id,'{}','{}']; next['Task Baselines'].push(b); return {row:b,values:{},dates:{}};
    }
    if (resolution.action === 'keep_current' || resolution.action === 'apply_proposed') {
      if (review[4] !== 'field_conflict' || !row || !Array.isArray(details.changes)) throw new Error('This is not a field conflict');
      var baseline = baselineFor(taskId);
      details.changes.forEach(function(change) {
        var col = HEADERS.indexOf(change.field);
        if (col < 2 || col > 10 || row[col] !== change.current) throw new Error('Field changed after the review was opened; inspect before resolving');
        var formula = state._boardFormulas[taskId] && state._boardFormulas[taskId][col];
        if (formula && resolution.action === 'apply_proposed') throw new Error('Remove or edit the manual formula yourself before replacing it');
        if (resolution.action === 'apply_proposed') {
          if (change.field === 'okr_link' && change.proposed && change.proposed !== 'Unmapped' && !state['OKR Registry'].some(function(r) { return r[0] === change.proposed; })) throw new Error('Unknown OKR code');
          row[col] = change.proposed;
        }
        if (!formula) {
          baseline.values[change.field] = row[col];
          baseline.dates[change.field] = [baseline.dates[change.field] || '',source.date].sort().pop();
        }
      });
      baseline.row[1] = JSON.stringify(baseline.values); baseline.row[2] = JSON.stringify(baseline.dates);
      if (resolution.action === 'apply_proposed') row[15] = now;
      touched.push(taskId);
    } else if (resolution.action === 'link_existing') {
      var candidates = JSON.parse(review[3]);
      taskId = resolution.task_id;
      if (!candidates.length || candidates.indexOf(taskId) < 0 || !next['Master Action Board'].some(function(r) { return r[0] === taskId; })) throw new Error('Choose an existing review candidate');
      touched.push(taskId); // Record the association, without guessing field changes.
    } else if (resolution.action === 'create_task') {
      if (review[4] !== 'clarification') throw new Error('Only a clarified request can become a new task');
      var values = resolution.values || {}, item = {};
      if (Object.keys(values).some(function(k) { return HEADERS.slice(1,11).indexOf(k) < 0; })) throw new Error('Unknown task field');
      HEADERS.slice(1,11).forEach(function(k) { item[k] = values[k] === undefined ? (k === 'status'?'open':k === 'urgency'?0:'') : values[k]; });
      if (!item.task.trim() || HEADERS.slice(1,11).some(function(k) { return typeof item[k] !== (k === 'urgency'?'number':'string') || (typeof item[k] === 'string' && item[k].length > 2000); }) || !Number.isInteger(item.urgency) || item.urgency < 0 || item.urgency > 9 || ['open','pending','blocked','done'].indexOf(item.status) < 0 || ['','low','medium','high'].indexOf(item.risk_flag) < 0 || (item.due_date && !validDate(item.due_date))) throw new Error('Invalid human-confirmed task fields');
      if (item.okr_link && item.okr_link !== 'Unmapped' && !state['OKR Registry'].some(function(r) { return r[0] === item.okr_link; })) throw new Error('Unknown OKR code');
      if (next['Master Action Board'].some(function(r) { return week2Normalize(r[1]) === week2Normalize(item.task); })) throw new Error('Task title already exists; link or distinguish the work');
      var max = next['Master Action Board'].reduce(function(n,r) { return Math.max(n,Number(r[0].slice(3))); },0);
      state['Source Journal'].filter(function(j) { return j[2] !== 'complete'; }).forEach(function(j) { JSON.parse(j[3]).forEach(function(id) { max = Math.max(max,Number(id.slice(3))); }); });
      taskId = 'HM-' + String(max+1).padStart(4,'0');
      (item.dependencies.match(/\bHM-\d+\b/g) || []).forEach(function(id) { if (!next['Master Action Board'].some(function(r) { return r[0] === id; })) throw new Error('Unknown dependency ID'); });
      var metadata = {id:review[1],title:'Human-clarified meeting request',date:source.date};
      row = buildRow(item,metadata,taskId,now); next['Master Action Board'].push(row);
      var createdBaseline = baselineFor(taskId); createdBaseline.values = week2RowObject(row);
      HEADERS.slice(1,11).forEach(function(k) { createdBaseline.dates[k] = source.date; });
      createdBaseline.row[1] = JSON.stringify(createdBaseline.values); createdBaseline.row[2] = JSON.stringify(createdBaseline.dates);
      touched.push(taskId);
    }
    state['Source Journal'].filter(function(j) { return j[2] !== 'complete'; }).forEach(function(j) {
      if (JSON.parse(j[3]).some(function(id) { return touched.indexOf(id) >= 0; })) throw new Error('Task has unfinished writes; reconcile first');
    });
    var target = next['Merge Reviews'].filter(function(r) { return r[0] === reviewId; })[0];
    target[2] = taskId || ''; target[6] = 'resolved'; target[7] = now; target[8] = safeCell(resolution.reviewed_by); target[9] = JSON.stringify(resolution);
    next['Task History'].push([eventId,review[1],taskId || '',source.url,source.date,JSON.stringify(details.source_quotes || []),'human_resolution',safeCell(resolution.reason),JSON.stringify(resolution)]);
    var ops = [];
    ['Master Action Board','Task Baselines','Task History','Merge Reviews'].forEach(function(name) {
      next[name].forEach(function(after,i) {
        var before = state[name][i] || week2Blank(WEEK2_TABLES[name].length);
        if (!week2Equal(before,after)) ops.push({tab:name,before:before,after:after});
      });
    });
    week2Commit(book,source,{ops:ops,task_ids:touched},now);
    return {review_id:reviewId,resolved:true,task_id:taskId || '',action:resolution.action};
  } finally { lock.releaseLock(); }
}
