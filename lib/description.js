/**
 * Description — does the feeling land on something concrete, and how well was
 * the landing place made.
 *
 * Port of `p5_score_v2.py`. The five-category distribution that used to live
 * here was removed: it read the same `dtype` field as the resonance
 * coefficient, so a piece written in only two modes was penalised twice for one
 * weakness. What is left is the question that has its own evidence: an emotion
 * either lands on a person, object, scene, or event — or it floats.
 *
 * ## Two rulers — reported, not scored yet
 *
 * The author's point (2026-11-13) is that the same object is judged differently
 * depending on what the description is doing:
 *
 *   台阶  声音、心理   the place is built along an order — 拟声词 → 直接互动 →
 *                      细节+比喻. A higher step is doing better.
 *   菜单  视觉         the place is built through parallel angles — 颜色 / 光影 /
 *                      主观感受. No order, so nothing is "reached": 用两个角度
 *                       is not better than 用一个. The angles are reported and
 *                      ranking them is the agent's call, not this module's.
 *   特殊  音乐         时间→空间 translating does not work; only 命名曲名 or
 *                      大幅旁敲侧击.
 *
 * **Neither ruler touches the score yet.** The 描述 补充依据 is not finished —
 * the author said so on 2026-11-13 and again on 2026-11-14 ("等写完发你再做") —
 * so how a level should weigh is his call, not a number to invent here. What
 * this module owes him until then is the reading: which channel, how far up the
 * ladder, which angles. The report states that the add side is still 落住率.
 *
 * The deduct side asks only whether the feeling landed at all, and never looks
 * at 判法. (Known flaw, deliberately left alone until his text lands: the add
 * side still reads the same coverage number as the deduct side, which gives
 * 卓越分 for 及格. The 判法 is what should fix that — when he says how.)
 *
 * What the module must never do, even while only reporting, is quietly treat a
 * menu channel as a ladder: `level` on 视觉 is rejected at parse time.
 *
 * Input is carrier rows: `{para, carrier, cause, ok, chan?, level?, angles?, way?}`.
 */

import { descMeasures } from './core.js'

const W_COVER = 0.6
const W_CAUSE = 0.4

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

/** Per-channel tally of what the annotator marked, for the report. */
function tally(rows, table) {
  const seen = new Map()
  let unmarked = 0
  for (const r of rows) {
    const spec = r?.chan ? table[r.chan] : null
    if (!spec) {
      unmarked += 1
      continue
    }
    const e = seen.get(r.chan) ?? {
      chan: r.chan,
      measure: spec.measure,
      levels: spec.levels ?? [],
      n: 0,
      top: 0,
      steps: {},
      angles: [],
      ways: [],
    }
    e.n += 1
    if (isNum(r.level)) {
      e.steps[r.level] = (e.steps[r.level] ?? 0) + 1
      e.top = Math.max(e.top, r.level)
    }
    for (const a of r.angles ?? []) if (!e.angles.includes(a)) e.angles.push(a)
    if (r.way && !e.ways.includes(r.way)) e.ways.push(r.way)
    seen.set(r.chan, e)
  }
  return { channels: [...seen.values()], unmarked }
}

/**
 * @param {object[]} carrierRows
 * @returns {{done:number, raw:number, full:number, detail:string, hints:string[],
 *            measures:object}|{unmeasured:string}}
 */
export function score(carrierRows) {
  const rows = (carrierRows ?? []).filter(
    (r) => r && typeof r.carrier === 'string' && r.carrier.trim(),
  )
  if (!rows.length) {
    // Same shape as the other "needs annotation" messages: say what is missing
    // and what it is for, rather than reporting an internal count of usable rows.
    return {
      unmeasured: '描写需要承载物标注（每处情感落在哪个具体的物上）——没有标注时判不了落没落住',
    }
  }

  let ok = 0
  let withCause = 0
  const hints = []
  const hits = []

  for (const r of rows) {
    const hasCause = r.cause != null && r.cause !== '' && r.cause !== false
    const good = r.ok === undefined ? hasCause : Boolean(r.ok)
    if (good) ok += 1
    if (hasCause) withCause += 1
    if (!good) {
      // An annotator may write "（没有承载物）" as the value, meaning the
      // paragraph has none. Quoting that back produces 「承载物「（没有承载物）」
      // 没落住」, which reads like the tool is confused. Say it plainly instead.
      const name = String(r.carrier ?? '').trim()
      const named = name && !/^[（(]?没有/.test(name) ? name : ''
      const why = String(r.reason ?? '说不清它承载了什么').slice(0, 40)
      hints.push(
        named
          ? `段 ${r.para} 的承载物「${named.slice(0, 18)}」没落住：${why}`
          : `段 ${r.para} 没有承载物：${why}`,
      )
      hits.push({
        para: Number(r.para),
        text: named
          ? `承载物「${named.slice(0, 16)}」没落住`
          : '这处没有承载物',
      })
    }
  }

  const cover = ok / rows.length
  const causeRate = withCause / rows.length

  // ── the 判法 reading: how was the landing place made ──────────
  //
  // Reading only — no score consumes it yet (see the header). What it does give
  // is the fact the report needs: which channel, and how far up the ladder.
  const table = descMeasures().channels ?? {}
  const { channels, unmarked } = tally(rows, table)
  const stair = rows.filter(
    (r) => r.chan && table[r.chan]?.measure === '台阶' && isNum(r.level),
  )
  const measures = { channels, unmarked, stairCount: stair.length }

  // Where a 台阶 description stopped. This is 改良意见 material, not a deduction:
  // the feeling landed, it just did not climb.
  for (const r of stair) {
    const spec = table[r.chan]
    const levels = spec.levels ?? []
    const opt = spec.optional_levels ?? []
    if (r.level < levels.length) {
      const rest = levels.slice(r.level).map((name, i) => (
        opt.includes(r.level + 1 + i) ? `${name}（可选）` : name
      ))
      hints.push(`段 ${r.para} 的${r.chan}停在「${levels[r.level - 1]}」——往下还有 ${rest.join(' / ')}`)
    }
  }

  const marked = rows.length - unmarked
  const tail = marked ? `；其中 ${marked} 处标了判法` : ''

  return {
    // `done` is the deduct-side completion. The add side reads the same coverage
    // number it always has: when the author's 描述 basis arrives, the level is
    // what the add side should read instead — until then a level is reported,
    // never scored.
    baseRate: W_COVER * cover + W_CAUSE * causeRate,
    metrics: { carrier_ratio: cover },
    cover,
    causeRate,
    measures,
    detail: `标注列了 ${rows.length} 处该有承载物的地方，${ok} 处真落了${tail}`,
    hits,
    hints,
  }
}
