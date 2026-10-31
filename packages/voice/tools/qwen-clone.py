import argparse,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1];p=argparse.ArgumentParser();p.add_argument('--reference',required=True);p.add_argument('--text',required=True);p.add_argument('--reference-text',default='');p.add_argument('--language',default='Auto');p.add_argument('--out',required=True);p.add_argument('--device',choices=['cuda','cpu'],default='cuda');a=p.parse_args()
out=pathlib.Path(a.out).resolve();out.parent.mkdir(parents=True,exist_ok=True)
if out.exists():raise ValueError('Output already exists')
import torch,soundfile as sf
from qwen_tts import Qwen3TTSModel
model=Qwen3TTSModel.from_pretrained(str(ROOT/'models/qwen3-tts-1.7b-base'),device_map=a.device,dtype=torch.bfloat16 if a.device=='cuda' else torch.float32,attn_implementation='sdpa',local_files_only=True)
waves,sr=model.generate_voice_clone(text=a.text,language=a.language,ref_audio=str(pathlib.Path(a.reference).resolve(strict=True)),ref_text=a.reference_text or None,x_vector_only_mode=not bool(a.reference_text));sf.write(out,waves[0],sr)
print('Generated '+str(out)+'; listen and confirm before adoption.')
