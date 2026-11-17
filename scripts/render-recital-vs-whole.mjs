import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const out = new URL('../dev/voice-bank-v3/audition/', import.meta.url)
mkdirSync(out, { recursive: true })
const manifest = JSON.parse(readFileSync(new URL('assets/voices/manifest.json', root), 'utf8'))
let api
const window = { test: v => api = v, __ModuleLoader__: { load: ({ factory }) => factory(() => ({})) } }
vm.runInNewContext(readFileSync(new URL('client.js', root), 'utf8').replace("  return { name: 'man-report'", "  window.test({ getAudioPlan }); return { name: 'man-report'"), { window, Date })

const rate = 24000
const toF32 = bytes => execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(rate), 'pipe:1'], { input: bytes, maxBuffer: 1 << 26 })
const toWav = raw => {
  const tmp = fileURLToPath(new URL('../dev/voice-bank-v3/audition/.raw.f32', import.meta.url))
  const tmpWav = fileURLToPath(new URL('../dev/voice-bank-v3/audition/.raw.wav', import.meta.url))
  writeFileSync(tmp, raw)
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', tmp, '-c:a', 'pcm_s16le', tmpWav], { maxBuffer: 1 << 26 })
    return readFileSync(tmpWav)
  } finally {
    rmSync(tmp, { force: true })
    rmSync(tmpWav, { force: true })
  }
}

const phrase = process.argv[2] ?? 'jobs'
const amount = Number(process.argv[3] ?? 0.31)
const tier = process.argv[4] ?? 't2'
const tag = process.argv[5] ?? '0.31'

const wholePath = manifest.amounts['CNY:' + amount]?.file
const whole = wholePath ? toF32(readFileSync(new URL('assets/voices/' + wholePath, root))) : null
const fragmentPack = { ...manifest, amounts: {} }
const paths = [...api.getAudioPlan(fragmentPack, amount, 'CNY', undefined, phrase)]

const recitalDir = new URL('../dev/voice-bank-v3/clips/' + tier + '/', import.meta.url)
const chunksB = []
const chunksC = []
const used = []
for (const p of paths) {
  const rel = p.replace('/api/man-report/voices/', '')
  const name = rel.split('/').at(-1)
  const base = readFileSync(fileURLToPath(new URL('assets/voices/' + rel, root)))
  chunksB.push(toF32(base))
  const key = name.replace(new RegExp('-' + tier + '\\.wav$'), '')
  const recital = new URL(key + '.wav', recitalDir)
  if (existsSync(fileURLToPath(recital))) {
    chunksC.push(toF32(readFileSync(fileURLToPath(recital))))
    used.push({ clip: name, source: 'recital' })
  } else {
    chunksC.push(toF32(base))
    used.push({ clip: name, source: 'bank' })
  }
}
const spliced = Buffer.concat(chunksB)
const recitalSpliced = Buffer.concat(chunksC)
const gap = Buffer.alloc(rate * 4)
const files = {}
if (whole) files['A-whole-' + tag + '.wav'] = whole
files['B-bank-spliced-' + tag + '.wav'] = spliced
files['C-recital-spliced-' + tag + '.wav'] = recitalSpliced
files['compare-' + tag + '.wav'] = Buffer.concat([...(whole ? [whole, gap] : []), spliced, gap, recitalSpliced])
const report = {
  note: 'development audition only; A = approved whole-sentence take, B = tier-2 bank splice, C = same splice with every number fragment taken from one continuous recital take of the same tier',
  phraseId: phrase, amount, tier, clips: used, files: {}
}
for (const [name, raw] of Object.entries(files)) {
  const wav = toWav(raw)
  writeFileSync(new URL(name, out), wav)
  report.files[name] = { sha256: createHash('sha256').update(wav).digest('hex'), bytes: wav.length, seconds: +(raw.length / 4 / rate).toFixed(3) }
}
writeFileSync(new URL('compare-recital-report.json', out), JSON.stringify(report, null, 1))
console.log(JSON.stringify(report.files))
