// Local-only preparation of complete emotion auditions; no runtime assets changed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { directory, plan } from './generate-doubao-emotions.mjs'
import { media, measureVoice } from './voice-loudness.mjs'
const hash = b => createHash('sha256').update(b).digest('hex')
const out = join(directory, 'audition'); mkdirSync(out, { recursive: true })
const writeWav = (pcm, file) => {
  const h = Buffer.alloc(44)
  h.write('RIFF'); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  writeFileSync(file, Buffer.concat([h, pcm]))
}
const rows = [], combined = []; let cursor = 0
for (const item of plan) {
  const source = join(directory, item.id + '.mp3'), ledger = JSON.parse(readFileSync(join(directory, item.id + '.json'), 'utf8'))
  if (ledger.status !== 'received' || hash(readFileSync(source)) !== ledger.sha256) throw Error('SOURCE_MISMATCH ' + item.id)
  const before = measureVoice(source)
  const raw = media(['-v', 'error', '-i', source, '-f', 'f32le', '-ar', '24000', '-ac', '1', 'pipe:1'], true).stdout
  const active = []
  for (let at = 0; at < raw.length / 4; at += 240) {
    let sum = 0, n = 0
    for (let i = at; i < Math.min(at + 240, raw.length / 4); i++) { sum += raw.readFloatLE(i * 4) ** 2; n++ }
    if (Math.sqrt(sum / n) >= 10 ** (-50 / 20)) active.push(at)
  }
  if (!active.length) throw Error('NO_ACTIVITY ' + item.id)
  const first = Math.max(0, active[0] - 1200), end = Math.min(raw.length / 4, active.at(-1) + 1440)
  const gainDb = Math.min(-24.8 - before.activeRmsDb, -2.2 - before.truePeakDb), gain = 10 ** (gainDb / 20)
  const pcm = Buffer.alloc((end - first) * 2)
  for (let i = first; i < end; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(raw.readFloatLE(i * 4) * gain * 32768))), (i - first) * 2)
  const file = join(out, item.id + '.wav'); writeWav(pcm, file)
  const after = measureVoice(file)
  if (!Number.isFinite(after.activeRmsDb) || after.truePeakDb > -2.1) throw Error('INVALID_LEVEL ' + item.id)
  rows.push({ id: item.id, emotion: item.emotion, text: item.text, performance: item.performance, file, sourceSha256: ledger.sha256, sha256: hash(readFileSync(file)), duration: pcm.length / 48000, combinedStart: cursor, sourceRangeSeconds: [first / 24000, end / 24000], gainDb, after, humanListeningVerified: false, emotionHumanVerified: false })
  combined.push(pcm, Buffer.alloc(48000)); cursor += pcm.length / 48000 + 1
}
writeWav(Buffer.concat(combined), join(out, 'all-10-emotions.wav'))
const report = { newTtsCalls: 10, cloudAsrCalls: 0, originalAiVoice: true, amount: 0.31, currency: 'USD', runtimeChanged: false, processing: 'One constant gain and outer silence trim only. Internal timing, pitch, speed and emotional performance unchanged. No synthetic added effects.', rows }
writeFileSync(join(out, 'manifest.json'), JSON.stringify(report, null, 2) + '\n')
const time = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
writeFileSync(join(out, 'README.md'), '# 十种积极情绪试听\n\n同一豆包 AI 音色，统一以 0.31 美元作情绪对比。这些是新合成的原创台词，不是真人原录音或本人引语。尚未写入插件随机池。情绪标签是表演目标，是否自然、有感染力由用户听审判断。只作统一音量和首尾静音整理，不变调、不变速，不裁切正文。\n\n[按编号连续试听](all-10-emotions.wav)\n\n' + rows.map((r, i) => `## ${i + 1}. ${r.emotion}（连续版 ${time(r.combinedStart)}）\n\n[试听](${r.id}.wav)\n\n${r.text}\n`).join('\n'), 'utf8')
console.log(JSON.stringify({ count: rows.length, fullDuration: cursor, rows: rows.map(r => ({ id: r.id, emotion: r.emotion, duration: r.duration, start: time(r.combinedStart) })) }))
