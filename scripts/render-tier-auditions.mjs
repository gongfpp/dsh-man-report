import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
const root = new URL('../', import.meta.url)
const dev = new URL('../dev/voice-bank-v2/audition/', import.meta.url)
mkdirSync(dev, { recursive: true })
const manifest = JSON.parse(readFileSync(new URL('assets/voices/manifest.json', root), 'utf8'))
let api
const window = { test: v => api = v, __ModuleLoader__: { load: ({ factory }) => factory(() => ({})) } }
vm.runInNewContext(readFileSync(new URL('client.js', root), 'utf8').replace("  return { name: 'man-report'", "  window.test({ getAudioPlan, numberTokens, displayAmount, billingAmount }); return { name: 'man-report'"), { window, Date })
const cases = [
  { amount: .005, currency: 'CNY', phrase: 'round-next', label: 't1', caption: '0.005 元 · 轻松无奈' },
  { amount: .3105, currency: 'CNY', phrase: 'round-next', label: 't2', caption: '0.311 元 · 满意微笑' },
  { amount: 3.5, currency: 'CNY', phrase: 'round-next', label: 't3', caption: '3.500 元 · 挑眉意外' },
  { amount: 42, currency: 'CNY', phrase: 'round-next', label: 't4', caption: '42.000 元 · 兴奋难以置信' }
]
const rate = 24000
const gap = Buffer.alloc(rate * 4 * .55)
const report = [], parts = []
for (const c of cases) {
  const paths = [...api.getAudioPlan(manifest, c.amount, c.currency, undefined, c.phrase)]
  const chunks = []
  for (const path of paths) {
    const bytes = readFileSync(fileURLToPath(new URL('assets/voices/' + path.replace('/api/man-report/voices/', ''), root)))
    chunks.push(execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(rate), 'pipe:1'], { input: bytes, maxBuffer: 1 << 26 }), gap)
  }
  const joined = Buffer.concat(chunks)
  const name = `${c.label}-${c.amount}.wav`
  const wav = toWav(joined)
  writeFileSync(new URL(name, dev), wav)
  parts.push(joined, gap)
  report.push({ ...c, file: name, sha256: createHash('sha256').update(wav).digest('hex'), seconds: +(joined.length / 4 / rate).toFixed(3), clips: paths.map(p => p.split('/').at(-1)) })
}
const all = toWav(Buffer.concat(parts))
writeFileSync(new URL('all-tiers.wav', dev), all)
report.push({ file: 'all-tiers.wav', sha256: createHash('sha256').update(all).digest('hex'), seconds: +(Buffer.concat(parts).length / 4 / rate).toFixed(3) })
writeFileSync(new URL('report.json', dev), JSON.stringify({ note: 'development audition only; runtime bank unchanged', cases: report }, null, 1))
console.log(JSON.stringify({ cases: report.map(r => [r.file, r.seconds]) }))
function toWav(raw) {
  const tmp = fileURLToPath(new URL('../dev/voice-bank-v2/audition/.raw.f32', import.meta.url))
  const tmpWav = fileURLToPath(new URL('../dev/voice-bank-v2/audition/.raw.wav', import.meta.url))
  writeFileSync(tmp, raw)
  try {
    // Seekable output so ffmpeg can patch the RIFF/data sizes; pipe-written WAV
    // keeps 0xFFFFFFFF sizes and strict players refuse it.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', tmp, '-c:a', 'pcm_s16le', tmpWav], { maxBuffer: 1 << 26 })
    return readFileSync(tmpWav)
  } finally {
    rmSync(tmp, { force: true })
    rmSync(tmpWav, { force: true })
  }
}
