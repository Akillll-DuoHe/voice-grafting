import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {normalizeConfig} from '../src/server.mjs';
import {createVoiceClient} from '../src/client.mjs';
const index=process.argv.indexOf('--config');if(index<0||!process.argv[index+1])throw Error('Use --config <your voice.local.json>');
const path=resolve(process.argv[index+1]),raw=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
if(raw.clientBaseUrl){
  const client=createVoiceClient({baseUrl:raw.clientBaseUrl,token:raw.token,allowNoAuth:raw.allowNoAuth});
  const checks={config:true,loopbackOnly:true,clientOnly:true};
  try{const response=await fetch(client.endpoint+'/models',{headers:raw.token?{Authorization:'Bearer '+raw.token}:{},redirect:'error',signal:AbortSignal.timeout(3000)});checks.providerProbeStatus=response.status;checks.note='A provider may omit GET /models; test its speech/transcription endpoints separately.';}catch{checks.providerReachable=false;}
  console.log(JSON.stringify(checks,null,2));process.exit(0);
}
const config=normalizeConfig(raw,dirname(path));
const checks={config:true,loopbackOnly:true,ffmpeg:spawnSync(config.ffmpeg,['-version'],{windowsHide:true,stdio:'ignore',timeout:10000}).status===0};
try{checks.engineReachable=(await fetch(config.backend.baseUrl+'/health',{redirect:'error',signal:AbortSignal.timeout(3000)})).ok;}catch{checks.engineReachable=false;}
try{const response=await fetch(`http://127.0.0.1:${config.port}/health`,{headers:{Authorization:'Bearer '+config.token},redirect:'error',signal:AbortSignal.timeout(3000)});checks.protocolReady=response.ok;}catch{checks.protocolReady=false;}
console.log(JSON.stringify(checks,null,2));
