/**
 * Foreshadowing — a planted cause or effect, and whether it gets collected.
 *
 * Port of `p3_score_v2.py`. The whole judgement rests on one idea from the
 * source material: the *plant* is the first paragraph where the cause or the
 * effect appears, and the *resolution* is the last one. Everything else is
 * derived from that span.
 *
 * A short span is judged on its effect (can the reader work backwards from it);
 * a long span on its cause plus how many layers of setup sit in between.
 *
 * Only the best few count toward the score, but **every** span is checked and
 * any problem is reported — the author's explicit instruction.
 */

const TH = {
  maxShort: 2,
  maxLong: 1,
  longRatio: 0.4,
  minLongSpan: 3,
  innerMin: 0.7,
  innerFull: 0.85,
  wInner: 6,
}
const FULL = 4
const PREP_QUALITY = 0.6 // a cause or effect below this is "weak"

const paras = (x) => {
  if (x == null) return []
  if (typeof x === 'number') return [x]
  if (Array.isArray(x)) return x.flatMap(paras)
  if (typeof x === 'object') return paras(x.paras)
  return []
}

/** Normalise one annotation row into the shape the scoring needs. */
function read(r) {
  let cause = paras(r.cause_paras)
  let effect = paras(r.effect_paras)
  if (!cause.length && !effect.length) {
    // legacy shape: plant / resolve
    if (r.plant != null) cause = [Number(r.plant)]
    if (r.resolve != null) effect = [Number(r.resolve)]
  }
  const all = [...new Set([...cause, ...effect])].sort((a, b) => a - b)
  return {
    id: r.id ?? '',
    cause,
    effect,
    plant: all.length ? all[0] : null,
    resolve: all.length ? all[all.length - 1] : null,
    span: all.length >= 2 ? all[all.length - 1] - all[0] : 0,
    causeQ: r.cause_quality ?? null,
    effectQ: r.effect_quality ?? null,
    setupLayers: r.setup_layers ?? null,
    combined: r.combined ?? null,
  }
}

/** @returns {{quality:number, notes:string[], bad:boolean}} */
function judge(x) {
  const notes = []
  let q
  if (x.isLong) {
    q = x.causeQ ?? 0.5
    if (x.causeQ == null) notes.push('因的质量没标')
    else if (x.causeQ < PREP_QUALITY) notes.push('因太弱')
    if (x.setupLayers == null) notes.push('铺垫层数没标')
    else if (x.setupLayers < 2) notes.push(`期间铺垫只有 ${x.setupLayers} 层，太疏`)
  } else {
    q = x.effectQ ?? 0.5
    if (x.effectQ == null) notes.push('果的质量没标')
    else if (x.effectQ < PREP_QUALITY) notes.push('果不够具体，读者难从果倒推因')
  }
  return { quality: q, notes, bad: notes.length > 0 }
}

/**
 * @param {object[]} rows          foreshadowing annotations
 * @param {number}   totalParas    paragraph count, for the long/short split
 */
export function score(rows, totalParas = 0) {
  const items = (rows ?? []).map(read).filter((x) => x.plant != null)
  if (!items.length) return { unmeasured: '标注里没有可用的挖坑/填坑段号' }

  const threshold = totalParas
    ? Math.max(TH.minLongSpan, Math.round(totalParas * TH.longRatio))
    : TH.minLongSpan
  for (const x of items) x.isLong = x.span >= threshold

  const shorts = items.filter((x) => !x.isLong)
  const longs = items.filter((x) => x.isLong)

  const hits = []
  const hints = []
  for (const x of items) {
    const j = judge(x)
    if (j.bad) {
      const text = `${x.isLong ? '长' : '短'}伏笔 段${x.plant}→${x.resolve}：${j.notes.join('；')}`
      hints.push(text)
      hits.push({ para: x.plant, text })
    }
  }

  const pick = (pool, k) =>
    [...pool].sort((a, b) => judge(b).quality - judge(a).quality).slice(0, k)
  const used = [...pick(shorts, TH.maxShort), ...pick(longs, TH.maxLong)]
  const usedIds = new Set(used.map((x) => `${x.plant}-${x.resolve}`))
  const rate = used.length
    ? used.reduce((a, x) => a + judge(x).quality, 0) / used.length
    : 0

  const dropped = items.filter((x) => !usedIds.has(`${x.plant}-${x.resolve}`)).length

  // Extra credit: the long span's "outer shown, inner hidden" balance, judged
  // by the annotator. Never derived from cause/effect quality — that half is
  // already scored above, and double-counting was an explicit no.
  let inner = null
  if (longs.length) {
    const best = [...longs].sort(
      (a, b) => (b.combined ?? -1) - (a.combined ?? -1),
    )[0]
    if (best.combined != null) {
      const c = Number(best.combined)
      const pt = c >= TH.innerFull ? TH.wInner : c >= TH.innerMin ? TH.wInner / 2 : 0
      inner = { para: best.plant, combined: c, got: pt, full: TH.wInner }
      if (c < TH.innerMin) {
        hints.push(
          `长伏笔 段${best.plant}→${best.resolve} 的外显/内敛结合只有 ${c.toFixed(2)}，` +
            '既没让读者能倒推，也没藏到值得挖',
        )
      }
    }
  }

  return {
    baseRate: rate,
    metrics: {},
    rate,
    threshold,
    counts: { total: items.length, shorts: shorts.length, longs: longs.length, used: used.length, dropped },
    inner,
    hits,
    hints,
    detail: `${items.length} 条伏笔（短 ${shorts.length} / 长 ${longs.length}），` +
      `计入 ${used.length} 条`,
  }
}
