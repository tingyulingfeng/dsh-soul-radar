/**
 * Language — sentence-level craft.
 *
 * Port of `p6_score.py`. Only the parts that carry evidence stay here:
 *
 *   段落臃肿   a paragraph long enough to lose the reader mid-way
 *   断句       one sentence carrying several complete clauses without a stop
 *   具体化率   how often an emotion is named instead of shown
 *
 * Typos and awkward repetition are reported as hints and never scored — the
 * author's call was that they do not affect the direction of the judgement,
 * but they must still reach the user through the improvement notes.
 */

import { sentences, thresholds, itemCap, clamp } from './core.js'

const TH = {
  bloat: thresholds('lang_para_bloat'),
  brk: thresholds('lang_break'),
  concrete: thresholds('lang_concrete'),
}

const PRON = ['我', '你', '他', '她', '它', '咱', '自己', '我们', '你们', '他们']

// Emotion words: naming the feeling instead of showing it.
const ABSTRACT = [
  '难过', '快乐', '开心', '幸福', '悲伤', '失落', '怅然',
  '美好', '温暖', '孤单', '激动', '期待', '满足', '平静',
  '愤怒', '害怕', '感动', '留恋', '怀念', '怅', '惆怅',
  '兴奋', '痛苦', '喜悦', '忧愁', '无奈', '可惜', '遗憾',
  '难受', '心酸', '不舒服', '委屈', '愧疚', '欣慰', '心疼',
  '着急', '焦虑', '不安', '紧张', '感激', '歉意',
  '酸楚', '苦涩', '暖心', '窝心', '孤独', '寂寞', '惘然', '执念',
]

// Something the reader can see, touch, or hear. Its presence near an emotion
// word means the emotion landed on something instead of floating.
const CONCRETE = [
  '看', '望', '听', '闻', '摸', '尝', '咬', '抱', '走', '跑',
  '站', '坐', '拿', '放', '哭', '笑', '喊', '叫', '跳', '爬',
  '蹲', '摔', '抖', '抬', '低', '转', '推', '拉', '踢', '扔',
  '香', '甜', '苦', '咸', '凉', '烫', '亮', '暗', '响',
  '门槛', '水缸', '蒲团', '屋顶', '台阶', '柿子', '哈欠',
  '眼睛', '疤', '尾巴', '毛', '爪',
]

const TYPO = [
  ['迫不急待', '迫不及待'], ['谈笑风声', '谈笑风生'],
  ['一股作气', '一鼓作气'], ['不径而走', '不胫而走'],
  ['再所不惜', '在所不惜'], ['一如继往', '一如既往'],
  ['变本加利', '变本加厉'], ['汗流夹背', '汗流浃背'],
  ['义无返顾', '义无反顾'], ['好高鹜远', '好高骛远'],
  ['星罗其布', '星罗棋布'], ['黄梁一梦', '黄粱一梦'],
  ['首位呼应', '首尾呼应'],
]

const SEMANTIC = [
  ['偷懒', '省事'], ['累', '疲'], ['舒服', '惬意'],
  ['害怕', '恐惧'], ['好看', '漂亮'], ['开心', '高兴'],
  ['突然', '忽然'], ['大约', '左右'], ['至少', '以上'],
]

const CONCRETE_WINDOW = TH.concrete.window ?? 7

function concreteNear(text, pos) {
  const lo = Math.max(0, pos - CONCRETE_WINDOW)
  const hi = Math.min(text.length, pos + CONCRETE_WINDOW)
  const win = text.slice(lo, hi)
  return CONCRETE.some((c) => win.includes(c))
}

/** How many emotion words in this sentence are floating (nothing concrete nearby). */
export function floatingEmotions(s) {
  if (s.length < 8) return 0
  let n = 0
  for (const w of ABSTRACT) {
    let from = 0
    for (;;) {
      const i = s.indexOf(w, from)
      if (i < 0) break
      if (!concreteNear(s, i)) n += 1
      from = i + w.length
    }
  }
  return n
}

/**
 * @param {{para:number,text:string}[]} bodyRows
 * @returns {{done:number, deduct:number, hits:object[], detail:string}}
 */
