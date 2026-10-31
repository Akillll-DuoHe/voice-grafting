import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {spawn} from 'node:child_process';
import {createVoiceClient} from '../src/client.mjs';
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(!value('--config')||!value('--text')||!value('--out'))throw Error('Use --config voice.local.json --text "your sentence" --out audition.wav [--open]');
const config=JSON.parse(readFileSync(resolve(value('--config')),'utf8').replace(/^\uFEFF/,'')),output=resolve(value('--out'));
const format=extname(output).slice(1).toLowerCase();if(!['wav','mp3'].includes(format))throw Error('Output must be .wav or .mp3');
const client=createVoiceClient({baseUrl:config.clientBaseUrl??`http://127.0.0.1:${config.port??18933}/v1`,token:config.token,allowNoAuth:config.allowNoAuth===true,speechModel:config.speechModel,defaultVoice:config.defaultVoice});
const result=await client.synthesize(value('--text'),{voice:value('--voice')??config.defaultVoice??'default',format,emotion:value('--emotion')});
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,result.audio,{flag:'wx'});
const escaped=value('--text').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const preview=output+'.html';
writeFileSync(preview,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>本地声音试听</title><style>body{max-width:680px;margin:64px auto;padding:24px;font:18px/1.7 system-ui;background:#f5f6fb;color:#202538}audio{width:100%}p{white-space:pre-wrap}</style><h1>本地声音试听</h1><p>${escaped}</p><audio controls preload="metadata" src="data:${format==='wav'?'audio/wav':'audio/mpeg'};base64,${result.audio.toString('base64')}"></audio><p>点播放即可试听；本页不含账号、令牌或形象。</p></html>`,{flag:'wx'});
console.log(JSON.stringify({audio:output,preview,emotion:result.emotion}));
if(args.includes('--open')){
  if(process.platform==='win32')spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','Start-Process -FilePath $env:DSH_VOICE_PREVIEW'],{windowsHide:true,stdio:'ignore',env:{...process.env,DSH_VOICE_PREVIEW:preview}}).unref();
  else spawn(process.platform==='darwin'?'open':'xdg-open',[preview],{stdio:'ignore'}).unref();
}
