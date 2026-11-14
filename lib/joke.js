/**
 * Jokes — 笑料与梗.
 *
 * Port of `p10_joke.py`. Small item (2 points) but three distinct questions:
 *
 *   密度    how many laughs per thousand characters
 *   位置    does a laugh sit after at least two paragraphs of buildup
 *   新鲜度  are the memes evergreen, or already stale
 *
 * A "joke" is not simply a release-upward paragraph — that reading caught
 * ordinary exclamations and rhetorical peaks. It also needs a reveal, or the
 * author marking it, or the self-deprecating shape (「后来我才知道…谁都…」).
 */

const FULL = 2.0
const F_DENS = 0.8
const F_POS = 0.8
const F_FRESH = 0.4
const PEN_OLD = 0.5
const MANUAL_WEIGHT = 0.5

// A release-upward paragraph still needs one of these to count as a joke.
const REVEAL = [
  '原来', '竟然', '居然', '其实', '谁知道', '没想到', '当然是因为',
  '才不是', '哪知道', '结果是', '偏偏',
]

// The author's 2026-11-07 note: a protagonist who overestimates their own
// standing is a joke even without a reveal.
const SELF_DEPRECATE = [
  '后来我才知道', '后来才知道', '我才知道', '我还以为',
  '自作多情', '原来她对', '原来他', '谁都', '每个',
  '逢人', '对所有人', '并不是我',
]

/** How many paragraphs immediately before `i` point the same way. */
function buildup(rows, i) {
  let k = i - 1
  let layer = 0
  while (k >= 0 && Number(rows[k].direction) === 1) {
    layer += 1
    k -= 1
  }
  return layer
}

/**
 * @param {object[]} rows        P1 annotation, each with text
 * @param {object}   [memes]     meme → {status, kind}
 * @param {number}   [bodyChars] character count from the body, if the caller has it
 */
export function score(rows, memes = {}, bodyChars = 0) {
  const list = rows ?? []

  // Finding a joke needs the paragraph annotation: the function (释放) and the
  // direction (+1) are what separate a laugh from an ordinary rhetorical peak.
  // Without it the honest answer is "not measured", not a zero — a zero would
  // read as "this piece has no jokes", which is a different claim.
  if (!list.length) {
    return {
      unmeasured: '笑料需要段落标注（每段的功能和方向）——没有标注时数不出笑点',
    }
  }

  const chars = list.reduce((a, r) => a + String(r.text ?? '').length, 0) || bodyChars
  if (!chars) return { unmeasured: '标注里没有段落文字，数不出字数' }

  // ── which paragraphs are jokes ──
  const jokes = []
  const hints = []
  const hits = []
  for (let i = 0; i < list.length; i += 1) {
    const r = list[i]
    const t = String(r.text ?? '')
    const isReleaseUp =
      r.function === '释放' && Number(r.direction) === 1
    if (isReleaseUp && REVEAL.some((w) => t.includes(w))) {
      jokes.push({ row: r, i })
      continue
    }
    // Black humour has no keyword to find — the annotator marks it.
    if (r.joke === true || r.joke === 'true') {
      jokes.push({ row: r, i })
      continue
    }
    if (SELF_DEPRECATE.some((w) => t.includes(w))) jokes.push({ row: r, i })
  }

  // ── memes from the library ──
  const memHits = []
  for (const r of list) {
    const t = String(r.text ?? '')
    for (const [m, info] of Object.entries(memes ?? {})) {
      if (t.includes(m)) {
        memHits.push({ para: r.para, meme: m, status: info.status ?? '?', kind: info.kind ?? '' })
      }
    }
  }

  // ── annotator-supplied jokes (weight halved, must be verified) ──
  const manual = []
  for (const r of list) {
    for (const j of r.joke_manual ?? []) {
      manual.push({ para: r.para, what: j.what ?? '', verified: Boolean(j.verified) })
    }
  }
  for (const m of manual) {
    if (!m.verified) hints.push(`段 ${m.para} 人工输入「${m.what}」没验证，不计分`)
  }

  // ── score ──
  const perK = jokes.length / (chars / 1000)
  const sD = F_DENS * Math.min(perK / 0.8, 1)

  let posOk = 0
  for (const j of jokes) {
    const layer = buildup(list, j.i)
    if (layer >= 2) posOk += 1
    else {
      const text = `段 ${j.row.para} 是笑点，但前面只有 ${layer} 段同向铺垫——笑点落在铺垫之后才响`
      hints.push(text)
      hits.push({ para: Number(j.row.para), text })
    }
  }
  const sP = jokes.length ? F_POS * (posOk / jokes.length) : 0

  const stale = memHits.filter((h) => h.status === '过时')
  for (const s of stale) {
    hints.push(`段 ${s.para} 用了过时的梗「${s.meme}」`)
  }
  let sFresh = Math.max(0, F_FRESH - PEN_OLD * stale.length)
  // No joke at all means the freshness question was never tested — an empty
  // set scoring full marks was a bug the audit caught.
  if (!jokes.length) sFresh = 0

  const verified = manual.filter((m) => m.verified)
  const manualBonus = MANUAL_WEIGHT * (Math.min(verified.length, 2) * 0.5)

  const raw = sD + sP + sFresh + manualBonus
  const total = Math.min(raw, FULL)

  return {
    // The engine sees the two halves separately: density+position are the
    // deduct side, freshness is the add side.
    baseRate: (F_DENS + F_POS) ? (sD + sP) / (F_DENS + F_POS) : 0,
    metrics: { joke_fresh: F_FRESH ? sFresh / F_FRESH : 0 },
    total,
    counts: { jokes: jokes.length, chars, perK, posOk, stale: stale.length, manual: verified.length },
    hits,
    hints,
    detail: `笑点 ${jokes.length} 个（${perK.toFixed(2)} 个/千字），` +
      `${posOk} 个落在铺垫之后，过时梗 ${stale.length} 处`,
  }
}
