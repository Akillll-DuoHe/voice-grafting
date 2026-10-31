/** Owner-approved audio only. No model, TTS, download, or full-song fallback. */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,realpathSync,statSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,sep,extname} from 'node:path';

const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const normalized=s=>String(s).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const hash=b=>createHash('sha256').update(b).digest('hex');

export function parseSongRequest(input,{hasContext=false,songs=[]}={}){
  const raw=String(input??'').replace(/^\s*\[语音消息\]\s*/,'').trim();
  if(/^(?:请|给我|我想|看看|查看|列出|打开|你的|已选|能唱的|可以唱的)*(?:歌单|歌曲列表)(?:有哪些|有什么|吧|吗|呢)?[?？。！!]*$/.test(raw)||/^(?:你|还|都|现在|到底|会|能|可以|给我|帮我|请)*(?:会|能|可以)唱(?:哪(?:些|几首|一?些)|什么)(?:歌|歌曲)?[?？。！!]*$/.test(raw))return {action:'list'};
  if(!raw||raw.length>160||/(?:不要|别|不用|不想|先不|停止).{0,8}(?:唱|放歌)|(?:唱歌|唱得).{0,5}(?:好听|真好|不错)|(?:什么是|为什么|怎么|不会|喜欢|会不会)唱歌|会唱歌吗/.test(raw))return null;
  const text=normalized(raw),aliases=s=>[s.id,s.title,...(s.aliases??[])];
  const direct=songs.find(s=>aliases(s).some(a=>normalized(a)===text));
  const explicit=/(?:唱|放歌|来一?首|来段歌|听一?首|播放|换一?首|换个歌|换歌)/.test(text);
  const follow=(/^(?:再|换|来|给我|放|听|要|一个|一段|首|段|个|一|的|点|吧|呀|啊|嘛|长|短|一点|换个|换一首|别的|其他|其它|另外|还有|吗)+$/.test(text))&&hasContext;
  if(!explicit&&!follow&&!direct)return null;
  const hasLong=/(?:长的|长一点|长点|长段|长版|唱长|长歌)/.test(text);
  const hasShort=/(?:短的|短一点|短点|短段|短版|唱短|短歌)/.test(text);
  if(hasLong&&hasShort)return {error:'ambiguous_length'};
  const length=hasLong?'long':hasShort?'short':'any';
  const found=songs.filter(s=>aliases(s).some(alias=>{let a=normalized(alias);return a.length>=2&&text.includes(a)}));
  if(found.length>1)return {error:'ambiguous_song'};
  const quoted=raw.match(/[《「“"]([^》」”"]+)[》」”"]/u)?.[1];
  if(quoted&&!found.length)return {error:'unknown_song'};
  if(!found.length&&explicit){
    const rest=text.replace(/(?:长一点|短一点|长的|短的|长点|短点|长段|短段|长版|短版|别的|其他|其它|另外|另一首|可以|能不能|能|请|给我|帮我|你|再|来|想听|我想听|我要听|听|唱歌|唱|播放歌曲|播放|放歌|换|首歌|一首歌|一段歌|一首|一段|首|段|个|一|歌|的|一下|吧|呀|啊|嘛|好吗|好不好|吗)/g,'');
    if(rest)return {error:'unknown_song'};
  }
  return {song:found[0]?.id??null,length,changeSong:/(?:别的|其他|其它|另外|另一首|换)/.test(text),relativeLength:/(?:长|短)(?:一点|点)/.test(text)};
}

export class ApprovedSongLibrary{
  constructor(cwd){this.cwd=resolve(cwd);this.configFile=join(this.cwd,'singing-library.local.json');this.stateFile=join(this.cwd,'song-playback-state.local.json');this.queues=new Map();}
  settings(){if(!existsSync(this.configFile))return null;let config=read(this.configFile);if(config.enabled!==true)return null;return config;}
  load(){
    const config=this.settings();if(!config)return null;
    const library=read(config.libraryFile);
    if(library.format!=='approved-song-library/v1'||library.approved!==true||library.referenceSHA256!==config.referenceSHA256||!library.id)throw Error('Approved song library identity mismatch');
    if(!Array.isArray(library.clips)||!Array.isArray(library.songs))throw Error('Invalid song library');
    const ids=new Set();for(const c of library.clips){
      if(ids.has(c.id)||c.ownerApproved!==true||c.status!=='keep'||c.referenceSHA256!==library.referenceSHA256||!(c.seconds>0)||c.end-c.start!==c.seconds)throw Error('Unapproved or invalid song clip');ids.add(c.id);
    }
    return library;
  }
  state(){if(!existsSync(this.stateFile))return {version:1,chats:{}};const state=read(this.stateFile);if(state.version!==1||!state.chats)throw Error('Invalid song playback state');return state;}
  request(text,key){
    const library=this.load();if(!library)return null;const chat=this.state().chats[key];
    const hasContext=chat?.libraryId===library.id&&Date.now()-Number(chat.lastAt)<30*60*1000;
    return parseSongRequest(text,{hasContext,songs:library.songs});
  }
  menu(language='zh'){
    const library=this.load();if(!library)return null;
    const rows=library.songs.map(s=>{const clips=library.clips.filter(c=>c.song===s.id);return `${s.id}: ${s.title} (${clips.map(c=>c.seconds+'s').join(' / ')})`});
    return language==='ja'?`歌リスト（${rows.length}曲、${library.clips.length}区間）\n${rows.join('\n')}\n曲名や番号を指定できます。「唱青鸟」「唱长的」「换一首」。`:`已选歌单（${rows.length}首、${library.clips.length}段）\n${rows.join('\n')}\n可以说“唱青鸟”“唱song08”“唱长的”“换一首”。只播放你留下的片段。`;
  }
  prepare(text,key){
    const library=this.load();if(!library)return null;
    const request=this.request(text,key);if(!request)return null;if(request.error)return {error:request.error};if(request.action==='list')return {action:'list'};
    const saved=this.state().chats[key],chat=saved?.libraryId===library.id?saved:null;
    const previous=library.clips.find(c=>c.id===chat?.lastClipId);
    let clips=library.clips.filter(c=>!request.song||c.song===request.song);
    if(!clips.length)return {error:'no_kept_clips'};
    let fallback=null;
    if(request.length!=='any'){
      const matches=clips.filter(c=>(c.seconds>=30?'long':'short')===request.length);
      if(matches.length)clips=matches;
      else return {error:'no_matching_length'};
    }
    if(request.relativeLength&&previous){
      const closer=clips.filter(c=>request.length==='long'?c.seconds>previous.seconds:c.seconds<previous.seconds);
      if(closer.length)clips=closer;
    }
    // Round-robin songs first, then the selected clips within each song. Length
    // changes share the last delivery, so an independent bucket cannot replay it.
    const order=library.songs.map(s=>s.id),lastSong=previous?.song??chat?.lastSong;
    if(!request.song&&request.changeSong&&lastSong){
      clips=clips.filter(c=>c.song!==lastSong);
      if(!clips.length)return {error:'no_alternative_song'};
    }
    if(!request.song){
      const offset=order.indexOf(lastSong),rotated=offset<0?order:[...order.slice(offset+1),...order.slice(0,offset+1)];
      const song=rotated.find(id=>clips.some(c=>c.song===id));clips=clips.filter(c=>c.song===song);
    }
    const lastId=chat?.lastClipBySong?.[clips[0].song]??(previous?.song===clips[0].song?previous.id:null);
    const songClips=library.clips.filter(c=>c.song===clips[0].song),offset=songClips.findIndex(c=>c.id===lastId);
    const rotated=offset<0?songClips:[...songClips.slice(offset+1),...songClips.slice(0,offset+1)];
    const clip=rotated.find(c=>clips.some(candidate=>candidate.id===c.id));
    const bucket=(request.song??'all')+':'+request.length;
    const cursor=chat?.libraryId===library.id?Number(chat.cursors?.[bucket]??0):0;
    const root=realpathSync(resolve(library.audioRoot)),file=realpathSync(resolve(clip.playbackPath));const part=relative(root,file);
    if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part)||extname(file).toLowerCase()!=='.mp3')throw Error('Song path outside approved audio directory');
    const stat=statSync(file);if(!stat.isFile()||stat.size<=0||stat.size>10*1024*1024||stat.size!==clip.playbackBytes)throw Error('Song file size mismatch');
    if(hash(readFileSync(file))!==clip.playbackSHA256)throw Error('Song file fingerprint mismatch');
    return {libraryId:library.id,clipId:clip.id,song:clip.song,title:clip.title,seconds:clip.seconds,length:request.length,
      actualLength:clip.seconds>=30?'long':'short',fallback,file,bytes:stat.size,sha256:clip.playbackSHA256,bucket,nextCursor:cursor+1,referenceSHA256:library.referenceSHA256};
  }
  commit(job,key){
    const library=this.load();if(library?.id!==job.libraryId)throw Error('Song library changed before delivery');
    const state=this.state(),prior=state.chats[key];const chat=prior?.libraryId===library.id?prior:{libraryId:library.id,cursors:{}};
    chat.cursors??={};chat.cursors[job.bucket]=job.nextCursor;chat.lastClipBySong??={};chat.lastClipBySong[job.song]=job.clipId;chat.lastClipId=job.clipId;chat.lastSong=job.song;chat.lastAt=Date.now();state.chats[key]=chat;
    mkdirSync(dirname(this.stateFile),{recursive:true});writeFileSync(this.stateFile+'.tmp',JSON.stringify(state,null,2),{mode:0o600});renameSync(this.stateFile+'.tmp',this.stateFile);
  }
  async runExclusive(key,fn){const previous=this.queues.get(key)??Promise.resolve();const next=previous.catch(()=>{}).then(fn);this.queues.set(key,next);try{return await next}finally{if(this.queues.get(key)===next)this.queues.delete(key)}}
}
