"""Update the component, installer filename and repository version table."""
from pathlib import Path
import argparse,json,re,sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('component',choices=['voice','qq-bridge']);p.add_argument('version');a=p.parse_args()
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?',a.version):p.error('Use a valid release version')
path=ROOT/'packages'/a.component/'plugin/package.json';meta=json.loads(path.read_text(encoding='utf-8-sig'));old=meta['version']
if old==a.version:p.error('Version is unchanged')
installer=ROOT/'packages'/a.component/'tools/cli.mjs';text=installer.read_text(encoding='utf-8');stem=meta['name'].lstrip('@').replace('/','-')
oldname=stem+'-'+old+'.tgz';newname=stem+'-'+a.version+'.tgz'
if oldname not in text:raise ValueError('Cannot locate current installer TGZ filename')
versions=json.loads((ROOT/'VERSION.json').read_text(encoding='utf-8-sig'))
meta['version']=a.version;versions['components'][a.component]['version']=a.version
path.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
installer.write_text(text.replace(oldname,newname),encoding='utf-8')
(ROOT/'VERSION.json').write_text(json.dumps(versions,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'component':a.component,'previous':old,'version':a.version,'next':'Update CHANGELOG, documentation and validation before release'}))
