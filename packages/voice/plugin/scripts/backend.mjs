import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const index=process.argv.indexOf('--config');if(index<0||!process.argv[index+1])throw Error('Use --config <your backend.local.json>');
const file=resolve(process.argv[index+1]),config=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,'')),home=dirname(file);
for(const key of ['python','repo','model_dir','reference','asr_model_dir'])if(typeof config[key]!=='string'||config[key].startsWith('EDIT_')||!existsSync(config[key]))throw Error('Configure an existing local path for '+key);
if(config.engine==='voxcpm2'){
  if(typeof config.voxcpm_repo!=='string'||config.voxcpm_repo.startsWith('EDIT_')||!existsSync(config.voxcpm_repo))throw Error('Configure voxcpm_repo to your own VoxCPM src directory');
  const {createHash}=await import('node:crypto');
  if(!/^[a-f0-9]{64}$/.test(config.reference_sha256??'')||createHash('sha256').update(readFileSync(config.reference)).digest('hex')!==config.reference_sha256)throw Error('Register your unchanged reference with scripts/set-reference.mjs');
  if(config.lora_weights_path&&(!existsSync(config.lora_weights_path)||!existsSync(join(config.lora_weights_path,'lora_config.json'))))throw Error('lora_weights_path must be a complete local LoRA checkpoint directory');
}
const script=fileURLToPath(new URL('../backend/server.py',import.meta.url));if(!existsSync(script))throw Error('Backend file missing; run package preparation from the source tree first');
const child=spawn(config.python,['-u',script],{cwd:home,windowsHide:true,stdio:'inherit',env:{...process.env,QQVOICE_WORK_DIR:home,QQVOICE_AUDIO_CONFIG:file,QQVOICE_OUTPUT_DIR:join(home,'outputs')}});
child.on('exit',code=>process.exitCode=code??1);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());
