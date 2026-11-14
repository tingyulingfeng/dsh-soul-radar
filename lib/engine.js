/**
 * The scoring engine — one item's score from its config and its metrics.
 *
 * Port of `lt_baseline.py`. This layer is the one I missed on the first pass,
 * and missing it is not cosmetic: without it every item is `weight × ratio`,
 * which drops both the convex curve and the resonance discount.
 *
 * Structure, from the source:
 *
 *     item = deduct side + add side
 *     deduct side: starts at full, loses points per problem, then `_curve_dec`
 *     add side:    starts at 0, gains per achievement, then `_curve_add`
 *
 * The two sides must read different metrics — using one number twice was
 * explicitly ruled out.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

export const GRAVITY = 1.6
export const ADD_POW = 1.6
const RESONANCE_FLOOR = 0.85
const RESONANCE_WEIGHT = 0.15

let _scoring = null
export function scoring() {
  if (!_scoring) {
    _scoring = JSON.parse(readFileSync(join(HERE, 'scoring.json'), 'utf8'))
  }
  return _scoring
}

/**
 * One item's config. `itemId` selects a sub-item when the section is grouped
 * (the atmosphere section has five of them).
 */
export function itemCfg(section, itemId) {
  const s = scoring().sections?.[section]
  if (!s || typeof s !== 'object') return null
  if (itemId != null) {
    const sub = s[itemId]
    if (sub && typeof sub === 'object' && 'full' in sub) return sub
  }
  return 'full' in s ? s : null
}

/** Read a metric; a missing value is 0, not an error. */
function metric(metrics, name, dflt = 0) {
  if (!metrics) return dflt
  const v = metrics[name]
  const n = Number(v ?? dflt)
  return Number.isFinite(n) ? n : dflt
}

// ─────────────────────────────────────────────────────────────
// The five add-side judgement kinds.
// ─────────────────────────────────────────────────────────────

/** Reaching a value earns a rate. `steps` runs high to low; first hit wins. */
function addThreshold(rule, metrics) {
  const v = metric(metrics, rule.metric)
  for (const [th, rate] of rule.steps) {
    if (v >= th) return Number(rate)
  }
  return 0
}

/** Inside `best` is full marks; outside falls to `low` / `high`, optionally decaying. */
function addRange(rule, metrics) {
  const v = metric(metrics, rule.metric)
  const [lo, hi] = rule.best
  if (v >= lo && v <= hi) return 1
  let val = v < lo ? (rule.low ?? 0) : (rule.high ?? 0)
  if (rule.decay) {
    const span = rule.span ?? 0.2
    const d = v < lo ? lo - v : v - hi
    val = span ? Math.max(0, 1 - d / span) : 0
  }
  return Number(val)
}

/** Take a 0..1 ratio directly, with an optional cap and a fallback metric. */
function addRatio(rule, metrics) {
  const fb = rule.fallback
  const name = fb && !(rule.metric in (metrics ?? {})) ? fb : rule.metric
  let v = Math.max(0, Math.min(1, metric(metrics, name)))
  if (rule.cap != null) v = Math.min(v, Number(rule.cap))
  return v
}

/** Count of kinds reaching a threshold, looked up in a table. */
function addCountOver(rule, metrics) {
  const v = metric(metrics, rule.metric)
  let best = -1
  for (const [k, rate] of Object.entries(rule.table ?? {})) {
    if (v >= Number(k)) best = Math.max(best, Number(rate))
  }
  return Math.max(0, best)
}

/** Peak-shaped: closest to `best` wins, deviation punished quadratically. */
function addPeakRatio(rule, metrics) {
  const x = metric(metrics, rule.metric)
  const best = Number(rule.best ?? 0.6)
  const width = Number(rule.width ?? 0.5)
  const d = Math.abs(x - best)
  if (!width) return d === 0 ? 1 : 0
  return Math.max(0, 1 - (d / width) ** 2)
}

/** Step counts weighted per step, averaged. */
function addStepWeight(rule, steps) {
  const list = Array.isArray(steps) ? steps : []
  if (!list.length) return 0
  const w = rule.weights ?? {}
  let total = 0
  for (const s of list) total += Number(w[String(Math.trunc(s))] ?? 0)
  return total / list.length
}

/** Add-side strength in 0..1. No rule, or kind `none`, means a pure deduct item. */
export function addRate(rule, metrics, steps) {
  if (!rule) return 0
  const kind = rule.kind ?? 'none'
  if (kind === 'none') return 0
  if (kind === 'step_weight') return addStepWeight(rule, steps)
  const fn = {
    threshold: addThreshold,
    range: addRange,
    ratio: addRatio,
    count_over: addCountOver,
    peak_ratio: addPeakRatio,
  }[kind]
  if (!fn) throw new Error(`未定义的加分判据 kind=${kind}`)
  return Math.max(0, Math.min(1, fn(rule, metrics)))
}

// ─────────────────────────────────────────────────────────────
// The two curves.
// ─────────────────────────────────────────────────────────────

/** Deduct side: convex, but never below linear, so a bad piece still gets credit for what it did. */
export function curveDec(x) {
  const v = Math.max(0, Math.min(1, x))
  return Math.max(v, Math.max(0, 1 - GRAVITY * (1 - v) ** 2))
}

/** Add side: `x^1.6`, reaching 1 only at 1. An earlier capped version killed all discrimination above 0.79. */
export function curveAdd(x) {
  return Math.max(0, Math.min(1, x)) ** ADD_POW
}

/**
 * One item's final score.
 *
 * The resonance discount is applied to the *rate*, before the curve — the
 * author's framing: the author doing the work is real, but a reader who cannot
 * follow it gets a discount, never a zero.
 *
 * @param {object} cfg           item config: deduct_full / add_full / add
 * @param {number} baseRate      deduct-side completion, 0..1
 * @param {object} metrics       for the add-side rule
 * @param {number[]} [steps]     only for kind `step_weight`
 * @param {number} resonanceC    0..1
 */
export function itemScore(cfg, baseRate, metrics, steps, resonanceC) {
  const deductFull = Number(cfg?.deduct_full ?? cfg?.full ?? 0)
  const addFull = Number(cfg?.add_full ?? 0)
  const rate = addRate(cfg?.add, metrics, steps)
  const scale = RESONANCE_FLOOR + RESONANCE_WEIGHT * Math.max(0, Math.min(1, resonanceC))
  const d = curveDec(baseRate * scale)
  const a = curveAdd(rate * scale)
  return {
    score: deductFull * d + addFull * a,
    deduct: deductFull * d,
    add: addFull * a,
    addRate: rate,
    scale,
    deductCurve: d,
    addCurve: a,
  }
}
