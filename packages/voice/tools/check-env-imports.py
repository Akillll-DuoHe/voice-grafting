import importlib,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1];env=sys.argv[1]
names=['torch','torchaudio','transformers','librosa','soundfile']+(['qwen_tts'] if env=='qwen' else ['whisper','torchvision','torchcrepe','models.svc.vevo2.vevo2_utils'])
for n in names:
 m=importlib.import_module(n);assert pathlib.Path(m.__file__).resolve().is_relative_to(root),(n,m.__file__)
print(json.dumps({'environment':env,'imports':names,'allLocal':True,'modelsLoaded':False,'gpuInference':False}))
