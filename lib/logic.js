/**
 * Logic — is the chain of reasoning actually a chain.
 *
 * Port of `p7_logic_v2.py`. The tool cannot read a cause or an effect out of
 * prose; that is a semantic judgement. So this module does not *find* them — it
 * validates what the annotator marked, and refuses to pretend otherwise when
 * the annotation is the old shape.
 *
 * Five things per chain:
 *
 *   因      the reader knows why
 *   果      the reader knows what it leads to
 *   过程    the middle link — without it the chain is an exam answer with only
 *           the final step written
 *   铺垫    before the cause: gives the chain a root instead of an invention
 *   延伸    after the effect: the room the reader gets to imagine in
 *
 * 铺垫 sets the floor (will the reader accept it), 延伸 sets the ceiling (will
 * the reader say 「就这？」). So 完整率+铺垫率 drive the deduct side, and 延伸率
 * drives the add side.
 *
 * A chain that was grafted on rather than native has to be dressed — the
 * author's 「同款 + 可爱」. Native chains need no ornament.
 */

import { readStream } from './core.js'

const W_CAUSE = 1.0
const W_EFFECT = 1.0
const W_PROCESS = 1.4 // only the final step written is the worst shape
const DEDUCT_FULL = 8.0

const W_FILL = 0.7
const W_SETUP = 0.3
const ORIGIN_PEN = 0.15
const DRESSED_MIN = 0.5

const paras = (x) => {
  if (x == null) return []
  if (typeof x === 'number') return [x]
  if (Array.isArray(x)) return x.flatMap(paras)
  if (typeof x === 'object') return paras(x.paras)
  return []
}

const has = (x) =>
  paras(x).length > 0 || (x && typeof x === 'object' && Boolean(x.text))

/** Normalise one chain annotation. */
function readChain(ch) {
  const cause = ch.cause
  const effect = ch.effect
  const proc = ch.process ?? {}

  const setupP = paras(proc.setup)
  const middleP = paras(proc.middle)
  const extendP = paras(proc.extend)
  const all = [...new Set([
    ...paras(cause), ...paras(effect), ...setupP, ...middleP, ...extendP,
  ])].sort((a, b) => a - b)

  return {
    id: ch.id ?? '',
    hasCause: has(cause),
    hasEffect: has(effect),
    // Only the middle counts as "process". Setup and extension sit outside the
    // cause→effect span and are judged separately.
    hasProcess: middleP.length > 0,
    hasSetup: setupP.length > 0,
    hasExtend: extendP.length > 0,
    causeP: paras(cause),
    effectP: paras(effect),
    plant: all.length ? all[0] : 0,
    resolve: all.length ? all[all.length - 1] : 0,
    relation: ch.relation ?? null,
    order: ch.order ?? null,
    origin: ch.origin ?? null,
    dressed: ch.dressed ?? null,
  }
}

/** Accept both one-object-per-line and pretty-printed streams. */
export function loadChains(path) {
  return readStream(path)
}

/**
 * @param {object[]} rows  logic-chain annotations
 */
export function score(rows) {
  const list = (rows ?? []).filter((r) => r && typeof r === 'object')
  if (!list.length) return { unmeasured: '逻辑链标注是空的（没标，不是没有）' }

  const isNew = list.some((r) => 'cause' in r || 'effect' in r)
  if (!isNew) {
    return {
      unmeasured: '标注是旧格式（只有链名，没有因/果/过程分段），无法验收',
    }
  }

  const chains = list.map(readChain)
  const n = chains.length

  const hits = []
  const hints = []

  // ── per chain ──
  for (let i = 0; i < chains.length; i += 1) {
    const c = chains[i]
    const miss = []
    if (!c.hasCause) miss.push('没标因')
    if (!c.hasEffect) miss.push('没标果')
    if (!c.hasProcess) miss.push('因果之间没有过程')
    if (!c.hasSetup) miss.push('因之前没有铺垫')
    if (!c.hasExtend) miss.push('果之后没有延伸')
    if (miss.length) {
      const text = `逻辑链${i + 1}：${miss.join('；')}`
      hints.push(text)
      hits.push({ para: c.causeP[0] ?? c.effectP[0] ?? 0, text })
    }
  }

  // ── 完整率：weighted, because a missing middle costs more than a missing tag ──
  const wsum = W_CAUSE + W_EFFECT + W_PROCESS
  let got = 0
  for (const c of chains) {
    if (c.hasCause) got += W_CAUSE
    if (c.hasEffect) got += W_EFFECT
    if (c.hasProcess) got += W_PROCESS
  }
  const fillRate = n ? got / (wsum * n) : 0

  const nSetup = chains.filter((c) => c.hasSetup).length
  const setupRate = n ? nSetup / n : 0
  const nExt = chains.filter((c) => c.hasExtend).length
  const extendRate = n ? nExt / n : 0

  // ── origin: a grafted chain that was never dressed reads as forced ──
  const added = chains.filter((c) => c.origin === '后加')
  const bare = added.filter((c) => !c.dressed || c.dressed < DRESSED_MIN)
  let originPen = 0
  for (const c of added) {
    if (!c.dressed || c.dressed < DRESSED_MIN) {
      hints.push(
        `后加的逻辑链 段${c.plant}→${c.resolve} 没做「同款+可爱」的梳理，读者会觉得是硬接`,
      )
    }
  }
  if (added.length) originPen = ORIGIN_PEN * (bare.length / added.length)

  // ── 过程顺序：乱序只报不判 ──
  const unordered = chains.filter((c) => c.order && c.order !== '正叙')
  for (const c of unordered) {
    hints.push(
      `段${c.plant}→${c.resolve} 用了「${c.order}」——乱序是技巧不是错，` +
        '但读者会不会被带偏要你自己看',
    )
  }

  const deductRate = Math.max(0, W_FILL * fillRate + W_SETUP * setupRate - originPen)

  return {
    baseRate: deductRate,
    metrics: { logic_extend_rate: extendRate, logic_fill_rate: fillRate },
    full: DEDUCT_FULL,
    chains: n,
    fillRate,
    setupRate,
    extendRate,
    holes: { cause: chains.filter((c) => !c.hasCause).length,
      effect: chains.filter((c) => !c.hasEffect).length,
      process: chains.filter((c) => !c.hasProcess).length },
    originPen,
    unordered: unordered.length,
    hits,
    hints,
    detail: `${n} 条链：因 ${n - chains.filter((c) => !c.hasCause).length}/${n} · ` +
      `果 ${n - chains.filter((c) => !c.hasEffect).length}/${n} · ` +
      `过程 ${n - chains.filter((c) => !c.hasProcess).length}/${n} · ` +
      `延伸 ${nExt}/${n}`,
  }
}
