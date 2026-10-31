import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes,createHash} from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';import {homedir} from 'node:os';import {createInterface} from 'node:readline/promises';
import YAML from '../vendor/yaml/dist/index.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),cmd=args.shift()??'help';
const val=k=>{const i=args.indexOf('--'+k);return i<0?undefined:args[i+1]},data=resolve(val('data')??join(root,'user-data')),json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const token=()=>randomBytes(32).toString('hex'),save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2),{flag:'wx',mode:0o600});
const voice=existsSync(join(root,'models/voxcpm2/config.json')),py=join(root,'runtime/python311/python.exe');
async function ask(label){const r=createInterface({input:process.stdin,output:process.stdout});try{return (await r.question(label)).trim().replace(/^"|"$/g,'')}finally{r.close()}}
function run(exe,argv,options={}){
 const ps=exe.toLowerCase().endsWith('.cmd');const r=ps?spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','$releaseArguments = @($env:DSH_RELEASE_ARGS | ConvertFrom-Json); & $env:DSH_RELEASE_COMMAND @releaseArguments; exit $LASTEXITCODE'],{stdio:'inherit',windowsHide:true,...options,env:{...process.env,...options.env,DSH_RELEASE_COMMAND:exe,DSH_RELEASE_ARGS:JSON.stringify(argv)}}):spawnSync(exe,argv,{stdio:'inherit',windowsHide:true,...options});if(r.status!==0)throw Error('Command failed: '+(r.error?.message??r.status));
}
function patchProfile(dshHome,profile,id,name,config){
 if(!/^[a-zA-Z0-9_-]+$/.test(profile))throw Error('Invalid DSH profile name');const p=join(dshHome,'profiles',profile,'cordis.patch.yml');
 const rows=existsSync(p)?YAML.parse(readFileSync(p,'utf8')):[];if(!Array.isArray(rows))throw Error('Unsupported profile patch; ask your DSH to merge the provided config');
 if(rows.some(r=>r.id===id))throw Error('This plugin is already configured; preserve it and merge manually');
 if(existsSync(p))copyFileSync(p,p+'.backup-'+Date.now());mkdirSync(dirname(p),{recursive:true});rows.push({id,name,config});writeFileSync(p,YAML.stringify(rows));
}
if(cmd==='setup'){
 mkdirSync(data,{recursive:true});
 if(voice){
  if(existsSync(join(data,'voice.local.json')))throw Error('Existing configuration preserved. Use your existing data directory.');
  const reference=resolve(val('reference')??await ask('你自己的参考声音 WAV 完整路径：'));
  const bytes=readFileSync(reference);if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Reference must be a WAV file.');
  mkdirSync(join(data,'incoming'),{recursive:true});mkdirSync(join(data,'outputs'),{recursive:true});
  const btoken=token(),backendPort=Number(val('backend-port')??28131),port=Number(val('port')??28133);
  for(const p of [backendPort,port])if(!Number.isInteger(p)||p<1024||p>65535)throw Error('Invalid port');if(port===backendPort)throw Error('Use separate ports');
  const config={python:py,engine:'voxcpm2',repo:join(root,'engines/VoxCPM/src'),voxcpm_repo:join(root,'engines/VoxCPM/src'),model_dir:join(root,'models/voxcpm2'),asr_model_dir:join(root,'models/whisper'),reference,reference_sha256:createHash('sha256').update(bytes).digest('hex'),token:btoken,input_dir:join(data,'incoming'),character_id:'my_voice',reference_asset_id:'my_reference',emotion_mode:'reference',cfg_value:1.5,auto_emotion:false,native_laughter:false,air_cleanup:false,output_rms_dbfs:-21,max_output_gain_db:6,output_peak_limit:.88,port:backendPort};
  save(join(data,'backend.local.json'),config);
  save(join(data,'voice.local.json'),{port,token:token(),maxSpeechChars:600,voices:{default:'active'},encoderPython:py,encoderScript:join(root,'tools/encode-mp3.py'),backend:{baseUrl:'http://127.0.0.1:'+backendPort,token:btoken,inputDir:join(data,'incoming'),outputDir:join(data,'outputs')},launch:{python:py,script:join(root,'plugin/backend/server.py'),config:join(data,'backend.local.json'),home:data,port:backendPort}});
  console.log('配置已创建，令牌保存在你的数据目录中。DSH 安装后自动启动本地服务。');
 }else{
  if(existsSync(join(data,'bridge.local.json')))throw Error('Existing bridge configuration preserved');
  const bot=val('bot')??await ask('角色专用 QQ 号：'),owner=val('owner')??await ask('允许聊天的本人 QQ 号：');if(!/^[1-9]\d{4,11}$/.test(bot)||!/^[1-9]\d{4,11}$/.test(owner)||bot===owner)throw Error('Provide two different QQ accounts');
  const port=Number(val('port')??28136);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
  const wsToken=token(),cfg={host:'127.0.0.1',port,accessToken:wsToken,cwd:data,botQq:Number(bot),allowUsers:[Number(owner)],allowGroups:[],allowAllChats:false,acceptPrivate:true,sessionMode:'chat',sessionResumeEnabled:true,memoryEnabled:true,memoryMaxEntries:30,historyArchiveEnabled:true,recordInbound:true,traceEnabled:true,agentMediaToolsEnabled:false,fileSendDirs:[join(data,'songs')],faceEnabled:false,sttEnabled:false,ttsEnabled:false};
  mkdirSync(join(data,'songs'),{recursive:true});
  const vf=val('voice-config')??(args.includes('--text-only')?'':await ask('通用声音包的 voice.local.json 路径（留空先用文字）：'));if(vf){const v=json(resolve(vf));Object.assign(cfg,{ttsEnabled:true,ttsProvider:'openai',ttsBaseUrl:'http://127.0.0.1:'+v.port+'/v1',ttsApiKey:v.token,ttsModel:'local-tts',ttsVoice:'default',sttEnabled:true,sttProvider:'cloud',sttBaseUrl:'http://127.0.0.1:'+v.port+'/v1',sttApiKey:v.token,sttModel:'local-asr'})}
  save(join(data,'bridge.local.json'),cfg);save(join(data,'napcat-onebot.local.json'),{network:{httpServers:[],httpClients:[],websocketServers:[],websocketClients:[{name:'dsh-local',enable:true,url:'ws://127.0.0.1:'+port,token:wsToken,messagePostFormat:'array',reconnectInterval:3000,heartInterval:30000}]},musicSignUrl:'',enableLocalFile2Url:false,parseMultMsg:false});
  save(join(data,'user-rules.json'),{persona:'',notes:'请在 DSH 中填写你自己的角色规则。此文件不自动注入模型。'});
  console.log('QQ桥配置已创建。按 docs/QQ登录与连接.md 登录自己的角色号，并导入生成的 OneBot 配置。');
 }
}else if(cmd==='install'){
 const cli=val('dsh')??await ask('本机 dsh.cmd 的完整路径：'),profile=val('profile')??'desktop';if(!existsSync(cli))throw Error('DSH CLI does not exist');
 const meta=json(join(root,'plugin/package.json')),filename=voice?'local-dsh-local-voice-0.3.0.tgz':'dsh-qq-onebot-bridge-0.8.0-offline.3.tgz';
 const config=voice?{configFile:join(data,'voice.local.json'),serve:true}:json(join(data,'bridge.local.json'));if(voice&&!existsSync(config.configFile))throw Error('Run setup first');
 run(cli,['plugin','--profile',profile,'add',join(root,'install',filename),'--offline','--ignore-scripts','--save-exact']);
 patchProfile(resolve(val('dsh-home')??process.env.DSH_HOME??join(homedir(),'.dsh')),profile,voice?'dsh-local-voice':'dsh-qq-onebot-bridge',meta.name,config);console.log('插件与本地配置已安装。请在你实际使用的 DSH profile 中核对插件已启用。');
}else if(cmd==='start'&&voice){
 const {startBackend}=await import('../plugin/src/managed-backend.mjs');const cfg=json(join(data,'voice.local.json'));const helper=await startBackend(cfg.launch);const {createVoiceServer,normalizeConfig}=await import('../plugin/src/server.mjs');const server=createVoiceServer(normalizeConfig(cfg,data));await server.listen();console.log('本地声音服务已启动，关闭此窗口即可停止本次启动的服务。');for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{await server.close();helper?.kill();process.exit(0)});
}else if(cmd==='doctor'){
 if(voice){run(py,['-I','-B',join(root,'tools/check-runtime.py'),root]);for(const env of ['vevo','qwen'])run(join(root,'runtime/python312/python.exe'),['-I','-B',join(root,'tools/run-env.py'),env,join(root,'tools/check-env-imports.py'),env]);console.log('三套运行环境检查结束；此检查不加载模型，不等于声音听感通过。')}
 else{console.log(JSON.stringify({node:process.version,bridgeSource:existsSync(join(root,'plugin/lib/local-memory.mjs')),frameworkArchive:existsSync(join(root,'third-party/NapCat.Framework-v4.18.41.zip')),configured:existsSync(join(data,'bridge.local.json'))}))}
}else if(cmd==='say'&&voice){run(join(root,'runtime/node/node.exe'),[join(root,'plugin/scripts/say.mjs'),'--config',join(data,'voice.local.json'),'--text',val('text')??'你好，这是本地声音试听。','--out',resolve(val('out')??join(data,'outputs/listen.wav')),...(args.includes('--open')?['--open']:[])])}
else if(cmd==='convert'&&voice){run(join(root,'runtime/python312/python.exe'),['-I',join(root,'tools/run-env.py'),'vevo',join(root,'tools/convert-vocal.py'),...args])}
else if(cmd==='qwen'&&voice){run(join(root,'runtime/python312/python.exe'),['-I',join(root,'tools/run-env.py'),'qwen',join(root,'tools/qwen-clone.py'),...args])}
else if(cmd==='prepare-training'&&voice){run(py,['-I',join(root,'plugin/scripts/prepare-training.py'),...args])}
else if(cmd==='train'&&voice){const config=val('config');if(!config)throw Error('Use --config your-reviewed-training.yaml');run(py,['-I',join(root,'tools/train.py'),'--config',resolve(config)])}
else console.log('命令：setup / install / doctor / start / say / convert / qwen / prepare-training / train。\n先看 README.md 和 docs/。安装者必须提供自己的声音素材、角色QQ号和DSH模型配置。');
