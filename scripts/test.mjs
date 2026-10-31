import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});if(r.status!==0)process.exit(r.status??1);}
run(['scripts/sync-shared.mjs']);
run(['--test',...readdirSync(resolve(root,'tests/unit')).filter(n=>n.endsWith('.test.mjs')).map(n=>'tests/unit/'+n)]);
run(['--loader',pathToFileURL(resolve(root,'tests/integration/test-loader.mjs')).href,'--test',...readdirSync(resolve(root,'tests/integration')).filter(n=>n.endsWith('.test.mjs')).map(n=>'tests/integration/'+n)]);
