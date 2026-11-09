const {executorHarness}=require('./executor-harness.cjs');
const vm=require('node:vm');
const fs=require('node:fs');
function enforcerHarness(){
  const h=executorHarness(),c=h.ctx;
  const original=h.run(); if(original.state!=='ready_for_review')throw Error('Executor baseline failed');
  const e=h.state(),book=h.book;
  const proto=Object.getPrototypeOf(book.tabs.get('Tasks')),range=proto.getRange;
  proto.getRange=function(...args){const r=range.apply(this,args);r.getNotes=()=>Array.from({length:args[2]||1},()=>Array(args[3]||1).fill(''));r.setWrap=()=>r;return r;};
  proto.showColumns=function(){return this;};proto.setColumnWidth=function(){return this;};
  for(const [k,v] of Object.entries({ENFORCER_SPREADSHEET_ID:'week2',ENFORCER_PROTECTED_SPREADSHEET_IDS:'classroom,sandbox',ENFORCER_FOLDER_ID:'review-feature',ENFORCER_REPORT_FOLDER_ID:'reports',ENFORCER_TEST_FOLDER_ID:'fixtures',ENFORCER_TEST_MODE:'yes'}))h.properties.set(k,v);
  for(const id of ['review-feature','reports','fixtures'])h.files.set(id,{id,mimeType:'application/vnd.google-apps.folder',parents:id==='review-feature'?[]:['review-feature'],capabilities:{canAddChildren:true}});
  const evidence=book.tabs.get('Executor Sources').rows.slice(1).map(r=>JSON.parse(r[2]));
  // The original meeting adapter is intentionally strict about its ingestion shape. Return the accepted text/revision for the reviewer read route.
  const base=c.UrlFetchApp.fetch;let model=(reply)=>reply,hook=()=>{},calls=0;
  function response(body,status=200){return {getResponseCode:()=>status,getContentText:()=>JSON.stringify(body)};}
  c.UrlFetchApp.fetch=(url,options)=>{
    hook({url,options,stage:'before'});
    if(url==='https://api.openai.com/v1/chat/completions'&&JSON.parse(options.payload).response_format.json_schema.name==='enforcer_review'){
      calls++;const payload=JSON.parse(options.payload),input=JSON.parse(payload.messages[1].content),quote=input.draft.text.split('\n').find(x=>x.includes('20 minutes'));
      const source=input.sources.find(s=>s.role==='scope'),q='Duration: 20 minutes including questions.';
      const issue={claim_type:'factual_error',category:'requirement',confidence:'high',evidence:[{source_id:source.evidence_id,quote:q}],correction:'Add: 20 minutes including questions.',correction_evidence:[{source_id:source.evidence_id,quote:q}]};
      const agendaQuote=(input.draft.text.split('Draft agenda\n')[1]||'').split('\n').find(x=>x.trim());
      const reply={task_fit:{status:agendaQuote?'fits':'unclear',draft_quote:agendaQuote||'',explanation:agendaQuote?'Substantive agenda addresses the requested work.':'No substantive agenda body available.',issue:agendaQuote?null:issue},checks:[{requirement_id:'duration',status:quote?'satisfied':'missing',draft_quote:quote||'',explanation:quote?'Visible duration.':'Required duration absent.',issue:quote?null:issue}],claims:[]};
      const result=model(reply,payload,input);if(result.throw)throw Error('PRIVATE paid response lost');if(result.status)return response({},result.status);if(result.finish)return response({id:'review-'+calls,model:'review-model',choices:[{finish_reason:result.finish,message:{content:'{}'}}]});
      return response({id:'review-'+calls,model:'review-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
    }
    if(url.startsWith('https://www.googleapis.com/drive/v3/files?')&&options.method==='get'){
      const q=new URL(url).searchParams.get('q'),marker=/key='enforcer_id' and value='([^']+)'/.exec(q);
      if(marker){const folder=q.match(/^'([^']+)'/)[1];const result=response({files:[...h.files.values()].filter(f=>f.parents?.includes(folder)&&!f.trashed&&f.appProperties?.enforcer_id===marker[1])});hook({url,options,stage:'after',result});return result;}
    }
    const match=/docs\.googleapis\.com\/v1\/documents\/([^?:]+)\?/.exec(url);
    let result;
    if(match&&evidence.some(s=>s.file_id===match[1])&&!h.outputs.has(match[1])){const s=evidence.find(s=>s.file_id===match[1]);result=response({title:s.title,revisionId:'accepted-read-revision',tabs:[{tabProperties:{tabId:'tab1'},documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:s.text}}]}}]}}}]});}
    else result=base(url,options);
    hook({url,options,stage:'after',result});return result;
  };
  for(const f of ['enforcerStore','enforcerContext','enforcerReview','enforcer'])vm.runInContext(fs.readFileSync('src/'+f+'.js','utf8'),c);
  c.setupEnforcer();
  const scope=evidence.find(s=>s.role==='scope'),profile={version:'1',audience:'Site manager',boundary:'HM IDs and source appendix are internal review metadata. Review the agenda body.',requirements:[{id:'duration',text:'Show 20 minutes including questions in agenda body.',source_id:scope.evidence_id,quote:'Duration: 20 minutes including questions.',mode:'semantic'}],standards:[]};
  const req=['review-req',e.id,e.output_id,'1','yes',JSON.stringify(profile),c.executorHash(JSON.stringify(profile)),'Instructor','2026-11-04T12:00:00Z','Instructor','Instructor','2026-11-04T12:00:00Z','','',''];
  book.tabs.get('Enforcer Requests').rows.push(req);
  return {...h,execution:e,profile,req,evidence,reviewCalls:()=>calls,setReviewModel:f=>model=f,setReviewHook:f=>hook=f,review:()=>c.runEnforcer({requestId:req[0]}),reviewState:()=>Object.values(c.enforcerHistory(book))[0]?.record,reviewSnapshot:()=>JSON.stringify([...book.tabs.entries()].filter(([k])=>!k.startsWith('Enforcer')).map(([k,s])=>[k,k==='Drafts'?s.rows.map(r=>r.slice(0,10)):s.rows,s.formulas]))};
}
module.exports={enforcerHarness};
