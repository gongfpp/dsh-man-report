"""Completeness check for the generated USD whole-sentence takes.

Two cheap, objective signals per take:

* content coverage: how much of the expected sentence the local ASR can match,
  after folding numbers and currency words into single tokens (base.en writes
  "$0.01" as one token, so a literal word comparison would be meaningless);
* duration outlier: a take far shorter than the other takes of the same
  template is the signature of a truncated provider response.

Neither signal is a pronunciation, emotion or human-approval claim.
"""
import json
import os
import re
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import numpy as np
from faster_whisper import WhisperModel

SPEC = json.loads((ROOT / 'dev/voice-bank-v5/spec.json').read_text(encoding='utf-8'))
REPORT = json.loads((ROOT / 'dev/voice-bank-v5/build-whole-report.json').read_text(encoding='utf-8'))
BY_ID = {row['id']: row for row in REPORT['takes']}
model = WhisperModel('base.en', device='cpu', compute_type='int8',
                     download_root=str(ROOT / 'dev/classic-man/asr-models'),
                     cpu_threads=6, local_files_only=True)

CURRENCY = {'dollar', 'dollars', 'yuan', 'usd', 'cny'}
NUMBER = re.compile(r"\$?\d+(?:[.,]\d+)?")
SPELLED = re.compile(r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point)(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point))*\b")


def fold(text):
    """Lowercase words with numbers (digits or spelled out) and currency words folded."""
    text = text.lower().replace("'s", 's').replace('\u2019s', 's')
    text = SPELLED.sub(' NUM ', text)
    text = NUMBER.sub(' NUM ', text)
    words = re.findall(r"[a-z]+|num", text)
    return ['CUR' if word in CURRENCY else word.upper() if word == 'num' else word for word in words]


def lcs(a, b):
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b, 1):
            cur.append(prev[j - 1] + 1 if x == y else max(prev[j], cur[j - 1]))
        prev = cur
    return prev[-1]


rows = []
for job in SPEC['jobs']:
    row = BY_ID.get(job['id'])
    if not row:
        continue
    path = ROOT / 'assets/voices' / row['file']
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32)
    segments, _ = model.transcribe(audio, language='en', beam_size=1, vad_filter=False)
    heard = ' '.join(s.text.strip() for s in segments)
    expected_tokens = fold(job['text'])
    heard_tokens = fold(heard)
    coverage = lcs(expected_tokens, heard_tokens) / len(expected_tokens)
    heard_number = NUMBER.search(heard)
    rows.append({
        'id': job['id'], 'amount': job['amount'], 'phraseId': job['phraseId'], 'tier': job['tier'],
        'duration': row['duration'], 'heard': heard,
        'coverage': round(coverage, 3),
        'heardNumber': heard_number.group(0) if heard_number else None,
        'numberMatches': bool(heard_number) and heard_number.group(0).lstrip('$').replace(',', '.') == job['amount'].rstrip('0').rstrip('.') or (heard_number is not None and abs(float(heard_number.group(0).lstrip('$')) - float(job['amount'])) < 0.005),
    })

by_phrase = {}
for row in rows:
    by_phrase.setdefault(row['phraseId'], []).append(row['duration'])
medians = {phrase: statistics.median(values) for phrase, values in by_phrase.items()}
for row in rows:
    row['durationRatio'] = round(row['duration'] / medians[row['phraseId']], 3)
    problems = []
    if row['coverage'] < 0.75:
        problems.append('LOW_COVERAGE')
    if row['durationRatio'] < 0.6:
        problems.append('SHORT_TAKE')
    row['flag'] = problems or None

flagged = [row for row in rows if row['flag']]
out = {
    'scope': 'content coverage and duration-outlier screening only; not a pronunciation, emotion or human approval',
    'checked': len(rows), 'flagged': len(flagged),
    'coverageMin': min(row['coverage'] for row in rows),
    'coverageMedian': statistics.median(row['coverage'] for row in rows),
    'numberMismatch': [row['id'] for row in rows if not row['numberMatches']],
    'flaggedRows': flagged, 'rows': rows,
}
(ROOT / 'dev/voice-bank-v5/asr-check.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')
print(json.dumps({'checked': len(rows), 'flagged': len(flagged),
                  'coverageMin': out['coverageMin'], 'coverageMedian': out['coverageMedian'],
                  'numberMismatch': len(out['numberMismatch']),
                  'flaggedIds': [row['id'] for row in flagged]}, ensure_ascii=False))
