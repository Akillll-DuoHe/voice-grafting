import argparse,os,pathlib,runpy,sys
root=pathlib.Path(__file__).resolve().parents[1];p=argparse.ArgumentParser();p.add_argument('--config',required=True);a=p.parse_args()
sys.path.insert(0,str(root/'engines/VoxCPM/src'));os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
script=root/'engines/VoxCPM/scripts/train_voxcpm_finetune.py';sys.argv=[str(script),'--config_path',str(pathlib.Path(a.config).resolve())];runpy.run_path(str(script),run_name='__main__')
