import {spawn} from 'node:child_process';import {openSync,closeSync,existsSync,mkdirSync} from 'node:fs';import {join} from 'node:path';
export async function startBackend(spec){
 if(!spec)return null;for(const n of ['python','script','config','home'])if(!spec[n]||!existsSync(spec[n]))throw Error('Configure local backend path: '+n);
 if(!Number.isInteger(spec.port)||spec.port<1024||spec.port>65535)throw Error('Invalid backend port');
 const health='http://127.0.0.1:'+spec.port+'/health';try{const r=await fetch(health,{signal:AbortSignal.timeout(500)});if(r.ok)return null}catch{}
 mkdirSync(join(spec.home,'logs'),{recursive:true});const out=openSync(join(spec.home,'logs/backend.out.log'),'a'),err=openSync(join(spec.home,'logs/backend.err.log'),'a');
 const child=spawn(spec.python,['-I','-u',spec.script,'--port',String(spec.port)],{windowsHide:true,cwd:spec.home,stdio:['ignore',out,err],env:{...process.env,QQVOICE_WORK_DIR:spec.home,QQVOICE_AUDIO_CONFIG:spec.config,QQVOICE_OUTPUT_DIR:join(spec.home,'outputs'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});closeSync(out);closeSync(err);
 let failed;child.on('error',e=>failed=e);for(let i=0;i<80;i++){if(failed||child.exitCode!==null)break;try{const r=await fetch(health,{signal:AbortSignal.timeout(300)});if(r.ok)return child}catch{}await new Promise(r=>setTimeout(r,100))}
 child.kill();throw Error('Local backend did not start; inspect your data/logs/backend.err.log'+(failed?': '+failed.message:''));
}
