import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const targets={
 'local-memory.mjs':['packages/voice/plugin/src/local-memory.mjs','packages/qq-bridge/plugin/lib/local-memory.mjs'],
 'song-library.mjs':['packages/voice/plugin/src/song-library.mjs','packages/qq-bridge/plugin/lib/song-library.mjs'],
 'reply-preferences.mjs':['packages/qq-bridge/plugin/lib/reply-preferences.mjs'],
};
let changed=0;
for(const [name,paths] of Object.entries(targets)){
 const source=readFileSync(resolve(root,'shared',name));
 for(const path of paths){const target=resolve(root,path);if(!source.equals(readFileSync(target))){changed++;if(process.argv.includes('--check'))console.error('Shared copy differs: '+path);else writeFileSync(target,source);}}
}
if(process.argv.includes('--check')&&changed)process.exitCode=1;
else console.log(JSON.stringify({sharedCopies:5,changed,checkOnly:process.argv.includes('--check')}));
