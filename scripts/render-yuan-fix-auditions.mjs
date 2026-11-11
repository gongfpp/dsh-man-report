// Development audition only: real client planner, unchanged number/prefix/ending bank.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import vm from 'node:vm'
import { media, measureVoice } from './voice-loudness.mjs'
const root = new URL('../', import.meta.url), voices = new URL('assets/voices/', root)
const dir = fileURLToPath(new URL('dev/doubao-yuan-fix/', root))
const manifest = JSON.parse(readFileSync(new URL('manifest.json', voices), 'utf8'))
const hash = b => createHash('sha256').update(b).digest('hex')
const originalHash = hash(readFileSync(new URL('clips/unit-yuan.wav', voices)))
let api
const window = { test: value => api = value, __ModuleLoader__: { load: ({ factory }) => factory(() => ({})) } }
vm.runInNewContext(readFileSync(new URL('client.js', root), 'utf8').replace("  return { name: 'man-031'", "  window.test({ getAudioPlan }); return { name: 'man-031'"), { window, Date })
mkdirSync(join(dir, 'audition'), { recursive: true })
const wav = (pcm, file) => {
  const header = Buffer.alloc(44)
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  writeFileSync(file, Buffer.concat([header, pcm]))
}
const decode = file => media(['-v', 'error', '-i', file, '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], true).stdout
const rows = []
for (const [id, trim] of [['yuan-standard', null], ['yuan-context', [1.815, 2.445]]]) {
  const source = join(dir, id + '.mp3'), ledger = JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8'))
  if (ledger.status !== 'received' || hash(readFileSync(source)) !== ledger.sha256) throw Error('SOURCE_MISMATCH')
  let pcm = media(['-v', 'error', '-i', source, ...(trim ? ['-af', `atrim=start=${trim[0]}:end=${trim[1]},asetpts=PTS-STARTPTS`] : []), '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], true).stdout
  if (!trim) {
    const active = []
    for (let at = 0; at < pcm.length / 2; at += 240) {
      let sum = 0, n = 0
      for (let i = at; i < Math.min(at + 240, pcm.length / 2); i++) { sum += (pcm.readInt16LE(i * 2) / 32768) ** 2; n++ }
      if (Math.sqrt(sum / n) >= 10 ** (-50 / 20)) active.push(at)
    }
    if (!active.length) throw Error('NO_ACTIVITY')
    pcm = pcm.subarray(Math.max(0, active[0] - 1200) * 2, Math.min(pcm.length / 2, active.at(-1) + 1440) * 2)
  }
  const unit = join(dir, 'audition', id + '-unit.wav')
  wav(pcm, unit)
  const before = measureVoice(unit), gainDb = Math.min(-24.8 - before.activeRmsDb, -2.2 - before.truePeakDb), gain = 10 ** (gainDb / 20)
  pcm = Buffer.from(pcm)
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i) * gain))), i)
  wav(pcm, unit)
  const paths = Array.from(api.getAudioPlan(manifest, .31, 'CNY', undefined, 'round-next'))
  const parts = paths.map(url => url.endsWith('/clips/unit-yuan.wav') ? pcm : decode(fileURLToPath(new URL(url.replace('/api/man-031/voices/', ''), voices))))
  const file = join(dir, 'audition', id + '-0.31.wav')
  wav(Buffer.concat(parts), file)
  rows.push({ id, sourceSha256: ledger.sha256, sourceRangeSeconds: trim, unit, unitSha256: hash(readFileSync(unit)), gainDb, after: measureVoice(unit), fullSentence: file, fullSha256: hash(readFileSync(file)), plan: paths, humanListeningVerified: false, asrVerified: false })
}
if (hash(readFileSync(new URL('clips/unit-yuan.wav', voices))) !== originalHash) throw Error('RUNTIME_CHANGED')
writeFileSync(join(dir, 'audition', 'report.json'), JSON.stringify({ newTtsCalls: 2, cloudAsrCalls: 0, baselineUnitSha256: originalHash, runtimeChanged: false, processing: 'Complete word only; outer quiet padding and one constant gain. No pitch, speed, phoneme editing or crossfade. Chinese-context unit starts and ends inside measured silent gaps.', rows }, null, 2) + '\n')
console.log(JSON.stringify({ runtimeChanged: false, candidates: rows.map(r => ({ id: r.id, seconds: r.after.decodedDurationSeconds, fullSentence: r.fullSentence })) }))
