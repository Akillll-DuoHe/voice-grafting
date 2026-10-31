"""Build from current public source and a verified clean asset baseline. No inference."""
from pathlib import Path,PurePosixPath
import argparse,datetime,hashlib,json,shutil,tarfile,zipfile,sys
sys.stdout.reconfigure(encoding='utf-8')

ROOT=Path(__file__).resolve().parent.parent
PRODUCTS={'voice':'DSH-Local-Voice-Offline','qq-bridge':'DSH-QQ-Bridge-Offline'}
ASSETS={'voice':{'runtime','models','engines','licenses'},'qq-bridge':{'runtime','third-party'}}
DENIED={'本机私有','user-data','outputs','logs','__pycache__','node_modules','.git'}
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def safe(root,relative):
    rel=PurePosixPath(relative)
    if rel.is_absolute() or '..' in rel.parts or any(':' in x or '\\' in x for x in rel.parts):raise ValueError('Unsafe manifest path')
    target=(root/str(rel)).resolve()
    if not target.is_relative_to(root.resolve()):raise ValueError('Path escapes root')
    return target
def allowed(rel):return not any(x in DENIED for x in rel.parts) and '.local.' not in rel.name and not rel.name.startswith('.env')
def copy_verified(source,target,expected):
    target.parent.mkdir(parents=True,exist_ok=True);h=hashlib.sha256();size=0
    with source.open('rb') as src,target.open('xb') as dst:
        for chunk in iter(lambda:src.read(8*1024*1024),b''):dst.write(chunk);h.update(chunk);size+=len(chunk)
    if h.hexdigest()!=expected['sha256']:raise ValueError('Asset SHA mismatch: '+expected['path'])
    if expected.get('bytes') is not None and size!=expected['bytes']:raise ValueError('Asset size mismatch')
def pack_plugin(folder,meta,out):
    selected={'package.json'}
    for entry in meta['files']:
        p=safe(folder,entry.rstrip('/'))
        if not p.exists():raise FileNotFoundError('Missing package files entry: '+entry)
        if p.is_dir():selected.update(x.relative_to(folder).as_posix() for x in p.rglob('*') if x.is_file())
        else:selected.add(p.relative_to(folder).as_posix())
    with tarfile.open(out,'w:gz',format=tarfile.PAX_FORMAT) as tgz:
        for rel in sorted(selected):
            path=safe(folder,rel)
            if not allowed(Path(rel)) or path.is_symlink():raise ValueError('Unsafe plugin file: '+rel)
            tgz.add(path,arcname='package/'+rel,recursive=False)
    return len(selected)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--component',choices=[*PRODUCTS,'all'],default='all');parser.add_argument('--code-only',action='store_true');parser.add_argument('--zip',action='store_true');a=parser.parse_args()
    # Current shared sources must have been synchronized before making either product.
    for module,targets in {'local-memory.mjs':['voice/plugin/src','qq-bridge/plugin/lib'],'song-library.mjs':['voice/plugin/src','qq-bridge/plugin/lib'],'reply-preferences.mjs':['qq-bridge/plugin/lib']}.items():
        for target in targets:
            if(ROOT/'shared'/module).read_bytes()!=(ROOT/'packages'/target/module).read_bytes():raise ValueError('Run scripts/sync-shared.mjs first')
    assets={} if a.code_only else load(ROOT/'本地资源/assets.local.json')
    versions=load(ROOT/'VERSION.json');stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');output=ROOT/'构建产物'/stamp;output.mkdir(parents=True,exist_ok=False);results=[]
    for component in (PRODUCTS if a.component=='all' else [a.component]):
        src=ROOT/'packages'/component;meta=load(src/'plugin/package.json');version=meta['version']
        if versions['components'][component]['version']!=version:raise ValueError('Version mismatch')
        product=PRODUCTS[component]+'-'+version;dest=output/product;dest.mkdir()
        for path in src.rglob('*'):
            if not path.is_file():continue
            rel=path.relative_to(src)
            if path.is_symlink() or not allowed(rel):raise ValueError('Unsafe source path: '+str(rel))
            target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
        asset_count=0
        if not a.code_only:
            baseline=safe(ROOT,assets[component]);manifest=load(baseline/'delivery-manifest.json')
            for row in manifest['files']:
                rel=PurePosixPath(row['path'])
                if rel.parts[0] not in ASSETS[component]:continue
                if not allowed(rel):raise ValueError('Private path in asset manifest')
                source=safe(baseline,row['path']);target=safe(dest,row['path'])
                if target.exists():
                    if digest(target)!=row['sha256']:raise ValueError('Source/asset collision: '+row['path'])
                    continue
                copy_verified(source,target,row);asset_count+=1
        install=dest/'install';install.mkdir(exist_ok=True);tgz=install/(meta['name'].lstrip('@').replace('/','-')+'-'+version+'.tgz');packed=pack_plugin(dest/'plugin',meta,tgz)
        validation={'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'component':component,'version':version,'completeOffline':not a.code_only,'assetFilesVerified':asset_count,'pluginFiles':packed,'modelInference':'NOT_RUN','training':'NOT_RUN','tests':'NOT_RUN_BY_BUILD','note':'Historical VALIDATION.json describes the original baseline only. Validate this candidate before publication.'}
        (dest/'BUILD-VALIDATION.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        rows=[{'path':p.relative_to(dest).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(dest.rglob('*')) if p.is_file()]
        (dest/'delivery-manifest.json').write_text(json.dumps({'format':'voice-grafting-delivery/v1','component':component,'version':version,'completeOffline':not a.code_only,'files':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        result={'component':component,'directory':str(dest),'completeOffline':not a.code_only,'files':len(rows)}
        if a.zip:
            archive=output/(product+('.code-only' if a.code_only else '')+'.zip')
            with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
                for p in sorted(dest.rglob('*')):
                    if p.is_file():z.write(p,product+'/'+p.relative_to(dest).as_posix())
            sha=digest(archive);archive.with_suffix('.zip.sha256').write_text(sha+'  '+archive.name+'\n',encoding='ascii');result.update(archive=str(archive),sha256=sha)
        results.append(result)
    (output/'build-result.local.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(results,ensure_ascii=False))
if __name__=='__main__':main()
