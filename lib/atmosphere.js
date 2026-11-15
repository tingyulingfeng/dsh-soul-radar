/**
 * Atmosphere — how the reader's interest actually moves.
 *
 * Port of `p2_score.py`. Five sub-items, and they answer five different
 * questions. Getting them confused is the easy mistake:
 *
 *   1-1 落差    how far does interest travel at all
 *   1-2 节奏    how often, how evenly, and with how much amplitude
 *   1-3 连贯    are the big swings carried, or do they just happen
 *   1-4 丰富    how many different kinds of paragraph function are in play
 *   1-5 配比    is there padding before the big drops
 *
 * Two details in the original are easy to lose:
 *
 *   The paragraph denominator is the *merged* count, not the raw one. A short
 *   paragraph that starts with a connective and ends in a full stop is usually
 *   a split paragraph, and counting it inflates "changes per paragraph".
 *
 *   Amplitude guards the rhythm score. Eighty small three-grade wobbles are
 *   fidgeting, not turning points, so the completion is scaled by how much the
 *   height sequence actually moves.
 */

const FULL = { '1-1': 9.0, '1-2': 9.0, '1-3': 8.1, '1-4': 6.55, '1-5': 8.1 }

const D_MAX_FULL = 6
const BIG_TH = 4
const BIG_FULL = 3
const W_MAX = 0.5
const W_BIG = 0.5

const CV_BEST = [0.6, 1.2]
const CV_ZERO = [0.15, 1.8]
const DEN_BEST = [0.15, 0.35]
const DEN_ZERO = [0.05, 0.6]
const W_CV = 0.6
const W_DEN = 0.4

const JUMP_TH = 4
const JUMP_SPAN = 1
// An uncarried jump is a local defect, so this item reads its *density*, not its
// head count: when `COH_ZERO_RATE` of paragraphs are uncarried jumps, 1-3 is
// done. The number is calibrated on the 88-paragraph reference piece — 8 jumps
// there used to zero 8.1 points at 1 point each, so 8/88 is where this item was
// always meant to hit zero.
//
// A count punished two pieces differently for the same disease: 2 jumps in 88
// paragraphs cost a fifth of the item, while the same 2.3% density in a
// 1091-paragraph piece (28 jumps) wiped it out. Same defect, two verdicts.
const COH_ZERO_RATE = 8 / 88

const PAD_OK = [0.6, 2.0]
const PAD_WINDOW = 3
const PAD_FUNCS = ['交代', '铺垫', '蓄势', '安抚', '回收']
const CARRIER_FUNCS = ['转折', '释放', '留白', '安抚', '回收']

// A short paragraph starting with one of these and ending in a full stop is
// almost always the tail of the paragraph above it.
const CARRY = ['只不过', '不过', '然而', '但是', '但', '而', '于是', '所以', '因此',
  '因为', '只是', '可', '至于', '也就是说', '换句话说']
const MIN_CHARS = 15
const ENDS = '。！？'

const between = (x, [lo, hi]) => x >= lo && x <= hi

/**
 * 1-3 连贯 completion: uncarried jumps per paragraph, not a head count.
 *
 * Exported because the calibration is a judgement call that deserves its own
 * test: the same density has to cost the same at any length.
 */
export function coherenceRate(badCount, paraCount) {
  const n = Number(paraCount) || 0
  if (!n) return 1
  return Math.max(0, 1 - (Number(badCount) / n) / COH_ZERO_RATE)
}

function ramp(x, best, zero) {
  if (between(x, best)) return 1
  if (x < best[0]) {
    return Math.max(0, (x - zero[0]) / (best[0] - zero[0]))
  }
  return Math.max(0, (zero[1] - x) / (zero[1] - best[1]))
}

/**
 * Peaks and troughs, with a threshold.
 *
 * A trend machine, not a pairwise scan. Only a reversal of at least 	h
 * grades from the last extreme confirms a turning point; without that filter
 * every ±1 wobble counts as a turn and 33 paragraphs produce 15 "turns" — that
 * is noise, not a roller coaster.
 *
 * 	h is in grades, and the scale spans 6 (-3..+3), so th=2 is about a third
 * of the range.
 *
 * The reset after a turn is load-bearing: both trackers must be set to the
 * current point, or the next extreme is measured against a stale value and
 * lands in the wrong place.
 */
