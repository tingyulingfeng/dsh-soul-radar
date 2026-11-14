/**
 * Shared core: text utilities, the rule table, and the two global coefficients.
 *
 * Everything here is a faithful port of the Python modules this plugin grew out
 * of. The behaviour is pinned by `test/core.test.js`; if a port changes a
 * number, that test is the place to notice.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

// ─────────────────────────────────────────────────────────────
// Tolerant reader: a JSONL file, a pretty-printed stream, or a JSON array.
// Hand-written annotations are not always one object per line, and refusing
// them would be a worse failure than accepting both.
// ─────────────────────────────────────────────────────────────
export function loadStream(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '')
  const out = []
  let i = 0
  const n = text.length
  while (i < n) {
    while (i < n && ' \t\r\n,'.includes(text[i])) i += 1
    if (i >= n) break
    // Let JSON.parse find the object's extent by trying progressively longer
    // slices would be quadratic; instead bracket-match on the raw text.
    const start = text[i]
    if (start !== '{' && start !== '[') {
      // skip a stray scalar
      const m = /^[^,{}\[\]]+/.exec(text.slice(i))
      i += m ? m[0].length : 1
      continue
    }
    const close = start === '{' ? '}' : ']'
    let depth = 0
    let inStr = false
    let esc = false
    let j = i
    for (; j < n; j += 1) {
      const c = text[j]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === start) depth += 1
      else if (c === close) {
        depth -= 1
        if (depth === 0) {
          j += 1
          break
        }
      }
    }
    try {
      out.push(JSON.parse(text.slice(i, j)))
    } catch {
      /* skip an unparsable chunk rather than failing the whole file */
    }
    i = j
  }
  return out
}

export function readStream(path) {
  return loadStream(readFileSync(path, 'utf8'))
}

/** Split on sentence-final punctuation. Mirrors the Python `sentences()`. */
export function sentences(text) {
  return String(text ?? '')
    .split(/[。！？…；]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function clamp(x, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, x))
}

// ─────────────────────────────────────────────────────────────
// The rule table — the single source of truth for every criterion.
// ─────────────────────────────────────────────────────────────
let _rules = null

export function rules() {
  if (!_rules) {
    _rules = JSON.parse(readFileSync(join(HERE, 'rules.json'), 'utf8'))
  }
  return _rules
}

/**
 * The 描写判法 table: for each channel a description can travel through, how it
 * is judged.
 *
 * Two kinds, and they are not interchangeable:
 *
 *   台阶  has an order — 拟声词 → 直接互动 → 细节+比喻. Reaching a higher step
 *         is doing better, so the add side may read "how high did this get".
 *   菜单  has no order — 颜色 / 光影 / 主观感受 sit side by side. Using two is
 *         not "better" than using one, so the add side must never read a level
 *         here, and `level` on a menu channel is an error rather than a guess.
 *
 * The author gave 声音 / 视觉 / 心理 / 音乐. 景 / 物 / 人 / 事 / 环境 are objects,
 * not channels, and he has not given judgements for them yet — so they are not
 * in this table and an unmarked carrier simply keeps the old reading.
 */
export function descMeasures() {
  return rules().desc_measures ?? { channels: {}, thresholds: {} }
}

/** Every rule node that carries an `id` and a `kind`, with its owning item. */
export function allRules() {
  const out = []
  const walk = (node, item) => {
    if (Array.isArray(node)) {
      for (const x of node) walk(x, item)
      return
    }
    if (!node || typeof node !== 'object') return
    if (typeof node.id === 'string' && typeof node.kind === 'string') {
      out.push({ item, rule: node })
      return
    }
    for (const [k, v] of Object.entries(node)) {
      // Metadata keys carry no rules; everything else is walked. `rules` must
      // NOT be skipped — that is where the rule list lives.
      if (k === 'label' || k === 'cap' || k === 'thresholds' || k === 'kind_note' || k === '_budget' || k === '_note') continue
      walk(v, item ?? k)
    }
  }
  walk(rules(), null)
  return out
}

export function rule(id) {
  return allRules().find((x) => x.rule.id === id)?.rule ?? null
}

/** Thresholds for a rule id, or for a scoring item when the id names one. */
export function thresholds(id) {
  const r = rule(id)
  if (r) return r.thresholds ?? {}
  const item = rules()[id]
  return item?.thresholds ?? {}
}

export function itemCap(item) {
  const node = rules()[item]
  if (!node) return null
  return node.cap ?? node.deduct_full ?? null
}

export function summary() {
  const list = allRules().map((x) => x.rule)
  const count = (s) => list.filter((r) => r.status === s).length
  const side = (s) => list.filter((r) => r.side === s).length
  return {
    total: list.length,
    byStatus: {
      final: count('定稿'),
      review: count('待核'),
      todo: count('待建'),
      test: count('待测'),
      overturned: count('已推翻'),
    },
    bySide: { score: side('score'), bonus: side('bonus') },
    enabled: list.filter((r) => r.enabled).length,
    disabled: list.filter((r) => !r.enabled).length,
  }
}

// ─────────────────────────────────────────────────────────────
// The global curve.
//
// Deduct side is convex: a big miss is punished harder than a small one.
// Add side is `x ** ADD_POW`, which reaches 1 only at x = 1 — an earlier
// version saturated at x = 0.79 and made every good score indistinguishable.
// ─────────────────────────────────────────────────────────────
export const GRAVITY = 1.6
export const ADD_POW = 1.6

export function curveDeduct(x) {
  const v = clamp(x)
  return Math.max(v, Math.max(0, 1 - GRAVITY * (1 - v) ** 2))
}

