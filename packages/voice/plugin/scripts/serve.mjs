import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createVoiceServer,normalizeConfig} from '../src/server.mjs';
const index=process.argv.indexOf('--config'),filename=index>=0?process.argv[index+1]:process.env.DSH_LOCAL_VOICE_CONFIG;
if(!filename)throw Error('Use --config <your voice.local.json>');
const path=resolve(filename),config=normalizeConfig(JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,'')),dirname(path));
const server=createVoiceServer(config);await server.listen();
console.log('Local voice protocol ready: '+server.endpoint+' (local account-free engine; QQ/Bilibili transports are separate)');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
