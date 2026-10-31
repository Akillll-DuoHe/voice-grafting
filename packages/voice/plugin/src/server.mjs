import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,realpathSync,unlinkSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';

class VoiceError extends Error{constructor(status,code,message=code){super(message);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new VoiceError(status,code);};
const emotions=new Set(['auto','neutral','warm','gentle','happy','amused','laugh','upset','sad','curious','surprised','serious']);
export function normalizeConfig(raw,base=process.cwd()){
  const b=raw.backend??{};
  const backend=new URL(b.baseUrl??'http://127.0.0.1:18931');
  if(backend.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(backend.hostname)||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw Error('Backend must be a loopback HTTP origin');
  if(typeof raw.token!=='string'||raw.token.length<24||typeof b.token!=='string'||b.token.length<24)throw Error('Generate separate local API and backend tokens before starting');
  if(!b.inputDir||!b.outputDir)throw Error('Backend inputDir and outputDir are required');
  const port=raw.port??18933;if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid local port');
  const voices=raw.voices??{default:'active'};
  if(!Object.keys(voices).length||Object.entries(voices).some(([k,v])=>!/^[a-z0-9_-]{1,40}$/.test(k)||!/^[a-z0-9_]{1,40}$/.test(v)))throw Error('Use registered voice IDs, never file paths in voice requests');
  const maxChars=raw.maxSpeechChars??600;if(!Number.isInteger(maxChars)||maxChars<1||maxChars>1800)throw Error('Invalid maxSpeechChars');
  return {token:raw.token,port,backend:{baseUrl:backend.origin,token:b.token,inputDir:resolve(base,b.inputDir),outputDir:resolve(base,b.outputDir)},
    ffmpeg:raw.ffmpeg??'ffmpeg',voices:Object.assign(Object.create(null),voices),maxSpeechChars:maxChars,chunkChars:60,maxUploadBytes:8*1024*1024,encoderPython:raw.encoderPython,encoderScript:raw.encoderScript};
}
export function speechChunks(text,max=120){
  if(typeof text!=='string'||!text.trim())fail(400,'input_required');
  const chunks=[];let remaining=text.trim();
  while(remaining.length){let cut=Math.min(max,remaining.length);if(cut<remaining.length){const part=remaining.slice(0,cut),punct=Math.max(...['。','！','？','；','，','\n','. ','! ','? '].map(p=>part.lastIndexOf(p)));if(punct>=Math.floor(max/3))cut=punct+1;}chunks.push(remaining.slice(0,cut));remaining=remaining.slice(cut).trimStart();}
  return chunks;
}
export function audioFormat(bytes){if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE')return 'wav';if(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224)return 'mp3';if(bytes.subarray(0,4).toString()==='OggS')return 'ogg';if(bytes.subarray(0,4).toString()==='fLaC')return 'flac';fail(415,'unsupported_audio_format');}
function contained(file,root){const path=realpathSync(file),allowed=realpathSync(root),delta=relative(allowed,path);if(delta==='..'||delta.startsWith('..\\')||delta.startsWith('../')||isAbsolute(delta))fail(502,'backend_output_outside_root');return path;}
function waveParts(wav){
  if(audioFormat(wav)!=='wav')fail(502,'backend_did_not_return_wav');let fmt,data;
  for(let offset=12;offset+8<=wav.length;){const name=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),end=offset+8+size;if(end>wav.length)fail(502,'invalid_backend_wav');if(name==='fmt ')fmt=wav.subarray(offset+8,end);if(name==='data')data=wav.subarray(offset+8,end);offset=end+(size%2);}
  if(!fmt||fmt.length<16||![1,3].includes(fmt.readUInt16LE(0))||!fmt.readUInt16LE(12)||!data||data.length%fmt.readUInt16LE(12))fail(502,'invalid_backend_wav');return {fmt,data};
}
export function joinWaves(waves){
  if(!waves.length)fail(502,'empty_speech_output');const parts=waves.map(waveParts),fmt=parts[0].fmt;
  if(parts.some(p=>!p.fmt.equals(fmt)))fail(502,'inconsistent_backend_wav_formats');
  const data=Buffer.concat(parts.map(p=>p.data));if(data.length>32*1024*1024)fail(502,'speech_output_too_large');
  const head=Buffer.alloc(20);head.write('RIFF');head.writeUInt32LE(4+8+fmt.length+(fmt.length%2)+8+data.length+(data.length%2),4);head.write('WAVE',8);head.write('fmt ',12);head.writeUInt32LE(fmt.length,16);
  const dataHead=Buffer.alloc(8);dataHead.write('data');dataHead.writeUInt32LE(data.length,4);
  return Buffer.concat([head,fmt,...(fmt.length%2?[Buffer.alloc(1)]:[]),dataHead,data,...(data.length%2?[Buffer.alloc(1)]:[])]);
}
function toMp3(wav,ffmpeg,signal){return new Promise((accept,reject)=>{
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-i','pipe:0','-map','0:a:0','-ac','1','-ar','24000','-codec:a','libmp3lame','-b:a','96k','-f','mp3','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','pipe'],signal});
  const chunks=[];let size=0,settled=false;const finish=(error,result)=>{if(settled)return;settled=true;error?reject(error):accept(result);};
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){child.kill();finish(new VoiceError(502,'encoded_speech_too_large'));}else chunks.push(chunk);});
  child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',()=>finish(new VoiceError(503,'ffmpeg_unavailable')));
  child.on('close',code=>code===0?finish(null,Buffer.concat(chunks)):finish(new VoiceError(502,'mp3_encoding_failed')));child.stdin.end(wav);
});}
function toPythonMp3(wav,python,script,signal){return new Promise((accept,reject)=>{
 const child=spawn(python,['-I',script],{windowsHide:true,stdio:['pipe','pipe','pipe'],signal}),chunks=[];let size=0,done=false;
 const finish=(e,b)=>{if(done)return;done=true;e?reject(e):accept(b)};
 child.stdout.on('data',b=>{size+=b.length;if(size>32*1024*1024){child.kill();finish(new VoiceError(502,'encoded_speech_too_large'))}else chunks.push(b)});
 child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',()=>finish(new VoiceError(503,'local_mp3_encoder_unavailable')));child.on('close',code=>code===0?finish(null,Buffer.concat(chunks)):finish(new VoiceError(502,'local_mp3_encoding_failed')));child.stdin.end(wav);
});}

