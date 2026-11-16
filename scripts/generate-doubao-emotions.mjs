// Development-only auditions. Fixed whole USD examples, never runtime TTS.
import { fileURLToPath } from 'node:url'
import { generateItem } from './generate-doubao-offline.mjs'
export const directory = fileURLToPath(new URL('../dev/doubao-emotions-10/', import.meta.url))
const base = '使用参考的同一个男声音色，不换人。请像真人表演一小段有感情的台词，不要平读、客服腔或机械报账。通过自然的重音、抑扬、停顿与呼吸表达指定情绪；不要每个词都喊叫。只说目标英文台词一次，不读情绪说明，不加背景音乐或音效。金额只是句中一个轻带过的信息，情绪贯穿金额前后。'
export const plan = [
  {
    id: '01-celebration', emotion: '兴奋庆祝',
    text: "MAN! Yes! That's what I'm talking about! Zero point three one dollars. Let's go!",
    performance: '刚刚赢下一场艰难比赛后的兴奋庆祝，能量九成。开头MAN和YES有爆发力，语速轻快，带着笑意，结尾Let\'s go再次扬起。中间金额自然稍微收一下，再把情绪推回去。',
  },
  {
    id: '02-proud', emotion: '骄傲赞许',
    text: "Now that's a solid round. Zero point three one dollars. Hold your head high. You did the work.",
    performance: '教练真心为对方感到骄傲，能量六成，沉稳而有分量。solid和you有赞许的重音，轻轻笑着，句尾从容落下，不喊口号。让人听出认可，而非冷淡播报。',
  },
  {
    id: '03-reassuring', emotion: '温柔鼓励',
    text: "Hey. You're doing fine. Zero point three one dollars. One step at a time. We've got this.",
    performance: '面对有点疲惫的队友，温柔安慰、耐心鼓励，能量三成。Hey很轻，语速偏慢，停顿柔软，最后We\'ve got this温暖而笃定。不是耳语，更不是悲伤或无精打采。',
  },
  {
    id: '04-amused', emotion: '开怀笑意',
    text: "Ha! Now that was fun! Zero point three one dollars. Come on, save some of that magic for the next round!",
    performance: '和朋友一起玩得特别开心，开怀、带笑说话，能量七成。Ha是一声短小爽朗的笑，后面笑意保留在嗓音中，最后半句像朋友间轻松打趣；不要夸张狂笑盖住台词。',
  },
  {
    id: '05-determined', emotion: '坚定斗志',
    text: "MAN. Zero point three one dollars. Eyes up. Stay ready. We're not done getting better.",
    performance: '积极坚定、专注而有斗志，能量七成。MAN低沉短促，不拉长喊。Eyes up和Stay ready用干净有力的重音，最后一句层层推进。不是愤怒、责备或威胁。',
  },
  {
    id: '06-delighted', emotion: '惊喜赞叹',
    text: "Oh, wow! Look at you! Zero point three one dollars. Now that's a beautiful finish!",
    performance: '看到队友打出漂亮表现后的真心惊喜，能量八成。Oh wow有自然上扬的惊喜，Look at you带着欣赏的笑，beautiful finish由衷赞叹。不要嘲讽，也不要像毫无表情的新闻朗读。',
  },
  {
    id: '07-relieved', emotion: '轻松释然',
    text: "All right. Zero point three one dollars. Take that breath. We made it through. Feels good, doesn't it?",
    performance: '顺利完成一轮之后松一口气的轻松满足，能量四成。All right像放下肩膀后舒展地说，语速松弛，We made it through带踏实的笑，最后反问亲切自然。不是疲惫叹气或难过。',
  },
  {
    id: '08-grateful', emotion: '真诚感谢',
    text: "Hey, thank you for showing up. Zero point three one dollars. I mean it. Glad you're here.",
    performance: '对一直努力的队友表达真诚感谢，能量四成。thank you和I mean it有真心的分量，语调温暖，停顿给人认真注视对方的感觉；Glad you\'re here带一点柔和笑意。不要煽情哭腔。',
  },
  {
    id: '09-hopeful', emotion: '满怀期待',
    text: "That's one more step forward. Zero point three one dollars. Just imagine what we can do next. I can't wait.",
    performance: '对下一步充满积极期待，能量六成。前半句明亮踏实，Just imagine开始语气逐渐扬起，最后I can\'t wait是真心跃跃欲试的笑意，不是焦虑或催促。',
  },
  {
    id: '10-playful', emotion: '自信打趣',
    text: "MAN! Zero point three one dollars. Making progress look easy, huh? All right, superstar. Your move.",
    performance: '自信又友好的打趣，能量六成。MAN带笑，huh轻轻上扬像挑眉，superstar是暖心昵称不是讽刺，Your move像自信地把球交给对方。潇洒、有玩心，不要盛气凌人。',
  },
].map(item => ({ ...item, instruction: `${base}\n这条的情绪表演要求：${item.performance}` }))
export const generateEmotion = (id, key) => generateItem(id, key, { directory, plan })
