/**
 * End-to-end test of the "the user only pastes the article" path.
 *
 * The agent reads the piece and writes one `annotation` object covering every
 * kind it can judge; this test assembles exactly that from the sample's
 * annotation files and passes it through `lt_score` as JSON text. It is the only
 * test that exercises the annotation parser, which is why it exists separately
 * from the parity suite (that one calls `scorePiece` directly).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as plugin from '../index.js'
import { readStream } from '../lib/core.js'
import { collapseRepeats } from '../lib/score.js'

// `URL.pathname` yields `/C:/...%E6%83%85...` on Windows — percent-encoded and
// with a leading slash — so it must go through fileURLToPath before use.
const S = fileURLToPath(new URL('../test/fixtures/samples/', import.meta.url))
const load = (f) => readStream(new URL(`./fixtures/samples/${f}`, import.meta.url))

const tools = () => {
  const reg = []
  plugin.apply({ tools: { register: (t) => reg.push(t) } })
  return reg
}

const bodyRows = load('body.jsonl').map((r) => ({
  para: Number(r.para_id ?? r.para),
  text: String(r.text ?? ''),
}))
const body = bodyRows.map((r) => r.text).join('\n')

const fullAnnotation = () => ({
  paras: load('annotation.jsonl').map((r) => ({
    ...r,
    para: Number(r.para ?? r.para_id),
    strength: Number(r.strength ?? 0),
    direction: Number(r.direction ?? 0),
  })),
  foreshadowing: load('foreshadowing.jsonl'),
  carriers: load('carriers.jsonl'),
  logic: load('logic.jsonl'),
  theme: JSON.parse(readFileSync(join(S, 'theme.json'), 'utf8')),
})

test('a full annotation reproduces the fully-measured score', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const ending = load('ending.jsonl')[0] ?? null

  const { text } = await score.execute({
    title: '示例',
    body,
    annotation: JSON.stringify(fullAnnotation()),
    ending: ending ? JSON.stringify(ending) : undefined,
  })

  // 78.69 是旧的五类分类下的分。2026-11-13 换成作者的六类（景/物/人/事/心理/环境）
  // 并加了「无」表示没有描写对象之后，共鸣从 0.66 降到 0.53：那个「其他」原本当了
  // 一种维度，把维度数顶到 5/5。现在是 4/6，且心理占 61%。分数降了 1.24，是因为
  // 原来虚高的那部分被挤掉了，不是判据变严。
  //
  // 2026-11-14 又变了两处：暗线位置分改成「按交集点归一」（+0.45），
  // 笑料在没喜剧密度时报未测（分母 100 → 98），加一起总分落在 77.29 / 98.00。
  assert.match(text, /77\.29 \/ 98\.00/, '总分应为 77.29 / 98.00（笑料未测，分母少 2）')
  assert.match(text, /\+10\.20 \/ 20/, '额外加分应为 +10.20')
  assert.match(text, /「直接终结」拿不到形式分/, '结尾形式 0 分要说清是有意的，不是漏算')
  // 笑料这一项没喜剧密度就报未测（0.58 个/千字），所以这里会有且只会有它。
  assert.match(text, /\*\*笑料与梗\*\* — 只找到 1 个笑点（少于 2 个）/, '笑料该因样本不够报未测')
  // The reading is the caller's own, and the report has to admit it.
  assert.match(text, /标注是你自己写的/, '必须声明这是调用者自己的阅读')
  assert.match(text, /不是独立第三方的/, '必须说清它不是独立读数')
})

test('a partial annotation measures only what it covers', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const ann = { paras: fullAnnotation().paras }

  const { text } = await score.execute({ body, annotation: JSON.stringify(ann) })

  // Paragraph annotation alone cannot answer the other five questions.
  assert.match(text, /## 未测项/, '只给段落标注时应有未测项')
  assert.match(text, /\*\*伏笔\*\* —/, '伏笔该报未测')
  assert.match(text, /\*\*逻辑\*\* —/, '逻辑该报未测')
  // Measured items must not appear in the unmeasured list.
  assert.ok(!/\*\*氛围铺垫\*\* —/.test(text), '氛围有段落标注就该测')
  assert.match(text, /\*\*笑料与梗\*\* — 只找到 \d+ 个笑点（少于 2 个）/, '笑料要因样本不够报未测，而不是给分')
  // And the signature lists only what was actually supplied.
  assert.match(text, /标注是你自己写的（段落）/, '署名应只列实际给的部分')
})

test('a bare paragraph array still works', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({
    body,
    annotation: JSON.stringify(fullAnnotation().paras),
  })
  assert.match(text, /语言文字/, '老的数组形态必须继续可用')
})

test('no annotation leaves six items unmeasured, not zero', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({ body })

  assert.match(text, /## 共鸣 —— 没测/, '没有标注时共鸣该报没测')
  assert.ok(!/## 共鸣 1\.00/.test(text), '不该把「没看过」印成 1.00')
  // The joke item must blame the annotation, never the body.
  assert.match(text, /笑料需要段落标注/, '笑料该说缺标注')
  assert.ok(!/没有正文/.test(text), '正文明明给了，不许说没有正文')
})

test('malformed annotation is reported, not swallowed', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({ body, annotation: '{not json' })
  assert.match(text, /不是合法 JSON/, '坏 JSON 要明说')
  assert.match(text, /正文已经收到/, '正文没丢要说清楚')
})

test('a fabricated quote is rejected instead of misplaced', async () => {
  // The quote is the only thing tying a judgement to a position, so a quote
  // that cannot be found must fail loudly rather than land on paragraph 1.
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({
    body,
    annotation: JSON.stringify({ hooks: [{ plant: '这句话正文里绝对没有', resolve: '沾泥的袖口' }] }),
  })
  assert.match(text, /正文里找不到/, '找不到的引用要报错')
  assert.ok(!/## 总分/.test(text), '有解析问题时不该给出分数')
})

test('paragraphs need no explicit numbers — array order is the order', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const paras = load('annotation.jsonl').map((r) => ({
    s: r.strength, d: r.direction, f: r.function, t: r.dtype,
  }))
  const { text } = await score.execute({
    body,
    annotation: JSON.stringify({ paras }),
  })
  // Atmosphere needs at least four paragraphs; without positions being resolved
  // it would report "0 段" and drop out of the denominator.
  assert.ok(!/只有 0 段/.test(text), '数组顺序应该被当成段号')
  assert.match(text, /\| 氛围铺垫 \| \d/, '氛围该在分项表里')
  assert.ok(!/\*\*氛围铺垫\*\* —/.test(text), '氛围不该出现在未测项里')
})

test('an empty body is declined politely', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({ body: '   \n  \n' })
  assert.match(text, /没有收到正文/, '空正文要友好拒绝')
})

test('an unsplit block is scored and labelled, not refused', async () => {
  // An earlier version refused to score this. That was wrong: "one long
  // paragraph" is itself something the tool measures — paragraph structure and
  // the reading-experience coefficient read it directly — so refusing made the
  // most severe case the one case that never got scored.
  const score = tools().find((t) => t.name === 'lt_score')
  const block = '雨下了整整三天，屋檐的水连成一条线。我坐在门槛上，看那条线把院子分成两半。'
    + '第四天早上，雨停了。太阳出来的时候，我听见隔壁传来锯木头的声音。'
    + '他们终于要把那棵老槐树砍了。我没有出去看。'
    + '雨停了以后院子里很亮，槐树的影子还在，但是树已经不在了。'
    + '我忽然想起小时候爬过那棵树，树杈上有个鸟窝，我掏过一次，里面什么也没有。'
  assert.ok(block.length > 120, `这段要够长才会被标注，现在 ${block.length} 字`)

  const { text } = await score.execute({ body: block })
  assert.match(text, /这篇是一整段/, '要说明是按原样算的')
  assert.match(text, /没有分段/, '要指出没分段')
  assert.match(text, /## 总分/, '仍然要给分')
  // The reading-experience coefficient is the part that should react.
  assert.match(text, /×0\.\d+/, '阅读体验系数该被压低')
})

test('the same text split into paragraphs does get scored', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const split = [
    '雨下了整整三天，屋檐的水连成一条线。',
    '我坐在门槛上，看那条线把院子分成两半。',
    '第四天早上，雨停了。',
    '太阳出来的时候，我听见隔壁传来锯木头的声音。',
    '他们终于要把那棵老槐树砍了。',
    '我没有出去看。',
  ].join('\n')
  const { text } = await score.execute({ body: split })
  assert.ok(!/没有分段/.test(text), '分好段就不该拦')
  assert.match(text, /## 总分/, '应该给出分数')
})

test('a genuinely short single paragraph is not refused', async () => {
  // The guard must not punish a real one-paragraph piece, such as a poem.
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({ body: '下雨了。' })
  assert.ok(!/没有分段/.test(text), '一句话不该被判成没分段')
  assert.match(text, /## 总分/)
})

// ── the compact four-character encoding ──────────────────────
// It exists because the object form costs ~2900 characters for 88 paragraphs
// and the token form costs ~440. The tests pin both: they must score the same,
// and a short or malformed input must fail loudly rather than shift silently.

const tokenForm = () => {
  const dir = (d) => (d > 0 ? '+' : d < 0 ? '-' : '0')
  return load('annotation.jsonl')
    .map((r) => `${r.strength}${dir(r.direction)}${String(r.function)[0]}${String(r.dtype)[0]}`)
    .join(' ')
}

const atmosphereRow = (text) => (text.match(/\| 氛围铺垫 \| [\d.]+ \| [\d.]+ \| \*\*\d+%\*\*/) ?? [])[0]

