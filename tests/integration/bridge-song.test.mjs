import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,relative} from 'node:path';import {createHash} from 'node:crypto';
import {QQBridge} from '../../packages/qq-bridge/plugin/lib/bridge.js';
const wait=()=>new Promise(r=>setTimeout(r,35));
function setup(t,extra={}){
 const dir=mkdtempSync(join(tmpdir(),'qq-song-bridge-'));t.after(()=>{assert(!relative(resolve(tmpdir()),resolve(dir)).startsWith('..'));rmSync(dir,{recursive:true,force:true})});
 const audio=join(dir,'songs');mkdirSync(audio);const clips=[9,24,36,54].map((seconds,i)=>{const b=Buffer.from('fake-audio-'+i),file=join(audio,'s'+i+'.mp3');writeFileSync(file,b);return {id:'K'+i,song:i<2?'song01':'song05',title:i<2?'测试曲甲':'TestSongB',seconds,start:1,end:1+seconds,status:'keep',ownerApproved:true,referenceSHA256:'voice',playbackPath:file,playbackSHA256:createHash('sha256').update(b).digest('hex'),playbackBytes:b.length}});
 const library=join(dir,'library.json');writeFileSync(library,JSON.stringify({format:'approved-song-library/v1',id:'test-library',approved:true,referenceSHA256:'voice',audioRoot:audio,songs:[{id:'song01',title:'测试曲甲',aliases:['第1首']},{id:'song05',title:'TestSongB',aliases:['第5首']}],clips}));
 writeFileSync(join(dir,'singing-library.local.json'),JSON.stringify({enabled:true,libraryFile:library,referenceSHA256:'voice'}));
 const server=new EventEmitter();server.sent=[];server.socket={readyState:1,OPEN:1};server.currentSocket=()=>server.socket;server.sendSegments=async(_b,type,id,segments)=>{server.sent.push({type,id,segments});return {message_id:server.sent.length}};server.getRecord=async()=>({base64:Buffer.from('offline-input-audio').toString('base64')});
 let modelCalls=0;const callbacks=new Map();const ctx={on(n,fn){callbacks.set(n,fn);return()=>{}},get(){},agentDefaultModel:{currentSelection:()=>({provider:'test',model:'test'})},agents:{async create(o){modelCalls++;await o.setup({systemPrompt:{section(){}},tools:{register(){}}});return {agent:{id:o.sessionId,followup(){},cancel(){}},async dispose(){}}}}};
 const config={cwd:dir,allowUsers:[10001],allowGroups:[],allowAllChats:false,botQq:20002,acceptPrivate:true,sessionMode:'chat',sessionResumeEnabled:false,memoryEnabled:false,recordInbound:false,historyArchiveEnabled:false,rateLimitEnabled:false,fortuneEnabled:false,diceEnabled:false,agentMediaToolsEnabled:false,sttEnabled:false,ttsProvider:'openai',ttsApiKey:'fake-only',...extra};
 const errors=[];const bridge=new QQBridge(ctx,config,server,{info(){},warn(){},error(s){errors.push(s)}});bridge.start();t.after(()=>bridge.stop());let id=0;
 return {bridge,server,clips,errors,get modelCalls(){return modelCalls},async input(text,overrides={}){server.emit('message',{bot:server.socket,userId:10001,messageType:'private',groupId:0,text,atMe:false,ats:[],reply:null,records:[],images:[],files:[],forwards:[],messageId:String(++id),senderName:'offline-test',raw:{message:[]},...overrides});await wait()}};
}
test('actual bridge routes singing and contextual lengths as one record only, with no model or TTS',async t=>{
 const s=setup(t);const prior=globalThis.fetch;globalThis.fetch=()=>{throw Error('No TTS/network allowed')};t.after(()=>globalThis.fetch=prior);
 await s.input('唱歌');await s.input('长的');await s.input('短的');assert.equal(s.server.sent.length,3);assert.equal(s.modelCalls,0);assert(s.server.sent.every(x=>x.segments.length===1&&x.segments[0].type==='record'));
 assert.match(s.server.sent[1].segments[0].data.file,/s2\.mp3$/);assert(s.server.sent[2].segments[0].data.file.endsWith('s0.mp3')||s.server.sent[2].segments[0].data.file.endsWith('s1.mp3'));
});
test('song requests preserve Japanese/text preferences and ordinary conversation remains a model turn',async t=>{
 const s=setup(t);await s.input('用日语加文字');const before=s.bridge.replyPreferences.get('u:10001');assert.equal(before.mode,'text');assert.equal(before.language,'ja');const calls=s.modelCalls;
 await s.input('唱一段长的');assert.equal(s.modelCalls,calls);assert.deepEqual(s.bridge.replyPreferences.get('u:10001'),before);assert.equal(s.server.sent.at(-1).segments[0].type,'record');await s.input('今天吃什么？');assert(s.modelCalls>=calls);
});
test('strangers, groups, injected frames and replayed frames cannot trigger song delivery',async t=>{
 const s=setup(t);await s.input('唱歌',{userId:99999});await s.input('唱歌',{messageType:'group',groupId:20002});await s.input('唱歌',{__injected:true});await s.input('唱歌',{__replayed:true});assert.equal(s.server.sent.length,0);assert.equal(s.modelCalls,0);
});
test('voice transcription can request singing without an LLM or synthesized answer',async t=>{
 const s=setup(t,{sttEnabled:true,sttProvider:'cloud',sttApiKey:'fake-only',sttBaseUrl:'https://offline.invalid/v1'});const prior=globalThis.fetch;let transcriptions=0;globalThis.fetch=async()=>{transcriptions++;return new Response(JSON.stringify({text:'唱一段长的'}),{headers:{'content-type':'application/json'}})};t.after(()=>globalThis.fetch=prior);
 await s.input('',{records:[{file:'fake-input'}]});assert.equal(transcriptions,1);assert.equal(s.server.sent.length,1);assert.equal(s.server.sent[0].segments[0].type,'record');assert.equal(s.modelCalls,0);
});
test('changed audio is blocked and never falls back to model, TTS, original singer or full song',async t=>{
 const s=setup(t);writeFileSync(s.clips[0].playbackPath,'changed');await s.input('唱歌');assert.equal(s.server.sent.length,0);assert.equal(s.modelCalls,0);assert(s.errors.some(e=>/playback failed/.test(e)));
});
test('an unknown requested song produces an explicit response without a different song',async t=>{
 const s=setup(t);await s.input('唱《未知歌曲》');assert.equal(s.server.sent.length,1);assert.equal(s.server.sent[0].segments[0].type,'text');assert.equal(s.modelCalls,0);
});

test('owner regression reaches a different clip and song through the actual QQ command handler',async t=>{
 const s=setup(t);await s.input('你能给我唱个歌吗');await s.input('唱个短一点的');await s.input('唱个别的');
 assert.equal(s.server.sent.length,3);assert(s.server.sent.every(x=>x.segments[0].type==='record'));assert.equal(s.modelCalls,0);
 const files=s.server.sent.map(x=>x.segments[0].data.file);assert.match(files[0],/s0\.mp3$/);assert.match(files[1],/s1\.mp3$/);assert.match(files[2],/s2\.mp3$/);
});

test('song list is textual metadata and does not consume or change the playback selection',async t=>{
 const s=setup(t);await s.input('你会唱哪些歌');assert.equal(s.server.sent.length,1);const seg=s.server.sent[0].segments[0];assert.equal(seg.type,'text');assert.match(seg.data.text,/2首、4段/);assert.match(seg.data.text,/TestSongB/);assert.equal(s.modelCalls,0);
 await s.input('唱第5首');assert.equal(s.server.sent.at(-1).segments[0].type,'record');assert.match(s.server.sent.at(-1).segments[0].data.file,/s2\.mp3$/);
});
