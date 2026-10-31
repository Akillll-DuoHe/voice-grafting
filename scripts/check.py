"""Public-tree gate. No provider/platform calls and no secret values in output."""
from pathlib import Path
import json, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8')

ROOT=Path(__file__).resolve().parent.parent
BLOCKED={'本机私有','本地资源','发行包','构建产物','临时','user-data','outputs','logs','node_modules','__pycache__'}
SUFFIXES={'.wav','.mp3','.mp4','.flac','.silk','.sqlite','.db','.zip','.tgz','.whl','.pt','.pth','.onnx','.safetensors','.ckpt'}
errors=[]
def fail(message):errors.append(message)
versions=json.loads((ROOT/'VERSION.json').read_text(encoding='utf-8-sig'))
for component,info in versions['components'].items():
    p=ROOT/'packages'/component
    meta=json.loads((p/'plugin/package.json').read_text(encoding='utf-8-sig'))
    if(meta['name'],meta['version'])!=(info['name'],info['version']):fail('Version mismatch: '+component)
    filename=meta['name'].lstrip('@').replace('/','-')+'-'+meta['version']+'.tgz'
    if filename not in (p/'tools/cli.mjs').read_text(encoding='utf-8'):fail('Installer TGZ mismatch: '+component)
try:
    proc=subprocess.run(['git','ls-files','-z'],cwd=ROOT,capture_output=True,check=True)
    tracked=[Path(x) for x in proc.stdout.decode('utf-8').split('\0') if x]
except (FileNotFoundError,subprocess.CalledProcessError):
    tracked=[]
public=[]
for name in ['packages','shared','scripts','tests','docs']:
    public.extend(p.relative_to(ROOT) for p in (ROOT/name).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
public.extend(p.relative_to(ROOT) for p in ROOT.iterdir() if p.is_file() and (p.suffix in {'.md','.json','.ps1'} or p.name in {'.gitignore','.gitattributes','LICENSE'}))
private=ROOT/'本机私有/检查规则.local.json'
terms=json.loads(private.read_text(encoding='utf-8-sig')).get('forbiddenText',[]) if private.exists() else []
for rel in sorted(set(public+tracked)):
    posix=rel.as_posix();p=ROOT/rel
    if any(part in BLOCKED for part in rel.parts) or rel.suffix.lower() in SUFFIXES or '.local.' in p.name or p.name.startswith('.env'):
        fail('Private/generated path in public tree: '+posix);continue
    if not p.is_file():continue
    if p.is_symlink():fail('Public source symlink: '+posix);continue
    data=p.read_bytes()
    for term in terms:
        # Text and UTF-16 encodings cover ordinary source/config copies.
        if any(term.lower().encode(enc) in data.lower() for enc in ['utf-8','utf-16-le']):
            fail('Known private marker found: '+posix);break
if not tracked:fail('No tracked public files; initialize and stage the intended source first')
print(json.dumps({'publicFilesChecked':len(set(public+tracked)),'trackedFiles':len(tracked),'privatePolicyApplied':bool(terms),'errors':errors},ensure_ascii=False))
sys.exit(bool(errors))