async function body(req,limit){
  if(req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>limit))fail(413,'request_too_large');
  return new Promise((accept,reject)=>{const chunks=[];let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>limit){chunks.length=0;reject(new VoiceError(413,'request_too_large'));}else chunks.push(chunk);});req.on('end',()=>accept(Buffer.concat(chunks)));req.on('error',reject);req.on('aborted',()=>reject(new VoiceError(400,'request_aborted')));});
}
export function createVoiceServer(config,{fetcher=fetch,encode=toMp3}={}){
  mkdirSync(config.backend.inputDir,{recursive:true});mkdirSync(config.backend.outputDir,{recursive:true});const active=new Set();let endpoint;
  async function backend(route,payload,signal){
    const response=await fetcher(config.backend.baseUrl+route,{method:'POST',headers:{Authorization:'Bearer '+config.backend.token,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal});
    if(!response.ok)fail(response.status===422?422:503,'local_engine_rejected_request');
    const text=await response.text();if(text.length>16384)fail(502,'invalid_backend_response');return JSON.parse(text);
  }
  function send(res,status,type,data){if(res.destroyed)return;const bytes=Buffer.isBuffer(data)?data:Buffer.from(type.includes('json')?JSON.stringify(data):String(data));res.writeHead(status,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);}
  async function speech(req,res,signal){
    let value;try{value=JSON.parse((await body(req,16384)).toString('utf8'));}catch(e){if(e instanceof VoiceError)throw e;fail(400,'invalid_json');}
    if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid_json');
    if(Object.keys(value).some(k=>!['model','input','voice','response_format','speed','emotion'].includes(k)))fail(400,'unsupported_speech_option');
    if(!emotions.has(value.emotion??'auto'))fail(400,'unsupported_emotion');
    if(!['local-tts','tts-1','tts-1-hd'].includes(value.model??'local-tts'))fail(400,'unsupported_local_model');
    if(value.speed!==undefined&&value.speed!==1)fail(400,'speed_adjustment_not_supported');
    if(typeof value.input!=='string'||value.input.length>config.maxSpeechChars)fail(400,'speech_input_too_long');
    const voice=config.voices[value.voice??'default'];if(!voice)fail(400,'unknown_voice');
    const format=value.response_format??'mp3';if(!['mp3','wav'].includes(format))fail(400,'unsupported_response_format');
    const waves=[],segments=[];let position=0;
    for(const text of speechChunks(value.input,config.chunkChars)){const result=await backend(voice==='active'?'/speech':'/audition',voice==='active'?{text,emotion:value.emotion??'auto'}:{text,voice},signal);if(typeof result.path!=='string')fail(502,'invalid_backend_output');const path=contained(result.path,config.backend.outputDir);if(statSync(path).size>32*1024*1024)fail(502,'speech_output_too_large');const wave=readFileSync(path),part=waveParts(wave),byteRate=part.fmt.readUInt32LE(8);if(!byteRate)fail(502,'invalid_backend_wav_rate');const duration=part.data.length/byteRate,mood=emotions.has(result.emotion)&&result.emotion!=='auto'?result.emotion:'neutral';waves.push(wave);segments.push({start:position,end:position+duration,emotion:mood});position+=duration;}
    const wav=joinWaves(waves),audio=format==='wav'?wav:config.encoderPython?await toPythonMp3(wav,config.encoderPython,config.encoderScript,signal):await encode(wav,config.ffmpeg,signal);
    res.setHeader('X-Voice-Emotion',segments.find(s=>s.emotion!=='neutral')?.emotion??'neutral');
    res.setHeader('X-Voice-Segments',Buffer.from(JSON.stringify(segments)).toString('base64url'));
    send(res,200,format==='wav'?'audio/wav':'audio/mpeg',audio);
  }
  async function transcribe(req,res,signal){
    const type=req.headers['content-type']??'';if(!type.startsWith('multipart/form-data;')||type.length>300)fail(415,'multipart_file_required');
    const bytes=await body(req,config.maxUploadBytes+65536);let form;
    try{form=await new Request('http://127.0.0.1/upload',{method:'POST',headers:{'Content-Type':type},body:bytes}).formData();}catch{fail(400,'invalid_multipart');}
    if([...form.keys()].some(k=>!['file','model','language','response_format','temperature','prompt','stream'].includes(k)))fail(400,'unsupported_transcription_option');
    const file=form.get('file');if(form.getAll('file').length!==1||!file||typeof file.arrayBuffer!=='function')fail(400,'one_file_required');
    if(!file.size||file.size>config.maxUploadBytes)fail(413,'audio_upload_too_large');
    if(!['local-asr','whisper-1'].includes(form.get('model')??'local-asr'))fail(400,'unsupported_local_model');
    if(form.get('language')&&!['zh','auto'].includes(form.get('language')))fail(400,'only_chinese_asr_configured');
    if(form.get('prompt')||form.get('stream')==='true'||form.get('temperature')&&!['0','0.0'].includes(form.get('temperature')))fail(400,'unsupported_transcription_option');
    const format=form.get('response_format')??'json';if(!['json','text'].includes(format))fail(400,'unsupported_response_format');
    const data=Buffer.from(await file.arrayBuffer()),ext=audioFormat(data),filename=randomUUID()+'.'+ext,path=join(config.backend.inputDir,filename);writeFileSync(path,data,{flag:'wx'});
    try{const result=await backend('/transcribe',{file:filename},signal);if(typeof result.text!=='string'||!result.text.trim())fail(502,'empty_transcript');send(res,200,format==='text'?'text/plain; charset=utf-8':'application/json; charset=utf-8',format==='text'?result.text:{text:result.text});}
    finally{try{unlinkSync(path);}catch{}}
  }
  const server=createServer(async(req,res)=>{
    const controller=new AbortController();active.add(controller);req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
    try{
      if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{fail(403,'origin_refused');}if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||origin.host!==req.headers.host)fail(403,'origin_refused');}
      const provided=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+config.token);
      if(provided.length!==expected.length||!timingSafeEqual(provided,expected))fail(401,'unauthorized');
      if(req.method==='GET'&&req.url==='/health')return send(res,200,'application/json',{ok:true,protocol:'local-voice-v1',network:'loopback',backend:'local',formats:['wav','mp3'],maxSpeechChars:config.maxSpeechChars,maxVoiceSeconds:120});
      if(req.method==='GET'&&req.url==='/v1/models')return send(res,200,'application/json',{object:'list',data:['local-asr','local-tts'].map(id=>({id,object:'model',owned_by:'local'}))});
      if(req.method==='GET'&&req.url==='/v1/voices')return send(res,200,'application/json',{voices:Object.keys(config.voices)});
      if(req.method!=='POST')fail(405,'method_not_allowed');
      if(req.url==='/v1/audio/speech')return await speech(req,res,signal);
      if(req.url==='/v1/audio/transcriptions')return await transcribe(req,res,signal);
      fail(404,'not_found');
    }catch(error){send(res,error instanceof VoiceError?error.status:503,'application/json',{error:{message:error instanceof VoiceError?error.message:'Local audio service is unavailable; check your private local configuration',type:'local_voice_error',code:error instanceof VoiceError?error.code:'local_service_unavailable'}});}
    finally{active.delete(controller);}
  });
  server.requestTimeout=60000;server.headersTimeout=15000;server.maxRequestsPerSocket=100;
  return {get endpoint(){return endpoint;},
    async listen(){await new Promise((accept,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',accept);});endpoint=`http://127.0.0.1:${server.address().port}/v1`;return endpoint;},
    async close(){for(const controller of active)controller.abort();server.closeAllConnections();await new Promise(accept=>server.close(accept));}
  };
}
