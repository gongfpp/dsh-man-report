// Development only: paid Doubao TTS v3 synthesis of the USD whole-sentence takes.
// The clone speaker was created in the free experience UI; the user authorised paid
// API calls for this batch after topping the account up. No key is printed or stored
// in the repo: the value is read from the local credential record into memory only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import https from 'node:https'

const root = fileURLToPath(new URL('../', import.meta.url))
const dev = join(root, 'dev/voice-bank-v5')
const raw = join(dev, 'raw')
const SPEC = JSON.parse(readFileSync(join(dev, 'spec.json'), 'utf8'))
const SPEAKER = process.env.MAN_SPEAKER ?? 'S_PneVZcKf2'
const MODEL = 'seed-tts-2.0-expressive'
const RESOURCE = 'seed-icl-2.0'
const CONCURRENCY = Number(process.env.MAN_CONCURRENCY ?? 4)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function readKey() {
  if (process.env.DOUBAO_KEY) return process.env.DOUBAO_KEY
  const store = process.env.MAN_CREDENTIALS ?? join(homedir(), '.dsh', '.credentials.yaml')
  const text = readFileSync(store, 'utf8').split(/\r?\n/)
  const at = text.findIndex(line => /^\s*dsh-man-031\/doubao\s*:/.test(line))
  if (at < 0) throw Error('CREDENTIAL_RECORD_NOT_FOUND')
  for (let i = at + 1; i < text.length; i++) {
    const line = text[i]
    if (/^\s{0,2}\S/.test(line) && !/^\s{4,}/.test(line)) break
    const match = /^\s+key:\s*(.+?)\s*$/.exec(line)
    if (match) return match[1].replace(/^['"]|['"]$/g, '')
  }
  throw Error('CREDENTIAL_KEY_NOT_FOUND')
}

function request({ text, instruction, requestId, key }) {
  const payload = JSON.stringify({
    user: { uid: 'dsh-man-report-whole-usd' },
    req_params: {
      text,
      speaker: SPEAKER,
      model: MODEL,
      audio_params: { format: 'mp3', sample_rate: 24000 },
      additions: JSON.stringify({ context_texts: [instruction] })
    }
  })
  return new Promise((resolve, reject) => {
    const req = https.request('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key, 'X-Api-Resource-Id': RESOURCE, 'X-Api-Request-Id': requestId }
    }, incoming => {
      const parts = []
      let size = 0
      incoming.on('data', bytes => {
        size += bytes.length
        if (size > 8 * 1024 * 1024) req.destroy(Error('RESPONSE_TOO_LARGE'))
        else parts.push(bytes)
      })
      incoming.on('error', reject)
      incoming.on('end', () => resolve({ status: incoming.statusCode, bytes: Buffer.concat(parts) }))
    })
    req.setTimeout(60000, () => req.destroy(Error('PROVIDER_TIMEOUT')))
    req.on('error', reject)
    req.end(payload)
  })
}

async function generateOne(job, key) {
  const ledgerPath = join(raw, job.id + '.json')
  if (existsSync(ledgerPath)) return { id: job.id, status: 'skipped' }
  const ledger = { id: job.id, text: job.text, instruction: job.instruction, speaker: SPEAKER, model: MODEL, status: 'reserved', time: new Date().toISOString(), requestId: randomUUID() }
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' })
  try {
    const response = await request({ text: job.text, instruction: job.instruction, requestId: ledger.requestId, key })
    ledger.http = response.status
    if (response.status !== 200) throw Error('PROVIDER_HTTP_ERROR')
    const records = response.bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    if (records.at(-1)?.code !== 20000000 || records.some(row => ![0, 20000000].includes(row.code))) throw Error('PROVIDER_BUSINESS_ERROR')
    const audio = Buffer.concat(records.filter(row => row.code === 0 && typeof row.data === 'string').map(row => Buffer.from(row.data, 'base64')))
    if (!audio.length || audio.length > 4 * 1024 * 1024) throw Error('INVALID_AUDIO_SIZE')
    writeFileSync(join(raw, job.id + '.mp3'), audio, { flag: 'wx' })
    Object.assign(ledger, { status: 'received', bytes: audio.length, sha256: hash(audio), finalCode: 20000000 })
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
    return { id: job.id, status: 'received', bytes: audio.length }
  } catch (error) {
    const known = ['PROVIDER_HTTP_ERROR', 'PROVIDER_BUSINESS_ERROR', 'PROVIDER_TIMEOUT', 'RESPONSE_TOO_LARGE', 'INVALID_AUDIO_SIZE']
    ledger.status = 'failed'
    ledger.error = known.includes(error.message) ? error.message : 'NETWORK_OR_RESPONSE_ERROR'
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
    return { id: job.id, status: 'failed', error: ledger.error, http: ledger.http }
  }
}

const only = process.env.MAN_ONLY ? new Set(process.env.MAN_ONLY.split(',')) : null
const limit = Number(process.env.MAN_LIMIT ?? Infinity)
const jobs = SPEC.jobs.filter(job => !only || only.has(job.id)).slice(0, limit)
mkdirSync(raw, { recursive: true })
const key = readKey()
const results = []
let cursor = 0
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++]
    const result = await generateOne(job, key)
    results.push(result)
    if (result.status === 'failed') console.log(JSON.stringify(result))
  }
}
await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, jobs.length)) }, worker))
const summary = { speaker: SPEAKER, model: MODEL, resource: RESOURCE, requested: jobs.length, received: results.filter(r => r.status === 'received').length, failed: results.filter(r => r.status === 'failed').length, skipped: results.filter(r => r.status === 'skipped').length, bytes: results.reduce((sum, r) => sum + (r.bytes ?? 0), 0) }
writeFileSync(join(dev, 'generation-report.json'), JSON.stringify({ ...summary, results, time: new Date().toISOString() }, null, 2) + '\n')
console.log(JSON.stringify(summary))
