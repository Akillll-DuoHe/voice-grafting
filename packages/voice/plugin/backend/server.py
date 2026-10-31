"""Local speech adapter. Uses existing environments read-only; writes to project outputs.
No QQ credentials, URL fetching, arbitrary reference paths or singing fallback.
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(os.environ.get('QQVOICE_WORK_DIR', Path(__file__).resolve().parents[1]))
LOCK = threading.Lock()
MODEL = None
ASR_MODEL = None
ASR_LOCK = threading.Lock()


def gpu_reserved():
    lease=Path(CONFIG.get('gpu_lease',ROOT/'runtime/gpu-lease.local.json'))
    try:
        return json.loads(lease.read_text(encoding='utf-8')).get('expires',0)>time.time()
    except (OSError,ValueError):
        return False


def unload_voice():
    global MODEL
    with LOCK:
        MODEL=None
        import gc
        gc.collect()
        import torch
        if torch.cuda.is_available():torch.cuda.empty_cache()
    return dict(unloaded=True,asr_loaded=ASR_MODEL is not None)


def configure():
    global CONFIG
    config_file = Path(os.environ.get('QQVOICE_AUDIO_CONFIG', ROOT / 'config' / 'audio.local.json'))
    CONFIG = json.loads(config_file.read_text(encoding='utf-8-sig'))
    for name in ('cache', 'outputs', 'logs', 'cache/temp'):
        (ROOT / name).mkdir(parents=True, exist_ok=True)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                      HF_HOME=str(ROOT / 'cache/huggingface'), TORCH_HOME=str(ROOT / 'cache/torch'),
                      NUMBA_CACHE_DIR=str(ROOT / 'cache/numba'), TEMP=str(ROOT / 'cache/temp'),
                      TMP=str(ROOT / 'cache/temp'), PYTHONIOENCODING='utf-8')
    # The upstream module sets a relative HF cache on import. Keep it in this project.
    os.chdir(ROOT)
    sys.path.insert(0, CONFIG['repo'])
    if CONFIG.get('engine', 'indextts') not in ('indextts', 'voxcpm2'):
        raise ValueError('Unknown configured speech engine')
    if CONFIG.get('engine') == 'voxcpm2':
        sys.path.insert(0, CONFIG['voxcpm_repo'])
        if hashlib.sha256(Path(CONFIG['reference']).read_bytes()).hexdigest() != CONFIG['reference_sha256']:
            raise ValueError('Configured reference hash mismatch')


def transcribe(filename):
    global ASR_MODEL
    import re
    if not isinstance(filename, str) or not re.fullmatch(r'[a-f0-9-]{36}\.(wav|mp3|ogg|flac)', filename):
        raise ValueError('Expected a registered incoming audio filename')
    incoming = Path(CONFIG.get('input_dir', ROOT / 'data/incoming')).resolve()
    source = (incoming / filename).resolve(strict=True)
    if not source.is_relative_to(incoming) or source.stat().st_size > 12*1024*1024:
        raise ValueError('Invalid incoming audio path or size')
    import soundfile as sf
    import numpy as np
    from scipy.signal import resample_poly
    from math import gcd
    info=sf.info(source)
    if not 0<info.duration<=120 or not 8000<=info.samplerate<=96000 or info.channels not in (1,2):
        raise ValueError('Incoming voice metadata exceeds recognition limits')
    audio, rate = sf.read(source, dtype='float32', always_2d=True,frames=info.samplerate*120+1)
    duration = len(audio)/rate
    if not 0 < duration <= 120 or not np.isfinite(audio).all():
        raise ValueError('Invalid audio duration or samples')
    audio = audio.mean(axis=1)
    if np.max(np.abs(audio)) < 0.0001:
        raise ValueError('Silent incoming voice')
    common = gcd(rate, 16000)
    audio = resample_poly(audio, 16000//common, rate//common).astype(np.float32)
    with ASR_LOCK:
        import torch
        import whisper
        start = time.monotonic()
        torch.set_num_threads(4)
        if ASR_MODEL is None:
            weights = Path(CONFIG['asr_model_dir']) / 'small.pt'
            if not weights.is_file():
                raise ValueError('Local Whisper small weights are missing')
            ASR_MODEL = whisper.load_model(str(weights), device='cpu')
        result = ASR_MODEL.transcribe(audio, language='zh', fp16=False, temperature=0,
                                      condition_on_previous_text=False)
        segments = [s for s in result.get('segments', [])
                    if not (s.get('no_speech_prob', 0) > .6 and s.get('avg_logprob', 0) < -.5)]
        text = ''.join(s['text'] for s in segments).strip()
        if not text or len(text) > 20000:
            raise ValueError('No reliable voice transcript')
        return dict(text=text, language=result.get('language'), backend='whisper-small-cpu',
                    duration=duration, asr_seconds=time.monotonic()-start)


def generated_word_alignment(audio, rate, text):
    """CPU timestamps for this generated utterance only; not a quality verdict."""
    global ASR_MODEL
    import re,torch,whisper,numpy as np
    from scipy.signal import resample_poly
    from math import gcd
    common=gcd(rate,16000);wave=resample_poly(np.asarray(audio,dtype=np.float32),16000//common,rate//common)
    language='ja' if re.search(r'[\u3040-\u30ff]',text) else 'zh'
    start=time.monotonic()
    with ASR_LOCK:
        torch.set_num_threads(4)
        if ASR_MODEL is None:ASR_MODEL=whisper.load_model(str(Path(CONFIG['asr_model_dir'])/'small.pt'),device='cpu')
        result=ASR_MODEL.transcribe(wave,language=language,fp16=False,temperature=0,
            condition_on_previous_text=False,word_timestamps=True)
    return [w for segment in result.get('segments',[]) for w in segment.get('words',[])],dict(language=language,seconds=time.monotonic()-start,transcript=result.get('text',''))


def synthesize(text, emotion='auto', audition_voice=None):
    global MODEL
    if gpu_reserved():raise ValueError('后台声线制作正在使用显卡，暂时用文字回复，完成后自动恢复语音')
    if not isinstance(text, str) or not text.strip() or len(text) > 120:
        raise ValueError('Expected 1–120 characters')
    vectors = {'neutral': None, 'warm': [0.1,0,0,0,0,0,0,0.5], 'amused': [0.35,0,0,0,0,0,0,0.2],
               'gentle': [0,0,0,0,0,0,0,0.65], 'curious': [0.1,0,0,0,0,0,0.1,0.3],
               'surprised': [0.15,0,0,0,0,0,0.4,0.1], 'serious': [0,0,0,0,0,0,0,0.5],
               'happy': None, 'upset': None, 'sad': None, 'laugh': None, 'auto': None}
    if emotion not in vectors:
        raise ValueError('Unknown emotion')
    emotion_mode = CONFIG.get('emotion_mode', 'mapped')
    if emotion_mode not in ('reference', 'mapped'):
        raise ValueError('Invalid configured emotion mode')
    applied_vector = None if emotion_mode == 'reference' else vectors[emotion]
    reference=CONFIG['reference']
    character=CONFIG.get('character_id', 'technical_demo')
    reference_asset_id=CONFIG.get('reference_asset_id')
    engine=CONFIG.get('engine','indextts')
    expression=None
    level=None
    if audition_voice is not None:
        import re
        if not isinstance(audition_voice,str) or not re.fullmatch(r'[a-z0-9_]{1,40}',audition_voice):
            raise ValueError('Invalid audition voice ID')
        registry_path=Path(CONFIG['voice_registry']).resolve(strict=True)
        registry=json.loads(registry_path.read_text(encoding='utf-8'))
        asset=registry['voices'].get(audition_voice)
        if not asset or asset.get('purpose')!='audition_only':raise ValueError('Unknown audition voice')
        path=(registry_path.parent/asset['reference']).resolve(strict=True)
        if not path.is_relative_to(registry_path.parent):raise ValueError('Invalid audition reference path')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=asset['sha256']:raise ValueError('Audition reference hash mismatch')
        reference=str(path);character=audition_voice;reference_asset_id=asset['id'];applied_vector=None
    if engine == 'voxcpm2':
        from voxcpm_backend import expression_plan
        expression=expression_plan(text,'neutral' if emotion=='auto' else emotion,
            automatic=emotion=='auto' and bool(CONFIG.get('auto_emotion',False)) and audition_voice is None,
            laughter=bool(CONFIG.get('native_laughter',False)))
        applied_vector=None
    with LOCK:
        if gpu_reserved():raise ValueError('Voice GPU is reserved for local voice preparation')
        import torch
        import soundfile as sf
        start = time.monotonic()
        torch.cuda.reset_peak_memory_stats()
        if MODEL is None:
            if engine == 'voxcpm2':
                from voxcpm import VoxCPM
                model_options={}
                if CONFIG.get('lora_weights_path'):
                    lora=Path(CONFIG['lora_weights_path']).resolve(strict=True)
                    if not lora.is_dir() or not (lora/'lora_config.json').is_file():
                        raise ValueError('Expected a complete local LoRA checkpoint directory')
                    model_options['lora_weights_path']=str(lora)
                MODEL=VoxCPM.from_pretrained(CONFIG['model_dir'],load_denoiser=False,
                    local_files_only=True,optimize=False,device='cuda',
                    cache_dir=str(ROOT/'cache/voxcpm/huggingface'),**model_options)
            else:
                from indextts.infer_v2_5 import IndexTTS2
                model_dir = CONFIG['model_dir']
                MODEL = IndexTTS2(cfg_path=str(Path(model_dir) / 'config.yaml'), model_dir=model_dir,
                                  use_bf16=True, use_cuda_kernel=False, use_deepspeed=False, use_qwen_emo=False)
        loaded = time.monotonic()
        output_dir = Path(os.environ.get('QQVOICE_OUTPUT_DIR', ROOT / 'outputs'))
        output_dir.mkdir(parents=True, exist_ok=True)
        output = output_dir / (str(uuid.uuid4()) + '.wav')
        if engine == 'voxcpm2':
            from voxcpm_backend import output_gain,air_cleanup,aligned_air_cleanup
            audio=MODEL.generate(text=expression['model_text'],reference_wav_path=reference,
                cfg_value=float(CONFIG.get('cfg_value',1.5)),inference_timesteps=20,
                normalize=False,denoise=False,retry_badcase=False,seed=42,max_len=600)
            cleanup={'enabled':False};mode=CONFIG.get('air_cleanup_mode','balanced')
            if mode not in ('balanced','aligned_v2'):raise ValueError('Unknown air cleanup mode')
            if CONFIG.get('air_cleanup',True) and mode=='balanced':audio,cleanup=air_cleanup(audio,MODEL.tts_model.sample_rate)
            audio,level=output_gain(audio,float(CONFIG.get('output_rms_dbfs',-21)),
                                    float(CONFIG.get('max_output_gain_db',6)),float(CONFIG.get('output_peak_limit',.88)))
            if CONFIG.get('air_cleanup',True) and mode=='aligned_v2':
                words=[];alignment={}
                try:words,alignment=generated_word_alignment(audio,MODEL.tts_model.sample_rate,expression['spoken_text'])
                except Exception as error:alignment={'error':type(error).__name__,'fallback':'bass_only'}
                audio,cleanup=aligned_air_cleanup(audio,MODEL.tts_model.sample_rate,words,expression['spoken_text'])
                cleanup['alignment']=alignment
                import numpy as np
                level['rms_dbfs']=float(20*np.log10(max(1e-12,np.sqrt(np.mean(np.asarray(audio,dtype=np.float64)**2)))))
                level['peak']=float(np.max(np.abs(audio)))
            level['cleanup']=cleanup
            sf.write(output,audio,MODEL.tts_model.sample_rate,subtype='PCM_24')
        else:
            MODEL.infer(spk_audio_prompt=reference, text=text, output_path=str(output), lang='ZH',
                        emo_vector=applied_vector, use_random=False, duration_factor=1.0,
                        verbose=False, max_text_tokens_per_segment=120)
        data, rate = sf.read(output, always_2d=True)
        duration = len(data) / rate
        if not 0 < duration <= 18:
            raise ValueError(f'Output duration {duration:.2f}s exceeds speech policy; rewrite text')
        import numpy as np
        if not np.isfinite(data).all() or np.max(np.abs(data)) < 0.0001:
            raise ValueError('Invalid or silent model output')
        result = dict(path=str(output), duration=duration, backend='tts',
                      character=character,
                      reference_asset_id=reference_asset_id, mode='fixed_reference_zero_shot',
                      audition_only=audition_voice is not None,
                      text=text, emotion=expression['emotion'] if expression else emotion,
                      requested_emotion=emotion, emotion_mode='style_control' if expression else emotion_mode,
                      engine=engine, expression=expression, output_level=level,
                      applied_emotion_vector=applied_vector,
                      sample_rate=rate, load_seconds=loaded-start,
                      synthesis_seconds=time.monotonic()-loaded,
                      peak_vram_mb=round(torch.cuda.max_memory_allocated()/1024**2,1),
                      sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                      reference_sha256=hashlib.sha256(Path(reference).read_bytes()).hexdigest())
        output.with_suffix('.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code, data):
        body=json.dumps(data,ensure_ascii=False).encode('utf-8')
        self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

    def do_GET(self):
        if self.path != '/health':
            return self.reply(404,{'error':'not found'})
        self.reply(200,{'ok':True,'loaded':MODEL is not None,'asr_loaded':ASR_MODEL is not None,
                       'voice_preparation':gpu_reserved(),
                       'engine':CONFIG.get('engine','indextts'),'air_cleanup_mode':CONFIG.get('air_cleanup_mode','balanced'),
                       'character':CONFIG.get('character_id', 'technical_demo'),
                       'reference_asset_id':CONFIG.get('reference_asset_id')})

    def do_POST(self):
        expected='Bearer '+CONFIG['token']
        if not hmac.compare_digest(self.headers.get('Authorization',''),expected):
            return self.reply(401,{'error':'unauthorized'})
        if self.path not in ('/speech', '/transcribe', '/audition', '/unload'):
            return self.reply(404,{'error':'unsupported route'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 8192:
                raise ValueError('Invalid body length')
            request=json.loads(self.rfile.read(length))
            if self.path == '/unload':
                if request!={}:raise ValueError('Unexpected unload fields')
                return self.reply(200,unload_voice())
            if self.path == '/transcribe':
                if set(request) != {'file'}:
                    raise ValueError('Unexpected transcription fields')
                return self.reply(200,transcribe(request['file']))
            if self.path == '/audition':
                if set(request)!={'text','voice'}:raise ValueError('Unexpected audition fields')
                return self.reply(200,synthesize(request['text'],'neutral',request['voice']))
            if set(request)-{'text','emotion'}:
                raise ValueError('Unexpected request fields')
            self.reply(200,synthesize(request.get('text'),request.get('emotion','auto')))
        except Exception as error:
            self.reply(422,{'error':type(error).__name__,'message':str(error)[:300]})


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--once');parser.add_argument('--port',type=int,default=18931)
    args=parser.parse_args();configure()
    if args.once:
        print(json.dumps(synthesize(args.once),ensure_ascii=False))
    else:
        ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
