"""One local cached ASR pass over a recital, to check the spoken word order.

This is a word-order check, not human listening approval.
"""
import os, sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
import subprocess

path = Path(sys.argv[1])
model = WhisperModel('base.en', device='cpu', compute_type='int8',
                     download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'),
                     cpu_threads=6, local_files_only=True)
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'],
                     capture_output=True, check=True).stdout
audio = np.frombuffer(raw, dtype=np.float32)
segments, _ = model.transcribe(audio, language='en', beam_size=1, vad_filter=False, word_timestamps=True)
words = []
for seg in segments:
    for w in seg.words or []:
        words.append([w.word.strip(), round(w.start, 2), round(w.end, 2)])
text = ' '.join(s.text.strip() for s in segments)
print(json.dumps({'file': path.name, 'count': len(words), 'text': text, 'words': words}, ensure_ascii=False))
