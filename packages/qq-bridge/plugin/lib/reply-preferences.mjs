import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

const defaults=Object.freeze({language:'zh',mode:'text'});
function lastMatch(text,rules){
  const matches=[];
  for(const [value,pattern]of rules)for(const m of text.matchAll(pattern))matches.push({value,start:m.index,end:m.index+m[0].length});
  matches.sort((a,b)=>a.end-b.end||b.start-a.start);
  return matches.at(-1)?.value;
}
/** Controls are explicit requests, never inferred from the language of normal input. */
export function parseReplyRequest(input){
  const text=String(input).replace(/\[语音消息\]\s*/g,'').replace(/[“「『"]([^”」』"]*)[”」』"]/g,'');
  const language=lastMatch(text,[
    ['ja',/(?:用|说|讲|改成|换成|切换到?|切到|保持|继续)(?:只用|用)?(?:日语|日文|日本語)/g],
    ['ja',/(?:日语|日文|日本語)\s*(?:加|[＋+和、，])\s*(?:语音|文字)/g],
    ['zh',/(?:用|说|讲|改成|换成|切换到?|切到|保持|继续)(?:只用|用)?(?:中文|汉语|普通话)/g],
    ['zh',/(?:中文|汉语|普通话)\s*(?:加|[＋+和、，])\s*(?:语音|文字)/g],
    ['zh',/(?:不要|别|不用)(?:再)?(?:用|说|讲)?(?:日语|日文|日本語)/g],
  ]);
  const mode=lastMatch(text,[
    ['voice',/(?:用|改成|换成|切换到?|切到|保持|继续)(?:只用|用)?语音|语音(?:回复|回答|模式)|(?:不要|别|不用)(?:再)?(?:发|用)?(?:文字|打字)(?:回复|回答|模式)?/g],
    ['voice',/(?:日语|日文|日本語|中文|汉语|普通话)\s*(?:加|[＋+和、，])\s*语音/g],
    ['text',/(?:用|改成|换成|切换到?|切到|保持|继续)(?:只用|用)?文字|文字(?:回复|回答|模式)|打字(?:回复|回答)?|(?:不要|别|不用)(?:再)?(?:发|用)?语音(?:回复|回答|模式)?/g],
    ['text',/(?:日语|日文|日本語|中文|汉语|普通话)\s*(?:加|[＋+和、，])\s*文字/g],
  ]);
  return {...(language?{language}:{}),...(mode?{mode}:{})};
}
export class ReplyPreferences{
  constructor(file){
    this.file=file;this.state=existsSync(file)?JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,'')):{version:1,chats:{}};
    if(this.state.version!==1||!this.state.chats||typeof this.state.chats!=='object')throw Error('Invalid persisted QQ reply preferences');
    for(const value of Object.values(this.state.chats))if(!['ja','zh'].includes(value.language)||!['voice','text'].includes(value.mode))throw Error('Invalid persisted QQ reply mode');
  }
  get(key){return {...defaults,...this.state.chats[key]};}
  update(key,text){
    const patch=parseReplyRequest(text),prior=this.get(key);
    if(Object.keys(patch).some(k=>patch[k]!==prior[k])){
      this.state.chats[key]={...prior,...patch,updatedAt:new Date().toISOString()};
      mkdirSync(dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';writeFileSync(tmp,JSON.stringify(this.state,null,2),{mode:0o600});renameSync(tmp,this.file);
    }
    return this.get(key);
  }
}
export function replyPrompt(prefs){
  return `Persistent QQ reply settings for THIS chat only: language=${prefs.language}; output=${prefs.mode}. These settings remain active until the user explicitly changes that dimension. The language of the user's next ordinary message does NOT change your reply language. ${prefs.language==='ja'?'Write every reply entirely in natural Japanese. Do not append Chinese, a Chinese translation, romanization, or a bilingual explanation.':'用自然简体中文回复，不附加日语译文。'} ${prefs.mode==='voice'?'Your final answer text is synthesized and sent as ONE voice reply automatically. Do not call qq_send_voice, send a separate voice yourself, or add a text caption/translation.':'Your final answer is delivered as text only. Do not call qq_send_voice or add audio.'} A mode change needs only a brief acknowledgment in the newly selected language and output mode. Never describe these internal settings.`;
}
/** Remove a labelled translation and unlabelled Chinese after Japanese, before TTS. */
export function cleanReply(text,prefs){
  let value=String(text??'').trim();
  if(prefs.language==='ja'){
    value=value.replace(/(?:^|\n)\s*(?:中文(?:翻译|译文|解释|版|意思)?|汉语(?:翻译|解释)?|翻译|意思是)\s*[：:][\s\S]*$/u,'').trim();
    const kana=/[\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const chinese=/[你这说吗呢呀吧请们让为还没么啦哟]|(?:我的|你的|可以|好的|意思|中文|翻译|这样|以后|现在|接下来|没问题)/u;
    if(kana.test(value))value=value.split(/(?<=[。！？!?])|\n+/u).filter(s=>!chinese.test(s)||kana.test(s)).join('').trim();
    if(!kana.test(value)&&chinese.test(value))throw Error('Japanese-only reply contained Chinese; not sent');
  }else value=value.replace(/(?:^|\n)\s*(?:日语(?:翻译|译文|版)?|日文(?:翻译|译文|版)?)\s*[：:][\s\S]*$/u,'').trim();
  if(!value)throw Error('Empty reply after language check');
  return value;
}
