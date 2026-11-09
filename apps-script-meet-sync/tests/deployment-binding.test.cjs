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

test('an explicit upgrade uses the existing project binding without requiring a second project',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'week2-upgrade-binding-'));
  try {
    fs.writeFileSync(path.join(dir,'.clasp.json'),JSON.stringify({scriptId:'existing-week1-project',rootDir:'src'}));
    fs.mkdirSync(path.join(dir,'src'));fs.writeFileSync(path.join(dir,'src/week2.js'),'');
    fs.mkdirSync(path.join(dir,'bin'));
    fs.writeFileSync(path.join(dir,'bin/clasp'),'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o755});
    const r=spawnSync(process.execPath,[path.resolve('scripts/clasp.cjs'),'--upgrade','push','--force'],{cwd:dir,env:{...process.env,PATH:path.join(dir,'bin')},encoding:'utf8'});
    assert.equal(r.status,0);assert.match(r.stdout,/-P\n\.clasp.json\npush\n--force/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('Executor upload requires an explicit mode and preserves the existing project binding',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'executor-binding-'));
  try {
    fs.writeFileSync(path.join(dir,'.clasp.json'),JSON.stringify({scriptId:'existing-project',rootDir:'src'}));fs.mkdirSync(path.join(dir,'src'));fs.writeFileSync(path.join(dir,'src/executor.js'),'');
    fs.mkdirSync(path.join(dir,'bin'));fs.writeFileSync(path.join(dir,'bin/clasp'),'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o755});
    const run=args=>spawnSync(process.execPath,[path.resolve('scripts/clasp.cjs'),...args],{cwd:dir,env:{...process.env,PATH:path.join(dir,'bin')},encoding:'utf8'});
    for(const args of [['push'],['--upgrade','push'],['--week2','push']]){const r=run(args);assert.equal(r.status,1);assert.match(r.stderr,/explicit --executor/);}
    const r=run(['--executor','push']);assert.equal(r.status,0);assert.match(r.stdout,/-P\n\.clasp.json\npush/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('Enforcer upload requires its explicit mode and retains the existing project binding',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'enforcer-binding-'));
  try{
    fs.writeFileSync(path.join(dir,'.clasp.json'),JSON.stringify({scriptId:'existing-project',rootDir:'src'}));fs.mkdirSync(path.join(dir,'src'));for(const f of ['enforcer','executor','week2'])fs.writeFileSync(path.join(dir,'src/'+f+'.js'),'');
    fs.mkdirSync(path.join(dir,'bin'));fs.writeFileSync(path.join(dir,'bin/clasp'),'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o755});
    const run=args=>spawnSync(process.execPath,[path.resolve('scripts/clasp.cjs'),...args],{cwd:dir,env:{...process.env,PATH:path.join(dir,'bin')},encoding:'utf8'});
    for(const args of [['push'],['--executor','push'],['--upgrade','push'],['--week2','push']]){const r=run(args);assert.equal(r.status,1);assert.match(r.stderr,/explicit --enforcer/);}
    const r=run(['--enforcer','push']);assert.equal(r.status,0);assert.match(r.stdout,/-P\n\.clasp.json\npush/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
