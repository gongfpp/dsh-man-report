"""Split one spoken recital into per-word fragments.

The recital is one continuous take, so every fragment inherits the same
prosody, tempo and emotion instead of being synthesised in isolation.
Word order comes from a local cached ASR pass (word-order check only, never a
pronunciation or emotion approval); boundaries are snapped to real silences in
the waveform so no cut lands inside a word.
"""
import json, os, subprocess, sys, hashlib
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
EXPECT = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,30,40,50,60,70,80,90,'dot',100,1000,10**6,10**9]
KEYS = [str(i) for i in range(20)] + ['20', '30', '40', '50', '60', '70', '80', '90',
                                      'dot', 'hundred', 'thousand', 'million', 'billion']
RATE = 24000
FRAME = 240           # 10 ms
GATE_DB = -50.0
MERGE_MS = 110
PAD_MS = 50
TARGET_RMS_DB = -24.8
PEAK_CEIL_DB = -2.2

WORD_NUM = {'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
            'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
            'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
            'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30, 'forty': 40,
            'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
            'point': 'dot', 'hundred': 100, 'thousand': 1000, 'million': 10 ** 6,
            'billion': 10 ** 9}


def norm_token(text):
    t = text.strip().strip('.,!?;:').lower()
    if t.isdigit():
        return int(t)
    return WORD_NUM.get(t)


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le',
                          '-ac', '1', '-ar', str(RATE), 'pipe:1'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def voiced(pcm):
    th = 10 ** (GATE_DB / 20)
    n = (len(pcm) // FRAME) * FRAME
    peaks = np.abs(pcm[:n].reshape(-1, FRAME)).max(axis=1)
    segs = []
    for i, p in enumerate(peaks):
        if p <= th:
            continue
        a, b = i * FRAME, (i + 1) * FRAME
        if segs and a - segs[-1][1] <= MERGE_MS / 1000 * RATE:
            segs[-1][1] = b
        else:
            segs.append([a, b])
    return segs


def asr_words(path):
    sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    from faster_whisper import WhisperModel
    model = WhisperModel('base.en', device='cpu', compute_type='int8',
                         download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'),
                         cpu_threads=6, local_files_only=True)
    audio = decode(path)
    audio16 = np.frombuffer(subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'],
        capture_output=True, check=True).stdout, dtype=np.float32)
    segments, _ = model.transcribe(audio16, language='en', beam_size=1,
                                   vad_filter=False, word_timestamps=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append((w.start, w.end, w.word))
    return words, len(audio)


def rms_db(x):
    return 20 * np.log10(max(float(np.sqrt(np.mean(x.astype(np.float64) ** 2))), 1e-9))


def gain_stage(pcm, target_rms_db=TARGET_RMS_DB, peak_ceil_db=PEAK_CEIL_DB):
    rms = rms_db(pcm)
    peak = 20 * np.log10(max(float(np.abs(pcm).max()), 1e-9))
    gain_db = min(target_rms_db - rms, peak_ceil_db - peak)
    return pcm * (10 ** (gain_db / 20)), gain_db


def write_wav(path, pcm):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.f32')
    np.asarray(pcm, dtype=np.float32).tofile(tmp)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1',
                    '-i', str(tmp), '-c:a', 'pcm_s16le', str(path)], check=True)
    tmp.unlink()


