import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
const root = new URL('../', import.meta.url)
const out = new URL('../dev/voice-bank-v2/audition/', import.meta.url)
mkdirSync(out, { recursive: true })
const manifest = JSON.parse(readFileSync(new URL('assets/voices/manifest.json', root), 'utf8'))
let api
const window = { test: v => api = v, __ModuleLoader__: { load: ({ factory }) => factory(() => ({})) } }
vm.runInNewContext(readFileSync(new URL('client.js', root), 'utf8').replace("  return { name: 'man-031'", "  window.test({ getAudioPlan, numberTokens, displayAmount, billingAmount }); return { name: 'man-031'"), { window, Date })
const rate = 24000
const toF32 = bytes => execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(rate), 'pipe:1'], { input: bytes, maxBuffer: 1 << 26 })
const toWav = raw => {
  const tmp = fileURLToPath(new URL('../dev/voice-bank-v2/audition/.raw.f32', import.meta.url))
  const tmpWav = fileURLToPath(new URL('../dev/voice-bank-v2/audition/.raw.wav', import.meta.url))
  writeFileSync(tmp, raw)
  try {
    // Encode to a real file: ffmpeg can only patch the RIFF/data sizes when the
    // output is seekable. Writing WAV to a pipe leaves 0xFFFFFFFF sizes, which
    // strict players such as PotPlayer refuse to open.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', tmp, '-c:a', 'pcm_s16le', tmpWav], { maxBuffer: 1 << 26 })
    return readFileSync(tmpWav)
  } finally {
    rmSync(tmp, { force: true })
    rmSync(tmpWav, { force: true })
  }
}
const gap = Buffer.alloc(rate * 4 * 1)
// A: the approved whole-sentence take (0.31 exactly, matching phrase) — no splicing at all.
const wholePath = manifest.amounts['CNY:0.31'].file
const whole = toF32(readFileSync(new URL('assets/voices/' + wholePath, root)))
// B: the same text assembled from the tier-2 fragment bank, exactly what the runtime plays for 0.31.
const phrase = 'jobs'
const fragmentPack = { ...manifest, amounts: {} }
const paths = [...api.getAudioPlan(fragmentPack, .31, 'CNY', undefined, phrase)]
const chunks = []
for (const p of paths) chunks.push(toF32(readFileSync(fileURLToPath(new URL('assets/voices/' + p.replace('/api/man-031/voices/', ''), root)))))
const spliced = Buffer.concat(chunks)
const files = {
  'A-whole-0.31.wav': whole,
  'B-spliced-0.31.wav': spliced,
  'compare-whole-vs-spliced.wav': Buffer.concat([whole, gap, spliced])
}
const report = { note: 'development audition only; A is the approved whole-sentence take, B is the tier-2 fragment bank for the same amount', phraseId: phrase, clips: paths.map(p => p.split('/').at(-1)), files: {} }
for (const [name, raw] of Object.entries(files)) {
  const wav = toWav(raw)
  writeFileSync(new URL(name, out), wav)
  report.files[name] = { sha256: createHash('sha256').update(wav).digest('hex'), bytes: wav.length, seconds: +(raw.length / 4 / rate).toFixed(3) }
}
writeFileSync(new URL('compare-report.json', out), JSON.stringify(report, null, 1))
console.log(JSON.stringify(report.files))
