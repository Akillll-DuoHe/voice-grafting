import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,statSync,copyFileSync,constants} from 'node:fs';
import {resolve,join,dirname,extname} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(!value('--config')||!value('--source')||!value('--reference')||!value('--out'))throw Error('Use --config singing.local.json --source dry-vocal.wav --reference your-voice.wav --out song.wav [--steps 30] [--semitones 0]');
const config=JSON.parse(readFileSync(resolve(value('--config')),'utf8').replace(/^\uFEFF/,''));
const repo=resolve(config.repo),source=resolve(value('--source')),reference=resolve(value('--reference')),output=resolve(value('--out'));
for(const file of [config.python,join(repo,'inference.py'),source,reference])if(!existsSync(file)||!statSync(file).isFile())throw Error('Missing local singing file: '+file);
if(extname(output).toLowerCase()!=='.wav'||existsSync(output))throw Error('Choose a new .wav output path');
const steps=Number(value('--steps')??30),shift=Number(value('--semitones')??0);
if(!Number.isInteger(steps)||steps<4||steps>100||!Number.isInteger(shift)||Math.abs(shift)>12)throw Error('Invalid steps or semitone shift');
const runDir=join(dirname(output),'sing-run-'+Date.now());
const command=[join(repo,'inference.py'),'--source',source,'--target',reference,'--output',runDir,'--f0-condition','True','--auto-f0-adjust','False','--semi-tone-shift',String(shift),'--diffusion-steps',String(steps),'--length-adjust','1.0','--inference-cfg-rate','0.7','--fp16',config.fp16===false?'False':'True'];
if(config.checkpoint||config.modelConfig){
  if(!config.checkpoint||!config.modelConfig||![config.checkpoint,config.modelConfig].every(existsSync))throw Error('Provide both local checkpoint and modelConfig');
  command.push('--checkpoint',resolve(config.checkpoint),'--config',resolve(config.modelConfig));
}
if(args.includes('--dry-run')){console.log(JSON.stringify({engine:'seed-vc',mode:'singing-voice-conversion',steps,semitones:shift,output,checked:true}));process.exit(0);}
mkdirSync(runDir,{recursive:true});
const env={...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_DISABLE_TELEMETRY:'1',HF_HUB_DISABLE_XET:'1',OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4',NUMBA_CACHE_DIR:join(repo,'checkpoints/numba')};
if(config.offline===true)Object.assign(env,{HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'});
const child=spawn(config.python,command,{cwd:repo,windowsHide:true,stdio:'inherit',env});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());
const code=await new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',accept);});
if(code!==0)throw Error('Seed-VC failed with exit code '+code+'; no successful song is claimed');
const candidates=readdirSync(runDir).filter(f=>f.endsWith('.wav'));if(candidates.length!==1)throw Error('Expected one converted song WAV');
const generated=join(runDir,candidates[0]),bytes=readFileSync(generated);if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.length<100)throw Error('Invalid converted audio');
copyFileSync(generated,output,constants.COPYFILE_EXCL);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(output+'.json',JSON.stringify({kind:'singing-voice-conversion',engine:'seed-vc',steps,semitones:shift,sourceSha256:hash(source),referenceSha256:hash(reference),outputSha256:hash(output),listeningApproved:false,identitySimilarityVerified:false},null,2),{flag:'wx'});
console.log(JSON.stringify({song:output,mode:'convert-existing-vocal',listeningApproved:false}));
