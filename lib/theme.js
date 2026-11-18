/**
 * Theme — the line that is never stated.
 *
 * Port of `p8_theme.py`. Honest about what it is: **most of this item is a
 * person's judgement, not a measurement.**
 *
 *   质量分   契合度 × 关联度      both supplied by the annotator
 *   位置分   踩中波动节点的权重    the tool computes this
 *
 * In the 8-point item roughly two thirds is judgement and one third is
 * measurement. The report says so explicitly, because quoting this number as if
 * it were measured would be the most misleading thing this plugin could do.
 *
 * 「交集点」is the shape of the idea: a spot on the surface story that points at
 * the hidden one at the same time. The tool can check *where* those spots land;
 * it cannot check whether the pointer is real.
 */

const FULL = 8.0
const W_QUALITY = 6.0
const W_POSITION = 2.0

// How many unwritten steps the reader is expected to infer, by genre.
const PEAK = { 硬核推理: 4, 推理科幻: 3, 其他: 2 }
const N_LOW = 1
const N_HIGH = 5
const GENRE = '其他'

const REL_DIMS = ['time', 'place', 'person', 'event', 'process', 'item']

/** Amplitude → weight. A full-text swing counts more than a local one. */
function nodeWeight(amp) {
  if (amp >= 5) return { w: 1.0, level: '全文' }
  if (amp >= 3) return { w: 0.6, level: '局部' }
  return { w: 0.3, level: '细节' }
}

/** Peaks and troughs: a reversal of at least `th` grades. */
function zigzag(pos, th = 2) {
  const ex = []
  let up = null
  let down = null
  for (let i = 0; i < pos.length; i += 1) {
    const v = pos[i]
    if (up === null || v > pos[up]) up = i
    if (down === null || v < pos[down]) down = i
    if (up !== null && v < pos[up] - th) {
      ex.push([up, pos[up], '峰'])
      down = i
      up = i
    } else if (down !== null && v > pos[down] + th) {
      ex.push([down, pos[down], '谷'])
      up = i
      down = i
    }
  }
  const seen = new Set()
  const out = []
  for (const e of [...ex].sort((a, b) => a[0] - b[0])) {
    if (seen.has(e[0])) continue
    seen.add(e[0])
    out.push(e)
  }
  return out
}

function targetK(n) {
  const peak = PEAK[GENRE]
  let base
  if (n <= N_LOW) base = peak
  else if (n >= N_HIGH) base = 0
  else base = (peak * (N_HIGH - n)) / (N_HIGH - N_LOW)
  return Math.min(base, n)
}

/** How close the inferred-step count is to the genre's ideal, times tightness. */
function fitScore(it) {
  const n = Number(it.fit_total_steps ?? 0)
  const m = Number(it.fit_written_steps ?? 0)
  const k = Math.max(0, n - m)
  const kstar = targetK(n)
  const tight = it.fit_tight?.length ? it.fit_tight : [1.0]
  const avg = tight.reduce((a, b) => a + Number(b), 0) / tight.length
  // 差一步不算差。暗线本来就要读者「推」，推多一步、推少一步都在可接受的范围里；
  // 原来的靶心窄到一个点，短篇里写得隐（多推）和写得显（全写明）两头都挨罚，
  // 2,600 字的篇目几乎不可能及格——作者 2026-11-14 实测指出（交集点 t1/t2 同时被压到 0.56/0.68）。
  const TOL = 1
  const d = Math.max(0, Math.abs(k - kstar) - TOL)
  const raw = Math.max(0, 1 - (d / PEAK[GENRE]) ** 2)
  return { fit: raw * avg, k, kstar }
}

/** The annotator's six-dimension coverage. */
function relScore(it) {
  const rel = it.rel ?? {}
  const got = REL_DIMS.reduce((a, d) => a + Number(rel[d] ?? 0), 0)
  return got / REL_DIMS.length
}

/**
 * @param {object} decl          theme declaration: core / elements / change / intersections
 * @param {object[]} p1Rows      the paragraph annotation, for the swing nodes
 */
