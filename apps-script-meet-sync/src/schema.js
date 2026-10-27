var HEADERS = ['task_id','task','owner','status','urgency','due_date','next_step','blockers','dependencies','okr_link','risk_flag','source_transcript_id','meeting_title','meeting_date','created_at','updated_at'];
var ITEM_FIELDS = HEADERS.slice(1,11).concat(['source_quote']);
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function validateExtraction(result, source) {
  if (!result || !Array.isArray(result.actionItems)) throw new Error('Invalid extraction envelope');
  result.actionItems.forEach(function(item) {
    if (!item || ITEM_FIELDS.some(function(k) { return typeof item[k] !== (k === 'urgency' ? 'number' : 'string'); })) throw new Error('Invalid task fields');
    if (!item.task.trim() || !item.source_quote.trim() || source.text.replace(/\s+/g,' ').indexOf(item.source_quote.replace(/\s+/g,' ').trim()) < 0) throw new Error('Task lacks exact source quote');
    if (!['open','pending','blocked','done'].includes(item.status) || !Number.isInteger(item.urgency) || item.urgency < 0 || item.urgency > 9 || !['','low','medium','high'].includes(item.risk_flag)) throw new Error('Invalid task values');
    if (item.due_date && !validDate(item.due_date)) throw new Error('Invalid due date');
    if (item.owner && source.text.indexOf(item.owner) < 0) throw new Error('Owner absent from source');
  });
  return result.actionItems;
}
function safeCell(value) { return typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value; }
function buildRow(item, source, id, now) {
  return [id].concat(HEADERS.slice(1,11).map(function(k) { return safeCell(item[k]); }), [source.id,safeCell(source.title),source.date,now,now]);
}
