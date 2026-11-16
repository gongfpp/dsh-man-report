// Reference review only: two full recordings, static level matching, no cloud calls.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { media, measureVoice } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/happy-reference-review')
mkdirSync(out, { recursive: true })
const sources = [
  { id: 'current-synthetic-reference', label: '当前克隆实际使用的 AI 合成参考', file: 'dev/voice-whole-man-trial/audition/B-tags.wav', sha256: '4abcb3f851e18b4b260c32f1da56935ec8b62117016d43f3997bb2f1254d134b', synthetic: true },
  { id: 'original-joking-candidate', label: '自然访谈中讲笑话的原声候选（尚待听审）', file: 'dev/classic-quotes/hybrid-reference/reference-segment-joke.wav', sha256: 'bf00c9a07f8a7c236eb4819e14ff03c795e3184466e0171137300d23927cc298', synthetic: false, sourceUrl: 'https://www.youtube.com/watch?v=t8eoIKiDTw8&t=107', sourceRangeSeconds: [107.49,115.8], limitations: 'Possible audience/host laughter in the background. Emotion review only; not automatically admitted as a clean voice-cloning reference.' },
]
const rows = []
for (const row of sources) {
  const source = join(root, row.file)
  const actual = createHash('sha256').update(readFileSync(source)).digest('hex')
  if (actual !== row.sha256) throw Error('SOURCE_MISMATCH ' + row.id)
  const before = measureVoice(source), gainDb = Math.min(-24.8 - before.activeRmsDb, -2.2 - before.truePeakDb)
  const file = join(out, row.id + '.wav')
  media(['-v','error','-y','-i',source,'-af',`volume=${gainDb}dB`,'-ac','1','-ar','24000','-c:a','pcm_s16le',file])
  const after = measureVoice(file)
  if (Math.abs(before.decodedDurationSeconds - after.decodedDurationSeconds) > 0.001 || after.truePeakDb > -2.1) throw Error('INVALID_TRANSFORM ' + row.id)
  rows.push({ ...row, file, sourceSha256: actual, gainDb, duration: after.decodedDurationSeconds, activeRmsDb: after.activeRmsDb, pitchChanged: false, speedChanged: false, cropped: false, humanListeningVerified: false })
}
writeFileSync(join(out, 'review.json'), JSON.stringify({ purpose: 'Compare the current synthesized cloning reference with an authentic joking interview candidate at similar active loudness.', ttsCalls: 0, cloneCalls: 0, existingVoiceChanged: false, runtimeChanged: false, rows }, null, 2) + '\n')
writeFileSync(join(out, 'README.md'), '# 开心语气参考复查\n\n当前豆包克隆音色 MAN-B-reference 使用的是先前 AI 合成的 B-tags（7.52秒），不是科比开心时的原录音。来源由原克隆记录的 SHA256 与 B-tags 文件逐一核对。新十条仍使用这个 speaker，只有情绪指令发生变化。参考情绪可能限制表现，但这不是证明参考是唯一原因。\n\n- [旧参考：AI 合成 B-tags](current-synthetic-reference.wav)\n- [待听审：访谈中讲笑话的原声](original-joking-candidate.wav)\n\n原声来自 Jimmy Kimmel Live 的公开访谈 https://www.youtube.com/watch?v=t8eoIKiDTw8&t=107 ，原片107.49–115.80秒。画面可见嘉宾笑着讲述，是否符合所需开心声线仍需人耳判断。片段可能带观众或主持笑声，不能直接视作干净训练集。\n\n两条仅调整整体音量至相近水平，没有升调、加速、拼接或裁正文。本次未调用 TTS、未提交复刻、未改旧音色或运行包。应先确认目标情绪，再清理选择单人语音，并在确认免费额度或获得付费授权后用独立测试音色少量比较，不能保证换参考必然解决所有表演问题。\n')
console.log(JSON.stringify({ rows: rows.map(({id,duration,activeRmsDb}) => ({id,duration,activeRmsDb})), ttsCalls:0, cloneCalls:0, runtimeChanged:false }))