export function score(decl, p1Rows) {
  const its = decl?.intersections ?? []
  if (!its.length) return { unmeasured: '暗线声明里没有交集点（没标，不是没有）' }

  const rows = (p1Rows ?? []).filter((r) => r)
  if (!rows.length) return { unmeasured: '没有段落标注，算不出波动节点' }

  // ── swing nodes ──
  const pos = rows.map((r) => Number(r.direction ?? 0) * Number(r.strength ?? 0))
  const ex = zigzag(pos, 2)
  const nodes = ex.map(([idx, v], i) => {
    const prev = i > 0 ? Math.abs(v - ex[i - 1][1]) : 0
    const next = i + 1 < ex.length ? Math.abs(v - ex[i + 1][1]) : 0
    const amp = Math.max(prev, next)
    const { w, level } = nodeWeight(amp)
    return { para: rows[idx].para, amp, w, level }
  })
  const totW = nodes.reduce((a, x) => a + x.w, 0)

  // ── intersections ──
  let qsum = 0
  const hitNodes = new Set()
  const hints = []
  let posSum = 0

  for (const it of its) {
    const { fit } = fitScore(it)
    const rel = relScore(it)
    qsum += fit * rel
    const p = Number(it.para)
    const nd = nodes.find((x) => Math.abs(x.para - p) <= 1)
    if (nd) {
      hitNodes.add(nd.para)
      posSum += nd.w
    }
  }

  const ideal = 0.75 * its.length
  const qualityRatio = Math.min(qsum / ideal, 1)
  const hitW = nodes.filter((n) => hitNodes.has(n.para)).reduce((a, x) => a + x.w, 0)

  // Position is per intersection, not a share of every swing in the piece.
  //
  // `hitW / totW` divided by a denominator that grows with length while the
  // numerator is capped by how many intersections the author wrote: on the
  // 1091-paragraph test piece, 4 well-placed points scored 1.4%, so the item was
  // measuring the piece's length rather than where the points landed. What was
  // asked for is 「交集点要落在波动节点上」 — so each intersection earns the
  // weight of the swing it landed on (0.3 细节 / 0.6 局部 / 1.0 全文), and
  // missing every swing still earns 0.
  const positionRatio = its.length ? posSum / its.length : 0

  // Deliberately loud: this number is mostly a person's opinion.
  hints.push(
    `暗线 ${FULL} 分里，${W_QUALITY} 分是标注人估的（契合度×关联度），` +
      `只有 ${W_POSITION} 分是工具算的（交集点有没有踩在波动节点上）。` +
      '引用这项分数时请说明这一点，别把它当成测量值。',
  )
  for (const it of its) {
    const { fit, k, kstar } = fitScore(it)
    // `fit` is computed, not estimated: it compares the steps the reader has to
    // infer against an ideal for the length. Calling it "人估契合" was wrong and
    // actively misleading — an annotator who set tight=0.85 read "人估契合 0.00"
    // and thought the tool had discarded their judgement.
    hints.push(
      `交集点 ${it.id ?? '?'}（段${it.para}）：契合 ${fit.toFixed(2)}` +
        `（要脑补 ${k} 步、理想 ${kstar.toFixed(1)} 步，差得越远扣得越狠）` +
        ` × 关联 ${relScore(it).toFixed(2)}（标了 ${Object.values(it.rel ?? {}).filter((v) => Number(v) > 0).length} 个维度 ÷ 6）`,
    )
  }

  return {
    baseRate: qualityRatio,
    metrics: { theme_position_ratio: positionRatio },
    full: FULL,
    nodes: nodes.length,
    totW,
    hitW,
    positionRatio,
    qualityRatio,
    humanRatio: W_QUALITY / FULL,
    hints,
    detail: `交集点 ${its.length} 个，踩中 ${hitNodes.size}/${nodes.length} 个波动节点；` +
      `落点平均权重 ${positionRatio.toFixed(2)}（0.3 细节 / 0.6 局部 / 1.0 全文）`,
  }
}
