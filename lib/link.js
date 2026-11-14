/**
 * Link — can a reader get from one paragraph to the next.
 *
 * Port of `p9_link.py`, including the corrections made after the first version
 * misfired:
 *
 *   Pronouns count only in the first 8 characters. Scanning the whole
 *   paragraph made 「那我会怎样？」→「导师沉默了很久」 look linked, because the
 *   second paragraph contains 「我」 — as dialogue, not as reference.
 *
 *   Shared entities must be at least 3 characters. Two-character slicing
 *   produced garbage like 「载里」「天夜」, which then polluted every
 *   "highest-coverage element" the review list reported.
 *
 * There is also a floor: below 30% coverage the tool is not measuring the
 * article, it is failing to see it. A decent article must not be marked as
 * falling apart because the matcher is blind.
 *
 * The details that matter and are easy to get wrong:
 *   · a shared n-gram is rejected if it contains *any* function character
 *   · connectives are looked for in the first 6 characters, not 8
 *   · 「小山」 and 「山上」 count as the same element (stem normalisation)
 */

const FULL_SCORE = 7.0

const CONNECT = [
  '因此', '所以', '于是', '结果', '不料', '谁知', '然而', '可是',
  '但是', '为此', '那天', '后来', '从那以后', '等到', '终于',
  '只不过', '而是', '接着', '随即', '然后',
  '还记得', '记得', '想起', '回想', '那时候', '当时',
]

const ACT = ['走', '跑', '看', '望', '听', '说', '拿', '放', '推', '拉', '抱',
  '抬', '低', '转', '站', '坐', '蹲', '踢', '扔', '抓', '摸', '笑', '哭']
const REACT = ['便', '就', '才', '着', '了', '起来', '下来', '过去', '出来']

const PRON = ['它', '他', '她', '它们', '他们', '她们', '这', '那', '该']

const TIME_JUMP = ['从', '后来', '几年后', '多年后', '等到', '毕业', '那年',
  '第二年', '而现在', '如今', '再后来', '长大后', '回到', '再次']

// Direction suffixes and modifier prefixes: 「小山」=「山上」=「山里」.
const DIR_SUFFIX = ['上', '下', '里', '外', '中', '内', '边', '旁', '前', '后', '头', '面']
const MOD_PREFIX = ['小', '大', '老', '阿', '那', '这']

// The parallel check filters with a *different*, shorter set and with ll
// rather than ny — that asymmetry is in the original and it changes which
// groups land in the review list, so it is kept rather than tidied away.
const FUNC_PARALLEL = new Set('的了是在和就不都也很有这那个一我他她它'.split(''))
const isAllFunc = (g) => [...g].every((c) => FUNC_PARALLEL.has(c))

// A shared n-gram containing any of these is not an element.
const FUNC = new Set(
  ('的了是在和就不都也很有这那个一我他她它们着过又而与其并且或者' +
    '么什怎之已把被让给对向从没不会能可要很更最太些').split(''),
)

const PRON_HEAD = 8
const CONNECT_HEAD = 6
const TIME_HEAD = 12
const ENTITY_N = 3
const MIN_PAIRS = 3
const MIN_RATE = 0.3
const W_KINDS = 5

const hasFunc = (g) => [...g].some((c) => FUNC.has(c))

/** Every n-gram of length n inside CJK runs. */
function ngrams(text, n) {
  const out = new Set()
  for (const seg of String(text ?? '').match(/[\u4e00-\u9fa5]+/g) ?? []) {
    for (let i = 0; i + n <= seg.length; i += 1) out.add(seg.slice(i, i + n))
  }
  return out
}

/** Reduce a word to its core: drop a direction suffix, then a modifier prefix. */
function stem(w) {
  let s = w
  for (const d of DIR_SUFFIX) {
    if (s.endsWith(d) && s.length > d.length) { s = s.slice(0, -d.length); break }
  }
  for (const m of MOD_PREFIX) {
    if (s.startsWith(m) && s.length > m.length) { s = s.slice(m.length); break }
  }
  return s
}

/** Shared elements between two paragraphs, with stem-equivalence folded in. */
function shared(a, b, n = 2) {
  const A = ngrams(a, n)
  const B = ngrams(b, n)
  const out = new Set([...A].filter((g) => B.has(g)))
  for (const wa of A) {
    const sa = stem(wa)
    if (!sa.length) continue
    for (const wb of B) {
      if (wa === wb) continue
      if (stem(wb) === sa) out.add(`${wa}≈${wb}`)
    }
  }
  return out
}

const connectIn = (text) => {
  const head = String(text ?? '').trim().slice(0, CONNECT_HEAD)
  return CONNECT.filter((w) => head.includes(w))
}

const actReact = (a, b) =>
  ACT.some((w) => String(a).includes(w)) && REACT.some((w) => String(b).includes(w))

/**
 * Is paragraph `b` joined to paragraph `a`?
 * @returns {{ok:boolean, why:string}}
 */
