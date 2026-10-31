"""Recheck moved archives by SHA and ZIP directory; does not load models."""
from pathlib import Path
import hashlib,json,zipfile,sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent.parent
manifest=json.loads((ROOT/'docs/发行历史/2026-11-01.json').read_text(encoding='utf-8-sig'));results=[]
for row in manifest['archives']:
    p=ROOT/row['path'];h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(16*1024*1024),b''):h.update(chunk)
    assert p.stat().st_size==row['archiveBytes'],p.name
    assert h.hexdigest()==row['sha256'],p.name
    assert p.with_suffix('.zip.sha256').read_text(encoding='utf-8-sig').split()[0].lower()==h.hexdigest(),p.name
    with zipfile.ZipFile(p) as z:assert len(z.infolist())==row['files'],p.name
    results.append({'name':p.name,'bytes':p.stat().st_size,'sha256':h.hexdigest(),'shaVerifiedAfterMove':True,'zipDirectoryReadable':True,'crc':'Previously verified before move; SHA unchanged'})
out=ROOT/'本机私有/迁移记录/archive-verified.local.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(results,ensure_ascii=False))
