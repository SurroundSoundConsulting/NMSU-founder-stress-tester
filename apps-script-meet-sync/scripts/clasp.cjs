const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
if (!fs.existsSync('.clasp.json')) { console.error('Missing .clasp.json. Follow README.md to bind a dedicated test project.'); process.exit(1); }
const config = JSON.parse(fs.readFileSync('.clasp.json','utf8'));
if (!config.scriptId || config.scriptId.startsWith('REPLACE') || config.rootDir !== 'src') { console.error('Set test scriptId and rootDir=src in .clasp.json'); process.exit(1); }
const args = process.argv.slice(2);
const integration = args[0] === 'run' && args[1] === 'runIntegrationTests';
const run = spawnSync('clasp',['-A','.clasprc.json',...(integration ? ['--json'] : []),...args],{stdio:integration ? 'pipe' : 'inherit',encoding:'utf8',shell:false});
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