export function serial(a, b) {
  const at = String(a.text ?? '')
  const bt = String(b.text ?? '')

  // ① a shared element of at least three characters, containing no function char
  const sh = [...shared(at, bt, ENTITY_N)].filter((x) => !hasFunc(x))
  if (sh.length) return { ok: true, why: '相同实体：' + sh.sort().slice(0, 3).join('、') }

  // ② a pronoun in the head of the second paragraph
  const head = bt.slice(0, PRON_HEAD)
  const pr = PRON.filter((w) => head.includes(w))
  if (pr.length) return { ok: true, why: '段首指代：' + pr[0] }

  // ③ a connective near the start
  const cn = connectIn(bt)
  if (cn.length) return { ok: true, why: '承接词：' + cn[0] }

  // ④ an explicit time jump
  const tj = TIME_JUMP.filter((w) => bt.slice(0, TIME_HEAD).includes(w))
  if (tj.length) return { ok: true, why: '时间跳跃：' + tj[0] }

  return { ok: false, why: '' }
}

/** Consecutive runs of non-joined paragraphs, at least two long. */
function findGroups(rows) {
  const pairs = []
  for (let i = 0; i + 1 < rows.length; i += 1) {
    const s = serial(rows[i], rows[i + 1])
    pairs.push({ a: rows[i].para, b: rows[i + 1].para, serial: s.ok, why: s.why })
  }
  const groups = []
  let cur = []
  for (let i = 0; i < pairs.length; i += 1) {
    if (!pairs[i].serial) {
      if (!cur.length) cur = [rows[i].para]
      cur.push(rows[i + 1].para)
    } else {
      if (cur.length >= 2) groups.push(cur)
      cur = []
    }
  }
  if (cur.length >= 2) groups.push(cur)
  return { pairs, groups }
}

/** Do all paragraphs in a group share one element? Coverage must be 100%. */
function parallelCheck(rows, group) {
  const byPara = new Map(rows.map((r) => [r.para, String(r.text ?? '')]))
  const texts = group.map((p) => byPara.get(p) ?? '')
  const n = texts.length
  const cnt = new Map()
  for (const t of texts) {
    for (const g of ngrams(t, 2)) {
      if (isAllFunc(g)) continue
      cnt.set(g, (cnt.get(g) ?? 0) + 1)
    }
  }
  if (!cnt.size) return { ok: false, top: null, cover: 0, n }
  let top = null
  let best = 0
  for (const [g, c] of cnt) if (c > best) { best = c; top = g }
  const full = [...cnt.entries()].find(([, c]) => c === n)
  if (full) return { ok: true, top: full[0], cover: n, n }
  return { ok: false, top, cover: best, n }
}

/** @param {{para:number,text:string}[]} rows */
export function score(rows) {
  const list = (rows ?? []).filter((r) => String(r.text ?? '').trim())
  if (list.length < 2) return { unmeasured: '少于两段，判不了衔接' }

  const { pairs, groups } = findGroups(list)
  if (pairs.length < MIN_PAIRS) {
    return { unmeasured: `相邻段只有 ${pairs.length} 对，样本太少判不了` }
  }

  const ok = pairs.filter((p) => p.serial).length

  // Groups that do not share one element go to the review list; the pairs they
  // cover come out of the denominator, because the tool cannot judge them.
  //
  // It must be *pairs*, not groups. A group of n paragraphs covers n-1 adjacent
  // pairs, so subtracting one per group over-counts the denominator whenever a
  // group is longer than two paragraphs — and a short piece is exactly where
  // groups are long. Six paragraphs with two review groups (4 and 2 long) cover
  // four pairs, not two; subtracting two turned 1/1 into 1/3.
  const review = []
  for (const g of groups) {
    const r = parallelCheck(list, g)
    if (!r.ok) review.push({ from: g[0], to: g[g.length - 1], top: r.top, cover: r.cover, n: r.n })
  }

  const reviewedPairs = review.reduce((a, g) => a + Math.max(g.n - 1, 0), 0)
  const judged = Math.max(pairs.length - reviewedPairs, 0)
  const rate = judged ? ok / judged : 0

  const hints = []
  for (const r of review) {
    hints.push(
      `段${r.from}–${r.to} 这 ${r.n} 段之间找不到直接关联，` +
        `最高覆盖要素「${r.top ?? '无'}」只覆盖 ${r.cover}/${r.n} 段——` +
        '这组是否共用一套逻辑，要你看',
    )
  }

  // Everything was unjudgeable: report that rather than dividing by zero.
  if (!judged) {
    return {
      unmeasured:
        `相邻 ${pairs.length} 对全部落在需要人看的组里，没有一对能自动判——这条判据对这篇不可靠`,
      rate: 0,
      pairs: pairs.length,
      review,
    }
  }

  // Below the floor the tool is blind, not the article broken.
  if (rate < MIN_RATE) {
    return {
      unmeasured:
        `可数信号只覆盖了 ${Math.round(rate * 100)}% 的相邻段，` +
        '剩下的是工具看不见的逻辑关联，这条判据对这篇不可靠',
      rate,
      pairs: pairs.length,
      review,
    }
  }

  const kinds = new Set()
  for (const p of pairs) {
    if (!p.serial) continue
    const k = String(p.why ?? '').split('：')[0].trim()
    if (k) kinds.add(k)
  }

  return {
    baseRate: rate,
    metrics: { link_kind_quality: Math.min(kinds.size / W_KINDS, 1) },
    rate,
    full: FULL_SCORE,
    pairs: pairs.length,
    ok,
    judged,
    review,
    kinds: [...kinds],
    hints,
    detail: `串联 ${ok}/${judged} 对（${Math.round(rate * 100)}%），` +
      `待核查 ${review.length} 组，用了 ${kinds.size} 种接法`,
  }
}