test('the token form scores exactly like the object form', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const objects = load('annotation.jsonl').map((r) => ({
    s: r.strength, d: r.direction, f: r.function, t: r.dtype,
  }))

  const a = await score.execute({ body, annotation: JSON.stringify({ paras: objects }) })
  const b = await score.execute({ body, annotation: JSON.stringify({ paras: tokenForm() }) })
  const c = await score.execute({ body, annotation: JSON.stringify({ paras: tokenForm().split(' ') }) })

  assert.equal(atmosphereRow(b.text), atmosphereRow(a.text), '字符串编码应该和对象数组同分')
  assert.equal(atmosphereRow(c.text), atmosphereRow(a.text), '字符串数组也应该同分')
  assert.ok(!/标注没读进去/.test(b.text), '编码不该报错')
})

test('the token form is much smaller than the object form', () => {
  const objects = JSON.stringify(
    load('annotation.jsonl').map((r) => ({ s: r.strength, d: r.direction, f: r.function, t: r.dtype })),
  )
  const tokens = JSON.stringify(tokenForm())
  assert.ok(
    tokens.length < objects.length * 0.3,
    `token 形态应该小得多：${tokens.length} vs ${objects.length}`,
  )
})

test('dropping a paragraph fails instead of shifting everything', async () => {
  // The danger with a short code is a silent off-by-one: every paragraph after
  // the gap would take its neighbour's values and the score would look fine.
  const score = tools().find((t) => t.name === 'lt_score')
  const short = tokenForm().split(' ').slice(0, -1).join(' ')
  const { text } = await score.execute({ body, annotation: JSON.stringify({ paras: short }) })
  assert.match(text, /给了 87 段，正文有 88 段/, '少一段要明确报出来')
  assert.ok(!/## 总分/.test(text), '段数对不上时不该给分')
})

test('a malformed token names its position', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const bad = tokenForm().split(' ')
  bad[3] = '9X乱来'
  const { text } = await score.execute({ body, annotation: JSON.stringify({ paras: bad.join(' ') }) })
  assert.match(text, /paras\[3\]/, '要指出第几个 token')
  assert.match(text, /格式不对/, '要说清是格式问题')
})

