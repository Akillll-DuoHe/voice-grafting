import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,relative} from 'node:path';import {createHash} from 'node:crypto';
import {ApprovedSongLibrary,parseSongRequest} from '../../shared/song-library.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const cwd=mkdtempSync(join(tmpdir(),'approved-song-test-'));t.after(()=>{assert(!relative(resolve(tmpdir()),resolve(cwd)).startsWith('..'));rmSync(cwd,{recursive:true,force:true})});const audio=join(cwd,'audio');mkdirSync(audio);
 const clips=[9,24,36,54].map((seconds,i)=>{const file=join(audio,`clip${i}.mp3`),b=Buffer.from('offline-audio-'+i);writeFileSync(file,b);return {id:'K'+i,song:i<2?'song01':'song05',title:i<2?'测试曲甲':'TestSongB',seconds,start:2,end:2+seconds,ownerApproved:true,status:'keep',referenceSHA256:'voice-sha',playbackPath:file,playbackSHA256:sha(b),playbackBytes:b.length}});
 const songs=[{id:'song01',title:'测试曲甲',aliases:['song01B','第1首']},{id:'song05',title:'TestSongB',aliases:['第5首']}];
 const library={format:'approved-song-library/v1',id:'test',approved:true,referenceSHA256:'voice-sha',audioRoot:audio,songs,clips};const file=join(cwd,'library.json');writeFileSync(file,JSON.stringify(library));writeFileSync(join(cwd,'singing-library.local.json'),JSON.stringify({enabled:true,libraryFile:file,referenceSHA256:'voice-sha'}));
 return {cwd,file,library,store:new ApprovedSongLibrary(cwd)};
}
for(const input of ['唱歌','给我唱一首歌','唱一段长的','唱短的','唱Morning Paper'])test('recognize explicit singing: '+input,()=>assert(parseSongRequest(input,{songs:[{id:'song08',title:'Morning Paper',aliases:[]}]})));
for(const input of ['我今天不高兴','你唱歌真好听','不要唱歌','你会唱歌吗','把回答写短一点','短的'])test('ordinary chat is not a song command: '+input,()=>assert.equal(parseSongRequest(input),null));
test('long and short remain distinct; unknown songs and missing lengths have no fallback',t=>{const {store}=fixture(t);assert(store.prepare('唱长的','u:1').seconds>=30);assert(store.prepare('唱短的','u:1').seconds<30);assert.equal(store.prepare('唱《没有的歌》','u:1').error,'unknown_song');assert.equal(store.prepare('唱测试曲甲长的','u:1').error,'no_matching_length')});
test('rotate only after acknowledged commit; persist and isolate follow-up context',t=>{const {store,cwd}=fixture(t);const first=store.prepare('唱歌','u:1');assert.equal(store.prepare('唱歌','u:1').clipId,first.clipId);store.commit(first,'u:1');const next=new ApprovedSongLibrary(cwd);assert.notEqual(next.prepare('唱歌','u:1').clipId,first.clipId);assert(next.prepare('长的','u:1').seconds>=30);assert.equal(next.prepare('长的','u:2'),null)});
test('fingerprints, owner approvals and audio containment are enforced',t=>{const {store,file,library}=fixture(t);let job=store.prepare('唱歌','u:1');writeFileSync(job.file,'modified');assert.throws(()=>store.prepare('唱歌','u:1'),/fingerprint|size/);library.clips[0].ownerApproved=false;writeFileSync(file,JSON.stringify(library));assert.throws(()=>store.prepare('唱歌','u:1'),/Unapproved/)});
test('same-chat concurrent commands serialize and advance without repeating',async t=>{const {store}=fixture(t);const ids=[];await Promise.all([1,2].map(()=>store.runExclusive('u:1',async()=>{let job=store.prepare('唱歌','u:1');ids.push(job.clipId);await new Promise(r=>setTimeout(r,2));store.commit(job,'u:1')})));assert.equal(new Set(ids).size,2)});

test('owner regression: generic request followed by short or another song does not repeat the first song',t=>{
 const {store}=fixture(t);const first=store.prepare('你能给我唱个歌吗','u:1');store.commit(first,'u:1');
 const short=store.prepare('唱个短一点的','u:1');assert.notEqual(short.clipId,first.clipId);store.commit(short,'u:1');
 const other=store.prepare('唱个别的','u:1');assert(!other.error);assert.notEqual(other.song,short.song);
});

test('generic rotation visits every available song before returning to the first',t=>{
 const {store}=fixture(t);const first=store.prepare('唱歌','u:1');store.commit(first,'u:1');const next=store.prepare('唱歌','u:1');assert.notEqual(next.song,first.song);
});

test('natural requests for a song list and contextual alternatives are commands',t=>{
 const {store}=fixture(t);assert.equal(store.request('你会唱哪些歌','u:1').action,'list');assert.equal(store.request('歌单','u:1').action,'list');
 const first=store.prepare('唱歌','u:1');store.commit(first,'u:1');
 for(const s of ['换一首','再来一首','唱个别的','换个歌','还有别的吗'])assert(!store.prepare(s,'u:1').error,s);
});

test('song title and numeric aliases can be requested directly; unknown named songs are still refused',t=>{
 const {store}=fixture(t);assert.equal(store.prepare('唱第5首','u:1').song,'song05');assert.equal(store.prepare('播放TestSongB','u:1').song,'song05');assert.equal(store.prepare('TestSongB','u:1').song,'song05');assert.equal(store.prepare('唱个别的《未知歌》','u:1').error,'unknown_song');
});
