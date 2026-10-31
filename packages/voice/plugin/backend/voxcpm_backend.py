"""Bounded expression and output gain for a locally configured VoxCPM voice.

No downloaded assets, user-provided style prompts, or cross-speaker laugh samples.
"""
import re

STYLES = {
    'neutral': '',
    'warm': '语气温柔自然，声音清楚。',
    'gentle': '语气安慰，声音自然清晰。',
    'happy': '语气开心，自然清晰。',
    'amused': '语气轻松，带一点笑意。',
    'laugh': '短促地笑一下，再正常说话。',
    'upset': '克制地表达不满，正常说话。',
    'sad': '语气有点低落，清楚地说话。',
    'curious': '好奇地询问，声音清晰。',
    'surprised': '有一点惊讶，正常说话。',
    'serious': '语气认真平静，声音清晰。',
}


def expression_plan(text, requested='neutral', automatic=False, laughter=True):
    if requested not in STYLES:
        raise ValueError('Unknown emotion')
    chosen = requested
    if automatic and requested == 'neutral':
        # Conservative cues in the assistant's own opening, not arbitrary recalled text.
        head = text.strip()[:28]
        if re.match(r'^(?:哈哈|嘻嘻|ふふ|あはは|ははは)', head):
            chosen = 'laugh'
        elif re.match(r'^(?:哼[，,。！!…\s]|我(?:有点|有些|真的)?不(?:太)?高兴|我(?:有点|有些)难过|もう[、,。！!])', head):
            chosen = 'upset'
        elif re.match(r'^(?:太好[啦了]|真替你高兴|好开心|这也太棒了|よかった|嬉しい|うれしい|やった)', head):
            chosen = 'happy'
        elif re.match(r'^(?:别难过|辛苦[啦了]|慢慢来|没关系)', head):
            chosen = 'warm'
    event = None
    target = text.strip()
    if chosen == 'laugh' and laughter:
        target = re.sub(r'^(?:哈{2,}|嘻{2,}|ふふ[っッ]?|あはは|ははは)[、，,。！!～~…\s]*', '', target)
        target = '[laughing]' + target
        event = 'laughing'
    elif chosen == 'laugh':
        chosen = 'amused'
    control = STYLES[chosen]
    return dict(requested_emotion=requested, emotion=chosen, control=control,
                spoken_text=target.removeprefix('[laughing]'),
                vocal_event=event, model_text=f'({control}){target}' if control else target)


def air_cleanup(audio, rate):
    """Conservative low-frequency pop control and mild attenuation of noise-like gaps.

    Candidate spans are signal heuristics, not proof of detected human breathing.
    No hard gate, pitch conversion, or time stretching.
    """
    import numpy as np
    from scipy.signal import butter, sosfiltfilt
    from scipy.ndimage import median_filter, uniform_filter1d
    x=np.asarray(audio,dtype=np.float32).reshape(-1)
    if not 8000<=rate<=96000 or not len(x) or not np.isfinite(x).all():
        raise ValueError('Invalid cleanup input')
    if len(x)<rate*.1:
        return x.copy(),dict(enabled=True,noise_candidate_spans=[],pop_candidate_frames=0)
    y=sosfiltfilt(butter(2,80,fs=rate,btype='highpass',output='sos'),x)
    n=max(64,round(rate*.02));hop=round(rate*.01)
    frames=np.lib.stride_tricks.sliding_window_view(y,n)[::hop]
    rms=np.sqrt(np.mean(frames*frames,axis=1)+1e-16)
    low=sosfiltfilt(butter(2,180,fs=rate,btype='lowpass',output='sos'),y)
    low_frames=np.lib.stride_tricks.sliding_window_view(low,n)[::hop]
    low_rms=np.sqrt(np.mean(low_frames*low_frames,axis=1)+1e-16)
    pop=(low_rms/rms>.65)&(low_rms>median_filter(low_rms,size=21)*2.5)&(low_rms>.015)
    pop_envelope=np.repeat(pop.astype(float),hop)
    pop_envelope=np.pad(pop_envelope,(0,max(0,len(y)-len(pop_envelope))))[:len(y)]
    pop_envelope=uniform_filter1d(pop_envelope,size=max(1,round(rate*.016)))
    y=y-low*.5*pop_envelope
    power=np.abs(np.fft.rfft(frames*np.hanning(n),axis=1))**2+1e-16
    freq=np.fft.rfftfreq(n,1/rate);band=power[:,(freq>=500)&(freq<=min(8000,rate*.45))]
    flatness=np.exp(np.mean(np.log(band),axis=1))/np.mean(band,axis=1)
    typical=max(float(np.quantile(rms,.7)),1e-6)
    candidates=(flatness>.25)&(rms<typical*.55)&(rms>typical*.04)
    edges=np.diff(np.r_[False,candidates,False].astype(int));starts=np.flatnonzero(edges==1);ends=np.flatnonzero(edges==-1)
    mask=np.zeros(len(y));spans=[]
    for a,b in zip(starts,ends):
        if not .18<=(b-a)*hop/rate<=.9:continue
        begin=int(a*hop+rate*.035);end=min(len(y),int(b*hop-rate*.035))
        if end>begin:mask[begin:end]=1;spans.append([round(begin/rate,3),round(end/rate,3)])
    mask=uniform_filter1d(mask,size=max(1,round(rate*.025)))
    y*=1-mask*(1-10**(-4/20))
    return y.astype(np.float32),dict(enabled=True,highpass_hz=80,
        noise_candidate_spans=spans,noise_attenuation_db=4,pop_candidate_frames=int(pop.sum()))


