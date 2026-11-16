"""One local cached ASR pass per complete audition; not human emotion approval."""
import os, sys, json, hashlib, subprocess, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'doubao-emotions-10' / 'audition'
DEST = OUT / 'local-asr.json'
if DEST.exists():
    raise RuntimeError('NO_REPEATED_ASR')
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'), cpu_threads=6, local_files_only=True)
report = json.loads((OUT / 'manifest.json').read_text(encoding='utf8'))
rows = []
for row in report['rows']:
    file = Path(row['file'])
    if hashlib.sha256(file.read_bytes()).hexdigest() != row['sha256']:
        raise RuntimeError('SHA_MISMATCH ' + row['id'])
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    segments, _ = model.transcribe(np.frombuffer(pcm, dtype=np.float32), language='en', beam_size=5, condition_on_previous_text=False)
    heard = ' '.join(r.text.strip() for r in segments)
    normal = re.sub(r'(\d)\s*\.\s*(\d+)', r'\1.\2', heard.lower())
    result = {'id': row['id'], 'heardInferenceOnly': heard, 'amountTextPresentInAsr': bool(re.search(r'zero\s+point\s+three\s+one|(?<![\d.])0\.31(?!\d)', normal)), 'dollarTextPresentInAsr': bool(re.search(r'dollars?', normal)), 'emotionHumanVerified': False, 'humanListeningVerified': False}
    rows.append(result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
DEST.write_text(json.dumps({'cachedOfflineModel': 'base.en CPU int8', 'cloudAsrCalls': 0, 'note': 'ASR is inference only, not a verdict on emotion, voice identity or pronunciation.', 'rows': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
