import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ReplyPreferences,parseReplyRequest,replyPrompt,cleanReply} from '../../shared/reply-preferences.mjs';
test('explicit settings change independent dimensions and persist across restart',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'qq-prefs-')),'prefs.json');let store=new ReplyPreferences(file);
 assert.deepEqual(store.get('u:10001'),{language:'zh',mode:'text'});
 store.update('u:10001','用语音');store.update('u:10001','用日语跟我说');
 assert.equal(store.update('u:10001','今天想吃什么').language,'ja');assert.equal(store.get('u:10001').mode,'voice');
 store=new ReplyPreferences(file);assert.equal(store.get('u:10001').language,'ja');assert.equal(store.get('u:10001').mode,'voice');
 assert.equal(store.update('u:10001','打字回复').language,'ja');assert.equal(store.get('u:10001').mode,'text');
 assert.equal(store.update('u:10001','改成中文').mode,'text');assert.equal(store.get('u:10001').language,'zh');
 assert.deepEqual(store.get('u:99999'),{language:'zh',mode:'text'});
});
for(const [input,want]of [
 ['用日语加语音回复我',{language:'ja',mode:'voice'}],['[语音消息] 用日语跟我聊，语音回复',{language:'ja',mode:'voice'}],
 ['不要用语音',{mode:'text'}],['别发语音，打字回复',{mode:'text'}],['不要打字，用语音',{mode:'voice'}],
 ['先用中文，后面改成日语',{language:'ja'}],['我爱吃薄荷茶',{}],['我喜欢日语歌',{}],
 ['他说“用中文”是什么意思',{}],['把这句话翻译成日语',{}],['别说日语了，用中文',{language:'zh'}],
 ['用语音，不要用文字',{mode:'voice'}],['文字回复，不用换语言',{mode:'text'}],
 ['不用语音',{mode:'text'}],['不要语音回复',{mode:'text'}],['不要用文字回复',{mode:'voice'}],['不用日语',{language:'zh'}],
 ['日语加语音',{language:'ja',mode:'voice'}],['日语+文字',{language:'ja',mode:'text'}],['中文加语音',{language:'zh',mode:'voice'}],
])test('control parser: '+input,()=>assert.deepEqual(parseReplyRequest(input),want));
test('Japanese voice cannot append Chinese translation',()=>{
 const p={language:'ja',mode:'voice'};
 assert.equal(cleanReply('はい、これから日本語で話します。\n中文：好的，接下来我用日语。',p),'はい、これから日本語で話します。');
 assert.equal(cleanReply('お疲れさまです。\n你今天辛苦了。',p),'お疲れさまです。');
 assert.equal(cleanReply('大丈夫です。好的，接下来用日语。',p),'大丈夫です。');
 assert.equal(cleanReply('今日は何を食べましたか。',p),'今日は何を食べましたか。');
 assert.throws(()=>cleanReply('好的，现在用日语回复你。',p),/contained Chinese/);
 assert.match(replyPrompt(p),/entirely in natural Japanese/);assert.match(replyPrompt(p),/ONE voice/);
});
