import Schema from '@deepseek-ai/schemastery';
import {readFileSync} from 'node:fs';import {resolve,dirname} from 'node:path';
import {createVoiceServer,normalizeConfig} from './src/server.mjs';import {createVoiceClient} from './src/client.mjs';import {createDshSpeechAdapter} from './src/native-stt.mjs';import {startBackend} from './src/managed-backend.mjs';
export const name='dsh-local-voice';
export const Config=Schema.object({configFile:Schema.string(),configFileEnv:Schema.string().default('DSH_LOCAL_VOICE_CONFIG'),serve:Schema.boolean().default(true),provideSpeechToTextFallback:Schema.boolean().default(false)});
export async function apply(ctx,options={}){
 const filename=options.configFile??process.env[options.configFileEnv??'DSH_LOCAL_VOICE_CONFIG'];if(!filename)throw Error('Choose your own voice configuration file');
 const full=resolve(filename),raw=JSON.parse(readFileSync(full,'utf8').replace(/^\uFEFF/,''));let server,helper;
 try{
  if(options.serve!==false){
   const config=normalizeConfig(raw,dirname(full));let reuse=false;
   try{const r=await fetch(`http://127.0.0.1:${config.port}/health`,{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(500)});reuse=r.ok&&(await r.json()).protocol==='local-voice-v1'}catch{}
   if(!reuse){helper=await startBackend(raw.launch);server=createVoiceServer(config);await server.listen()}
  }
 }catch(error){helper?.kill();throw error}
 ctx.effect(()=>async()=>{await server?.close();helper?.kill()},'local-voice.owned-services');
 const baseUrl=server?.endpoint??raw.clientBaseUrl??`http://127.0.0.1:${raw.port??28133}/v1`;
 const client=createVoiceClient({baseUrl,token:raw.token,speechModel:raw.speechModel,transcriptionModel:raw.transcriptionModel,defaultVoice:raw.defaultVoice});ctx.provide('localVoice',client);
 if(options.provideSpeechToTextFallback){if(ctx.get('speechToText'))throw Error('Keep your existing speechToText provider or disable it before enabling this fallback');ctx.provide('speechToText',createDshSpeechAdapter(client))}
}
