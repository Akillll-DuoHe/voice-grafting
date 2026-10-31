"""No inference: validate imports and paths within the extracted offline package."""
import importlib,sys,pathlib,json
root=pathlib.Path(sys.argv[1]).resolve();sys.path.insert(0,str(root/'engines/VoxCPM/src'))
names=['torch','torchaudio','numpy','scipy','soundfile','transformers','librosa','whisper','voxcpm','argbind','tensorboardX','lameenc'];checks=[]
for name in names:
 m=importlib.import_module(name);p=pathlib.Path(m.__file__).resolve();assert p.is_relative_to(root),(name,str(p));checks.append(name)
assert pathlib.Path(sys.executable).resolve().is_relative_to(root)
print(json.dumps({'imports':checks,'allLocal':True,'modelLoaded':False,'gpuInference':False}))
