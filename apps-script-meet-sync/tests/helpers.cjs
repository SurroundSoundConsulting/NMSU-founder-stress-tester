const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const item = {task:'Compare supplier quotes',owner:'Jordan',status:'open',urgency:0,due_date:'',next_step:'',blockers:'',dependencies:'',okr_link:'',risk_flag:'',source_quote:'Jordan: I can do that. No committed date yet.'};
function harness(options = {}) {
  const tabs = new Map(); const sandboxTabs = new Map(); const properties = new Map([['SPREADSHEET_ID','classroom'],['SANDBOX_SPREADSHEET_ID',options.sameBook ? 'classroom' : 'sandbox'],['OPENAI_API_KEY','private-test-key']]); let calls = 0; let status = 200; let response;
  class Sheet {
    constructor(name,map){this.rows=[];this.formats=[];this.formulas={};this.name=name;this.map=map;}
    getName(){return this.name;}
    setName(name){this.map.delete(this.name);this.name=name;this.map.set(name,this);return this;}
    copyTo(book){const copy=book.insertSheet("Copy "+this.name);copy.rows=this.rows.map(r=>r.slice());return copy;}
    deleteRow(row){this.rows.splice(row-1,1);}
    getLastRow(){return this.rows.length;}
    setFrozenRows(){}
    getRange(row,col,n=1,m=1){return {setFormula:formula=>{this.formulas[row+':'+col]=formula;},getFormulas:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.formulas[(row+i)+':'+(col+j)]||'')),getFormula:()=>this.formulas[row+':'+col] || '',setNumberFormat:format=>this.formats.push({row,col,n,m,format}),getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[row-1+i]?.[col-1+j] ?? '')),setValue:v=>this.getRange(row,col).setValues([[v]]),setValues:values=>values.forEach((r,i)=>r.forEach((v,j)=>{this.rows[row-1+i] ??=[];this.rows[row-1+i][col-1+j]=v;}))};}
  }
  function makeBook(id,map) { return {getId:()=>id,getSheetByName:n=>map.get(n),insertSheet:n=>{const s=new Sheet(n,map);map.set(n,s);return s;},getUrl:()=>id}; }
  const book=makeBook('classroom',tabs),sandboxBook=makeBook('sandbox',sandboxTabs);
  const ctx=vm.createContext({console:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)})},Utilities:{getUuid:()=>require('node:crypto').randomUUID(),DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF-8'},computeDigest:(_algorithm,text)=>Array.from(require('node:crypto').createHash('sha256').update(text).digest()).map(x=>x>127?x-256:x)},SpreadsheetApp:{getActiveSpreadsheet:()=>book,openById:id=>{if(id==='classroom')return book;if(id==='sandbox')return sandboxBook;throw new Error('Unknown workbook');},flush(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},UrlFetchApp:{fetch:(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');const payload=JSON.parse(options.payload);assert.ok(payload.messages[1].content.includes('Mesa Verde Robotics'));const quotes=payload.response_format.json_schema.schema.properties.actionItems.items.properties.source_quote.enum;assert.ok(quotes.includes(item.source_quote));assert.equal(new Set(quotes).size,quotes.length);return {getResponseCode:()=>status,getContentText:()=>response ?? JSON.stringify({id:'completion-test',model:'test',choices:[{finish_reason:'stop',message:{content:JSON.stringify({actionItems:[item]})}}]})};}}});
  for(const f of ['schema','synthetic','extraction','sheets','Code','integration','maintenance'])vm.runInContext(fs.readFileSync(`src/${f}.js`,'utf8'),ctx);
  return {ctx,tabs,sandboxTabs,properties,calls:()=>calls,setStatus:s=>status=s,setResponse:s=>response=s};
}

module.exports={harness,item};
