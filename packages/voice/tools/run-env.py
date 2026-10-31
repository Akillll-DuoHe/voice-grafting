import os,pathlib,runpy,sys
root=pathlib.Path(__file__).resolve().parents[1];env=sys.argv[1]
if env not in ['vevo','qwen']:raise ValueError('Unknown offline environment')
sys.path[:0]=[str(root/'runtime/envs'/env),str(root/'runtime/shared312'),str(root/'engines/Amphion')]
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false')
script=pathlib.Path(sys.argv[2]).resolve();sys.argv=[str(script),*sys.argv[3:]];runpy.run_path(str(script),run_name='__main__')
