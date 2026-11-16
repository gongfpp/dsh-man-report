"""Diagnostics for one recital: voiced intervals vs ASR words."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
spec = importlib.util.spec_from_file_location('split', Path(__file__).resolve().parent / 'split-recital.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

tier = sys.argv[1]
src = m.ROOT / 'dev' / 'voice-bank-v3' / 'raw' / tier / 'numbers.mp3'
pcm = m.decode(src)
segs = m.voiced(pcm)
words, total = m.asr_words(src)
print('tier', tier, 'seconds', round(total / m.RATE, 2))
print('voiced intervals', len(segs), [round((b - a) / m.RATE, 2) for a, b in segs])
print('asr words', len(words), [round(w[0], 2) for w in words])
