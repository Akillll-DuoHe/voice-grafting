"""Local SVC with original Vevo2 weights. Supply your own dry vocal and reference."""
import argparse,json,pathlib,tempfile,os,time
ROOT=pathlib.Path(__file__).resolve().parents[1];p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--reference',required=True);p.add_argument('--out',required=True);p.add_argument('--device',choices=['cuda','cpu'],default='cuda');p.add_argument('--steps',type=int,default=32);p.add_argument('--chunk-seconds',type=int,default=18);a=p.parse_args()
out=pathlib.Path(a.out).resolve();out.parent.mkdir(parents=True,exist_ok=True)
if out.exists():raise ValueError('Choose a new output file; existing audio is preserved')
if not 12<=a.chunk_seconds<=30 or not 8<=a.steps<=80:raise ValueError('Invalid chunk length or diffusion steps')
import torch,numpy as np,soundfile as sf,librosa
from models.svc.vevo2 import vevo2_utils as vu
source=pathlib.Path(a.source).resolve(strict=True);reference=pathlib.Path(a.reference).resolve(strict=True)
if sf.info(reference).duration<3 or sf.info(reference).duration>30:raise ValueError('Use a clear 3-30 second one-speaker reference')
audio,sr=sf.read(source,dtype='float32',always_2d=True);audio=audio.mean(axis=1)
if not np.isfinite(audio).all() or not 1<len(audio)/sr<=600:raise ValueError('Use a finite dry vocal WAV between 1 and 600 seconds')
audio=librosa.resample(audio,orig_sr=sr,target_sr=24000);sr=24000
original_load=vu.whisper.load_model
vu.whisper.load_model=lambda name,device=None,**kw:original_load(str(ROOT/'models/whisper/medium.pt'),device='cpu',in_memory=False)
device=torch.device(a.device);torch.set_num_threads(4);torch.manual_seed(42)
if a.device=='cuda' and not torch.cuda.is_available():raise ValueError('CUDA not available; use --device cpu or check your driver')
class Sequential(vu.Vevo2InferencePipeline):
 def extract_whisper_features(self,*args,**kw):
  self.whisper_model.encoder.to(device)
  try:return super().extract_whisper_features(*args,**kw)
  finally:self.whisper_model.encoder.to('cpu');self.clear()
 def extract_coco_codec(self,kind,*args,**kw):
  m=self.style_tokenizer if kind=='style' else self.content_style_tokenizer;m.to(device)
  try:return super().extract_coco_codec(kind,*args,**kw)
  finally:m.to('cpu');self.clear()
 def code2mel(self,*args,**kw):
  self.fmt_model.to(device);self.mel_model.to(device)
  try:return super().code2mel(*args,**kw)
  finally:self.fmt_model.to('cpu');self.mel_model.to('cpu');self.clear()
 def mel2audio(self,*args,**kw):
  self.vocoder_model.to(device)
  try:return super().mel2audio(*args,**kw)
  finally:self.vocoder_model.to('cpu');self.clear()
 def clear(self):
  if a.device=='cuda':torch.cuda.empty_cache()
w=ROOT/'models/vevo2';pipeline=Sequential(content_style_tokenizer_ckpt_path=str(w/'tokenizer/contentstyle_fvq16384_12.5hz'),fmt_cfg_path=str(w/'acoustic_modeling/fm_emilia101k_singnet7k_repa/config.json'),fmt_ckpt_path=str(w/'acoustic_modeling/fm_emilia101k_singnet7k_repa'),vocoder_cfg_path=str(w/'vocoder/config.json'),vocoder_ckpt_path=str(w/'vocoder'),device=torch.device('cpu'));pipeline.device=device
if pipeline.use_normed_whisper:pipeline.whisper_mean=pipeline.whisper_mean.to(device);pipeline.whisper_std=pipeline.whisper_std.to(device)
chunk=a.chunk_seconds*sr;overlap=int(.5*sr);stride=chunk-overlap;result=np.zeros(len(audio)+sr,dtype=np.float64);weight=np.zeros_like(result);records=[]
with tempfile.TemporaryDirectory(prefix='voice-convert-',dir=out.parent) as td:
 for i,start in enumerate(range(0,len(audio),stride)):
  stop=min(start+chunk,len(audio))
  if stop-start<sr and records:break
  f=pathlib.Path(td)/('chunk-'+str(i)+'.wav');sf.write(f,audio[start:stop],sr,subtype='PCM_16');at=time.monotonic()
  with torch.inference_mode():wave=pipeline.inference_fm(src_wav_path=str(f),timbre_ref_wav_path=str(reference),use_pitch_shift=False,flow_matching_steps=a.steps,display_audio=False).detach().float().cpu().numpy().reshape(-1)
  if not np.isfinite(wave).all() or abs(len(wave)-(stop-start))>sr*.5:raise ValueError('Converted chunk duration/sample validation failed')
  n=min(len(wave),stop-start);fade=np.ones(n)
  if start:fade[:min(overlap,n)]=np.linspace(0,1,min(overlap,n))
  if stop<len(audio):fade[-min(overlap,n):]=np.linspace(1,0,min(overlap,n))
  result[start:start+n]+=wave[:n]*fade;weight[start:start+n]+=fade
  records.append({'start':start/sr,'end':stop/sr,'generationSeconds':time.monotonic()-at});print(json.dumps({'completed':i+1,'sourcePosition':stop/sr}),flush=True)
result=result[:len(audio)];weight=weight[:len(audio)]
if np.any(weight<1e-8):raise ValueError('Uncovered audio interval; output not written')
result/=weight;peak=float(np.max(np.abs(result)));rms=float(np.sqrt(np.mean(result**2)))
if peak<.0001:raise ValueError('Empty conversion')
gain=min(.88/peak,10**(-18/20)/max(rms,1e-9));sf.write(out,result*gain,sr,subtype='PCM_16')
out.with_suffix('.conversion.json').write_text(json.dumps({'reference':str(reference),'source':str(source),'model':'RMSnow/Vevo2','weightLicense':'CC-BY-NC-ND-4.0','pitchShift':False,'backingMusic':False,'trainedWeights':False,'listeningApproved':False,'chunks':records},indent=2),encoding='utf-8');print('Generated '+str(out)+'; listen before adding it to your song library.')