export function score(bodyRows, capOverride) {
  const rows = (bodyRows ?? []).filter((r) => String(r.text ?? '').trim())
  const cap = capOverride ?? itemCap('lang') ?? 7

  const hits = []
  let bloat = 0
  let split = 0
  let broken = 0
  let abstractSent = 0

  const BLOAT = TH.bloat.bloat ?? 100
  const NORMAL = TH.bloat.normal ?? 80
  const PEN_BLOAT = TH.bloat.pen_bloat ?? 0.6
  const PEN_LONG = TH.bloat.pen_long ?? 0.3
  const BLOAT_CAP = capOverride == null ? (TH.bloat.cap ?? 2) : 2

  const BRK_MIN = TH.brk.min_len ?? 15
  const BRK_PRON = TH.brk.min_pron ?? 3
  const BRK_ALT_C = TH.brk.alt_clauses ?? 7
  const BRK_ALT_L = TH.brk.alt_len ?? 45
  const BRK_PER = TH.brk.per ?? 0.25
  const BRK_CAP = TH.brk.cap ?? 2

  for (const r of rows) {
    const n = String(r.text).length
    if (n > BLOAT) {
      bloat += PEN_BLOAT
      hits.push({ para: r.para, text: `段 ${r.para} 有 ${n} 字，一个段落装了两三件事` })
    } else if (n > NORMAL) {
      bloat += PEN_LONG
      hits.push({ para: r.para, text: `段 ${r.para} 有 ${n} 字，偏长` })
    }
  }
  bloat = Math.min(bloat, BLOAT_CAP)

  const fullText = rows.map((r) => String(r.text)).join('')
  for (const r of rows) {
    for (const raw of sentences(String(r.text))) {
      const s = raw.replace(/^["“”]+|["“”]+$/g, '').trim()
      if (s.length <= BRK_MIN) continue
      const parts = s.split(/[，,]/).filter((x) => x.trim())
      const pron = parts.filter((x) => PRON.some((p) => x.includes(p))).length
      if (pron >= BRK_PRON || (parts.length >= BRK_ALT_C && s.length > BRK_ALT_L)) {
        broken += 1
        hits.push({
          para: r.para,
          text: `段 ${r.para} 一句 ${s.length} 字里挤了 ${pron} 个带主语的分句`,
        })
      }
    }
  }
  split = Math.min(broken * BRK_PER, BRK_CAP)

  const sl = sentences(fullText)
  for (const s of sl) {
    if (floatingEmotions(s) > 0) abstractSent += 1
  }
  const concreteRate = sl.length ? 1 - abstractSent / sl.length : 1

  // Typos and repeated near-synonyms: hints only.
  const hints = []
  for (const [wrong, right] of TYPO) {
    for (const r of rows) {
      if (String(r.text).includes(wrong)) {
        hints.push(`段 ${r.para}「${wrong}」应为「${right}」`)
      }
    }
  }
  for (const [a, b] of SEMANTIC) {
    for (const r of rows) {
      const t = String(r.text)
      if (t.includes(a) && t.includes(b) && Math.abs(t.indexOf(a) - t.indexOf(b)) < 20) {
        hints.push(`段 ${r.para}「${a}」和「${b}」语义重复，留一个就好`)
      }
    }
  }

  const deduct = Math.min(bloat + split, cap)

  // Two sides, and they read different metrics (the author's rule: the two
  // sides must not be two readings of one number):
  //   deduct side  "错"  — how many problems
  //   add side     "实"  — how often the writing lands on something concrete
  // The engine combines them; here we only report the raw rate and the metric.
  const baseRate = cap ? (cap - deduct) / cap : 0

  const parts = []
  if (bloat > 0) parts.push(`段落结构 −${bloat.toFixed(2)}`)
  if (split > 0) parts.push(`断句 −${split.toFixed(2)}`)
  if (concreteRate < 1) parts.push(`具体化 ${(concreteRate * 100).toFixed(0)}%`)

  return {
    baseRate,
    metrics: { concrete_ratio: concreteRate },
    deduct,
    cap,
    hits,
    hints,
    detailMetrics: {
      concrete_rate: concreteRate,
      floating_emotions: abstractSent,
      sentences: sl.length,
      broken_sentences: broken,
      bloat_deduct: bloat,
      break_deduct: split,
    },
    detail: parts.join('，') || '没有发现字句层面的问题',
  }
}
