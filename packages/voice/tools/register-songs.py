"""Build a fresh approved song library from the installer's own reviewed files."""
import argparse,datetime,hashlib,io,json,pathlib,re,sys
import numpy as np,soundfile as sf,lameenc
p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--manifest',required=True);p.add_argument('--reference',required=True);p.add_argument('--approve',action='store_true');a=p.parse_args()
if not a.approve:raise ValueError('Listen first, then add --approve to approve only your listed clips')
home=pathlib.Path(a.data).resolve();manifest=pathlib.Path(a.manifest).resolve(strict=True);reference=pathlib.Path(a.reference).resolve(strict=True);rows=json.loads(manifest.read_text(encoding='utf-8-sig'))
if not isinstance(rows,list) or not rows:raise ValueError('Provide a non-empty JSON array of reviewed clips')
refsha=hashlib.sha256(reference.read_bytes()).hexdigest();libraryid='songs-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
root=home/'songs'/libraryid
if root.exists():raise ValueError('Import folder already exists')
root.mkdir(parents=True);clips=[];songs={};ids=set()
for r in rows:
 id=r['id'];song=r['song']
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}',id) or id in ids or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}',song):raise ValueError('Use unique simple clip ids and simple song ids')
 ids.add(id);source=pathlib.Path(r['file']);source=(manifest.parent/source).resolve(strict=True) if not source.is_absolute() else source.resolve(strict=True)
 audio,rate=sf.read(source,dtype='float32',always_2d=True);start=float(r.get('start',0));end=float(r.get('end',len(audio)/rate));audio=audio[round(start*rate):round(end*rate)].mean(axis=1)
 if not 1<=len(audio)/rate<=120 or start<0 or end<=start or not np.isfinite(audio).all() or max(abs(audio))<.0001:raise ValueError('Invalid or silent reviewed clip')
 e=lameenc.Encoder();e.set_bit_rate(128);e.set_in_sample_rate(rate);e.set_channels(1);e.set_quality(2);e.silence();b=e.encode((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())+e.flush();f=root/(id+'.mp3');f.write_bytes(b);seconds=len(audio)/rate
 songs.setdefault(song,{'id':song,'title':r['title'],'aliases':r.get('aliases',[])})
 clips.append({'id':id,'song':song,'title':r['title'],'start':0,'end':seconds,'seconds':seconds,'sourceStart':start,'sourceEnd':end,'status':'keep','ownerApproved':True,'referenceSHA256':refsha,'playbackPath':str(f),'playbackSHA256':hashlib.sha256(b).hexdigest(),'playbackBytes':len(b)})
library=root/'approved-library.json';library.write_text(json.dumps({'format':'approved-song-library/v1','id':libraryid,'approved':True,'referenceSHA256':refsha,'audioRoot':str(root),'songs':list(songs.values()),'clips':clips},ensure_ascii=False,indent=2),encoding='utf-8')
config=home/'singing-library.local.json'
if config.exists():config.rename(config.with_suffix('.backup-'+libraryid+'.json'))
config.write_text(json.dumps({'enabled':True,'libraryFile':str(library),'referenceSHA256':refsha},indent=2),encoding='utf-8');print(json.dumps({'songs':len(songs),'clips':len(clips),'library':str(library),'originalInputsPreserved':True},ensure_ascii=False))
