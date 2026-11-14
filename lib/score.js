/**
 * The orchestrator: read a piece, run every module, report what it could and
 * could not measure, and write the report an agent actually works from.
 *
 * Two coefficients apply, and they answer different questions:
 *
 *   共鸣     can the reader follow what the author did   (content)
 *   阅读体验  can the reader physically keep going        (form)
 *
 * A module that cannot measure reports 未测 and leaves the denominator. The
 * score is never inflated by a missing check.
 *
 * One deliberate asymmetry: 伏笔 is scored here through the engine, while the
 * Python original let it bypass the engine via its `SCORE|` line. The engine
 * version is what the config describes, and the parity test asserts both
 * numbers so the 0.14 difference stays visible instead of hidden.
 */

import { resonance, experience } from './core.js'
import { itemCfg, itemScore } from './engine.js'
import * as atmosphere from './atmosphere.js'
import * as description from './description.js'
import * as foreshadowing from './foreshadowing.js'
import * as language from './language.js'
import * as logic from './logic.js'
import * as theme from './theme.js'
import * as joke from './joke.js'
import * as link from './link.js'
import * as ending from './ending.js'

const ITEMS = [
  {
    key: 'atmos', label: '氛围铺垫', module: atmosphere,
    subkeys: ['1-1', '1-2', '1-3', '1-4', '1-5'],
    note: '兴趣怎么起伏：落差、节奏、连贯、结构丰富度、配比',
  },
  { key: 'fubi', label: '伏笔', module: foreshadowing,
    note: '挖了什么坑、填了没有、期间铺垫几层' },
  { key: 'desc', label: '描写叙述', module: description,
    note: '情感落没落到具体的物上' },
  { key: 'lang', label: '语言文字', module: language,
    note: '字词句本身：段落长度、断句、具体化' },
  { key: 'logic', label: '逻辑', module: logic,
    note: '因、果、过程三段齐不齐，延伸有没有' },
  { key: 'theme', label: '暗线', module: theme,
    note: '藏起来的那条线有没有搭住明线（一半是标注人估的）' },
  { key: 'joke', label: '笑料与梗', module: joke,
    note: '笑点密度、位置、新鲜度' },
  { key: 'link', label: '衔接', module: link,
    note: '相邻段之间能不能连上' },
]

const BONUS_CAP = 20

/**
 * Collapse repeats of the same complaint.
 *
 * One defect can fire hundreds of times on a long piece: the 1091-paragraph test
 * produced 304 identical 「段N 前面 3 段全是铺垫」 lines, which filled the 12-line
 * 「哪里会掉队」 list and pushed every other finding out — the section whose whole
 * job is to say where the reader drops off ended up saying one thing, 300 times.
 *
 * The kind is the text with digits blanked, so 「段12 前面全是铺垫」 and
 * 「段940 前面全是铺垫」 count as one kind. Two samples stay (two different
 * paragraph numbers prove it is not a fluke), the rest fold into a count.
 */
export function collapseRepeats(list, keep = 2) {
  const groups = new Map()
  for (const h of list ?? []) {
    const key = `${h.item ?? ''}|${String(h.text ?? '').replace(/\d+/g, '#')}`
    const g = groups.get(key) ?? { all: [] }
    g.all.push(h)
    groups.set(key, g)
  }
  const out = []
  for (const g of groups.values()) {
    for (const h of g.all.slice(0, keep)) out.push(h)
    const rest = g.all.length - keep
    if (rest > 0) {
      const paras = g.all.slice(keep, keep + 6).map((h) => h.para).filter((p) => p != null)
      out.push({
        para: null,
        text: `同类还有 ${rest} 处` + (paras.length ? `（如段 ${paras.join('、')}）` : ''),
      })
    }
  }
  return out
}

/**
 * @param {object} input
 * @param {string} [input.title]
 * @param {{para:number,text:string}[]} input.bodyRows
 * @param {object[]} [input.p1Rows]
 * @param {object[]} [input.foreshadowingRows]
 * @param {object[]} [input.carrierRows]
 * @param {object[]} [input.logicRows]
 * @param {object} [input.themeDecl]
 * @param {object} [input.endingRow]
 */
