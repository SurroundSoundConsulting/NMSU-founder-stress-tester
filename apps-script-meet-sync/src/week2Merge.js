// Pure planning: no Google calls and no mutation of the current board.
var W2_FIELDS = HEADERS.slice(1,11);
function w2Scalar(v) { return Object.prototype.toString.call(v)==='[object Date]' ? v.toISOString().slice(0,10) : (v == null ? '' : v); }
function w2Equal(a,b) { return String(w2Scalar(a)) === String(w2Scalar(b)); }
function w2Identity(x) { return ['action','deliverable','project','audience'].map(function(k){return String(x[k]||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}).join('|'); }
// Suggest candidates only; never select a target or execute the unresolved request.
function week2ReviewCandidates(quotes,project,baselines){
  function tokens(text){return String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[];}
  var common=tokens(project).concat(['a','an','the','of','for','and','or','to','with','from','by','in','on','our','their','create','draft','share','compare','comparison','task','work','one','page','pilot']);
  var evidence=tokens(quotes.join(' '));
  return Object.keys(baselines||{}).filter(function(id){var identity=baselines[id].identity;if(!identity||identity.project.toLowerCase()!==String(project).toLowerCase())return false;
    var distinctive=Array.from(new Set(tokens(identity.deliverable).filter(function(t){return !common.includes(t);})));return distinctive.filter(function(t){return evidence.includes(t);}).length>=2;
  });
}
function validateWeek2Proposal(proposal,source,rows,objectives,baselines) {
  if (!proposal || !Array.isArray(proposal.items)) throw new Error('invalid_proposal');
  var ids=rows.map(function(r){return r[0];}),keys={};
  proposal.items.forEach(function(item){
    if (!item || !/^[A-Za-z0-9_-]{1,80}$/.test(item.key)||keys[item.key]) throw new Error('invalid_item_key');
    keys[item.key]=true;
    if (!['new','match','review'].includes(item.decision)||!Array.isArray(item.changes)||!Array.isArray(item.quotes)||!Array.isArray(item.candidate_ids)||!Array.isArray(item.dependency_keys)) throw new Error('invalid_decision');
    if (!item.quotes.length||item.quotes.some(function(q){return !q || source.text.indexOf(q)<0;})) throw new Error('fabricated_quote');
    if (item.decision==='match'&&!ids.includes(item.task_id)) throw new Error('unknown_task_id');
    if(item.decision==='match'&&source.project&&(!baselines||!baselines[item.task_id]||baselines[item.task_id].identity.project.toLowerCase()!==source.project.toLowerCase()))throw new Error('unverified_project_match');
    if (item.candidate_ids.some(function(id){return !ids.includes(id);})) throw new Error('unknown_candidate');
    if (!item.identity||['action','deliverable','project','audience'].some(function(k){return typeof item.identity[k]!=='string';})) throw new Error('invalid_identity');
    if(item.decision==='new' && (!item.identity.action||!item.identity.deliverable||!item.identity.project||!item.identity.audience||!item.changes.some(function(c){return c.field==='task'&&c.value.trim();})))throw new Error('missing_new_identity');
    var fields={};
    item.changes.forEach(function(c){
      if(!W2_FIELDS.includes(c.field)||fields[c.field]||!['set','clear'].includes(c.operation)||typeof c.value!=='string'||!c.quote||source.text.indexOf(c.quote)<0) throw new Error('invalid_change');
      fields[c.field]=true;
      if(c.operation==='clear'&&c.value!=='')throw new Error('invalid_clear');
      if(c.operation==='set'&&c.value==='')throw new Error('empty_set_use_clear');
      if(c.field==='due_date'&&c.value&&!validDate(c.value))throw new Error('invalid_date');
      if(c.field==='status'&&!['open','pending','blocked','done'].includes(c.value))throw new Error('invalid_status');
      if(c.field==='urgency'&&!/^[0-9]$/.test(c.value))throw new Error('invalid_urgency');
      if(c.field==='risk_flag'&&!['','low','medium','high'].includes(c.value))throw new Error('invalid_risk');
      if(c.field==='owner'&&c.value&&source.text.indexOf(c.value)<0)throw new Error('unsupported_owner');
      if(c.field==='okr_link'&&c.value&&!(objectives||[]).includes(c.value))throw new Error('unknown_objective');
      if(c.field==='dependencies')throw new Error('use_dependency_keys');
    });
  });
  proposal.items.forEach(function(item){if(item.dependency_keys.some(function(k){return !ids.includes(k)&&!keys[k];}))throw new Error('unknown_dependency');});
  return proposal;
}
function planWeek2Merge(state,source,proposal,now) {
  validateWeek2Proposal(proposal,source,state.rows,state.objectives,state.baselines);
  var rows=state.rows.map(function(r){return r.slice();}),baselines=JSON.parse(JSON.stringify(state.baselines||{}));
  var result={rows:rows,baselines:baselines,histories:[],reviews:[],added:0,updated:0,taskIds:[]};
  var max=rows.reduce(function(n,r){var m=/^HM-(\d+)$/.exec(r[0]);return m?Math.max(n,+m[1]):n;},0),refs={},seen={};
  proposal.items.forEach(function(item){refs[item.key]=item.decision==='new'?'HM-'+String(++max).padStart(4,'0'):item.task_id;});
  function review(item,type,field,current,proposed,baseline) {
    result.reviews.push({key:source.id+':'+item.key+':'+type+':'+field,type:type,task_id:item.task_id||'',candidate_ids:type==='clarification'?Array.from(new Set((item.candidate_ids||[]).concat(week2ReviewCandidates(item.quotes,source.project||item.identity.project,baselines)))):(item.candidate_ids||[]),field:field,baseline:baseline===undefined?null:baseline,current_formula:((state.formulas[item.task_id]||[])[HEADERS.indexOf(field)]||''),current:w2Scalar(current),proposed:w2Scalar(proposed),source_id:source.id,source_url:source.url,date:source.date,quotes:item.quotes,state:'pending',decision:null});
  }
  proposal.items.forEach(function(item){
    if(item.decision==='review'){review(item,'clarification','',null,item.reason,null);return;}
    var id=refs[item.key];
    if(seen[id])throw new Error('duplicate_task_proposal');seen[id]=true;
    if((state.blockedTaskIds||[]).includes(id))throw new Error('task_needs_reconciliation');
    var index=rows.findIndex(function(r){return r[0]===id;}),isNew=item.decision==='new',base=baselines[id];
    if(isNew && Object.keys(baselines).some(function(k){return w2Identity(baselines[k].identity)===w2Identity(item.identity);}))throw new Error('duplicate_identity_new');
    if(!isNew&&base&&base.identity.project.toLowerCase()!==item.identity.project.toLowerCase())throw new Error('project_identity_mismatch');
    var row=isNew?[id,'','','open',0,'','','','','','',source.id,source.title,source.date,now,now]:rows[index].slice();
    var original=row.slice(),changed=false,applied=[];
    if(isNew)base={identity:item.identity,fields:{},dates:{}};
    var changes=item.changes.slice();
    if(item.dependency_keys.length)changes.push({field:'dependencies',operation:'set',value:item.dependency_keys.map(function(k){return refs[k]||k;}).join(', '),quote:item.quotes[0]});
    changes.forEach(function(c){
      var col=HEADERS.indexOf(c.field),proposed=c.field==='urgency'?Number(c.value):c.value,current=row[col],previous=base&&base.fields[c.field],date=base&&base.dates[c.field];
      if(w2Equal(current,proposed)){
        if(base&&previous!==undefined&&w2Equal(current,previous)&&!((state.formulas[id]||[])[col])&&source.date>date)base.dates[c.field]=source.date;
        return;
      }
      if(!isNew&&(!base||previous===undefined)){review(item,'missing_baseline',c.field,current,proposed,previous);return;}
      if(!isNew&&source.date<date){review(item,'older_evidence',c.field,current,proposed,previous);return;}
      if(!isNew&&source.date===date){review(item,'same_date_conflict',c.field,current,proposed,previous);return;}
      if(!isNew&&((state.formulas[id]||[])[col]||!w2Equal(current,previous))){review(item,'human_conflict',c.field,current,proposed,previous);return;}
      if(!isNew&&c.field==='status'&&current==='done'&&proposed!=='done'){review(item,'reopen_done',c.field,current,proposed,previous);return;}
      row[col]=safeCell(proposed);changed=true;applied.push(c);
      base.fields[c.field]=row[col];base.dates[c.field]=source.date;
    });
    if(isNew){W2_FIELDS.forEach(function(f){if(base.fields[f]===undefined){base.fields[f]=row[HEADERS.indexOf(f)];base.dates[f]=source.date;}});rows.push(row);result.added++;}
    else if(changed){row[15]=now;rows[index]=row;result.updated++;}
    if(base)baselines[id]=base;
    result.taskIds.push(id);
    result.histories.push({key:source.id+':'+item.key,task_id:id,source_id:source.id,url:source.url,date:source.date,quotes:item.quotes,identity:item.identity,decision:item.decision,proposed:item.changes,applied:applied,changed:JSON.stringify(original)!==JSON.stringify(row)});
  });
  result.reviews.forEach(function(r){r.candidate_snapshots={};(r.candidate_ids||[]).forEach(function(id){var row=rows.find(function(x){return x[0]===id;});r.candidate_snapshots[id]={values:row.map(w2Scalar),formulas:state.formulas[id]||Array(16).fill('')};});});
  return result;
}
