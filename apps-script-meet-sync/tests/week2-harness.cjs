const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

function week2Harness() {
  const properties = new Map([['SPREADSHEET_ID','classroom'],['SANDBOX_SPREADSHEET_ID','sandbox'],['WEEK2_SPREADSHEET_ID','week2'],['WEEK2_INBOX_FOLDER_ID','inputs'],['OPENAI_API_KEY','test-private']]);
  const books = new Map(), docs = new Map(), requests = [];
  let reply = () => ({actions:[]}), fail = () => false, calls = 0, now = Date.UTC(2026,10,4,12), locked = false, pages = null, consumeEscapes = false;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  class Sheet {
    constructor(name) { this.name=name;this.rows=[];this.formulas={}; }
    getLastRow() { return this.rows.length; }
    setFrozenRows() {}
    getRange(row,col,n=1,m=1) {
      const key = `${row}:${col}`;
      return {
        getValues: () => Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[row-1+i]?.[col-1+j] ?? '')),
        getValue: () => this.rows[row-1]?.[col-1] ?? '',
        getFormula: () => this.formulas[key] || '',
        getFormulas: () => Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.formulas[`${row+i}:${col+j}`] || '')),
        setFormula: value => { this.formulas[key]=value; },
        setNumberFormat() {},
        setValue: value => this.getRange(row,col).setValues([[value]]),
        setValues: values => {
          if (fail({name:this.name,row,col,values})) throw Error('Injected write failure');
          values.forEach((r,i)=>r.forEach((v,j)=>{this.rows[row-1+i] ??=[];this.rows[row-1+i][col-1+j]=consumeEscapes && typeof v==='string' && /^'[=+@-]/.test(v) ? v.slice(1) : v;}));
        }
      };
    }
  }
  for (const id of ['classroom','sandbox','week2','verification']) {
    const tabs = new Map();
    books.set(id,{tabs,getId:()=>id,getUrl:()=>id,getSheetByName:n=>tabs.get(n),insertSheet:n=>{const s=new Sheet(n);tabs.set(n,s);return s;}});
  }
  function response(body,status=200) { return {getResponseCode:()=>status,getContentText:()=>typeof body==='string'?body:JSON.stringify(body)}; }
  const ctx=vm.createContext({Date:Clock,console:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperties:(values,replace)=>{if(replace)properties.clear();Object.entries(values).forEach(([k,v])=>properties.set(k,v));}})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest()),formatDate:()=>new Clock().toISOString().slice(0,10)},
    ScriptApp:{getOAuthToken:()=> 'private-google-token'},
    SpreadsheetApp:{getActiveSpreadsheet:()=>books.get('classroom'),openById:id=>{if(!books.has(id))throw Error('Unknown workbook');return books.get(id);},flush(){}},
    LockService:{getScriptLock:()=>({waitLock(){if(locked)throw Error('Lock timeout');locked=true;},releaseLock(){locked=false;}})},
    UrlFetchApp:{fetch:(url,options)=>{
      requests.push({url,options});
      if(url==='https://api.openai.com/v1/chat/completions') {
        calls++;
        const payload=JSON.parse(options.payload), output=reply(payload);
        if(output.raw!==undefined)return response(output.raw,output.status || 200);
        if(output.status)return response({},output.status);
        return response({id:'response-'+calls,model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
      }
      const u=new URL(url);
      if(u.hostname==='www.googleapis.com' && u.pathname==='/drive/v3/files/inputs')return response({id:'inputs',mimeType:'application/vnd.google-apps.folder'});
      if(u.hostname==='www.googleapis.com' && u.pathname==='/drive/v3/files') {
        if(pages) return response(pages[u.searchParams.get('pageToken') || 'first']);
        return response({files:Array.from(docs.values()).map(d=>({id:d.id,name:d.name,mimeType:d.mimeType,createdTime:d.createdTime}))});
      }
      if(u.hostname==='docs.googleapis.com') {
        const d=docs.get(u.pathname.split('/').pop());
        if(!d || d.denied)return response({},403);
        return response({tabs:Array.from({length:d.tabCount || 1},()=>({documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:d.body}}]}}]}}}))});
      }
      throw Error('Unexpected request '+url);
    }}
  });
  for(const f of ['schema','synthetic','extraction','sheets','Code','week2Input','week2Model','week2Merge','week2Store','week2','week2Views','week2Review','week2Integration','week2Upgrade'])vm.runInContext(fs.readFileSync(`src/${f}.js`,'utf8'),ctx);
  ctx.setupBoard('classroom');ctx.setupBoard('sandbox');
  return {ctx,books,docs,properties,requests,calls:()=>calls,setReply:f=>{reply=f;},setFailure:f=>{fail=f;},setPages:p=>{pages=p;},consumeTextEscapes:()=>{consumeEscapes=true;},tick:()=>{now+=1000;},setLocked:v=>{locked=v;},rows:name=>books.get('week2').tabs.get(name).rows.slice(1),
    addDoc(id,date,text,extra={}) { docs.set(id,{id,name:id,mimeType:'application/vnd.google-apps.document',createdTime:date+'T12:00:00Z',body:`Northstar project ${id}\nMeeting date: ${date}\nTranscript\n${text}\n`,...extra}); },
    run(ids,extra={}) { now+=1000; return ctx.processInbox({sourceIds:ids || [],...extra}); }
  };
}

function action(decision,taskId,quote,values={},extra={}) {
  return {decision,task_id:taskId,candidate_ids:[],reason:'Same identified work and source evidence',source_quotes:[quote],values:{task:null,owner:null,status:null,urgency:null,due_date:null,next_step:null,blockers:null,dependencies:null,okr_link:null,risk_flag:null,...values},dependency_ids:[],...extra};
}

module.exports={week2Harness,action};