def aligned_air_cleanup(audio, rate, words, spoken_text):
    """Accepted v2 constants with this utterance's own word boundaries.

    Unmatched or unreliable alignment falls back to bass control, preserving words.
    """
    import unicodedata
    import numpy as np
    from scipy.signal import butter, sosfiltfilt
    from scipy.ndimage import uniform_filter1d
    x=np.asarray(audio,dtype=np.float64).reshape(-1)
    if not 8000<=rate<=96000 or not len(x) or not np.isfinite(x).all():
        raise ValueError('Invalid aligned cleanup input')
    meta=dict(enabled=True,profile='aligned_v2',alignment_applied=False,
              highpass_hz=105,max_bass_duck_db=9,prefix_attenuation_db=6,gap_attenuation_db=8,
              prefix_end=0,gap_spans=[],tail_from=None)
    if len(x)<rate*.1:return x.astype(np.float32),meta
    y=sosfiltfilt(butter(2,105,fs=rate,btype='highpass',output='sos'),x)
    low=sosfiltfilt(butter(3,300,fs=rate,btype='lowpass',output='sos'),y)
    n=round(rate*.03);hop=round(rate*.01)
    frames=np.lib.stride_tricks.sliding_window_view(y,n)[::hop]
    low_frames=np.lib.stride_tricks.sliding_window_view(low,n)[::hop]
    rms=np.sqrt(np.mean(frames*frames,axis=1)+1e-16)
    low_rms=np.sqrt(np.mean(low_frames*low_frames,axis=1)+1e-16)
    active=rms[rms>np.quantile(rms,.2)]
    reference=max(float(np.median(active)) if len(active) else 0,.025)
    mask=np.clip((low_rms/rms-.55)/.35,0,1)*np.clip((rms/reference-1.3)/1.2,0,1)
    mask=np.repeat(mask,hop);mask=np.pad(mask,(0,max(0,len(y)-len(mask))))[:len(y)]
    mask=uniform_filter1d(mask,size=round(rate*.035))
    y-=low*mask*(1-10**(-9/20))
    normalize=lambda s:''.join(c for c in unicodedata.normalize('NFKC',s) if c.isalnum())
    expected=normalize(spoken_text)[:3]
    duration=len(x)/rate;valid=[]
    for w in words:
        a=w.get('start');b=w.get('end');text=w.get('word')
        if not isinstance(text,str) or not isinstance(a,(int,float)) or not isinstance(b,(int,float)):continue
        if not np.isfinite([a,b]).all() or not 0<=a<=b<=duration+.05:continue
        if valid and a<valid[-1]['end']-.04:continue
        valid.append(dict(start=float(a),end=min(duration,float(b)),word=text))
    index=next((i for i,w in enumerate(valid)
                if expected and w['start']<=min(6,duration-.1)
                and normalize(''.join(t['word'] for t in valid[i:i+6])).startswith(expected)),None)
    if index is not None:
        meta['alignment_applied']=True
        prefix_end=max(0,valid[index]['start']-.12);meta['prefix_end']=prefix_end
        envelope=np.ones(len(y));envelope[:round(prefix_end*rate)]=10**(-6/20)
        for left,right in zip(valid[index:],valid[index+1:]):
            a=left['end']+.10;b=right['start']-.10
            if a>=prefix_end and .18<=b-a<=1.5:
                envelope[round(a*rate):round(b*rate)]=10**(-8/20)
                meta['gap_spans'].append([round(a,3),round(b,3)])
        tail=min(duration,valid[-1]['end']+.14);meta['tail_from']=tail
        envelope[round(tail*rate):]=10**(-8/20)
        y*=uniform_filter1d(envelope,size=round(rate*.04))
    else:meta['alignment_reason']='expected_opening_not_matched; bass_only'
    safety=min(1,.88/max(float(np.abs(y).max()),1e-12));y*=safety
    meta['safety_gain_db']=float(20*np.log10(safety))
    return y.astype(np.float32),meta


def output_gain(audio, target_dbfs=-21.0, max_gain_db=6.0, peak_limit=.95):
    """Use constant gain with a sample-peak ceiling; no clipping or compression."""
    import numpy as np
    if not -32 <= target_dbfs <= -16 or not 0 <= max_gain_db <= 9 or not .7<=peak_limit<=.98:
        raise ValueError('Invalid output level configuration')
    x = np.asarray(audio, dtype=np.float32).reshape(-1)
    if not len(x) or not np.isfinite(x).all():
        raise ValueError('Invalid model samples')
    peak = float(np.abs(x).max())
    rms = float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))
    if peak < .0001 or rms <= 0:
        raise ValueError('Silent model output')
    wanted=10 ** (target_dbfs / 20) / rms
    gain = min(wanted, 10 ** (max_gain_db / 20), peak_limit / peak)
    result = x * gain
    return result, dict(gain_db=float(20 * np.log10(gain)),
                        rms_dbfs=float(20 * np.log10(rms * gain)),
                        target_rms_dbfs=target_dbfs, peak=float(np.abs(result).max()),
                        peak_limited=bool(peak_limit/peak<wanted and peak_limit/peak<=10**(max_gain_db/20)),
                        gain_limited=bool(10**(max_gain_db/20)<wanted and 10**(max_gain_db/20)<peak_limit/peak))
