const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('Week 2 upload refuses missing, shared and legacy bindings before starting clasp',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'week2-binding-'));
  const wrapper=path.resolve('scripts/clasp.cjs');
  const run=args=>spawnSync(process.execPath,[wrapper,...args],{cwd:dir,env:{...process.env,PATH:''},encoding:'utf8'});
  try {
    fs.writeFileSync(path.join(dir,'.clasp.json'),JSON.stringify({scriptId:'old-project',rootDir:'src'}));
    fs.mkdirSync(path.join(dir,'src'));fs.writeFileSync(path.join(dir,'src/week2.js'),'');
    let r=run(['push']);assert.equal(r.status,1);assert.match(r.stderr,/separate .clasp-week2.json/);
    r=run(['--week2','push']);assert.equal(r.status,1);assert.match(r.stderr,/Missing .clasp-week2.json/);
    fs.writeFileSync(path.join(dir,'.clasp-week2.json'),JSON.stringify({scriptId:'old-project',rootDir:'src'}));
    r=run(['--week2','push']);assert.equal(r.status,1);assert.match(r.stderr,/different Apps Script project/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