export function zigzag(pos, th = 2) {
  const n = pos.length
  if (n < 2) return []
  const out = []
  let hiI = 0
  let hiV = pos[0]
  let loI = 0
  let loV = pos[0]
  let trend = 0 // 0 undecided / 1 rising / -1 falling
  for (let j = 1; j < n; j += 1) {
    const v = pos[j]
    if (trend >= 0 && v > hiV) { hiI = j; hiV = v }
    if (trend <= 0 && v < loV) { loI = j; loV = v }
    if (trend === 0) {
      if (hiV - loV >= th) {
        if (hiI > loI) {
          out.push([loI, loV, '谷'])
          trend = 1
          loI = hiI; loV = hiV
          hiI = j; hiV = v
        } else {
          out.push([hiI, hiV, '峰'])
          trend = -1
          hiI = loI; hiV = loV
          loI = j; loV = v
        }
      }
    } else if (trend === 1) {
      if (hiV - v >= th) {
        out.push([hiI, hiV, '峰'])
        trend = -1
        hiI = j; hiV = v
        loI = j; loV = v
      }
    } else if (v - loV >= th) {
      out.push([loI, loV, '谷'])
      trend = 1
      hiI = j; hiV = v
      loI = j; loV = v
    }
  }
  const last = trend >= 0 ? [hiI, hiV, '峰'] : [loI, loV, '谷']
  if (!out.length || out[out.length - 1][0] !== last[0]) out.push(last)
  return out
}

/** Would this short paragraph merge back into the one above it? */
function shouldMerge(rows, i) {
  const text = String(rows[i].text ?? '').trim()
  if (text.length >= MIN_CHARS) return false
  if (i === 0) return false
  const carry = CARRY.find((c) => text.startsWith(c))
  const complete = text.length > 0 && ENDS.includes(text[text.length - 1])
  return Boolean(carry && complete)
}

