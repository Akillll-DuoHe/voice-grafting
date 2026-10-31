"""Validate one-speaker PCM-WAV/CSV data and split by source recording group.

This does not transcribe, denoise, identify speakers, or train a model.
CSV columns: audio,text,speaker,group,split (split optional: train/val).
"""
import argparse
import csv
import hashlib
import json
import wave
from pathlib import Path


def prepare(metadata, output, speaker):
    metadata, output = Path(metadata).resolve(strict=True), Path(output).resolve()
    if output.exists():
        raise ValueError('Output already exists; choose a new dataset version')
    with metadata.open(encoding='utf-8-sig', newline='') as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) < 2:
        raise ValueError('Provide at least two independently grouped recordings')
    records = []
    group_splits = {}
    explicit = any(row.get('split', '').strip() for row in rows)
    for row in rows:
        if row.get('speaker', '').strip() != speaker:
            raise ValueError('Mixed/missing speakers; prepare each speaker separately')
        text, group = row.get('text', '').strip(), row.get('group', '').strip()
        if not text or not group:
            raise ValueError('Every clip needs a reviewed transcript and source group')
        audio = Path(row['audio'])
        audio = (metadata.parent / audio).resolve(strict=True) if not audio.is_absolute() else audio.resolve(strict=True)
        with wave.open(str(audio), 'rb') as wav:
            duration = wav.getnframes() / wav.getframerate()
            if wav.getnchannels() not in (1, 2) or wav.getframerate() not in (16000, 22050, 24000, 32000, 44100, 48000) or not 3 <= duration <= 30:
                raise ValueError('Use 3-30 second mono/stereo PCM WAV clips at a supported sample rate')
            # Hash decoded PCM too: changing a WAV header does not create new data.
            digest = hashlib.sha256(wav.readframes(wav.getnframes())).hexdigest()
        split = row.get('split', '').strip()
        if explicit:
            if split not in ('train', 'val'):
                raise ValueError('Explicit split requires train/val on every row')
            if group in group_splits and group_splits[group] != split:
                raise ValueError('The same source group cannot appear in train and val')
            group_splits[group] = split
        records.append(dict(audio=str(audio), text=text, duration=duration, group=group, pcmSha256=digest))
    groups = sorted({r['group'] for r in records}, key=lambda s: hashlib.sha256(s.encode()).hexdigest())
    if len(groups) < 2:
        raise ValueError('Need at least two source recording groups for a real holdout')
    if not explicit:
        val_groups = set(groups[:max(1, round(len(groups) * .2))])
        group_splits = {g: 'val' if g in val_groups else 'train' for g in groups}
    train = [r for r in records if group_splits[r['group']] == 'train']
    val = [r for r in records if group_splits[r['group']] == 'val']
    if not train or not val:
        raise ValueError('Both train and val must contain samples')
    if {r['pcmSha256'] for r in train} & {r['pcmSha256'] for r in val}:
        raise ValueError('Duplicate audio across train and val; fix source groups')
    output.mkdir(parents=True, exist_ok=False)
    for split, items in [('train', train), ('val', val)]:
        with (output / (split + '.jsonl')).open('x', encoding='utf-8') as stream:
            for i, item in enumerate(items):
                record = {k: item[k] for k in ('audio', 'text', 'duration')}
                if split == 'train' and len(train) > 1 and i % 3 == 0:
                    record['ref_audio'] = train[(i + 1) % len(train)]['audio']
                stream.write(json.dumps(record, ensure_ascii=False) + '\n')
    report = dict(speaker=speaker, trainClips=len(train), valClips=len(val),
                  trainSeconds=sum(r['duration'] for r in train), valSeconds=sum(r['duration'] for r in val),
                  groups=group_splits, automaticSpeakerVerification=False, transcriptsManuallyReviewed='required',
                  note='Groups must describe the original recording/session; this tool cannot detect mislabeled scenes.',
                  records=records)
    (output / 'preparation.local.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return {k: report[k] for k in ('speaker', 'trainClips', 'valClips', 'trainSeconds', 'valSeconds')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--metadata', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--speaker', required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.metadata, args.out, args.speaker), ensure_ascii=False))