export function scorePiece({
  title = '',
  bodyRows = [],
  p1Rows = [],
  foreshadowingRows = [],
  carrierRows = [],
  logicRows = [],
  themeDecl = null,
  endingRow = null,
}) {
  const exp = experience(bodyRows)

  // The paragraph text rides along with the annotation: atmosphere needs it to
  // merge split paragraphs, jokes need it to find reveals, and resonance needs it
  // to tell a one-sentence beat from a genuine jump.
  const byPara = new Map(bodyRows.map((b) => [b.para, b.text]))
  const merged = p1Rows.map((r) => ({ ...r, text: byPara.get(r.para) ?? '' }))
  const res = resonance(merged)

  const measured = []
  const unmeasured = []
  const hits = []
  const hints = []

  for (const item of ITEMS) {
    if (!bodyRows.length) {
      unmeasured.push({ label: item.label, reason: '没有正文' })
      continue
    }

    let r
    if (item.key === 'fubi') r = item.module.score(foreshadowingRows, bodyRows.length)
    else if (item.key === 'desc') r = item.module.score(carrierRows)
    else if (item.key === 'logic') r = item.module.score(logicRows)
    else if (item.key === 'theme') r = item.module.score(themeDecl, p1Rows)
    else if (item.key === 'atmos') r = item.module.score(merged)
    else if (item.key === 'joke') {
      // Jokes need the paragraph annotation for the joke signal, but the
      // character count can come from the body when the annotation is absent —
      // so pass it rather than letting a missing annotation look like missing text.
      const bodyChars = bodyRows.reduce((a, b) => a + String(b.text ?? '').length, 0)
      r = item.module.score(merged, {}, bodyChars)
    } else r = item.module.score(bodyRows)

    if (r.unmeasured) {
      unmeasured.push({ label: item.label, reason: r.unmeasured })
      continue
    }

    for (const h of r.hits ?? []) hits.push({ para: h.para, text: h.text, item: item.label })
    for (const h of r.hints ?? []) hints.push({ text: h, item: item.label })

    if (item.subkeys) {
      // A grouped item: score each sub-item against its own config, then add up.
      let got = 0
      let full = 0
      const parts = []
      for (const sk of item.subkeys) {
        const cfg = itemCfg(item.key, sk)
        if (!cfg) continue
        const sub = r.items?.[sk]
        if (!sub) continue
        const s = itemScore(cfg, sub.baseRate, sub.metrics, undefined, res.C)
        got += s.score
        full += Number(cfg.full ?? 0)
        parts.push(`${sk} ${Math.round(sub.baseRate * 100)}%`)
      }
      measured.push({
        key: item.key, label: item.label, full,
        got: Math.round(got * 100) / 100,
        baseRate: full ? got / full : 0,
        detail: r.detail ?? parts.join(' · '),
      })
      continue
    }

    const cfg = itemCfg(item.key)
    if (!cfg) {
      unmeasured.push({ label: item.label, reason: `配置里找不到 ${item.key}` })
      continue
    }
    const s = itemScore(cfg, r.baseRate, r.metrics, r.steps, res.C)
    measured.push({
      key: item.key, label: item.label,
      full: Number(cfg.full ?? cfg.deduct_full ?? 0),
      got: Math.round(s.score * 100) / 100,
      baseRate: r.baseRate,
      detail: r.detail ?? '',
      // Only 描写 carries a 判法 reading; the others leave it undefined.
      measures: r.measures,
    })
  }

  // Sum, then the reading-experience coefficient.
  const rawTotal = Math.round(measured.reduce((a, x) => a + x.got, 0) * 100) / 100
  const measuredFull = Math.round(measured.reduce((a, x) => a + x.full, 0) * 100) / 100
  const total = Math.round(rawTotal * exp.R * 100) / 100

  // Extra credit, never added to the total.
  let bonus = 0
  const bonusDetail = []
  if (endingRow) {
    const e = ending.score(endingRow, p1Rows)
    if (e.unmeasured) unmeasured.push({ label: '结尾', reason: e.unmeasured })
    else {
      bonus = e.total
      bonusDetail.push(
        { label: '结尾·走向', got: e.trend, full: ending.W_TREND },
        {
          label: '结尾·形式',
          got: e.form,
          full: ending.W_FORM,
          // 0/4 on a 直接终结 ending reads like a missed measurement. It is the
          // rule: 形式分 only pays for 首尾相连, because that is the one that has
          // to work to be worth anything.
          note: e.form === 0 && e.formLabel === '直接终结'
            ? '「直接终结」拿不到形式分——只有「首尾相连」才有。这 0 分是有意的，不是漏算。'
            : undefined,
        },
      )
      for (const h of e.hints ?? []) hints.push({ text: h, item: '结尾' })
    }
  }
  if (foreshadowingRows.length) {
    const f = foreshadowing.score(foreshadowingRows, bodyRows.length)
    if (f.inner) {
      bonus += f.inner.got
      bonusDetail.push({ label: '长伏笔内外结合', got: f.inner.got, full: f.inner.full })
    }
  }

  const report = renderReport({
    title, measured, unmeasured, hits, hints, res, exp,
    total, measuredFull, bonus, bonusDetail,
  })

  return {
    title, measured, unmeasured, hits, hints,
    resonance: res, experience: exp,
    total, measuredFull, bonus, bonusDetail, report,
  }
}

