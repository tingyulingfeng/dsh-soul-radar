/**
 * Parity tests — the JS port must produce the same numbers as the Python
 * original, because the Python version is the one with a month of tuning
 * behind it.
 *
 * Run with: node --test test/parity.test.js
 *
 * One delta is expected and asserted explicitly rather than hidden:
 * 伏笔. The Python module emits `SCORE|` instead of `ITEM|`, so it bypasses the
 * engine's convex curve and resonance discount and lands on `4.0 × rate`.
 * The JS applies the engine uniformly, which is what the config describes. The
 * two agree the moment that inconsistency is fixed on the Python side.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readStream, resonance, experience, summary } from '../lib/core.js'
import { itemCfg, itemScore, curveDec, curveAdd } from '../lib/engine.js'
import * as language from '../lib/language.js'
import * as description from '../lib/description.js'
import * as foreshadowing from '../lib/foreshadowing.js'
import * as atmosphere from '../lib/atmosphere.js'
import * as logic from '../lib/logic.js'
import * as theme from '../lib/theme.js'
import * as joke from '../lib/joke.js'
import * as link from '../lib/link.js'
import * as ending from '../lib/ending.js'
import { scorePiece } from '../lib/score.js'

const S = new URL('../test/fixtures/samples/', import.meta.url)
const load = (f) => readStream(new URL(f, S))

const bodyRows = load('body.jsonl').map((r) => ({
  para: Number(r.para_id ?? r.para),
  text: String(r.text ?? ''),
}))

// Keep the whole row. Projecting a fixed field list once dropped `joke: true`,
// and the joke item silently scored zero on a piece that has one.
const p1Rows = load('annotation.jsonl').map((r) => ({
  ...r,
  para: Number(r.para ?? r.para_id),
  strength: Number(r.strength ?? 0),
  direction: Number(r.direction ?? 0),
}))

const fubiRows = load('foreshadowing.jsonl')
const carrierRows = load('carriers.jsonl')
const endingRow = load('ending.jsonl')[0] ?? null
const logicRows = load('logic.jsonl')
const themeDecl = JSON.parse(readFileSync(new URL('theme.json', S), 'utf8'))
const C = resonance(p1Rows).C

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`)

const jokeRows = () => {
  const byPara = new Map(bodyRows.map((b) => [b.para, b.text]))
  return p1Rows.map((r) => ({ ...r, text: byPara.get(r.para) ?? '' }))
}

test('the rule table loads and its shape is stable', () => {
  const s = summary()
  assert.ok(s.total > 40, '判据表应该有几十条')
  assert.equal(s.byStatus.review, 0, '不该还有「待核」挂着')
  assert.ok(s.byStatus.final > 30, '大部分判据应该已经定稿')
  assert.ok(s.bySide.bonus >= 3, '额外加分项至少有 3 条')
})

test('resonance: 过程/顺序这一半和 Python 一致，维度那一半是有意分歧', () => {
  const r = resonance(p1Rows)

  // 和 Python 完全一致的部分：过程分和渐变/跳变计数。
  near(r.P, 0.5, 1e-9, '过程分')
  assert.equal(r.grad, 21, '渐变数')
  assert.equal(r.jump, 21, '跳变数')

  // 有意分歧：Python 按自己编的五类算维度（角色/环境/心理/事件/其他），
  // 那个「其他」把 27 段没有类型的内容当成了一种维度，把 D 顶到 5/5=1.0。
  // 作者 2026-11-13 给的分类是六类（景/物/人/事/心理/环境），另加「无」表示
  // 这一段没有描写对象。排除「无」之后这篇只有 4 类，所以 D=4/6。
  assert.equal(r.kinds, 4, '维度类别数（排除「无」之后）')
  near(r.D, 4 / 6, 1e-9, '维度分')
  // 心理 40 段占 66 段有描写的 61%，所以均衡度比 Python 那个分母低。
  near(r.B, 1 - 40 / 66, 1e-9, '均衡度')
  near(r.C, 0.5 * 0.5 + 0.3 * (4 / 6) + 0.2 * (1 - 40 / 66), 1e-9, '共鸣 C')
  near(r.factor, 0.85 + 0.15 * r.C, 1e-9, '共鸣乘数')
})

test('reading experience matches', () => {
  const e = experience(bodyRows)
  near(e.R, 1.0, 1e-9, '这篇文章不该被阅读体验扣分')
  assert.equal(e.n, 88, '段数')
  assert.equal(e.longest, 118, '最长段')
})

test('curves keep their shape', () => {
  for (const x of [0, 0.2, 0.5, 0.8, 1]) {
    assert.ok(curveDec(x) >= x - 1e-9, `curveDec(${x}) 不该低于线性`)
  }
  assert.equal(curveDec(1), 1)
  assert.equal(curveAdd(1), 1)
  assert.ok(curveAdd(0.86) < 0.95, '0.86 不该已经封顶')
  assert.ok(curveAdd(0.86) > curveAdd(0.7), '单调递增')
})

test('language matches the Python run', () => {
  const l = language.score(bodyRows)
  // baseRate 不依赖共鸣，这一条才是真正的 parity。
  near(l.baseRate, 0.6286, 0.001, '语言扣分完成度')
  near(l.metrics.concrete_ratio, 1.0, 1e-9, '具体化率')
  // score 会乘共鸣系数，所以它随分类改动而变。2026-11-13 把五类换成作者的六类
  // 并加了「无」之后，共鸣从 0.6614 降到 0.5288，这里跟着从 8.40 变成 8.18。
  const s = itemScore(itemCfg('lang'), l.baseRate, l.metrics, undefined, C)
  near(s.score, 8.18, 0.01, '语言最终分')
})

test('description matches the Python run', () => {
  const d = description.score(carrierRows)
  const s = itemScore(itemCfg('desc'), d.baseRate, d.metrics, undefined, C)
  near(s.score, 12.66, 0.01, '描写最终分')
})

test('an unmarked carrier set scores exactly as before', () => {
  // 判法 is reading-only until the author's 描述 basis lands, so the old numbers
  // must not move — and no level metric should exist at all.
  const d = description.score(carrierRows)
  assert.equal(d.measures.unmarked, carrierRows.length, '这五处都没标判法')
  assert.deepEqual(Object.keys(d.metrics), ['carrier_ratio'], '加分侧读的还是落住率')

  const rate = itemScore(itemCfg('desc'), d.baseRate, d.metrics, undefined, C).addRate
  near(rate, d.cover, 1e-9, '加分侧应等于落住率')
})

test('foreshadowing matches except for the known legacy-path delta', () => {
  const f = foreshadowing.score(fubiRows, bodyRows.length)
  near(f.baseRate, 0.95, 0.001, '伏笔得分率')

  const s = itemScore(itemCfg('fubi'), f.baseRate, f.metrics, undefined, C)
  near(s.score, 3.91, 0.01, '伏笔最终分（走引擎）')

  // What the Python original prints: 4.0 × rate, no curve, no resonance.
  // Asserted explicitly so the delta stays visible instead of buried.
  const legacy = 4.0 * f.baseRate
  near(legacy, 3.80, 0.01, '伏笔旧路径')
  assert.ok(Math.abs(s.score - legacy) > 0.1, '两条路径本该不同——差异被记录下来了')

  assert.equal(f.inner?.got, 6, '长伏笔内外结合该拿满')
})

test('joke reports itself unmeasured when there is no comedy density', () => {
  // 0.58 个/千字——抒情文/严肃文的正常样子。为「不好笑」扣分等于拿喜剧的尺子量散文，
  // 所以这一项对这类篇目不适用：报未测、退出分母（作者 2026-11-14 实测要求）。
  const j = joke.score(jokeRows(), {})
  assert.ok(j.unmeasured, '密度不到 1 个/千字就该报未测')
  assert.match(j.unmeasured, /少于 2 个/)
  assert.equal(j.counts.jokes, 1, '笑点数得出来，只是不进分')

  // 密度够的时候照旧算分——不能因为加了门槛就把这条判据废掉。
  const dense = [
    { para: 1, text: '今天本来没什么事。', function: '交代', direction: 0 },
    { para: 2, text: '我想着早点睡。', function: '蓄势', direction: 1 },
    { para: 3, text: '结果我熬到了三点。', function: '释放', direction: 1 },
    { para: 4, text: '原来我一直在刷手机。', function: '释放', direction: 1 },
    { para: 5, text: '偏偏早上还有会。', function: '释放', direction: 1 },
  ]
  const d = joke.score(dense, {})
  assert.equal(d.unmeasured, undefined, '密度够就该给分')
  assert.ok(d.baseRate > 0, '有笑点要有分')
})

test('an annotator-marked joke is found without a keyword', () => {
  // 段14 is 「正在戳蜗牛的……」 with `joke: true` — black humour no word list
  // reaches. If the loader drops that field the item silently reads zero.
  const merged = jokeRows()
  const marked = merged.filter((r) => r.joke === true)
  assert.ok(marked.length >= 1, '标注里应该有人工标的笑点')
  const found = joke.score(merged, {}).counts.jokes
  assert.ok(found >= marked.length, '人工标的笑点必须被算进去')
})

test('resonance counts a one-sentence beat as a gradient, not a jump', () => {
  // 前一段刚「释放」，这一句独立成段收住——哪怕档位掉了 4 级，那也是文体上的换气，
  // 不是读者跟不上（作者 2026-11-14 实测：散文的留白被当成跳变，把「过程」压到 0.44）。
  const beat = [
    { para: 1, strength: 3, direction: 1, function: '释放', text: '他笑了笑。杯子放下了。' },
    { para: 2, strength: 1, direction: -1, function: '留白', text: '可没有。' },
  ]
  const withBeat = resonance(beat)
  assert.equal(withBeat.jump, 0, '单句成段落不该记成跳变')
  assert.equal(withBeat.grad, 1, '它记成一次渐变')

  // 同样的落差，但目标不是单句成段 → 照旧算跳变。
  const plain = resonance([
    { para: 1, strength: 3, direction: 1, function: '释放', text: '他笑了笑。杯子放下了。' },
    { para: 2, strength: 1, direction: -1, function: '留白', text: '可没有。窗外没有声音，也没有人影。' },
  ])
  assert.equal(plain.grad, 0, '多句段落不享受这条豁免')
  assert.equal(plain.jump, 1, '该算跳变')
})

test('theme tolerates one step of slack around the ideal', () => {
  // 靶心原来是「一点」：短篇里写得隐（多推一步）和写得显（全写明）两头都挨罚，
  // 交集点几乎不可能及格。现在差一步不罚（作者 2026-11-14 实测要求）。
  const rows = []
  for (let i = 1; i <= 20; i += 1) {
    // 造两个大摆幅，好让 zigzag 出节点
    const s = i <= 10 ? 3 : 1
    rows.push({ para: i, strength: s, direction: 1, function: '蓄势', text: '甲。', dtype: '景' })
  }
  const decl = {
    core: '暗线',
    intersections: [
      {
        para: 10,
        fit_total_steps: 4,
        fit_written_steps: 2,
        fit_tight: [1],
        rel: { time: 1, place: 1, person: 1, event: 1, process: 1, item: 1 },
      },
    ],
  }
  // 这里只关心「差一步有没有被罚」，直接看拟合值：k=2、kstar=0.5，差 1.5
  const t = theme.score(decl, rows)
  assert.ok(t.qualityRatio > 0.8, `差一步不该把交集点打掉（实际 ${t.qualityRatio}）`)
})

test('link matches the corrected denominator', () => {
  // NOTE: this deliberately no longer matches the Python original — see
  // `the two deltas from the Python original, both on purpose` below.
  const l = link.score(bodyRows)
  near(l.rate, 0.9545, 0.005, '串联率')
  assert.equal(l.ok, 42, '串联对数')
  assert.equal(l.review.length, 20, '待核查组数')
  assert.equal(l.judged, 44, '分母按「对数」算，不是按「组数」')

  const s = itemScore(itemCfg('link'), l.baseRate, l.metrics, undefined, C)
  near(s.score, 6.86, 0.02, '衔接最终分')
})

test('link reports itself blind rather than broken', () => {
  const r = link.score(bodyRows.slice(0, 2))
  assert.ok(r.unmeasured, '样本太小时该报未测，不该硬给分')
  assert.ok(r.unmeasured.includes('样本太少'))
})

test('ending matches the Python run', () => {
  const e = ending.score(endingRow, p1Rows)
  near(e.total, 4.2, 0.01, '结尾合计')
  near(e.trend, 4.2, 0.01, '结尾走向')
  assert.equal(e.form, 0, '直接终结不给形式分')
  assert.equal(e.blank?.q, 1.0, '留白落在结尾')
})

test('atmosphere matches the Python run', () => {
  const byPara = new Map(bodyRows.map((b) => [b.para, b.text]))
  const merged = p1Rows.map((r) => ({ ...r, text: byPara.get(r.para) ?? '' }))
  const a = atmosphere.score(merged)
  assert.equal(a.unmeasured, undefined, '这篇该测得了')

  // The five sub-item base rates, checked individually so a wrong zigzag or a
  // missing padding penalty shows up in the right place.
  near(a.items['1-1'].baseRate, 1.0, 1e-9, '1-1 落差')
  near(a.items['1-2'].baseRate, 0.8513, 0.001, '1-2 节奏')
  near(a.items['1-3'].baseRate, 1.0, 1e-9, '1-3 连贯')
  near(a.items['1-4'].baseRate, 0.8033, 0.001, '1-4 丰富')
  near(a.items['1-5'].baseRate, 0.3889, 0.001, '1-5 配比')
  assert.equal(a.metrics.func_kinds, 6, '功能种类数')

  let sum = 0
  for (const sk of ['1-1', '1-2', '1-3', '1-4', '1-5']) {
    sum += itemScore(itemCfg('atmos', sk), a.items[sk].baseRate, a.items[sk].metrics, undefined, C).score
  }
  near(sum, 28.65, 0.05, '氛围五项合计')
})

test('logic matches the Python run', () => {
  const l = logic.score(logicRows)
  near(l.baseRate, 0.775, 0.001, '逻辑扣分完成度')
  near(l.metrics.logic_extend_rate, 1.0, 1e-9, '延伸率')
  const s = itemScore(itemCfg('logic'), l.baseRate, l.metrics, undefined, C)
  near(s.score, 10.56, 0.01, '逻辑最终分')
})

test('theme position is per intersection, not a share of the whole piece', () => {
  const t = theme.score(themeDecl, p1Rows)
  // It used to be 命中权重 ÷ 全部节点权重. That denominator grows with the piece
  // while the numerator is capped by how many intersections the author wrote, so
  // a long piece scored ~1% however well the points landed (1091 段: 3/275 节点,
  // 位置分 1.4%). Per intersection it reads what was actually asked for: how big
  // a swing did each 交集点 land on.
  near(t.positionRatio, 0.4857, 0.001, '交集点落点的平均权重')
  assert.ok(t.positionRatio > 0.3, '七个交集点踩在波动上，不该被节点总数稀释成个位数')
  const s = itemScore(itemCfg('theme'), t.baseRate, t.metrics, undefined, C)
  near(s.score, 6.04, 0.01, '暗线最终分')
  // Most of this item is a person's opinion; the report must say so.
  assert.ok(t.hints.some((h) => h.includes('标注人估的')), '必须声明这是人估的')
})

test('1-3 连贯 penalises density, not a head count', () => {
  // Same density, same completion — whether the piece has 88 paragraphs or 1091.
  // With an absolute count, 28 jumps zeroed a 1091-paragraph piece while 2 jumps
  // in 88 paragraphs cost a fifth: one defect, two verdicts.
  near(atmosphere.coherenceRate(2, 88), 0.75, 1e-9, '88 段 2 处')
  near(atmosphere.coherenceRate(28, 1091), 0.718, 0.002, '1091 段 28 处，密度差不多就该扣差不多')
  assert.equal(atmosphere.coherenceRate(0, 500), 1, '没有跳变就是满')
  // 8/88 is the old zero point, kept as the calibration.
  assert.equal(atmosphere.coherenceRate(8, 88), 0, '88 段 8 处扣光')
  assert.equal(atmosphere.coherenceRate(4, 44), 0, '同样密度、一半长度，也扣光')
})

test('the whole piece scores as expected', () => {
  const r = scorePiece({
    title: '示例', bodyRows, p1Rows,
    foreshadowingRows: fubiRows, carrierRows, logicRows, themeDecl, endingRow,
  })
  near(r.total, 77.29, 0.05, '总分')
  near(r.measuredFull, 98, 0.01, '笑料报未测，分母少 2')
  near(r.bonus, 10.20, 0.01, '额外加分')
  assert.equal(r.unmeasured.length, 1, '笑料报未测（这篇没有喜剧密度），其余都测了')
  assert.match(r.unmeasured[0].reason, /笑料/, '未测理由要指名是笑料')
})

test('the deltas from the Python original, all on purpose', () => {
  const r = scorePiece({
    title: 'x', bodyRows, p1Rows,
    foreshadowingRows: fubiRows, carrierRows, logicRows, themeDecl, endingRow,
  })
  // Python prints 76.81. Four items disagree with it, for known reasons:
  //
  //  伏笔  +0.14   its `SCORE|` line bypasses the engine and lands on 3.80
  //                instead of the 3.94 the config describes.
  //  衔接  +1.74   它的分母用「组数」，组一长就少减，短文里能把 100% 压成 33%。
  //                这一条 Python 和移植版原本同错，现在只有这边修了。
  //  共鸣  −1.24   2026-11-13 把描写分类从自己编的五类换成作者的六类，并加了「无」
  //                表示没有描写对象。Python 那个「其他」把 27 段没有类型的内容当成
  //                一种维度，把维度数顶到 5/5；现在是 4/6，且心理占 61%。
  //                这一条不是修正 Python 的错，是分类标准本身换了。
  //  暗线  +0.45   2026-11-14 位置分从「占全部波动节点」改成「按交集点归一」——
  //                长文里前者等于按篇幅扣分（1091 段时 4 个交集点只拿 1.4%）。
  //
  // 前两条和后一条让这边的分更高，第三条让它更低。四条都留住断言，让差异一直
  // 看得见，而不是被四舍五入吞掉。
  const delta = r.total - 76.81
  near(delta, 0.48, 0.05, '和 Python 总分的差')
  assert.ok(delta > 0, '两处修正的涨幅仍然盖过分类改动带来的下降')
})

test('unmeasured items leave the denominator instead of scoring zero', () => {
  const r = scorePiece({ title: 'x', bodyRows, p1Rows })
  assert.ok(r.unmeasured.length >= 3, '没移植的项该报未测')
  assert.ok(r.measuredFull < 100, '未测项不该算进分母')
  assert.ok(!r.measured.some((m) => m.got === 0), '不该有整项归零')
})

test('the report tells the agent what it must not do', () => {
  const r = scorePiece({ title: 't', bodyRows, p1Rows, carrierRows, endingRow })
  assert.ok(r.report.includes('不能相加'), '总分和额外加分必须写明不能相加')
  assert.ok(r.report.includes('不许出现'), '要有禁止项清单')
  assert.ok(r.report.includes('不加客套'), '结尾不许客套')
})

test('报告要说清「读数不是结论，话由 DSH 说」', () => {
  const r = scorePiece({ title: 't', bodyRows, p1Rows, carrierRows, endingRow })
  // 作者 2026-11-14 的要求：插件只测「读者会不会掉队」，出了这个范围它不作数。
  // 用户年龄、口味、在写什么，插件不知道而 DSH 知道——报告必须把这层交代出去，
  // 否则 DSH 会把那八个数当成判决，直接搬给用户。
  assert.ok(r.report.includes('话由你说'), '要有一段说明读数只是原料')
  assert.ok(r.report.includes('不作数'), '要说明插件判断的适用范围')
  assert.ok(r.report.includes('必须你补'), '未测/待核的地方要指名让 DSH 接手')
  // 但也要防止它反过来——把解读自由当成改分数的理由。
  assert.ok(r.report.includes('调的是**解读**，不是**读数**'), '要分清解读和读数')
})