export function curveAdd(x) {
  return clamp(x) ** ADD_POW
}

// ─────────────────────────────────────────────────────────────
// Resonance: a multiplier on every scored item.
//
// It answers "can the reader follow what the author did", which is not the
// same question as "did the author do it". Both matter, so one is a score and
// the other is a coefficient.
// ─────────────────────────────────────────────────────────────
export const RESONANCE_FLOOR = 0.85
export const RESONANCE_WEIGHT = 0.15

export function resonance(p1Rows) {
  const h = []
  let grad = 0
  let jump = 0
  if (!p1Rows || p1Rows.length < 2) {
    // No annotation means the question was never asked — not that the answer is
    // perfect. `measured: false` lets the report say "not discounted" instead of
    // printing C=1.00 next to "维度 0 类", which read as a perfect score.
    return {
      C: 1, P: 1, D: 1, B: 1, grad: 0, jump: 0, kinds: 0, factor: 1,
      measured: false,
      why: p1Rows?.length ? '段落标注不足两行' : '没有段落标注',
    }
  }
  for (const r of p1Rows) {
    h.push(Number(r.direction ?? 0) * Number(r.strength ?? 0))
  }
  // 单句成段是一种拍子，不是读者跟不上。前一段刚「释放/留白」，这一句独立成段收住，
  // 哪怕情绪档位一下掉了 2 级以上，也算渐变（作者 2026-11-14 实测：散文的留白被当成跳变，
  // 把「过程」压到 0.44）。没有正文时判不了，照旧按跳变算。
  const BEAT_AFTER = ['释放', '留白']
  const isBeat = (r) => {
    const text = String(r?.text ?? '').trim()
    if (!text) return false
    return text.split(/[。！？…；]+/).filter((s) => s.trim()).length === 1
  }
  for (let i = 0; i + 1 < h.length; i += 1) {
    const d = Math.abs(h[i + 1] - h[i])
    if (d === 1) grad += 1
    else if (d >= 2) {
      const beat = isBeat(p1Rows[i + 1]) && BEAT_AFTER.includes(p1Rows[i]?.function)
      if (beat) grad += 1
      else jump += 1
    }
  }
  const total = grad + jump
  const P = total ? grad / total : 1

  // 作者 2026-11-13 给的描写对象是六类（景/物/人/事/心理/环境）。「无」表示这一段
  // 没有描写对象（纯叙述：对话、时间标记、信息交代），它不参与维度统计——把「没有描写」
  // 当成一种描写维度，会让一篇几乎不描写的文章看起来维度丰富。
  const cnt = {}
  let described = 0
  for (const r of p1Rows) {
    const k = r.dtype || '无'
    if (k === '无') continue
    described += 1
    cnt[k] = (cnt[k] ?? 0) + 1
  }
  const kinds = Object.keys(cnt).length
  const D = Math.min(kinds / 6, 1)

  let maxShare = 0
  for (const v of Object.values(cnt)) maxShare = Math.max(maxShare, v / Math.max(described, 1))
  const B = described ? 1 - maxShare : 0

  const C = 0.5 * P + 0.3 * D + 0.2 * B
  return {
    C,
    P,
    D,
    B,
    grad,
    jump,
    kinds,
    factor: RESONANCE_FLOOR + RESONANCE_WEIGHT * C,
    measured: true,
  }
}

// ─────────────────────────────────────────────────────────────
// Overall reading experience: a second multiplier, on form rather than content.
//
// Three signals, all of them about whether a reader can physically keep going.
// Short paragraphs are deliberately *not* a signal: a one-sentence paragraph is
// a beat, not a stumble. Ported from `lt_experience.py`.
// ─────────────────────────────────────────────────────────────
export const EXPERIENCE_FLOOR = 0.85
export const EXP_MIN_SEG = 3
export const EXP_SEG_CHARS = 150
export const EXP_AVG_BAD = 150
export const EXP_PARA_LONG = 200

export function experience(bodyRows) {
  const lens = (bodyRows ?? [])
    .map((r) => String(r.text ?? ''))
    .filter((t) => t.trim())
    .map((t) => t.length)
  const n = lens.length
  if (n === 0) return { R: 1, why: '正文是空的' }
  const chars = lens.reduce((a, b) => a + b, 0)

  // ① Too few paragraphs — a veto, multiplied rather than averaged in.
  let sSeg
  if (n < EXP_MIN_SEG && chars > EXP_SEG_CHARS) sSeg = 0
  else if (n < EXP_MIN_SEG) sSeg = 0.5
  else sSeg = 1

  // ② Average paragraph length.
  const avg = chars / n
  let sAvg
  if (avg <= EXP_AVG_BAD) sAvg = 1
  else if (avg >= EXP_AVG_BAD * 2) sAvg = 0
  else sAvg = Math.max(0, 1 - (avg - EXP_AVG_BAD) / EXP_AVG_BAD)

  // ③ Paragraphs long enough that they cannot be read in one breath.
  const longCnt = lens.filter((L) => L > EXP_PARA_LONG).length
  const longR = longCnt / n
  let sLong
  if (longCnt === 0) sLong = 1
  else if (longR >= 0.3) sLong = 0
  else sLong = Math.max(0, 1 - longR / 0.3)

  const E = (sSeg * (sAvg + sLong)) / 2
  return {
    R: EXPERIENCE_FLOOR + (1 - EXPERIENCE_FLOOR) * E,
    E,
    n,
    chars,
    avg,
    longest: Math.max(...lens),
    longCnt,
    sSeg,
    sAvg,
    sLong,
  }
}
