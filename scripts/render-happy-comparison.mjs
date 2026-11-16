// Development-only one-shot comparison. No synthesis, runtime or existing voice changes.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { media, measureVoice } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, 'dev/happy-reference-review'), out = join(directory, 'audition')
mkdirSync(out, { recursive: true })
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const oldManifest = JSON.parse(readFileSync(join(root, 'dev/doubao-emotions-10/audition/manifest.json'), 'utf8'))
const oldRow = oldManifest.rows.find(row => row.id === '01-celebration')
const oldFile = join(root, 'dev/doubao-emotions-10/audition/01-celebration.wav')
const newFile = join(directory, 'happy-clone-ui-original.bin')
if (hash(oldFile) !== oldRow.sha256 || hash(newFile) !== '131c7d971bc415bf7ffea5b7ff431d5f98808d1a36bc69fda01aab36d731e149') throw Error('COMPARISON_SOURCE_MISMATCH')
const oldLevel = measureVoice(oldFile), newLevel = measureVoice(newFile)
const raw = media(['-v', 'error', '-i', newFile, '-f', 'f32le', '-ar', '24000', '-ac', '1', 'pipe:1'], true).stdout
const active = []
for (let at = 0; at < raw.length / 4; at += 240) {
  let sum = 0, n = 0
  for (let i = at; i < Math.min(at + 240, raw.length / 4); i++) { sum += raw.readFloatLE(i * 4) ** 2; n++ }
  if (Math.sqrt(sum / n) >= 10 ** (-50 / 20)) active.push(at)
}
if (!active.length) throw Error('NO_NEW_AUDIO_ACTIVITY')
const first = Math.max(0, active[0] - 1200), end = Math.min(raw.length / 4, active.at(-1) + 1440)
const gainDb = Math.min(oldLevel.activeRmsDb - newLevel.activeRmsDb, -2.2 - newLevel.truePeakDb), gain = 10 ** (gainDb / 20)
const pcm = Buffer.alloc((end - first) * 2)
for (let i = first; i < end; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(raw.readFloatLE(i * 4) * gain * 32768))), (i - first) * 2)
const h = Buffer.alloc(44)
h.write('RIFF'); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28)
h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
const a = join(out, 'A-old-reference.wav'), b = join(out, 'B-joking-reference.wav')
copyFileSync(oldFile, a); writeFileSync(b, Buffer.concat([h, pcm]))
const after = measureVoice(b)
if (Math.abs(after.activeRmsDb - oldLevel.activeRmsDb) > .15 || after.truePeakDb > -2.1) throw Error('COMPARISON_LEVEL_MISMATCH')
const report = {
  text: oldRow.text, oldSpeaker: 'S_HhJVZcKf2', newSpeaker: 'S_PneVZcKf2', newVoiceName: 'MAN-happy-test',
  newSpeakerProof: 'Current official UI voice component props: voice.id and voice.speaker both S_PneVZcKf2. Voice was not switched after generation.',
  newTtsCalls: 1, normalPublicApiSynthesisCalls: 0, freeUiCharactersConsumed: 80,
  oldApiModel: 'seed-tts-2.0-expressive', newUiModelLabel: 'Doubao - TTS 2.0',
  comparisonLimit: 'Official free UI and prior API paths are not a controlled model/backend experiment. The same English text and performance instruction were used (UI input removes newline). No claim that reference alone caused any perceived difference.',
  referenceRangeSeconds: [107.49, 112.9], referenceSourceUrl: 'https://www.youtube.com/watch?v=t8eoIKiDTw8',
  processing: 'A is the exact previously delivered WAV. B has one constant gain and outer silence trim with 50 ms padding only. No pitch/speed/internal timing edits, inserted laughter or effects.',
  runtimeChanged: false, oldVoiceChanged: false, humanListeningVerified: false, emotionHumanVerified: false,
  A: { file: a, sha256: hash(a), level: oldLevel },
  B: { file: b, sha256: hash(b), sourceSha256: hash(newFile), sourceRangeSeconds: [first / 24000, end / 24000], gainDb, level: after },
}
writeFileSync(join(out, 'comparison.json'), JSON.stringify(report, null, 2) + '\n')
writeFileSync(join(out, 'README.md'), '# 新旧参考音色对比\n\n同一句 0.31 美元台词；两条主动语音响度相同。A 是此前十条中的第 1 条原文件。B 使用经用户选定方向的原声玩笑片段新建独立免费试听音色，旧音色与插件不变。\n\n- [A：旧参考](A-old-reference.wav)\n- [B：原声玩笑参考](B-joking-reference.wav)\n\n' + oldRow.text + '\n\n只统一响度和整理首尾静音，不变调、不变速、不添加笑声。新试听走免费体验 UI，旧试听走 API，因此这不是完全控制模型后端的因果实验；是否更开心、是否保留想要的声音，由用户听审。\n')
console.log(JSON.stringify({ A: { file: a, duration: oldLevel.decodedDurationSeconds, activeRmsDb: oldLevel.activeRmsDb }, B: { file: b, duration: after.decodedDurationSeconds, activeRmsDb: after.activeRmsDb, truePeakDb: after.truePeakDb }, runtimeChanged: false }))