// ── 描写判法：台阶 / 菜单 ─────────────────────────────────────
// The author's point (2026-11-13): 声音 and 心理 are 台阶 — there is an order,
// so a higher step is better. 视觉 is 菜单 — the angles are side by side, so
// "第三级不一定更好". 音乐 cannot be translated at all. Two rulers that must not
// be swapped: asking one for the other's shape must fail loudly instead of being
// scored as a guess.
//
// The prose this exercises lives in `test/fixtures/demo/`, not in this file:
// **测试用的文本不随包发布**（作者的规矩），所以测试源码里也不留正文。
const demoBodyRows = readStream(new URL('./fixtures/demo/body.jsonl', import.meta.url))
const measureBody = demoBodyRows.map((r) => r.text).join('\n')

const measureCarriers = (extra) => [
  { at: '末班车还有二十分钟', what: '车', ok: true, ...extra },
  { at: '候车亭的灯坏了一半', what: '灯', ok: true, ...extra },
  { at: '有个女人抱着一只纸箱', what: '纸箱', ok: true, ...extra },
  // One carrier that did not land: it stays out of the 判法 table, and it keeps
  // the coverage below 1 so a 判法 change would be visible as a score change.
  { at: '车门开了', what: '（没有承载物）', ok: false, reason: '收尾只有动作，没有东西接住' },
]

