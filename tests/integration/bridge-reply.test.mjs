import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {QQBridge} from '../../packages/qq-bridge/plugin/lib/bridge.js';
const pause=()=>new Promise(r=>setTimeout(r,25));
function setup(t,dir=mkdtempSync(join(tmpdir(),'qq-reply-bridge-'))){
 const server=new EventEmitter();server.sent=[];server.socket={readyState:1,OPEN:1};server.currentSocket=()=>server.socket;server.sendSegments=async(_bot,type,id,segments)=>{server.sent.push({type,id,segments});return {message_id:server.sent.length};};
 const callbacks=new Map(),sections=[],tools=[],options=[];
 const ctx={on(name,fn){callbacks.set(name,fn);return()=>callbacks.delete(name);},get(){},agentDefaultModel:{currentSelection:()=>({provider:'deepseek-account',model:'deepseek-flash'})},agents:{async create(o){options.push(o.agentOptions);await o.setup({systemPrompt:{section:s=>sections.push(s)},tools:{register:x=>tools.push(x)}});return {agent:{id:o.sessionId,followup(){},cancel(){}},async dispose(){}};}}};
 const cfg={cwd:dir,allowUsers:[10001],allowGroups:[],allowAllChats:false,botQq:20002,acceptPrivate:true,sessionMode:'chat',agentMediaToolsEnabled:true,historyQueryEnabled:false,memberQueryEnabled:false,reactToolEnabled:false,sessionResumeEnabled:false,memoryEnabled:false,ttsEnabled:false,ttsProvider:'openai',ttsBaseUrl:'http://127.0.0.1:18934/v1',ttsApiKey:'fake-only',ttsMaxChars:500,faceEnabled:false,rateLimitEnabled:false,sttEnabled:false};
 const bridge=new QQBridge(ctx,cfg,server,{info(){},warn(){},error(){}});bridge.start();t.after(()=>bridge.stop());let count=0;
 return {dir,bridge,server,sections,tools,options,async input(text,userId=10001){server.emit('message',{bot:server.socket,userId,messageType:'private',groupId:0,text,atMe:false,ats:[],reply:null,records:[],images:[],files:[],messageId:String(++count),senderName:'test',raw:{message:[]}});await pause();},event(type,data={}){const entry=bridge.sessions.get('u:10001');callbacks.get('session/event')({id:entry.sessionId},{type,data});},answer(text){this.event('assistant/message',{message:{content:[{type:'text',text}]}});},end(){this.event('turn/end',{turn:1,reason:{kind:'completed'}});}};
}
test('real bridge: voice-only Japanese, no tool preamble or appended text, modes independent',async t=>{
 const prior=globalThis.fetch;globalThis.fetch=async()=>new Response(Buffer.from('ID3-offline-test-audio'));t.after(()=>{globalThis.fetch=prior;});
 const s=setup(t);await s.input('用日语，语音回复');assert.equal(s.options[0].reasoningEffort,undefined);assert(!s.tools.some(x=>x.name==='qq_send_voice'));
 s.event('turn/start',{turn:1});s.answer('稍等，我给你发语音。');s.answer('はい、日本語で話します。\n中文：好的，接下来用日语。');assert.equal(s.server.sent.length,0);s.end();await pause();
 assert.equal(s.server.sent.length,1);assert.deepEqual(s.server.sent[0].segments.map(x=>x.type),['record']);
 assert.match(s.sections.find(x=>x.name==='qq-persistent-reply-settings').text(),/language=ja; output=voice/);
 await s.input('今天吃什么');s.event('turn/start',{turn:2});s.answer('温かいうどんはいかがですか。');s.end();await pause();assert.equal(s.server.sent.length,2);assert.equal(s.server.sent[1].segments[0].type,'record');
 await s.input('打字回复');s.event('turn/start',{turn:3});s.answer('はい、文字で話します。');s.end();await pause();assert.equal(s.server.sent.length,3);assert.equal(s.server.sent[2].segments[0].type,'text');assert.match(s.server.sent[2].segments[0].data.text,/文字で/);
 assert.equal(s.bridge.replyPreferences.get('u:10001').language,'ja');
 const restarted=setup(t,s.dir);assert.equal(restarted.bridge.replyPreferences.get('u:10001').language,'ja');assert.equal(restarted.bridge.replyPreferences.get('u:10001').mode,'text');
});
test('new input invalidates in-flight voice before it reaches QQ; stranger cannot change preferences',async t=>{
 const prior=globalThis.fetch;let resolve;globalThis.fetch=()=>new Promise(r=>{resolve=r;});t.after(()=>{globalThis.fetch=prior;});
 const s=setup(t);await s.input('用日语加语音');s.event('turn/start',{turn:1});s.answer('はい、聞いています。');s.end();await pause();assert.equal(typeof resolve,'function');
 await s.input('打字回复');resolve(new Response(Buffer.from('ID3-offline-test')));await pause();assert.equal(s.server.sent.length,0);
 s.event('turn/start',{turn:2});s.answer('はい、文字で続けます。');s.end();await pause();assert.equal(s.server.sent.length,1);assert.equal(s.server.sent[0].segments[0].type,'text');
 await s.input('用中文语音回复',99999);assert.equal(s.bridge.replyPreferences.get('u:10001').language,'ja');assert.equal(s.bridge.replyPreferences.get('u:99999').mode,'text');
});
