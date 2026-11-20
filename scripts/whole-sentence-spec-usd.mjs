// Build the spec for the USD whole-sentence takes: every phrase template in the
// spoken form of a covered USD amount, with the instruction of that amount's tier.
// Same ten amounts as the CNY set, same tier bands, unit word dollar/dollars.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(root + 'assets/voices/manifest.json', 'utf8'))
const AMOUNTS = ['0.01', '0.02', '0.03', '0.05', '0.08', '0.10', '0.20', '0.30', '0.50', '1.00']
const INSTRUCTIONS = {
  t1: '轻松又无奈，带一点自嘲的笑，语气轻快自然',
  t2: '满意地微笑，语气松弛愉快，像点头认可',
  t3: '有点意外地挑眉，语气上扬，带点惊讶',
  t4: '非常兴奋，难以置信地提高音量，笑着大声说'
}
const BANDS = manifest.tierBands.money
const tierOf = value => BANDS.find(b => b.below === undefined || value < b.below).tier

const jobs = []
for (const amount of AMOUNTS) {
  const tier = tierOf(Number(amount))
  const unit = amount === '1.00' ? 'dollar' : 'dollars'
  for (const phrase of manifest.phrases) {
    const text = phrase.text.replaceAll('{amount}', amount).replaceAll('{unit}', unit)
    jobs.push({ id: 'USD-' + amount + '-' + phrase.id, currency: 'USD', amount, phraseId: phrase.id, tier, instruction: INSTRUCTIONS[tier], text })
  }
}
mkdirSync(root + 'dev/voice-bank-v5', { recursive: true })
writeFileSync(root + 'dev/voice-bank-v5/spec.json', JSON.stringify({ currency: 'USD', amounts: AMOUNTS, tiers: INSTRUCTIONS, jobs }, null, 1))
console.log(JSON.stringify({ jobs: jobs.length, chars: jobs.reduce((sum, j) => sum + j.text.length, 0), amounts: AMOUNTS }))