def main():
    tier = sys.argv[1]
    src = ROOT / 'dev' / 'voice-bank-v3' / 'raw' / tier / 'numbers.mp3'
    pcm = decode(src)
    words, total = asr_words(src)
    segs = voiced(pcm)
    # Match ASR tokens against the expected recital order instead of trusting the
    # ASR word count: base.en sometimes splits one number into two tokens (e.g.
    # "seventy" -> "seven" "ty") or emits a stray token. Only tokens whose
    # normalised value equals the next expected value are accepted; anything else
    # is skipped as spurious.
    matched = []
    k = 0
    for ws, we, text in words:
        if k >= len(EXPECT):
            break
        value = norm_token(text)
        target = EXPECT[k]
        # base.en transcribes the spoken "point" as "0," / "point" / "."; both
        # spellings stand for the same recital slot. "Thousand" often arrives as
        # ",000," and "million"/"billion" as words.
        thousand_alias = target == 1000 and text.strip(' .,!?;:') in ('000', '1000', '1,000')
        if value == target or (target == 'dot' and value == 0) or thousand_alias:
            matched.append((k, ws, we))
            k += 1
    if k != len(EXPECT):
        raise SystemExit(f'ORDER_MISMATCH {tier} matched {k}/{len(EXPECT)} asr={len(words)}')
    # Match ASR words to voiced intervals with an ordered walk that tolerates
    # both cases seen in practice: two words spoken without a measurable pause
    # (one interval, two words) and one word split by a stop consonant (two
    # intervals, one word). Blips shorter than 50 ms are ignored.
    intervals = [[a, b] for a, b in segs if (b - a) >= 0.05 * RATE]
    groups = []
    i = 0
    for k, (_, ws, we) in enumerate(matched):
        start_i = i
        limit = (we + 0.20) * RATE
        while i < len(intervals) and intervals[i][0] < limit:
            i += 1
        if i == start_i:
            if not groups:
                raise SystemExit(f'ALIGN_FAIL {tier} word {k}')
            groups[-1]['words'].append(k)
        else:
            groups.append({'words': [k], 'range': [intervals[start_i][0], intervals[i - 1][1]]})
    if i < len(intervals):
        groups[-1]['range'][1] = intervals[-1][1]

    word_ranges = [None] * len(matched)
    merged = 0
    for g in groups:
        ks, (a, b) = g['words'], g['range']
        if len(ks) == 1:
            word_ranges[ks[0]] = (a, b)
        else:
            # Two words inside one interval: cut at the ASR boundary and flag it,
            # because that cut may clip coarticulation.
            merged += 1
            cuts = [a] + [int((matched[q][2] + matched[q + 1][1]) / 2 * RATE) for q in ks[:-1]] + [b]
            for j, k in enumerate(ks):
                word_ranges[k] = (cuts[j], cuts[j + 1])
    if any(r is None for r in word_ranges):
        raise SystemExit(f'ALIGN_INCOMPLETE {tier}')
    segs = word_ranges

    pad = int(PAD_MS / 1000 * RATE)
    # "global" keeps the recital's own loudness contour: one gain for the whole
    # take, so relative emphasis survives. "clip" normalises every fragment to
    # the same active RMS, matching the older bank's flatness.
    gain_mode = sys.argv[2] if len(sys.argv) > 2 else 'clip'
    out_dir = 'clips' if gain_mode == 'clip' else 'clips-global'
    out = ROOT / 'dev' / 'voice-bank-v3' / out_dir / tier
    if gain_mode == 'global':
        full = np.array(pcm, dtype=np.float32)
        _, global_gain_db = gain_stage(full)
    rows = []
    for key, (a, b) in zip(KEYS, segs):
        a2, b2 = max(0, a - pad), min(total, b + pad)
        stage = np.array(pcm[a2:b2], dtype=np.float32)
        if gain_mode == 'global':
            gain_db = global_gain_db
            stage = stage * (10 ** (gain_db / 20))
        else:
            stage, gain_db = gain_stage(stage)
        dest = out / (key + '.wav')
        write_wav(dest, stage)
        rows.append({'key': key, 'file': str(dest.relative_to(ROOT)).replace('\\', '/'),
                     'seconds': round(len(stage) / RATE, 3), 'gainDb': round(gain_db, 3),
                     'range': [round(a2 / RATE, 3), round(b2 / RATE, 3)],
                     'sha256': hashlib.sha256(dest.read_bytes()).hexdigest()})
    report = {'tier': tier, 'gainMode': gain_mode,
              'source': str(src.relative_to(ROOT)).replace('\\', '/'),
              'sourceSha256': hashlib.sha256(src.read_bytes()).hexdigest(),
              'words': len(matched), 'voicedIntervals': len(segs), 'mergedSplit': merged,
              'note': 'one continuous recital per tier; boundaries snapped to silence; '
                      + ('single gain for the whole take so natural emphasis survives' if gain_mode == 'global'
                         else 'constant gain to active RMS -24.8 dB with true-peak ceiling -2.2 dB')
                      + '; no pitch, speed or crossfade edits; no human review claimed',
              'rows': rows}
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf8')
    print(json.dumps({'tier': tier, 'words': len(matched), 'mergedSplit': merged,
                      'seconds': round(sum(r['seconds'] for r in rows), 2)}))


if __name__ == '__main__':
    main()
