// Pure planner: proposals go in; validated row operations come out. No service calls.
var WEEK2_TABLES = {
  get 'Master Action Board'() { return HEADERS; },
  'Processed Sources': ['source_id','processed_at','task_count','evidence'],
  'Task Baselines': ['task_id','values_json','field_dates_json'],
  'Task History': ['history_id','source_id','task_id','source_url','meeting_date','source_quotes','decision','reason','changes_json'],
  'Merge Reviews': ['review_id','source_id','task_id','candidate_ids','issue','details_json','status','resolved_at','resolved_by','decision'],
  'Source Registry': ['source_id','fingerprint','title','meeting_date','source_url','outcome','attempted_at'],
  'OKR Registry': ['okr_code','objective'],
  'Run Log': ['run_id','timestamp','source_id','stage','outcome','message'],
  'Source Journal': ['source_id','fingerprint','phase','task_ids','plan_json','started_at','finished_at']
};

function week2Equal(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
function week2Copy(value) { return JSON.parse(JSON.stringify(value)); }
function week2Normalize(value) { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
function week2Blank(width) { return Array(width).fill(''); }
function week2RowObject(row) {
  var values = {}; HEADERS.slice(1,11).forEach(function(k,i) { values[k] = row[i+1]; }); return values;
}

function week2ValidateAction(action, source) {
  var keys = ['decision','task_id','candidate_ids','reason','source_quotes','values','dependency_ids'];
  if (!action || !week2Equal(Object.keys(action).sort(),keys.sort()) || ['new','match','review'].indexOf(action.decision) < 0 || typeof action.task_id !== 'string' || typeof action.reason !== 'string' || !action.reason.trim() || action.reason.length > 2000) throw new Error('Invalid merge action');
  ['candidate_ids','dependency_ids'].forEach(function(k) {
    if (!Array.isArray(action[k]) || action[k].length > 100 || action[k].some(function(id) { return typeof id !== 'string'; }) || new Set(action[k]).size !== action[k].length) throw new Error('Invalid task references');
  });
  var utterances = source.text.split(/\n+/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (!Array.isArray(action.source_quotes) || !action.source_quotes.length || action.source_quotes.length > 10 || action.source_quotes.some(function(q) { return typeof q !== 'string' || utterances.indexOf(q) < 0; })) throw new Error('Proposal lacks exact source utterances');
  if (!action.values || !week2Equal(Object.keys(action.values).sort(),HEADERS.slice(1,11).sort())) throw new Error('Invalid proposed fields');
  HEADERS.slice(1,11).forEach(function(k) {
    var v = action.values[k];
    if (v === null) return;
    if (k === 'urgency') { if (!Number.isInteger(v) || v < 0 || v > 9) throw new Error('Invalid urgency'); }
    else if (typeof v !== 'string' || v.length > 2000) throw new Error('Invalid field value');
  });
  var v = action.values;
  if (v.status !== null && ['open','pending','blocked','done'].indexOf(v.status) < 0) throw new Error('Invalid status');
  if (v.risk_flag !== null && ['','low','medium','high'].indexOf(v.risk_flag) < 0) throw new Error('Invalid risk flag');
  if (v.due_date && !validDate(v.due_date)) throw new Error('Invalid due date');
  if (v.owner && action.source_quotes.join('\n').indexOf(v.owner) < 0) throw new Error('Owner absent from supporting quotes');
  if (action.decision === 'new' && (action.task_id || !v.task || !v.task.trim())) throw new Error('New work requires a task and no existing ID');
  if (action.decision === 'match' && (!action.task_id || v.task !== null)) throw new Error('Match requires an existing reference; preserve task wording');
}

function week2Plan(source, state, proposal, now, blockedIds) {
  if (!proposal || !Array.isArray(proposal.actions) || proposal.actions.length > 30) throw new Error('Invalid merge proposal envelope');
  proposal.actions.forEach(function(a) { week2ValidateAction(a,source); });
  var next = week2Copy(state), board = next['Master Action Board'], baselines = next['Task Baselines'];
  var byId = {}, baselineById = {}, localIds = {}, changesByTask = {}, touched = [], added = 0, updated = 0, reviewed = 0;
  var maxId = 0;
  board.forEach(function(row) {
    if (!/^HM-\d+$/.test(row[0]) || byId[row[0]] !== undefined) throw new Error('Invalid or duplicate board task ID');
    byId[row[0]] = row; maxId = Math.max(maxId,Number(row[0].slice(3)));
  });
  (blockedIds || []).forEach(function(id) { if (/^HM-\d+$/.test(id)) maxId = Math.max(maxId,Number(id.slice(3))); });
  baselines.forEach(function(row) {
    if (baselineById[row[0]]) throw new Error('Duplicate task baseline');
    baselineById[row[0]] = {row:row,values:JSON.parse(row[1]),dates:JSON.parse(row[2])};
  });
  // Allocate IDs first so explicit dependencies can point forward to new work.
  proposal.actions.forEach(function(a,i) {
    if (a.decision === 'new') localIds['item:' + i] = 'HM-' + String(++maxId).padStart(4,'0');
  });
  function resolve(ref, allowFuture, index) {
    if (localIds[ref]) {
      if (!allowFuture && Number(ref.slice(5)) >= index) throw new Error('Match must refer to earlier new work');
      return localIds[ref];
    }
    if (!byId[ref]) throw new Error('Unknown task reference');
    return ref;
  }
  function review(index, taskId, candidates, issue, details) {
    var id = source.id + ':' + index + ':' + issue;
    if (next['Merge Reviews'].some(function(r) { return r[0] === id; })) throw new Error('Review exists without source completion; reconcile manually');
    next['Merge Reviews'].push([id,source.id,taskId,JSON.stringify(candidates),issue,JSON.stringify(details),'pending','','','']);
    reviewed++;
  }
  proposal.actions.forEach(function(a,i) {
    var id = '', applied = {}, conflicts = [], candidates = a.candidate_ids.map(function(ref) { return resolve(ref,true,i); });
    if (a.decision === 'review') {
      if (a.task_id) id = resolve(a.task_id,false,i);
      review(i,id,candidates,'clarification',{reason:a.reason,source_quotes:a.source_quotes,proposed:a.values});
    } else {
      id = a.decision === 'new' ? localIds['item:' + i] : resolve(a.task_id,false,i);
      if ((blockedIds || []).indexOf(id) >= 0) throw new Error('Task has an unfinished source journal; reconcile before updating');
      touched.push(id);
      var v = week2Copy(a.values);
      if (a.dependency_ids.length) v.dependencies = a.dependency_ids.map(function(ref) { return resolve(ref,true,i); }).join(', ');
      if (v.dependencies && /\bHM-\d+\b/.test(v.dependencies)) {
        var refs = v.dependencies.match(/\bHM-\d+\b/g);
        refs.forEach(function(ref) {
          if (!byId[ref] && Object.keys(localIds).every(function(k) { return localIds[k] !== ref; })) throw new Error('Unknown dependency ID');
          if (ref === id) throw new Error('Task cannot depend on itself');
        });
      }
      var existing = byId[id];
      if (a.decision === 'new') {
        if (a.dependency_ids.some(function(ref) { return (localIds[ref] || ref) === id; })) throw new Error('Task cannot depend on itself');
        var sameText = board.filter(function(r) { return week2Normalize(r[1]) === week2Normalize(v.task); });
        if (sameText.length) throw new Error('Proposed new task duplicates an existing title; request an explicit match or review');
        var item = {};
        HEADERS.slice(1,11).forEach(function(k) { item[k] = v[k] === null ? (k === 'urgency' ? 0 : k === 'status' ? 'open' : '') : v[k]; });
        if (item.okr_link && item.okr_link !== 'Unmapped' && !next['OKR Registry'].some(function(r) { return r[0] === item.okr_link; })) throw new Error('Unknown OKR code');
        var row = buildRow(item,source,id,now);
        board.push(row); byId[id] = row;
        var dates = {}; HEADERS.slice(1,11).forEach(function(k) { dates[k] = source.date; });
        var baseRow = [id,JSON.stringify(week2RowObject(row)),JSON.stringify(dates)]; baselines.push(baseRow);
        baselineById[id] = {row:baseRow,values:week2RowObject(row),dates:dates};
        added++; applied = week2RowObject(row);
      } else {
        var baseline = baselineById[id];
        HEADERS.slice(2,11).forEach(function(k) {
          if (v[k] === null) return;
          var column = HEADERS.indexOf(k), value = safeCell(v[k]), current = existing[column];
          var lastDate = baseline && baseline.dates[k];
          if (state._boardFormulas && state._boardFormulas[id] && state._boardFormulas[id][column]) {
            conflicts.push({field:k,issue:'human_formula',baseline:baseline ? baseline.values[k] : null,current:current,proposed:value});
            return;
          }
          if (current === value) {
            if (baseline && baseline.values[k] === current && lastDate && source.date > lastDate) baseline.dates[k] = source.date;
            return;
          }
          var issue = '';
          if (!baseline || !lastDate || !validDate(lastDate)) issue = 'missing_machine_baseline';
          else if (baseline.values[k] !== current) issue = 'human_edit';
          else if (source.date < lastDate) return; // Older evidence stays in history.
          else if (source.date === lastDate) issue = 'same_date_conflict';
          else if (k === 'status' && current === 'done' && value !== 'done') issue = 'reopen_completed';
          else if (k === 'okr_link' && value && value !== 'Unmapped' && !next['OKR Registry'].some(function(r) { return r[0] === value; })) issue = 'unknown_okr';
          if (issue) conflicts.push({field:k,issue:issue,baseline:baseline ? baseline.values[k] : null,current:current,proposed:value});
          else {
            applied[k] = {before:current,after:value}; existing[column] = value;
            baseline.values[k] = value; baseline.dates[k] = source.date;
          }
        });
        if (Object.keys(applied).length) { existing[15] = now; changesByTask[id] = true; }
        if (conflicts.length) review(i,id,[id],'field_conflict',{changes:conflicts,source_quotes:a.source_quotes});
        if (baseline) { baseline.row[1] = JSON.stringify(baseline.values); baseline.row[2] = JSON.stringify(baseline.dates); }
      }
    }
    next['Task History'].push([source.id + ':' + i,source.id,id,source.url,source.date,JSON.stringify(a.source_quotes),a.decision,safeCell(a.reason),JSON.stringify({applied:applied,conflicts:conflicts,candidate_ids:candidates})]);
  });
  var visiting = {}, visited = {};
  function visit(id) {
    if (visiting[id]) throw new Error('Circular task dependencies require review');
    if (visited[id]) return;
    visiting[id] = true;
    (String(byId[id][8]).match(/\bHM-\d+\b/g) || []).forEach(function(ref) { if (byId[ref]) visit(ref); });
    visiting[id] = false; visited[id] = true;
  }
  Object.keys(byId).forEach(visit);
  updated = Object.keys(changesByTask).length;
  var ops = [];
  ['Master Action Board','Task Baselines','Task History','Merge Reviews'].forEach(function(name) {
    next[name].forEach(function(row,index) {
      var before = state[name][index] || week2Blank(WEEK2_TABLES[name].length);
      if (!week2Equal(before,row)) ops.push({tab:name,row:index+2,before:before,after:row});
    });
  });
  return {ops:ops,task_ids:Array.from(new Set(touched)),added:added,updated:updated,reviewed:reviewed};
}