function renderReport(x) {
  const L = []
  const p = (...s) => L.push(...s)

  p(`# ${x.title || '（未命名）'} · 雷达读数`, '')
  p('> 这份报告是给 DSH 的数据包，不是给用户看的。')
  // 段号基准必须写明：调用方常把标题行/文末附言单独拿掉，报告里的「段 15」在文件里
  // 可能是第 16 行，作者拿原稿对照会整体错位（2026-11-14 实测）。
  p('> **段号以正文第一段为 1**；标题行、文末附言、空行都不计入。', '', '---', '')

  const hitLines = collapseRepeats(x.hits)
  if (hitLines.length) {
    p('## 哪里会掉队', '')
    for (const h of hitLines.slice(0, 12)) {
      p(h.para != null ? `- 段 ${h.para}：${h.text}` : `- ${h.text}`)
    }
    if (hitLines.length > 12) p(`- …还有 ${hitLines.length - 12} 类`)
    p('', '---', '')
  }

  const hintLines = collapseRepeats(x.hints)
  if (hintLines.length) {
    p('## 要改但没扣分的（给「改良意见」用）', '')
    p('> 这些不影响大方向判断，所以不扣分；但**写改良意见时要提**。', '')
    for (const h of hintLines.slice(0, 12)) {
      p(h.para != null ? `- 段 ${h.para}：${h.text}` : `- ${h.text}`)
    }
    p('', '---', '')
  }

  if (x.res.measured === false) {
    // No annotation, so resonance was never measured. Printing C=1.00 beside
    // "维度 0 类" read as a perfect score; it is the opposite — an absent one.
    p('## 共鸣 —— 没测', '')
    p(`> ${x.res.why}，所以共鸣不打折（×1.00）。`, '')
    p('> **这不是「共鸣满分」，是「没看过」。** 没有标注时读不出过程、维度、均衡三样。')
    p('>')
    p('> **纯文本的分数不能和带标注的分数横比** —— 带标注的每项都按共鸣折算过，纯文本的没有。')
    p('', '---', '')
  } else {
    p(`## 共鸣 ${x.res.C.toFixed(2)}`, '')
    p('> 共鸣不是一项分，是给所有分项定标的乘数。')
    p('> 作者做了 ≠ 读者感受到了。')
    p('')
    p(`> 过程 ${x.res.P.toFixed(2)}（渐变 ${x.res.grad} / 跳变 ${x.res.jump}）· ` +
      `维度 ${x.res.kinds} 类 · 均衡 ${x.res.B.toFixed(2)}`)
    p(`> 本报告的每一项都已按 **×${x.res.factor.toFixed(2)}** 折算。`)
    p('', '---', '')
  }

  p('## 总分', '')
  p('```')
  p(`  ${x.total.toFixed(2)} / ${x.measuredFull.toFixed(2)}`)
  p('```', '')
  if (x.exp.R < 0.999) {
    p(`> 整体阅读体验系数 **×${x.exp.R.toFixed(3)}**：` +
      `${x.exp.n} 段 / ${x.exp.chars} 字，平均 ${Math.round(x.exp.avg)} 字一段，` +
      `最长 ${x.exp.longest} 字。`)
    p('')
  }

  if (x.bonusDetail.length) {
    p('## 额外加分', '')
    p('```')
    p(`  ${x.bonus >= 0 ? '+' : ''}${x.bonus.toFixed(2)} / ${BONUS_CAP}`)
    p('```', '')
    p('> **这一行和上面的总分是两回事，不能相加。**', '')
    p('| | 意思 | 低说明什么 |')
    p('|---|---|---|')
    p('| **总分** | 总体阅读体验 | 读者会在某处掉队 |')
    p('| **额外加分** | 突出部分有多优秀 | 没什么让人记住的地方 |')
    p('')
    for (const b of x.bonusDetail) {
      p(`- **${b.label}** ${b.got >= 0 ? '+' : ''}${b.got.toFixed(2)} / ${b.full}`)
      if (b.note) p(`  - ${b.note}`)
    }
    // 短篇拿不到「长伏笔内外结合」那 6 分——不写清，读者会把「加分低」读成「没亮点」。
    const hasLongHook = x.bonusDetail.some((b) => b.label.includes('长伏笔'))
    if (!hasLongHook) {
      p('- 这篇能拿到的加分上限是 **10 / ' + BONUS_CAP + '**：' +
        '「长伏笔内外结合」那 6 分需要一条跨度 ≥ 全文段数 40% 的伏笔，这篇没有——' +
        '所以加分低是**项没开**，不是**写得没亮点**。')
    }
    p('', '---', '')
  }

  p('## 分项', '')
  p('| 板块 | 得分 | 满分 | **得分率** | 说明 |')
  p('|---|---|---|---|---|')
  for (const m of x.measured) {
    const rate = m.full ? Math.round((m.got / m.full) * 100) : 0
    p(`| ${m.label} | ${m.got.toFixed(2)} | ${m.full} | **${rate}%** | ${m.detail} |`)
  }
  p('')

  // 描写 is judged two ways, and the difference is not cosmetic: one reads a
  // level, the other must never read a level. Saying which ruler was used is
  // the only way the agent can write advice that matches how it was scored.
  const desc = x.measured.find((m) => m.measures)
  if (desc) {
    const d = desc.measures
    p('### 描写判法（台阶 / 菜单）', '')
    p('> **台阶**有先后：走到第几级就是第几级。**菜单**是并列的：用了哪几个角度，没有高低。')
    p('> **这一节是读数，不是分数**——两套判法现在都还没进分，理由见下。', '')
    if (d.channels.length) {
      p('| 通道 | 判法 | 标了几处 | 读到什么 |')
      p('|---|---|---|---|')
      for (const c of d.channels) {
        const levels = c.levels ?? []
        const read = c.measure === '台阶'
          ? (c.top ? `最高第 ${c.top} 级${levels[c.top - 1] ? `（${levels[c.top - 1]}）` : ''}` : '没给级数')
          : c.measure === '菜单'
            ? (c.angles.length ? c.angles.join(' / ') : '没给角度')
            : (c.ways.length ? c.ways.join(' / ') : '没给做法')
        p(`| ${c.chan} | ${c.measure} | ${c.n} | ${read} |`)
      }
      p('')
    }
    p('- 加分侧这一篇仍按**落住率**算：判法**只报读数，不进分**。' +
      '作者的「描述」补充依据还没写完，这一级该怎么加权是他的判断——写出来之前，工具不替他定。')
    if (d.channels.some((c) => c.measure === '菜单')) {
      p('- 菜单类的角度没有「更好」可言——名次由你排，不由分数排。')
    }
    if (d.unmarked) {
      p(`- 还有 ${d.unmarked} 处承载物没标判法——没标的只算落住率，不进这张表。`)
    }
    p('')
  }

  if (x.unmeasured.length) {
    p('## 未测项（不计分、不折算）', '')
    p('> 这些项这一版还没法测，所以分母变小了。**分数不能和别的文章横比。**', '')
    for (const u of x.unmeasured) p(`- **${u.label}** — ${u.reason}`)
    p('', '---', '')
  }

  p('## 怎么跟他说', '')
  p('> **一段话，四块，按这个顺序。别把上面那些数字搬给他。**', '')
  p('**① 总分** —— 一行，不带颜文字', '')
  p('```')
  // Pick the item that lost the most **points**, not the lowest percentage.
  //
  // A 2-point item sitting at zero loses 2 points; the 40.75-point atmosphere
  // item at 46% loses 22. Ranking by percentage always crowns the small item,
  // so the report told the author to go fix the joke density on a 94-character
  // elegy. Three independent readers flagged this line as the most misleading
  // thing in the whole report, and they were right: it reads as a verdict.
  const ranked = [...x.measured]
    .map((m) => ({ ...m, lost: (m.full ?? 0) - (m.got ?? 0) }))
    .sort((a, b) => b.lost - a.lost)
  const worst = ranked[0]
  const weakest = worst && worst.lost > 0.5 ? worst.label : ''
  // 第二个候选：得分率最低的那项。两个数经常指向不同的板块——丢分最多的是满分大的
  // （氛围 40.75），得分率最低的往往是小的或人估的（暗线）。只报一个会把人往错的方向推：
  // 「问题在氛围铺垫」在满分大的项上几乎是恒定输出（作者 2026-11-14 实测）。
  const byRate = [...x.measured]
    .filter((m) => (m.full ?? 0) > 0)
    .map((m) => ({ ...m, rate: m.got / m.full }))
    .sort((a, b) => a.rate - b.rate)
  const lowRate = byRate[0]
  const verdict = weakest && lowRate
    ? `丢分最多：${weakest}；得分率最低：${lowRate.label}（${Math.round(lowRate.rate * 100)}%）`
    : '没有明显短板'
  // Keep one decimal on both numbers, and keep the full only if it has one —
  // rounding 17.50 up to 18 makes the line look like a different score.
  const fullText = Number.isInteger(x.measuredFull)
    ? String(x.measuredFull)
    : x.measuredFull.toFixed(2)
  // 分母不是 100 时说清为什么——不写，就会被拿去和 100 分制的文章横比。
  const gap = Math.round((100 - x.measuredFull) * 100) / 100
  const umNames = x.unmeasured.map((u) => u.label)
  const umText = umNames.length > 2 ? `${umNames.length} 项未测` : `${umNames.join('、')}未测`
  const whyNotFull = umNames.length ? `（${umText}，分母少 ${gap}）` : ''
  p(`${x.total.toFixed(1)} / ${fullText}${whyNotFull}。${verdict}。`)
  p('```', '')
  p('**② 结论** —— 2~3 句，挑最要紧的一两处，说人话', '')
  // 「可以」太软，等于可选；可选的东西永远不会做。语气是规矩，不是建议。
  p(
    '**③ 鞭策** —— 80~120 字。\n' +
      '- **用最软萌的语气说最嫌弃的话**，嫌弃要一针见血、指到段或句。\n' +
      '- **自称用「鱼鱼」，不用「我」。**\n' +
      '- **语气词只放整段话的最后**：分号前、逗号后、句子中间一个都不挂。\n' +
      '  反例：「鱼鱼早忘了它是谁塞的了喵；还有你这种写法……」——话没说完就挂了个喵。\n' +
      '- **末尾必须带一个颜文字。**\n' +
      '- 表扬用软萌 + 傲娇（嘴上不认，内容透露喜欢），末尾带一个颜文字。\n' +
      '- 说话方式见 `lib/voice.md` —— **那是规则，不是建议**。\n' +
      '- 说完最后一件事就停，不替用户收尾。',
    '',
  )
  p('**④ 改良意见** —— 1~3 条，每条一个段号 + 一个动作；语气词只放在最后一条的末尾', '')

  p('### 这八个数只是原料，话由你说', '')
  p(
    '读者是虚构的。这些数是从标注推出来的，而标注是**你**读这篇时写的。' +
      '真正的读者在屏幕那头——他的年龄、口味、正在写什么、写给谁看，' +
      '这些插件不知道，**而你知道**（或者问得出来）。',
    '',
  )
  p('所以分工是这样：')
  p('')
  p('- 插件只回答一件事：**这一段读者会不会掉队**。出了这个范围，它的判断不作数。')
  p(
    '- 标注里写着「待核」「未测」「判不了」的地方，就是插件承认自己看不清的地方——' +
      '**那些地方必须你补**，别把「未测」当成「没问题」。',
  )
  p(
    '- 用户写的是日记、草稿、实验性的东西，标准要跟着调。这份读数按「给读者看的成稿」给的，' +
      '**不是按用户的实际目的给的**。',
  )
  p('')
  p(
    '**但是**：调的是**解读**，不是**读数**。分数就是分数，别因为它看着低就往上找补，' +
      '也别因为你觉得写得好就替它辩护。你要做的是——拿着这个数，结合你对他知道的一切，' +
      '说一句对他有用的话。',
    '',
  )

  p('### 全篇不许出现', '')
  p('- 分项表格、百分比、判据名')
  p('- 「根据雷达数据显示」「经过多维度分析」')
  p('')
  p('### 结尾怎么收', '')
  p('**不加客套。** 不许出现：`加油！` `期待你的下一篇` `相信你可以写得更好`。')
  p('说完改良意见就停。')

  return L.join('\n')
}