/** Merged paragraph count — used only as a denominator. */
function mergedCount(rows) {
  let merges = 0
  for (let i = 0; i < rows.length; i += 1) if (shouldMerge(rows, i)) merges += 1
  return rows.length - merges
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function pstdev(xs) {
  if (!xs.length) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

/**
 * @param {object[]} rows P1 annotation with text
 * @returns {{items:object, metrics:object, hits:Array, hints:Array, detail:string}|{unmeasured:string}}
 */
export function score(rows) {
  const list = (rows ?? []).filter((r) => r)

  // Distinguish "nobody annotated it" from "annotated, but too short". Saying
  // "只有 0 段" to someone who pasted six paragraphs reads as a broken tool,
  // and points at the wrong thing: the article is fine, the annotation is absent.
  if (!list.length) {
    return {
      unmeasured: '氛围需要段落标注（每段的功能和方向）——没有标注时算不出起伏',
    }
  }
  if (list.length < 4) {
    return { unmeasured: `只有 ${list.length} 段，判不了氛围` }
  }

  const n = list.length
  const pos = list.map((r) => Number(r.direction ?? 0) * Number(r.strength ?? 0))
  const ex = zigzag(pos, 2)

  // ── drops between consecutive extremes ──
  const drops = []
  for (let i = 0; i + 1 < ex.length; i += 1) {
    const [i1, v1] = ex[i]
    const [i2, v2] = ex[i + 1]
    drops.push({
      from: Number(list[i1].para),
      to: Number(list[i2].para),
      v1,
      v2,
      drop: Math.abs(v2 - v1),
      span: Number(list[i2].para) - Number(list[i1].para),
    })
  }
  const dvals = drops.map((d) => d.drop)
  const dMax = dvals.length ? Math.max(...dvals) : 0
  const dBig = dvals.filter((v) => v >= BIG_TH).length

  // ── 1-1 落差 ──
  const a11 = Math.min(dMax / D_MAX_FULL, 1)
  const b11 = Math.min(dBig / BIG_FULL, 1)
  const rate11 = W_MAX * a11 + W_BIG * b11

  // ── rhythm ──
  const gaps = drops.map((d) => d.span)
  const nTurn = ex.length
  const nEff = mergedCount(list)
  const density = nEff ? nTurn / nEff : 0
  const cv = gaps.length >= 2 && mean(gaps) > 0 ? pstdev(gaps) / mean(gaps) : 0

  const ampRaw = (() => {
    const d = []
    for (let i = 0; i + 1 < pos.length; i += 1) d.push(Math.abs(pos[i + 1] - pos[i]))
    return d.length ? mean(d) / 3.0 : 0
  })()
  const ampC = Math.min(ampRaw / 0.5, 1)

  const ra = ramp(cv, CV_BEST, CV_ZERO)
  const rb = ramp(density, DEN_BEST, DEN_ZERO)
  const rate12 = (W_CV * ra + W_DEN * rb) * (0.6 + 0.4 * ampC)

  // ── 1-3 连贯：an uncarried jump ──
  const jumps = []
  for (const d of drops) {
    if (d.drop >= JUMP_TH && d.span <= JUMP_SPAN) {
      const tgt = list.find((r) => Number(r.para) === d.to)
      jumps.push({ ...d, carrier: Boolean(tgt && CARRIER_FUNCS.includes(tgt.function)) })
    }
  }
  const bad = jumps.filter((j) => !j.carrier)
  const rate13 = coherenceRate(bad.length, nEff)

  // ── 断层：同一件事，1-5 已经扣过，这里只报 ──
  const hints = []
  const hits = []
  for (const d of drops) {
    if (d.drop < BIG_TH || d.span < 3) continue
    const tgt = list.find((r) => Number(r.para) === d.to)
    if (!tgt || tgt.function !== '转折') continue
    const lo = Math.max(0, d.from - 1)
    const hi = Math.max(lo, d.to - 1)
    const mid = []
    for (let k = lo; k < hi && k < pos.length; k += 1) mid.push(pos[k])
    if (mid.length < 2) continue
    const dir = d.v2 < d.v1 ? -1 : 1
    let moved = false
    for (let k = 0; k + 1 < mid.length; k += 1) {
      if ((mid[k + 1] - mid[k]) * dir >= 1) moved = true
    }
    if (!moved) {
      const text = `铺垫断层 段${d.from}→${d.to}：中间几段高度原地没动，读者情绪跟不上`
      hints.push(text)
      hits.push({ para: d.from, text })
    }
  }

  // ── 1-4 丰富：normalised entropy over paragraph functions ──
  const cnt = {}
  for (const r of list) cnt[r.function] = (cnt[r.function] ?? 0) + 1
  let H = 0
  for (const v of Object.values(cnt)) {
    const p = v / n
    H -= p * Math.log(p)
  }
  const kinds = Object.keys(cnt).length
  const entropy = kinds > 1 ? H / Math.log(kinds) : 0
  const rate14 = entropy

  // ── 1-5 配比：padding before a big drop ──
  const bigDrops = drops.filter((d) => d.drop >= BIG_TH)
  const prepCount = (d) => {
    const hi = Math.max(0, d.to - 1)
    const lo = Math.max(0, hi - PAD_WINDOW)
    let c = 0
    for (let k = lo; k < hi && k < list.length; k += 1) {
      if (PAD_FUNCS.includes(list[k].function)) c += 1
    }
    return c
  }
  const prepScore = (c) => (c >= 2 ? 1 : c === 1 ? 0.75 : 0)
  const prep = bigDrops.map((d) => prepCount(d))
  let rate15 = prep.length ? mean(prep.map(prepScore)) : 1

  // Padding can be too sparse *or* too dense. Two paragraphs before a drop is
  // natural; three means the reader was walked there step by step and never got
  // to move. That is a defect, so it discounts the 配比 score rather than
  // earning extra credit — the author's rule is that extra credit measures
  // excellence, and a flaw is not the absence of excellence.
  const nat = bigDrops.map((d) => {
    const c = prepCount(d)
    if (c <= 0) return 0
    return c === 2 ? 1 : 0.5
  })
  const natRate = nat.length ? mean(nat) : 0
  if (natRate < 1) {
    const pen = (1 - natRate) * 0.5
    rate15 *= 1 - pen
    for (const d of bigDrops) {
      if (prepCount(d) >= 3) {
        const text =
          `段${d.to} 前面 3 段全是铺垫，密到不自然——抽掉一段，让读者自己走一步`
        hints.push(text)
        hits.push({ para: d.to, text })
      }
    }
  }

  // ── add-side metrics ──
  const supply = rate15
  const rhythmBonus = Math.min(ampRaw / 0.5, 1) * (0.5 + 0.5 * Math.max(0, Math.min(1, supply)))

  // Carrier variety: how many kinds of paragraph function have caught a sharp
  // fall. If there is no sharp fall to judge, this is not a zero — it is "no
  // evidence either way", so it stays at 1 (neither rewarded nor punished).
  const caught = drops
    .filter((d) => d.v2 < d.v1 && d.drop >= 3 && d.span <= 2)
    .map((d) => {
      const tgt = list.find((r) => Number(r.para) === d.to)
      const override = tgt?.carrier
      if (override !== undefined && override !== null) {
        return { ok: Boolean(override), func: tgt?.function ?? '?' }
      }
      return { ok: Boolean(tgt && CARRIER_FUNCS.includes(tgt.function)), func: tgt?.function ?? '?' }
    })
  let carrierQuality
  const caughtKinds = new Set(caught.filter((c) => c.ok).map((c) => c.func))
  if (caughtKinds.size) {
    carrierQuality = Math.min(caughtKinds.size / 3, 1)
  } else {
    const dow = new Set(
      drops.filter((d) => d.v2 < d.v1 && d.drop >= 3)
        .map((d) => list.find((r) => Number(r.para) === d.to))
        .filter((t) => t && CARRIER_FUNCS.includes(t.function))
        .map((t) => t.function),
    )
    carrierQuality = dow.size ? Math.min(dow.size / 3, 1) : 1.0
  }

  for (const d of drops) {
    const r0 = d.span / (d.drop || 999)
    if (d.drop >= BIG_TH && !between(r0, PAD_OK)) {
      hits.push({
        para: d.from,
        text: `段${d.from}→${d.to} 落差 ${d.drop} 级只跨 ${d.span} 段，跌得太陡`,
      })
    }
  }

  return {
    items: {
      '1-1': { baseRate: rate11, metrics: { d_max: dMax } },
      '1-2': { baseRate: rate12, metrics: { rhythm_bonus: rhythmBonus } },
      '1-3': { baseRate: rate13, metrics: { carrier_quality: carrierQuality } },
      '1-4': { baseRate: rate14, metrics: { func_kinds: kinds } },
      '1-5': { baseRate: rate15, metrics: {} },
    },
    metrics: {
      d_max: dMax,
      rhythm_amp: ampRaw,
      rhythm_supply: supply,
      rhythm_bonus: rhythmBonus,
      carrier_quality: carrierQuality,
      func_kinds: kinds,
    },
    counts: { n, nEff, turns: nTurn, drops: drops.length, big: bigDrops.length,
      badJumps: bad.length, entropy },
    hits,
    hints,
    detail: `${n} 段（合并后 ${nEff}）、${nTurn} 个拐点；` +
      `最大落差 ${dMax} 级、大落差 ${dBig} 个；` +
      `无载体跳变 ${bad.length} 处（${(nEff ? (bad.length / nEff) * 100 : 0).toFixed(1)}%）；` +
      `功能熵 ${entropy.toFixed(2)}` +
      // 28 段里 9 个拐点就定 30 分——单个段位的 ±1 就能动一两分（2026-11-14 实测）。
      (n < 40 ? '；**样本小（<40 段）**，单段档位的变化就能动一两分，别拿这个数做精确定位' : ''),
  }
}
