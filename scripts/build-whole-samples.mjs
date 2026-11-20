// Builds the whole-sentence bank for the covered amounts of each currency from
// development captures. Each file is one continuous take of one phrase at one
// amount, so nothing is spliced: outer quiet trim with 50 ms padding, one constant
// gain per take (target active RMS -24.8 dB, true peak ceiling -2.2 dB), no pitch,
// speed, phoneme or crossfade edits. MP3 96 kbps mono 24 kHz keeps the set compact.
// Sets are merged into manifest.wholeSamples, never overwritten wholesale.
//   CNY  dev/voice-bank-v4 (free experience UI, clone MAN-happy-test)
//   USD  dev/voice-bank-v5 (paid Doubao API, same clone)
// Set MAN_BUILD=USD to rebuild only one currency.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { measureVoice, media } from './voice-loudness.mjs'

const root = new URL('../', import.meta.url), voices = new URL('assets/voices/', root)
const outDir = fileURLToPath(new URL('assets/voices/amounts/', root))
const manifestPath = new URL('manifest.json', voices)
const bank = JSON.parse(readFileSync(manifestPath, 'utf8'))
const hash = buffer => createHash('sha256').update(buffer).digest('hex')
const FRAME = 240, GATE = 10 ** (-50 / 20), RATE = 24000
const decode = file => media(['-v', 'error', '-i', file, '-f', 'f32le', '-ar', String(RATE), '-ac', '1', 'pipe:1'], true).stdout

const SETS = [
  { currency: 'CNY', dir: 'dev/voice-bank-v4', source: 'Free 豆包语音 experience UI with clone MAN-happy-test (S_PneVZcKf2); no paid activation, no public API synthesis.' },
  { currency: 'USD', dir: 'dev/voice-bank-v5', source: 'Paid Doubao TTS v3 API (openspeech.bytedance.com, seed-icl-2.0) with the same clone MAN-happy-test (S_PneVZcKf2), authorised by the maintainer after topping the account up.' }
].filter(set => !process.env.MAN_BUILD || process.env.MAN_BUILD === set.currency)

function extent(pcm) {
  const total = pcm.length / 4
  let first = -1, last = -1
  for (let at = 0; at < total; at += FRAME) {
    let sum = 0, count = 0
    for (let i = at; i < Math.min(at + FRAME, total); i++) { sum += pcm.readFloatLE(i * 4) ** 2; count++ }
    if (Math.sqrt(sum / count) < GATE) continue
    if (first < 0) first = at
    last = at + FRAME
  }
  if (first < 0) throw Error('NO_ACTIVITY')
  return [Math.max(0, first - 1200), Math.min(total, last + 1440)]
}

function normalize(pcm, from, to, label) {
  const stage = Buffer.from(pcm.subarray(from * 4, to * 4))
  mkdirSync(outDir, { recursive: true })
  const raw = join(outDir, '.tmp-' + label + '.f32'), wav = join(outDir, '.tmp-' + label + '.wav')
  writeFileSync(raw, stage)
  try { media(['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', raw, '-c:a', 'pcm_s16le', wav]) } finally { unlinkSync(raw) }
  const before = measureVoice(wav)
  const gainDb = Math.min(-24.8 - before.activeRmsDb, -2.2 - before.truePeakDb), gain = 10 ** (gainDb / 20)
  for (let i = 0; i < stage.length; i += 4) stage.writeFloatLE(stage.readFloatLE(i) * gain, i)
  const prepared = join(outDir, '.tmp-' + label + '.g.f32')
  writeFileSync(prepared, stage)
  const out = join(outDir, label + '.mp3')
  try {
    media(['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', prepared, '-c:a', 'libmp3lame', '-b:a', '96k', out])
  } finally { unlinkSync(prepared); unlinkSync(wav) }
  const bytes = readFileSync(out), after = measureVoice(out)
  return { file: 'amounts/' + label + '.mp3', sha256: hash(bytes), duration: Number(after.decodedDurationSeconds.toFixed(3)), gainDb: Number(gainDb.toFixed(3)), rangeSeconds: [from / RATE, to / RATE], before: { activeRmsDb: before.activeRmsDb, truePeakDb: before.truePeakDb }, after: { activeRmsDb: after.activeRmsDb, truePeakDb: after.truePeakDb } }
}

const processed = {}
for (const set of SETS) {
  const dev = fileURLToPath(new URL(set.dir + '/', root))
  const specPath = join(dev, 'spec.json')
  if (!existsSync(specPath)) continue
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const report = [], missing = []
  for (const job of spec.jobs) {
    const source = join(dev, 'raw', job.id + '.mp3')
    if (!existsSync(source)) { missing.push(job.id); continue }
    const pcm = decode(source)
    const [from, to] = extent(pcm)
    const row = normalize(pcm, from, to, job.id.replace(/\./g, 'p'))
    report.push({ id: job.id, amount: job.amount, phraseId: job.phraseId, tier: job.tier, text: job.text, ...row })
  }
  if (missing.length) throw Error('MISSING_TAKES ' + set.currency + ' ' + missing.join(','))
  for (const row of report) {
    const key = set.currency + ':' + String(Number(row.amount))
    bank.wholeSamples = bank.wholeSamples ?? {}
    bank.wholeSamples[key] = bank.wholeSamples[key] ?? {}
    bank.wholeSamples[key][row.phraseId] = { file: row.file, sha256: row.sha256, duration: row.duration, phraseId: row.phraseId, fullUtterance: true }
  }
  writeFileSync(join(dev, 'build-whole-report.json'), JSON.stringify({
    developmentSyntheses: report.length, cloudAsrCalls: 0, source: set.source,
    instruction: 'One continuous take per phrase and amount; outer quiet trim with 50 ms padding; one constant gain to active RMS -24.8 dB with true peak ceiling -2.2 dB; MP3 96 kbps mono 24 kHz; no splicing, pitch, speed or phoneme edits.',
    takes: report,
  }, null, 2) + '\n')
  processed[set.currency] = { takes: report.length, totalBytes: report.reduce((sum, row) => sum + readFileSync(fileURLToPath(new URL(row.file, voices))).length, 0), gainDb: [Math.min(...report.map(row => row.gainDb)), Math.max(...report.map(row => row.gainDb))], duration: [Math.min(...report.map(row => row.duration)), Math.max(...report.map(row => row.duration))] }
}

const currencies = Object.keys(bank.wholeSamples ?? {}).map(key => key.split(':')[0])
bank.wholeSamplesProcessed = {
  count: Object.values(bank.wholeSamples ?? {}).reduce((sum, byPhrase) => sum + Object.keys(byPhrase).length, 0),
  currencies: [...new Set(currencies)],
  amounts: [...new Set(Object.keys(bank.wholeSamples ?? {}).map(key => Number(key.split(':')[1])))].sort((a, b) => a - b),
  processing: 'One continuous take per phrase and amount; outer quiet trim with 50 ms padding; one constant gain to active RMS -24.8 dB with true peak ceiling -2.2 dB; MP3 96 kbps mono 24 kHz; no splicing, pitch, speed or phoneme edits.',
}
writeFileSync(manifestPath, JSON.stringify(bank, null, 2) + '\n')
console.log(JSON.stringify({ processed, wholeSamples: bank.wholeSamplesProcessed.count, currencies: bank.wholeSamplesProcessed.currencies }))
