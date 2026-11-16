"""Transcribe candidate auditions to check which words are actually spoken.

Word identity only; never a pronunciation, emotion or human approval.
"""
import os
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import numpy as np
from faster_whisper import WhisperModel

model = WhisperModel('base.en', device='cpu', compute_type='int8',
                     download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'),
                     cpu_threads=6, local_files_only=True)
for p in sys.argv[1:]:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32)
    segments, _ = model.transcribe(audio, language='en', beam_size=1, vad_filter=False)
    text = ' '.join(s.text.strip() for s in segments)
    print(Path(p).name, '|', text)
