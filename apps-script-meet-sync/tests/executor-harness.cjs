const {week2Harness}=require('./week2-harness.cjs');
const vm=require('node:vm');
const fs=require('node:fs');
function executorHarness(){
  const h=week2Harness(), c=h.ctx, book=h.books.get('week2');
  c.ScriptApp.AuthMode={FULL:'FULL'};c.ScriptApp.AuthorizationStatus={NOT_REQUIRED:'NOT_REQUIRED',REQUIRED:'REQUIRED'};c.ScriptApp.getAuthorizationInfo=()=>({getAuthorizationStatus:()=>c.authDenied?'REQUIRED':'NOT_REQUIRED'});
  const p={EXECUTOR_SPREADSHEET_ID:'week2',EXECUTOR_FEATURE_FOLDER_ID:'feature',EXECUTOR_OUTPUT_FOLDER_ID:'outputs',EXECUTOR_CONTEXT_FOLDER_ID:'context',EXECUTOR_COMPLETION_FOLDER_ID:'completion',EXECUTOR_TASK_IDS:'HM-0004',EXECUTOR_REFERENCE_DATE:'2026-11-04',WEEK2_OPENAI_MODEL:'test-model'};
  Object.entries(p).forEach(([k,v])=>h.properties.set(k,v));
  c.setupWeek2();
  const board=book.tabs.get('Master Action Board');
  board.rows.push(['HM-0004','Draft the one-page Arroyo pilot demo agenda','Jordan','open',0,'2026-11-06','','','HM-0005','','','DRIVE-meeting','Arroyo pilot','2026-11-04','created','updated'],['HM-0005','Share the approved Arroyo scope','Avery','done',0,'2026-11-03','','','','','','DRIVE-meeting','Arroyo pilot','2026-11-04','created','updated']);
  h.addDoc('meeting','2026-11-04','Jordan: The Arroyo pilot agenda is open; I received the scope.');
  const history=book.tabs.get('Task History');
  history.rows.push(['hist','DRIVE-meeting','HM-0004','https://docs.google.com/document/d/meeting/edit','2026-11-04','["Jordan: The Arroyo pilot agenda is open; I received the scope."]','match','Arroyo pilot','{}']);
  const source=c.week2ReadSource({id:'meeting',mimeType:'application/vnd.google-apps.document'});
  book.tabs.get('Processed Sources').rows.push(['DRIVE-meeting','now',1,JSON.stringify({fingerprint:source.fingerprint})]);
  const raw=c.UrlFetchApp.fetch; const files=new Map(), outputs=new Map(); let calls=0,creates=0,writes=0,nextId=0,modelReply=null,hook=()=>{};
  function response(body,status=200){return {getResponseCode:()=>status,getContentText:()=>JSON.stringify(body)};}
  for(const id of ['feature','outputs','context','completion','inputs'])files.set(id,{id,mimeType:'application/vnd.google-apps.folder',parents:id==='feature'?[]:['feature'],capabilities:{canAddChildren:true}});
  files.set('meeting',{id:'meeting',name:'Meeting',mimeType:'application/vnd.google-apps.document',parents:['inputs']});
  const scope='SYNTHETIC classroom scope\nProject: Arroyo pilot\nScope version: v1\nScenario approver: Avery\nScenario approval date: 2026-11-04\nAudience: Site manager\nObjective: Show the tabletop workflow.\nPermitted demonstration: Show operator check-in, a simulated pick-and-place cycle and a simulated exception.\nConstraints: Tabletop simulation only; no production integration or launch commitment.\nDuration: 20 minutes including questions.\nRequired sequence: Introduction, workflow, exception, questions.\n';
  files.set('scope',{id:'scope',name:'Synthetic scope',mimeType:'application/vnd.google-apps.document',parents:['context']});
  outputs.set('scope',{text:scope,revision:'scope-rev',title:'Synthetic scope'});
  c.UrlFetchApp.fetch=(url,options)=>{
    hook({url,options,c,h,files,outputs});
    if(url==='https://api.openai.com/v1/chat/completions'){
      const payload=JSON.parse(options.payload);if(payload.response_format.json_schema.name!=='executor_agenda')return raw(url,options);
      calls++; const sources=JSON.parse(payload.messages[1].content).sources, s=sources.find(s=>s.role==='scope');
      const defaultReply={agenda:[{text:'Introduce the tabletop workflow.',source_id:s.evidence_id,quote:'Objective: Show the tabletop workflow.'},{text:'Show operator check-in and the simulated pick-and-place cycle.',source_id:s.evidence_id,quote:'Permitted demonstration: Show operator check-in, a simulated pick-and-place cycle and a simulated exception.'},{text:'Review the simulated exception.',source_id:s.evidence_id,quote:'Permitted demonstration: Show operator check-in, a simulated pick-and-place cycle and a simulated exception.'},{text:'Collect questions within 20 minutes.',source_id:s.evidence_id,quote:'Duration: 20 minutes including questions.'}],gaps:['[NEEDS: Confirm the event date and time before use.]']};
      const r=modelReply ? modelReply(defaultReply,payload):defaultReply;
      if(r.throw)throw Error('PRIVATE response lost');
      if(r.status)return response({private:'sensitive'},r.status);
      return response({id:'exec-model-'+calls,model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(r)}}]});
    }
    const u=new URL(url);
    if(u.hostname==='www.googleapis.com' && u.pathname==='/drive/v3/files'){
      if(options.method==='post'){
        creates++; const b=JSON.parse(options.payload),id='out-'+(++nextId);files.set(id,{id,name:b.name,mimeType:b.mimeType,parents:b.parents,appProperties:b.appProperties});outputs.set(id,{text:'\n',revision:'r1',title:b.name});return response({id});
      }
      const q=u.searchParams.get('q'),folder=q.match(/^'([^']+)'/)[1]; return response({files:[...files.values()].filter(f=>f.parents?.includes(folder)&&!f.trashed).map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,appProperties:f.appProperties}))});
    }
    if(u.hostname==='www.googleapis.com' && u.pathname.startsWith('/drive/v3/files/'))return response(files.get(u.pathname.split('/').pop()) || {},files.has(u.pathname.split('/').pop())?200:404);
    if(u.hostname==='docs.googleapis.com'){
      const id=u.pathname.split('/').pop().replace(':batchUpdate',''), doc=outputs.get(id);
      if(!doc)return raw(url,options);
      if(u.pathname.endsWith(':batchUpdate')){
        writes++;const b=JSON.parse(options.payload);if(b.writeControl.requiredRevisionId!==doc.revision)return response({},400);
        doc.text=b.requests[0].insertText.text+'\n'; doc.revision='r'+(Number(doc.revision.slice(1))+1);return response({documentId:id});
      }
      return response({title:doc.title,revisionId:doc.revision,tabs:[{tabProperties:{tabId:'tab1'},documentTab:{body:{content:[{startIndex:1,paragraph:{elements:[{textRun:{content:doc.text}}]}}]}}}]});
    }
    return raw(url,options);
  };
  for(const f of ['executorStore','executorContext','executorDraft','executor'])vm.runInContext(fs.readFileSync('src/'+f+'.js','utf8'),c);
  c.setupExecutor();
  const request=['req1','HM-0004','demo_agenda_v1','1','yes','Arroyo pilot','Site manager','set1','Instructor','2026-11-04T10:00:00Z','2026-11-04T10:00:00Z','','','Instructor'];
  book.tabs.get('Executor Requests').rows.push(request);
  book.tabs.get('Executor Context').rows.push(['scope-map','set1','scope','context','scope','Arroyo pilot',c.executorHash(scope),'yes',''],['transcript-map','set1','meeting','inputs','transcript','Arroyo pilot','','yes','']);
  return {...h,book,files,outputs,scope,request,counts:()=>({calls,creates,writes}),setModel:f=>modelReply=f,setHook:f=>hook=f,run:()=>c.runExecutor({requestId:'req1'}),state:()=>Object.values(c.executorHistory(book))[0]?.record,snapshot:()=>JSON.stringify([...book.tabs.entries()].filter(([k])=>!k.startsWith('Executor')).map(([k,s])=>[k,s.rows,s.formulas]))};
}
module.exports={executorHarness};
