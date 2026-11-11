// Development-only pronunciation auditions. Never ships with the runtime.
import { fileURLToPath } from 'node:url'
import { generateItem } from './generate-doubao-offline.mjs'
export const directory = fileURLToPath(new URL('../dev/doubao-yuan-fix/', import.meta.url))
const common = '保持参考的同一个低沉男声音色和自然语速，不要变成播音员。使用标准普通话读中文，不要用英语口音。元读yuán，和圆同音，阳平第二声，声音从低向高自然上扬。不要读成英语you、one、yan，也不要读成第四声愿。只读目标文字，不添加解释、词语、音乐或音效。'
export const plan = [
  { id: 'yuan-standard', text: '元。', instruction: common },
  { id: 'yuan-context', text: '人民币。元。', instruction: common + '两个短句之间清楚停顿，最后的元保持完整自然的第二声。' },
]
export const generateYuanFix = (id, key) => generateItem(id, key, { directory, plan })