const totalOf = (text) => {
  const m = text.match(/([\d.]+) \/ ([\d.]+)。/)
  return m ? Number(m[1]) : NaN
}

test('both rulers only report — neither moves the score', async () => {
  // The author's 描述 basis is still being written, so a level must not turn into
  // a weight here: whatever the agent marks, the number has to stay put until he
  // says how a step should count.
  const score = tools().find((t) => t.name === 'lt_score')
  const run = async (extra) => {
    const { text } = await score.execute({
      body: measureBody,
      annotation: JSON.stringify({ carriers: measureCarriers(extra) }),
    })
    return { n: totalOf(text), text }
  }

  const plain = await run(null)
  const menu = await run({ chan: '视觉', angles: ['光影'] })
  const stair = await run({ chan: '声音', level: 3 })

  assert.equal(menu.n, plain.n, `菜单判法不该改分数：${plain.n} -> ${menu.n}`)
  assert.equal(stair.n, plain.n, `台阶判法也不该改分数：${plain.n} -> ${stair.n}`)

  // …but the reading itself must still show up, or the annotation is pointless.
  assert.match(stair.text, /### 描写判法/, '报告要说清读到了什么')
  assert.match(stair.text, /最高第 3 级/, '要说清走到哪一级')
  assert.match(stair.text, /细节\+比喻/, '要写出级名')
  assert.match(stair.text, /只报读数，不进分/, '要说清判法现在不进分')
  assert.match(menu.text, /光影/, '菜单要报用了哪几个角度')
})

test('giving a 菜单 channel a level is refused, not scored', async () => {
  // This is the whole point of the split: 视觉 has no third step that is better
  // than the second, so a level there is the wrong kind of number.
  const score = tools().find((t) => t.name === 'lt_score')
  const carriers = [{ at: '雨下了一夜', what: '雨', ok: true, chan: '视觉', level: 2 }]
  const { text } = await score.execute({ body: measureBody, annotation: JSON.stringify({ carriers }) })
  assert.match(text, /菜单/, '要指出这是菜单判法')
  assert.match(text, /没有级数这回事/, '要说清菜单没有级数')
  assert.ok(!/## 总分/.test(text), '报错时不该出分')
})

test('each wrong 判法 shape names the right fix', async () => {
  const score = tools().find((t) => t.name === 'lt_score')
  const at = '雨下了一夜'
  const cases = [
    [{ chan: '声音', angles: ['细节'] }, /台阶/, '台阶没有角度'],
    [{ chan: '声音' }, /给级数/, '台阶缺级数'],
    [{ chan: '视觉' }, /角度/, '菜单缺角度'],
    [{ chan: '音乐', level: 1 }, /特殊/, '音乐不比高低'],
    [{ chan: '嗅觉' }, /判法表/, '判法表里没有的通道'],
  ]
  for (const [extra, want, why] of cases) {
    const carriers = [{ at, what: '雨', ok: true, ...extra }]
    const { text } = await score.execute({ body: measureBody, annotation: JSON.stringify({ carriers }) })
    assert.match(text, want, why)
    assert.ok(!/## 总分/.test(text), `${why}：有解析问题时不该给分`)
  }
})

test('the schema doc states the two rulers and the 菜单 prohibition', async () => {
  const schema = tools().find((t) => t.name === 'lt_schema')
  const { text } = await schema.execute({ body: measureBody })
  assert.match(text, /台阶/, '要讲台阶判法')
  assert.match(text, /菜单/, '要讲菜单判法')
  assert.match(text, /不许给 level/, '菜单不许给级数要写死')
  assert.match(text, /扣分侧永远只问落没落住/, '扣分侧和判法无关要写清')
})

test('结论行同时给「丢分最多」和「得分率最低」', async () => {
  // 只报一个会把人往错的方向推：满分 40.75 的氛围几乎是恒定拿「丢分最多」，
  // 而真正该改的可能是得分率最低的小项（作者 2026-11-14 实测）。
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({
    body: measureBody,
    annotation: JSON.stringify({ carriers: measureCarriers(null) }),
  })
  assert.match(text, /丢分最多：.+；得分率最低：.+（\d+%）/, '两个候选都要给')
})

test('衔接的说明带上「自动判的覆盖率」', async () => {
  // 待核查的组被踢出分母，所以「100%」只覆盖看得见的那部分——报告得说清。
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({ body })
  assert.match(text, /自动判的只覆盖 \d+% 的相邻段/, '覆盖率要写在衔接那一行')
})

test('没有长伏笔时，说清加分上限', async () => {
  // 短篇拿不到「长伏笔内外结合」那 6 分，不写清就会被读成「没亮点」。
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({
    body: measureBody,
    ending: JSON.stringify({ form: '直接终结', trend: '顺势' }),
  })
  assert.match(text, /能拿到的加分上限是 \*\*10 \/ 20\*\*/, '要说明这 6 分是项没开，不是没写好')
})

test('角色是特殊判法：只报交付哪一层，给 level 直接报错', async () => {
  // 作者 2026-11-17：角色的总判据是「和现实中的人/群体有没有类比联系」，
  // 三层（背景/节点/细节）只报交付形式，不比高低。
  const score = tools().find((t) => t.name === 'lt_score')
  const body = [
    '他进门时把伞收得很慢。',
    '屋里没人，桌上的碗缺了一个口。',
    '他伸手碰了碰那个豁口，又缩回去。',
  ].join('\n')

  const ok = await score.execute({
    body,
    annotation: JSON.stringify({
      carriers: [{ at: '桌上的碗缺了一个口', what: '碗', chan: '角色', way: '细节' }],
      ending: { form: '直接终结', trend: '顺势' },
    }),
  })
  assert.doesNotMatch(ok.text, /标注没读进去/)

  const bad = await score.execute({
    body,
    annotation: JSON.stringify({
      carriers: [{ at: '桌上的碗缺了一个口', what: '碗', chan: '角色', level: 2 }],
      ending: { form: '直接终结', trend: '顺势' },
    }),
  })
  assert.match(bad.text, /角色 是特殊判法/, '给 level 要按特殊判法拒收')
})
test('角色读数：节点段和细节摆位都报出来，且明说不判好坏', async () => {
  // 作者 2026-11-17 写完「角色」：节点=氛围落差处，细节要摆在高潮/低谷前后。
  // 工具只报形式，好坏交给 DSH。
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({ body, annotation: JSON.stringify(fullAnnotation()) })
  assert.match(text, /### 角色读数/, '要报节点段与细节摆位')
  assert.match(text, /只报形式，不判好坏/)
  assert.match(text, /\*\*节点段\*\*：\d+/)
  assert.match(text, /平常环节.*节点前的铺垫.*节点前后/s, '要按三档报描写层数')
})
test('标注的逻辑链段落群会被采用；写错了逐条报错', async () => {
  // 作者 2026-11-18：描写层数要按「包含完整逻辑链的段落群」算，群由标注者给。
  const score = tools().find((t) => t.name === 'lt_score')
  const ann = fullAnnotation()
  const okAnn = { ...ann, groups: [[1, 44], [45, 88]] }
  const ok = await score.execute({ body, annotation: JSON.stringify(okAnn) })
  assert.match(ok.text, /标注切分/, '给了群就用标注的群')

  const badGroups = await score.execute({
    body,
    annotation: JSON.stringify({ ...ann, groups: [[5, 10]] }),
  })
  assert.match(badGroups.text, /groups/, '群写错要报 error')
  assert.match(badGroups.text, /覆盖/, '没覆盖全文要说清楚')
})

test('未测项必须带判断依据', async () => {
  // 作者 2026-11-15：凡是出不了分、或者出分细化不了的地方，都要给出判断依据，
  // 交给使用插件的 DSH 自己判——不是只丢一句「未测」了事。
  const score = tools().find((t) => t.name === 'lt_score')
  const { text } = await score.execute({
    body,
    annotation: JSON.stringify(fullAnnotation()),
  })
  assert.match(
    text,
    /- \*\*笑料与梗\*\* — [^\n]+\n {2}- \*\*你自己判\*\*：/,
    '未测项下面要写清 DSH 该看什么',
  )
})

test('a repeated complaint collapses into a count instead of burying the rest', async () => {
  // The 1091-paragraph test fired 「前面 3 段全是铺垫」 304 times, and the 12-line
  // 「哪里会掉队」 list filled up with that one complaint while 断句/臃肿/逻辑
  // never showed. Two samples stay; the rest become a number.
  const hits = Array.from({ length: 300 }, (_, i) => ({
    item: '氛围铺垫',
    para: i + 1,
    text: `段${i + 1} 前面 3 段全是铺垫，密到不自然——抽掉一段，让读者自己走一步`,
  }))
  hits.push({ item: '语言文字', para: 7, text: '段 7 一句 50 字里挤了 4 个带主语的分句' })

  const out = collapseRepeats(hits)
  assert.equal(out.length, 4, '两条样例 + 一条同类计数 + 另一类那一条')
  assert.ok(out.some((h) => /同类还有 298 处/.test(h.text)), '其余 298 处折叠成计数')
  assert.ok(out.some((h) => h.item === '语言文字'), '别类的问题不许被淹掉')
})

test('lt_demo cannot be mistaken for a real analysis', async () => {
  // The demo output is a complete, plausible report. An agent in a hurry would
  // hand it over as the analysis of whatever the user pasted, so the banner has
  // to come first and say both things: this is an archive, and the article is
  // not in the package.
  const demo = tools().find((t) => t.name === 'lt_demo')
  const { text } = await demo.execute({})
  assert.match(text, /存档报告/, '要明说是存档')
  assert.match(text, /不是对你提交的文章的分析/, '要明说不是用户的文章')
  assert.match(text, /没有随包发布/, '要说明正文不在包里')
  assert.ok(
    text.indexOf('存档报告') < text.indexOf('## 总分'),
    '警示要在报告前面',
  )
})

test('the schema doc warns that its examples are placeholders', async () => {
  const schema = tools().find((t) => t.name === 'lt_schema')
  const { text } = await schema.execute({})
  assert.match(text, /占位符，照抄会报/, '没给正文时必须说清示例是假的')
})

test('the schema doc examples actually resolve against the supplied body', async () => {
  // The manual must not be the thing that causes the first error. Whatever
  // quotes it prints alongside a body have to locate in that same body.
  const schema = tools().find((t) => t.name === 'lt_schema')
  const score = tools().find((t) => t.name === 'lt_score')

  const { text: doc } = await schema.execute({ body })
  assert.match(doc, /真截出来的/, '给了正文就该用真引用')

  const example = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)[1])
  const copied = {
    hooks: [{ plant: example.hooks[0].plant, resolve: example.hooks[0].resolve, quality: 0.9, layers: 2 }],
    carriers: [{ at: example.carriers[0].at, what: '示例物' }],
    chains: [{ cause: example.chains[0].cause, effect: example.chains[0].effect }],
  }

  const { text: scored } = await score.execute({ body, annotation: JSON.stringify(copied) })
  assert.ok(!/标注没读进去/.test(scored), '照抄示例不该失败：' + scored.slice(0, 300))
  assert.match(scored, /## 总分/, '照抄示例应该能出分')
})
