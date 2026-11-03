const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const name=process.argv[2];if(!/^[A-Za-z][A-Za-z0-9]*$/.test(name||''))throw new Error('Pass an explicit function name');
const args=['-A','.clasprc.json','--json','run',name];if(process.argv[3])args.push('--params',JSON.stringify(JSON.parse(process.argv[3])));
const r=spawnSync('clasp',args,{encoding:'utf8'});let body;try{body=JSON.parse(r.stdout);}catch(_){throw new Error(r.stderr||'No JSON response');}
if(r.status!==0||body.error||body.response===undefined)throw new Error(JSON.stringify(body.error||body));
fs.mkdirSync('session2-private',{recursive:true});fs.writeFileSync('session2-private/'+name+'-'+Date.now()+'.json',JSON.stringify(body.response,null,2),{mode:0o600});
let display=body.response;
if(name==='session2Snapshot'){const s=body.response.state;display={private_snapshot_saved:true,tasks:(s['Master Action Board']?.values.length||1)-1,completions:(s['Processed Sources']?.values.length||1)-1,support_tables:Object.keys(s)};}
if(name==='executorSnapshot'){display={private_snapshot_saved:true,tasks:body.response.ingestion['Master Action Board'].values.length-1,completions:body.response.ingestion['Processed Sources'].values.length-1,visible:body.response.sheets.filter(s=>!s.hidden).map(s=>s.name),model_requests:body.response.model_requests};}
if(name==='session2Status'){display={...body.response,baselines:'Saved in private evidence'};}
console.log(JSON.stringify(display,null,2));

if((body.response.outcomes||[body.response]).some(x=>['failed','needs-reconciliation'].includes(x.outcome)))process.exitCode=1;

if(["reconcile","rejected","stale","deferred"].includes(body.response.code))process.exitCode=1;
