import {copyFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
const destination=new URL('../backend/',import.meta.url);
// In the project source tree, package only the generic adapter code, never a config or voice.
const projectSource=new URL('../../../audio/server.py',import.meta.url);
const projectManifest=new URL('../../../package.json',import.meta.url);
if(existsSync(projectManifest)&&JSON.parse(readFileSync(projectManifest,'utf8')).name==='@local/qq-voice-companion'&&existsSync(projectSource)){mkdirSync(destination,{recursive:true});copyFileSync(projectSource,new URL('server.py',destination));copyFileSync(new URL('../../../audio/voxcpm_backend.py',import.meta.url),new URL('voxcpm_backend.py',destination));}
else if(!existsSync(new URL('server.py',destination)))throw Error('Generic audio adapter source missing');
console.error('Prepared generic backend source; credentials, references, models and chats are excluded.');
