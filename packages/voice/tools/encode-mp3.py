"""PCM WAV stdin -> MP3 stdout. LAME source and license are bundled separately."""
import io,sys
import soundfile as sf,numpy as np,lameenc
audio,rate=sf.read(io.BytesIO(sys.stdin.buffer.read(40*1024*1024)),dtype='float32',always_2d=True)
if not len(audio) or not np.isfinite(audio).all() or rate not in (16000,22050,24000,32000,44100,48000):raise ValueError('Invalid PCM input')
pcm=(np.clip(audio.mean(axis=1),-1,1)*32767).astype('<i2').tobytes();enc=lameenc.Encoder();enc.set_bit_rate(96);enc.set_in_sample_rate(rate);enc.set_channels(1);enc.set_quality(2);enc.silence();sys.stdout.buffer.write(enc.encode(pcm)+enc.flush())
