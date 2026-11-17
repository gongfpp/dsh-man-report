// Builds the four-tier offline voice bank from development UI captures.
// Local processing only: outer quiet trim with 50 ms padding, one constant gain
// per clip (target active RMS -24.8 dB, true peak ceiling -2.2 dB), no pitch,
// speed, phoneme or crossfade edits. WAV PCM16 mono 24 kHz keeps the bank lossless.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { measureVoice, media } from './voice-loudness.mjs'
const root = new URL('../', import.meta.url), voices = new URL('assets/voices/', root)
const dev = fileURLToPath(new URL('dev/voice-bank-v2/', root))
const clipsDir = fileURLToPath(new URL('assets/voices/clips/', root))
const manifestPath = new URL('manifest.json', voices)
const config = JSON.parse(readFileSync(join(dev, 'tiers.json'), 'utf8'))
const bank = JSON.parse(readFileSync(manifestPath, 'utf8'))
const hash = b => createHash('sha256').update(b).digest('hex')
const FRAME = 240, GATE = 10 ** (-50 / 20)
const decode = file => media(['-v', 'error', '-i', file, '-f', 'f32le', '-ar', '24000', '-ac', '1', 'pipe:1'], true).stdout
function activeFrames(pcm) {
  const total = pcm.length / 4, frames = []
  for (let at = 0; at < total; at += FRAME) {
    let sum = 0, n = 0
    for (let i = at; i < Math.min(at + FRAME, total); i++) { sum += pcm.readFloatLE(i * 4) ** 2; n++ }
    if (Math.sqrt(sum / n) >= GATE) frames.push(at)
  }
  return { frames, total }
}
function segments(pcm, gapMs = 110) {
  const { frames, total } = activeFrames(pcm), out = []
  for (const at of frames) {
    const last = out.at(-1)
    if (last && at - last[1] <= (gapMs / 10) * FRAME) last[1] = at + FRAME
    else out.push([at, at + FRAME])
  }
  return { segments: out.map(([a, b]) => [Math.max(0, a - 1200), Math.min(total, b + 1440)]), total }
}
function normalize(pcm, from, to, label) {
  const stage = Buffer.from(pcm.subarray(from * 4, to * 4))
  const temp = join(clipsDir, '.tmp-' + label + '.f32')
  writeFileSync(temp, stage)
  const probe = join(clipsDir, '.tmp-' + label + '.wav')
  try { media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', temp, '-c:a', 'pcm_s16le', probe]) } finally { unlinkSync(temp) }
  const before = measureVoice(probe)
  const gainDb = Math.min(-24.8 - before.activeRmsDb, -2.2 - before.truePeakDb), gain = 10 ** (gainDb / 20)
  for (let i = 0; i < stage.length; i += 4) stage.writeFloatLE(stage.readFloatLE(i) * gain, i)
  const temp2 = temp + '.g'
  writeFileSync(temp2, stage)
  const out = join(clipsDir, label + '.wav')
  try { media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', temp2, '-c:a', 'pcm_s16le', out]) } finally { unlinkSync(temp2); unlinkSync(probe) }
  const bytes = readFileSync(out), after = measureVoice(out)
  return { file: 'clips/' + label + '.wav', sha256: hash(bytes), duration: Number(after.decodedDurationSeconds.toFixed(3)), gainDb: Number(gainDb.toFixed(3)), before, after }
}
const report = [], missing = []
mkdirSync(clipsDir, { recursive: true })
for (const tier of config.tiers) {
  for (const clip of config.clips) {
    const source = join(dev, 'raw', tier.id, clip.key + '.mp3')
    if (!existsSync(source)) { missing.push(tier.id + '/' + clip.key); continue }
    let pcm = decode(source)
    let from, to
    if (clip.key === 'unit-yuan') {
      // The approved fix spoke the unit inside a Chinese context sentence; keep the
      // measured second word rather than trusting an English ASR word boundary.
      const context = join(dev, 'raw', tier.id, 'unit-yuan-context.mp3')
      if (!existsSync(context)) throw Error('MISSING_CONTEXT ' + tier.id)
      pcm = decode(context)
      const { segments: parts } = segments(pcm)
      if (parts.length < 2) throw Error('CONTEXT_SEGMENTS ' + tier.id + ' ' + parts.length)
      ;[from, to] = parts.at(-1)
    } else {
      const { segments: parts } = segments(pcm)
      if (!parts.length) throw Error('NO_ACTIVITY ' + tier.id + '/' + clip.key)
      ;[from, to] = [parts[0][0], parts.at(-1)[1]]
    }
    const row = normalize(pcm, from, to, clip.key + '-' + tier.id)
    report.push({ tier: tier.id, key: clip.key, text: clip.text, rangeSeconds: [from / 24000, to / 24000], ...row })
  }
}
if (missing.length) throw Error('MISSING_CLIPS ' + missing.join(','))
const byTier = tier => Object.fromEntries(report.filter(r => r.tier === tier).map(r => [r.key, { file: r.file, sha256: r.sha256, duration: r.duration }]))
bank.clips = bank.clips ?? {}
for (const clip of config.clips) {
  const base = report.find(r => r.tier === 't2' && r.key === clip.key)
  bank.clips[clip.key] = { text: clip.text, file: base.file, sha256: base.sha256, duration: base.duration, asrVerified: false, humanListeningVerified: false }
}
bank.tierOverrides = { t1: byTier('t1'), t3: byTier('t3'), t4: byTier('t4') }
bank.tierBands = {
  money: [{ tier: 't1', below: .02 }, { tier: 't2', below: .1 }, { tier: 't3', below: 1 }, { tier: 't4' }],
  tokens: [{ tier: 't1', below: 1000 }, { tier: 't2', below: 10000 }, { tier: 't3', below: 100000 }, { tier: 't4' }]
}
bank.notes = `${bank.phrases.length} money and ${bank.tokenPhrases?.length ?? 0} token templates; four emotion tiers re-record every clip (digits, openers, endings, units) with the approved bright reference; tier 2 is the default set. Fixed local voice and number bank, no runtime synthesis/key/provider.`
bank.verification = { ...(bank.verification ?? {}), newCompositesHumanReviewed: false, tierClipsHumanReviewed: false }
writeFileSync(manifestPath, JSON.stringify(bank, null, 2) + '\n')
writeFileSync(new URL('readable-text.txt', voices), Object.entries(bank.clips).map(([key, row]) => `${key}: ${row.text}`).join('\n') + '\n\n' + [...bank.phrases, ...(bank.tokenPhrases ?? [])].map(p => `${p.id}: ${p.text}`).join('\n') + '\n')
writeFileSync(join(dev, 'build-report.json'), JSON.stringify({
  developmentUiSyntheses: report.length, cloudAsrCalls: 0,
  processing: 'Outer quiet trim with 50 ms padding; one constant gain per clip to active RMS -24.8 dB with true peak ceiling -2.2 dB; WAV PCM16 mono 24 kHz; no pitch, speed, phoneme or crossfade edits; no fabricated human review.',
  clips: report.map(r => ({ tier: r.tier, key: r.key, file: r.file, sha256: r.sha256, duration: r.duration, gainDb: r.gainDb, rangeSeconds: r.rangeSeconds }))
}, null, 2) + '\n')
const stale = readdirSync(clipsDir).filter(name => /\.wav$/.test(name) && config.clips.some(c => name === c.key + '.wav'))
console.log(JSON.stringify({ tiers: config.tiers.map(t => t.id), clips: report.length, staleLegacyWavs: stale, totalBytes: report.reduce((s, r) => s + readFileSync(fileURLToPath(new URL(r.file, voices))).length, 0) }))
