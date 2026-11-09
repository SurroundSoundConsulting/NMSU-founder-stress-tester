const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
const week2 = args[0] === '--week2';
const upgrade = args[0] === '--upgrade';
const executor = args[0] === '--executor';
const enforcer = args[0] === '--enforcer';
if (week2 || upgrade || executor || enforcer) args.shift();
const uploads = ['push','deploy','create-deployment','update-deployment'];
if (uploads.includes(args[0]) && fs.existsSync('src/enforcer.js') && !enforcer) { console.error('Enforcer code is present. Review its destination and use explicit --enforcer against the existing project; other upload modes are blocked.'); process.exit(1); }
if (uploads.includes(args[0]) && fs.existsSync('src/executor.js') && !executor && !enforcer) { console.error('Executor code is present. Review its permissions and use explicit --executor against the existing project; other upload modes are blocked.'); process.exit(1); }
const configFile = week2 ? '.clasp-week2.json' : '.clasp.json';
if (!fs.existsSync(configFile)) { console.error('Missing ' + configFile + '. Bind a dedicated test project before uploading.'); process.exit(1); }
const config = JSON.parse(fs.readFileSync(configFile,'utf8'));
if (!config.scriptId || config.scriptId.startsWith('REPLACE') || config.rootDir !== 'src') { console.error('Set test scriptId and rootDir=src in .clasp.json'); process.exit(1); }
if (week2 && fs.existsSync('.clasp.json') && config.scriptId === JSON.parse(fs.readFileSync('.clasp.json','utf8')).scriptId) { console.error('Week 2 must use a different Apps Script project from the Week 1 binding.'); process.exit(1); }
if (!week2 && !upgrade && !executor && !enforcer && uploads.includes(args[0]) && fs.existsSync('src/week2.js')) { console.error('Choose an explicit upgrade:week2 of the existing project, or deploy:week2:test with a separate .clasp-week2.json binding.'); process.exit(1); }
const integration = args[0] === 'run' && ['runIntegrationTests','runWeek2IntegrationTests'].includes(args[1]);
const run = spawnSync('clasp',['-A','.clasprc.json','-P',configFile,...(integration ? ['--json'] : []),...args],{stdio:integration ? 'pipe' : 'inherit',encoding:'utf8',shell:false});
if (run.error) console.error('Install dependencies with npm install first.');
if (integration) {
  let result;
  try { result = JSON.parse(run.stdout); } catch (_) {
    console.error(run.stderr || run.stdout || 'Remote execution returned no JSON result');
    process.exit(1);
  }
  if (result.error || result.response?.passed !== true) {
    console.error(JSON.stringify(result.error || result));
    process.exit(1);
  }
  console.log(JSON.stringify(result.response,null,2));
}
process.exit(run.status === null ? 1 : run.status);
