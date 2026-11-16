// Replace the separately synthesised number fragments with fragments cut out of
// one continuous recital take per tier. Prefix, unit and ending clips keep the
// existing bank recordings; only the 33 number keys are swapped.
import { readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifestPath = root + 'assets/voices/manifest.json'
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const TIERS = ['t1', 't2', 't3', 't4']
const NUMBER_KEYS = [...Array.from({ length: 20 }, (_, i) => String(i)),
  '20', '30', '40', '50', '60', '70', '80', '90', 'dot', 'hundred', 'thousand', 'million', 'billion']

const wavInfo = bytes => {
  // 24 kHz mono PCM16 WAV: walk the RIFF chunks instead of trusting a fixed header.
  let offset = 12
  let duration = null
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    if (id === 'data') {
      duration = +(size / (24000 * 2)).toFixed(3)
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (duration === null) throw new Error('no data chunk')
  return { duration, sha256: createHash('sha256').update(bytes).digest('hex') }
}

const report = { generatedFrom: 'dev/voice-bank-v3/clips', tiers: {}, replaced: {}, kept: [] }
for (const tier of TIERS) {
  const dir = root + 'dev/voice-bank-v3/clips/' + tier + '/'
  const tierReport = JSON.parse(readFileSync(dir + 'report.json', 'utf8'))
  const rows = new Map(tierReport.rows.map(r => [r.key, r]))
  let replaced = 0
  for (const key of NUMBER_KEYS) {
    const src = rows.get(key)
    if (!src || !existsSync(dir + key + '.wav')) throw new Error('missing recital fragment ' + tier + '/' + key)
    const dest = root + 'assets/voices/clips/' + key + '-' + tier + '.wav'
    copyFileSync(dir + key + '.wav', dest)
    const info = wavInfo(readFileSync(dest))
    const row = {
      file: 'clips/' + key + '-' + tier + '.wav',
      duration: info.duration,
      sha256: info.sha256,
      gainDb: src.gainDb,
      range: src.range,
      source: 'recital-' + tier,
      humanListeningVerified: false,
      asrVerified: false
    }
    if (tier === 't2') manifest.clips[key] = row
    else manifest.tierOverrides[tier][key] = row
    replaced++
  }
  report.replaced[tier] = replaced
  report.tiers[tier] = {
    recitalSha256: tierReport.sourceSha256,
    mergedSplit: tierReport.mergedSplit,
    fragments: tierReport.rows.length
  }
}

const spoken = [...new Set([...manifest.phrases, ...manifest.tokenPhrases].flatMap(p => [p.prefix, p.unit, p.suffix].filter(Boolean)))]
report.kept = spoken.filter(key => !NUMBER_KEYS.includes(key))
manifest.notes = 'Numbers are cut from one continuous recital take per emotion tier (same clone, same instruction), '
  + 'so neighbouring fragments share pitch and tempo; prefixes, units and endings keep the per-clip recordings. '
  + 'Tier 2 is the default set stored in clips; tierOverrides holds t1/t3/t4.'
manifest.voiceBank = {
  layout: 'recital-numbers',
  generated: '2026-11-16',
  tiers: Object.fromEntries(TIERS.map(t => [t, { recitalSha256: report.tiers[t].recitalSha256, mergedSplit: report.tiers[t].mergedSplit }])),
  note: 'development audition only: no human listening approval is claimed for the fragments'
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n')
writeFileSync(root + 'dev/voice-bank-v3/build-report.json', JSON.stringify(report, null, 1))
console.log(JSON.stringify({ replaced: report.replaced, kept: report.kept.length }))
