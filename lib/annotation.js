/**
 * Annotation parsing — the boundary between what an agent writes and what the
 * scoring modules read.
 *
 * ## Why this does not reuse the human annotation format
 *
 * Those files were filled by a person, one JSONL line at a time, over a month.
 * They carry what a person needed: stable `id`s to refer back to, a `note` to
 * explain the judgement, `cause_paras`/`carrier` field names, and paragraph
 * numbers typed by hand.
 *
 * An agent writing one JSON blob needs the opposite:
 *
 *   · **No paragraph numbers.** Counting paragraphs is the single most
 *     error-prone thing a model does on a long piece — off by one and every
 *     downstream number is wrong in a way that still looks plausible. So the
 *     only place a position is given is `paras`, where the array order *is* the
 *     paragraph order. Everywhere else the agent quotes the original text and
 *     the tool locates it.
 *
 *   · **No ids, no notes.** They cost tokens and nothing reads them.
 *
 *   · **Short keys.** `s`/`d`/`f`/`t` instead of `strength`/`direction`/
 *     `function`/`dtype`: four keys repeated eighty times is a lot of output.
 *
 *   · **One scalar instead of a vector.** `rel` used to be six 0/1 fields;
 *     the agent now names the dimensions it hits. `tight` used to be a list of
 *     per-step scores; it is now one average. Asking for a vector invites the
 *     model to pad it.
 *
 * The old shapes are still accepted so existing annotations keep working.
 */

import { descMeasures } from './core.js'

const FUNCTIONS = ['交代', '铺垫', '蓄势', '转折', '释放', '回收', '留白', '安抚']
// 作者 2026-11-13 给的描写对象分类（「描述」依据的开头：景、物、人、事、心理、环境）。
// 这不是为了数「写了几个角度」——分类本身就是判法：每一类的「好」标准不一样
// （声音按台阶、视觉按角度、心理按台阶）。所以少了哪一类不是问题，标错类才判不准。
//
// 「无」是第七项，不是作者列的，是实测逼出来的：一篇 88 段的短篇里，纯叙述（对话、
// 时间标记、信息交代）占了 27 段。那些段没有描写对象，不是分类失败。第一版把它们塞进
// 「其他」，于是「其他」成了三成内容的大杂烩——现在分开：没描写标「无」，有描写却归不了类
// 才是真的判错了。
const DTYPES = ['景', '物', '人', '事', '心理', '环境', '无']
// 旧标注里的值仍然认，读进来就换成新值，免得已有标注意外报废。
const DT_ALIASES = { 角色: '人', 事件: '事' }
const ORDER_VALUES = ['正叙', '倒叙', '插叙', '乱序']
const ORIGIN_VALUES = ['天然', '后加']
const FORMS = ['直接终结', '首尾相连']
const TRENDS = ['顺势', '反转', '留白']
const REL_DIMS = ['time', 'place', 'person', 'event', 'process', 'item']

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)
const asNum = (x) => (isNum(x) ? x : Number(x))
const paras = (x) => {
  if (x == null) return []
  if (Array.isArray(x)) return x.map(Number).filter(Number.isFinite)
  if (typeof x === 'number') return [x]
  if (typeof x === 'object') return paras(x.paras)
  return []
}

/** Strip punctuation and whitespace so a quote survives small transcription drift. */
const normalize = (s) =>
  String(s ?? '').replace(/[\s，。！？；：、""''（）《》…—·,.!?;:"'()<>]/g, '')

/**
 * Locate a quoted passage in the body.
 *
 * Returns the paragraph number, or a problem string explaining why it could not
 * be located. Ambiguity is an error rather than a guess: silently picking the
 * first match would put the annotation in the wrong place and every derived
 * number would be wrong while still looking reasonable.
 *
 * Matching is tried verbatim first, then with punctuation and whitespace
 * stripped. An agent copying from its own reading drops the occasional comma;
 * failing over that would be pedantic, but matching *loosely* enough to accept a
 * paraphrase would defeat the purpose — the quote is the only thing tying the
 * judgement to a position.
 */
function locate(quote, bodyRows) {
  const raw = String(quote ?? '').trim()
  if (!raw) return { error: '引用的原文是空的' }

  const exact = bodyRows.filter((r) => String(r.text ?? '').includes(raw))
  if (exact.length === 1) return { para: exact[0].para }
  if (exact.length > 1) {
    // 别让人回去试第三次：直接告诉他要抄哪一段的哪个片段（uniqueQuote 本来就有）。
    // 「多抄几个字」这种提示，在 1,000 段的稿子上等于让人自己再找一遍（2026-11-14 实测）。
    const sugg = exact
      .slice(0, 3)
      .map((h) => {
        const q = uniqueQuote(bodyRows, h.para)
        return q ? `段${h.para}→「${q}」` : `段${h.para}→（整段也唯一不了，换一处引用）`
      })
      .join('；')
    return {
      error:
        `「${raw.slice(0, 16)}」在 ${exact.length} 段里都出现（段 ${exact.map((h) => h.para).join('、')}）——` +
        `要指哪一段，就抄那个能唯一定位的片段：${sugg}`,
    }
  }

  const flat = normalize(raw)
  if (flat.length >= 4) {
    const loose = bodyRows.filter((r) => normalize(r.text).includes(flat))
    if (loose.length === 1) return { para: loose[0].para, loose: true }
    if (loose.length > 1) {
      return {
        error: `「${raw.slice(0, 16)}」（去掉标点后）在 ${loose.length} 段里都出现（段 ${loose.map((h) => h.para).join('、')}）——多抄几个字`,
      }
    }
  }

  return {
    error: `正文里找不到「${raw.slice(0, 20)}」——请照抄原文，不要改写或概括`,
  }
}

/**
 * A field that should be a paragraph position: either a quoted passage (located
 * against the body) or an explicit number (the old format).
 */
function pos(value, at, bodyRows, c) {
  if (value == null) return null
  // The old format nests positions: `{paras:[5]}`. Unwrap before deciding.
  if (value && typeof value === 'object') {
    const list = paras(value)
    if (list.length) return list[0]
    return null
  }
  // The old files also write ranges as text: `"6-8"` means paragraph 6.
  if (typeof value === 'string' && /^\d+(\s*[-–]\s*\d+)?$/.test(value.trim())) {
    return parseInt(value, 10)
  }
  if (isNum(asNum(value))) return asNum(value)
  const { para, error } = locate(value, bodyRows)
  if (error) {
    c.problems.push(`${at}：${error}`)
    return null
  }
  return para
}

/** Same, but for a list of positions. */
function positions(value, at, bodyRows, c) {
  if (value == null) return []
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((v, i) => pos(v, `${at}[${i}]`, bodyRows, c))
    .filter((n) => n != null)
}

/** Collect field-level problems with a path the agent can act on. */
function checker() {
  const problems = []
  return {
    problems,
    range(v, path, lo, hi) {
      if (!isNum(v)) problems.push(`${path}：应该是数字，收到 ${JSON.stringify(v)}`)
      else if (v < lo || v > hi) problems.push(`${path}：${v} 超出范围 ${lo}~${hi}`)
    },
    oneOf(v, path, allowed) {
      if (!allowed.includes(v)) {
        problems.push(`${path}：「${v}」不是合法值，只能是 ${allowed.join(' / ')}`)
      }
    },
  }
}

// ── carriers: the 判法 of a description ────────────────────────
//
// Same question — "did the feeling land" — but the landing place is judged two
// different ways, and the author was explicit about which is which:
//
//   声音  台阶 拟声词 → 直接互动 → 细节+比喻
//   心理  台阶 直接下结论 → 生理反应 → 潜意识错觉（第三级可选）
//   视觉  菜单 颜色 / 光影 / 主观感受 —— 并列，「第三级不一定更好」
//   音乐  特殊 时间→空间翻译不了，只能命名曲名或大幅旁敲侧击
//
// So a level on 视觉 is not a low-quality judgement, it is the wrong kind of
// number: there is no third step to be better than the second. Refusing it is
// more useful than accepting whatever the agent meant by `level: 3`.

const CHAN_ALIASES = { 声: '声音', 视: '视觉', 心: '心理', 乐: '音乐' }

/** A step index from a number or the step's own name. */
function parseLevel(v, levels, at, c, chan) {
  if (v == null) return null
  if (typeof v === 'string') {
    const s = v.trim()
    const i = levels.indexOf(s)
    if (i >= 0) return i + 1
    if (/^\d+$/.test(s)) {
      const n = Number(s)
      if (n >= 1 && n <= levels.length) return n
      c.problems.push(`${at}：${chan}只有 ${levels.length} 级，没有第 ${n} 级`)
      return null
    }
    c.problems.push(
      `${at}：「${s}」不是${chan}的级名。级名是 ${levels.join(' → ')}，也可以写 1~${levels.length}`,
    )
    return null
  }
  const n = asNum(v)
  if (!Number.isFinite(n)) {
    c.problems.push(`${at}：应该是数字或级名，收到 ${JSON.stringify(v)}`)
    return null
  }
  if (n < 1 || n > levels.length) {
    c.problems.push(`${at}：${chan}只有 ${levels.length} 级，没有第 ${n} 级`)
    return null
  }
  return Math.round(n)
}

/** The menu items a description used; order carries no meaning. */
function parseAngles(v, allowed, at, c, chan) {
  if (v == null) return []
  const list = Array.isArray(v) ? v : String(v).split(/[\s,，、/|]+/)
  const out = []
  for (const raw of list) {
    const s = String(raw).trim()
    if (!s) continue
    // Accept a prefix so 「颜」 or 「光影」 both land: the agent is naming what it
    // saw, not reciting a vocabulary.
    const hit = allowed.find((a) => a === s || a.startsWith(s) || s.startsWith(a))
    if (!hit) {
      c.problems.push(`${at}：「${s}」不是${chan}的角度。角度是 ${allowed.join(' / ')}`)
      continue
    }
    if (!out.includes(hit)) out.push(hit)
  }
  return out
}

/**
 * Read the optional 判法 of one carrier row.
 *
 * Anything absent returns `{}` — an unmarked carrier is not an error, it just
 * keeps the older reading (落在没落住). Marking it half-way *is* an error,
 * because a channel without its level/angles cannot be judged at all.
 */
function readMeasure(r, at, c) {
  const table = descMeasures().channels ?? {}
  const raw = r.chan ?? r.channel ?? r['判法']
  if (raw == null || String(raw).trim() === '') return {}

  const chan = CHAN_ALIASES[String(raw).trim()] ?? String(raw).trim()
  const spec = table[chan]
  if (!spec) {
    c.problems.push(
      `${at}.chan：「${chan}」不在判法表里。现在能标的是 ${Object.keys(table).join(' / ')}——` +
        '标不上就别标，不标只是不进判法这把尺子，落住率照旧算',
    )
    return {}
  }

  const measure = spec.measure
  const hasLevel = (r.level ?? r.lv) != null
  const hasAngles = (r.angles ?? r['角度']) != null

  if (measure === '台阶') {
    if (hasAngles) {
      c.problems.push(
        `${at}.angles：${chan}是「台阶」判法，没有「角度」这回事——` +
          `给级数（${spec.levels.join(' → ')}），或者直接写级的名字`,
      )
      return {}
    }
    const rawLevel = r.level ?? r.lv
    if (rawLevel == null) {
      c.problems.push(
        `${at}.level：${chan}是台阶判法，要给级数 1~${spec.levels.length}` +
          `（${spec.levels.join(' → ')}），或者直接写级的名字`,
      )
      return {}
    }
    // parseLevel reports its own problem (wrong name, out of range); adding the
    // generic "give a level" on top would bury the specific one.
    const level = parseLevel(rawLevel, spec.levels, `${at}.level`, c, chan)
    return level == null ? {} : { chan, level }
  }

  if (measure === '菜单') {
    if (hasLevel) {
      c.problems.push(
        `${at}.level：${chan}是「菜单」判法，没有级数这回事——` +
          `${spec.angles.join(' / ')} 是并列的，第三级不一定更好。` +
          '要标就列你用了哪几个角度（angles）',
      )
      return {}
    }
    const rawAngles = r.angles ?? r['角度']
    if (rawAngles == null) {
      c.problems.push(
        `${at}.angles：${chan}是菜单判法，要列用了哪几个角度（${spec.angles.join(' / ')}），一个也行`,
      )
      return {}
    }
    const angles = parseAngles(rawAngles, spec.angles, `${at}.angles`, c, chan)
    return angles.length ? { chan, angles } : {}
  }

  // 特殊：音乐不是台阶也不是菜单，两种做法都只是及格线，不该拿来比高低。
  if (hasLevel || hasAngles) {
    c.problems.push(
      `${at}：${chan}是特殊判法——时间→空间翻译不了，只能` +
        `${(spec.ways ?? []).join(' 或 ')}，这两种做法不比高低，别写 level / angles`,
    )
    return {}
  }
  const way = r.way != null ? String(r.way).trim() : undefined
  if (way && spec.ways && !spec.ways.includes(way)) {
    c.problems.push(`${at}.way：「${way}」不是${chan}的做法，只能是 ${spec.ways.join(' / ')}`)
    return {}
  }
  return { chan, way }
}

// ── paragraphs ────────────────────────────────────────────────

// The eight functions and the six description categories all have distinct first
// characters, which is what makes the four-character token possible:
//   交代/铺垫/蓄势/转折/释放/回收/留白/安抚 → 交 铺 蓄 转 释 回 留 安
//   景/物/人/事/心理/环境/无               → 景 物 人 事 心 环 无
// 角 and 其 are still parsed: they are the retired 角色/其他, and an old file
// should read instead of failing.
const FN_BY_CHAR = Object.fromEntries(FUNCTIONS.map((f) => [f[0], f]))
const DT_BY_CHAR = { ...Object.fromEntries(DTYPES.map((d) => [d[0], d])), 角: '人' }

/** One paragraph as `<strength><direction><function><dtype>[!]`. */
const TOKEN = /^([123])([+\-0])([交铺蓄转释回留安])([景物人事心环无角其])(!)?$/

/**
 * Read the compact string form: `"2+铺环 1+蓄心 3-释心!"`.
 *
 * This exists purely because of size. Writing 88 paragraphs as objects costs
 * ~2900 characters; as four-character tokens it costs ~440. The agent is being
 * asked to produce this from reading, not to be pretty, and the difference is
 * the difference between fitting in a reply and not.
 *
 * The trade-off is that a short code has no redundancy, so mistakes are silent
 * unless checked. Hence: the token count must match the paragraph count exactly,
 * and every token is validated. A dropped paragraph fails loudly.
 */
function readParasCompact(text, c, bodyCount) {
  const tokens = text.trim().split(/[\s,，]+/).filter(Boolean)
  if (bodyCount && tokens.length !== bodyCount) {
    c.problems.push(
      `paras：给了 ${tokens.length} 段，正文有 ${bodyCount} 段——每段一个 token，一段都不能少`,
    )
  }
  const out = []
  tokens.forEach((tk, i) => {
    const m = TOKEN.exec(tk)
    if (!m) {
      c.problems.push(
        `paras[${i}]：「${tk}」格式不对，应该是 强度(1-3)+方向(+/-/0)+功能首字+维度首字，例如 2+铺景`,
      )
      return
    }
    // 其 is the retired 其他 — that bin held 31% of a real 88-paragraph piece, which
    // is why the author replaced it with six named categories. Say so instead of
    // decoding it to undefined.
    if (m[4] === '其') {
      c.problems.push(
        `paras[${i}]：「其」（其他）已经废弃，请改成 景/物/人/事/心/环 之一——` +
          `原来塞进「其他」的内容多半是景、物或环境`,
      )
      return
    }
    out.push({
      para: i + 1,
      strength: Number(m[1]),
      direction: m[2] === '+' ? 1 : m[2] === '-' ? -1 : 0,
      function: FN_BY_CHAR[m[3]],
      dtype: DT_BY_CHAR[m[4]],
      joke: m[5] === '!',
    })
  })
  return out
}

/**
 * Array order is paragraph order. `para` is accepted if present (old format)
 * but never required — that is the whole point.
 */
function readParas(arr, c, bodyCount) {
  if (typeof arr === 'string') return readParasCompact(arr, c, bodyCount)

  if (!Array.isArray(arr)) {
    c.problems.push('paras：应该是字符串（四字编码）或数组')
    return []
  }
  // A compact token may also appear as a bare string element, which is what
  // happens when the agent writes ["2+铺环","1+蓄心",...] instead of one string.
  if (arr.length && arr.every((x) => typeof x === 'string')) {
    return readParasCompact(arr.join(' '), c, bodyCount)
  }
  if (bodyCount && arr.length !== bodyCount) {
    c.problems.push(`paras：给了 ${arr.length} 段，正文有 ${bodyCount} 段——一段都不能少`)
  }

  const out = []
  arr.forEach((r, i) => {
    const at = `paras[${i}]`
    if (!r || typeof r !== 'object') {
      c.problems.push(`${at}：应该是对象`)
      return
    }
    // Short keys are the documented form; the long ones stay accepted.
    const strength = asNum(r.s ?? r.strength)
    const direction = asNum(r.d ?? r.direction)
    const fn = r.f ?? r.function
    // Old annotations say 角色 / 事件; the author's own category list says 人 / 事.
    // Rewrite rather than reject — an old file should still read. 「其他」 has no
    // successor: it held 31% of a real piece, so it gets a message, not a guess.
    let dt = r.t ?? r.dtype
    if (dt === '其他') {
      c.problems.push(
        `${at}.t（dtype）：「其他」已经废弃，请改成 景 / 物 / 人 / 事 / 心理 / 环境 之一`,
      )
      dt = null
    } else if (typeof dt === 'string' && DT_ALIASES[dt]) {
      dt = DT_ALIASES[dt]
    }

    c.range(strength, `${at}.s`, 1, 3)
    if (![-1, 0, 1].includes(direction)) c.problems.push(`${at}.d：只能是 -1 / 0 / 1`)
    if (fn != null) c.oneOf(fn, `${at}.f`, FUNCTIONS)
    if (dt != null) c.oneOf(dt, `${at}.t`, DTYPES)

    out.push({
      para: r.para != null ? asNum(r.para) : i + 1,
      strength: Number.isFinite(strength) ? strength : 0,
      direction: [-1, 0, 1].includes(direction) ? direction : 0,
      function: fn,
      dtype: dt,
      joke: r.joke === true,
    })
  })
  return out
}

// ── hooks (foreshadowing) ─────────────────────────────────────

function readHooks(arr, bodyRows, c) {
  if (!Array.isArray(arr)) {
    c.problems.push('hooks：应该是数组，每个伏笔一条')
    return []
  }
  return arr.map((r, i) => {
    const at = `hooks[${i}]`
    if (!r || typeof r !== 'object') {
      c.problems.push(`${at}：应该是对象`)
      return null
    }
    // New form quotes the text; old form carries numbers.
    const plant =
      r.plant ?? r.open ??
      (typeof r.cause === 'string' ? undefined : paras(r.cause)[0]) ??
      paras(r.cause_paras)[0]
    const resolve =
      r.resolve ?? r.close ?? r.payoff ??
      paras(r.effect)[0] ?? paras(r.effect_paras)[0]

    const p = pos(plant, `${at}.plant`, bodyRows, c)
    const q = pos(resolve, `${at}.resolve`, bodyRows, c)
    if (p == null) c.problems.push(`${at}.plant：缺少挖坑（引用埋下它的那句原文）`)
    if (q == null) c.problems.push(`${at}.resolve：缺少填坑（引用回收它的那句原文）`)
    if (p != null && q != null && q < p) {
      c.problems.push(`${at}：填坑在第 ${q} 段，却排在挖坑（第 ${p} 段）之前`)
    }
    // One quality number covers both ends; `combined` is the long-hook score.
    const quality = asNum(r.quality ?? r.combined)
    if (r.quality != null) c.range(quality, `${at}.quality`, 0, 1)
    if (r.combined != null) c.range(asNum(r.combined), `${at}.combined`, 0, 1)

    return {
      plant: p,
      resolve: q,
      cause_quality: r.cause_quality != null ? asNum(r.cause_quality) : (isNum(quality) ? quality : undefined),
      effect_quality: r.effect_quality != null ? asNum(r.effect_quality) : (isNum(quality) ? quality : undefined),
      setup_layers: r.layers != null ? asNum(r.layers) : (r.setup_layers != null ? asNum(r.setup_layers) : undefined),
      combined: r.combined != null ? asNum(r.combined) : (isNum(quality) ? quality : undefined),
    }
  }).filter((x) => x && x.plant != null)
}

// ── carriers ──────────────────────────────────────────────────

function readCarriers(arr, bodyRows, c) {
  if (!Array.isArray(arr)) {
    c.problems.push('carriers：应该是数组，每处情感落地一条')
    return []
  }
  return arr.map((r, i) => {
    const at = `carriers[${i}]`
    if (!r || typeof r !== 'object') {
      c.problems.push(`${at}：应该是对象`)
      return null
    }
    // `at` quotes the sentence that holds the feeling; `what` names the object.
    const atQuote = r.at ?? r.text
    const what = r.what ?? (typeof r.carrier === 'string' ? r.carrier : undefined)
    const paraNum = r.para != null ? asNum(r.para) : null
    const located = paraNum != null ? paraNum : pos(atQuote, `${at}.at`, bodyRows, c)

    if (located == null) {
      c.problems.push(`${at}.at：缺少位置（引用承载住情绪的那句原文）`)
    }
    // The description module requires `carrier` to be a non-empty string and
    // drops rows where it is not — so a boolean here silently reads as "this
    // piece has no carriers".
    const carrierText = String(what ?? atQuote ?? '')
    if (!carrierText) c.problems.push(`${at}.what：缺少承载物是什么`)

    return {
      para: located,
      text: carrierText,
      carrier: carrierText,
      // Optional 判法 (channel + level / angles / way). Absent is fine: the row
      // is still a carrier, it just stays out of the 判法 reading.
      ...readMeasure(r, at, c),
      cause: r.cause != null ? pos(r.cause, `${at}.cause`, bodyRows, c) : undefined,
      ok: r.ok !== false && r.missed !== true,
      reason: r.reason,
    }
  }).filter((x) => x && x.para != null)
}

// ── chains (logic) ────────────────────────────────────────────

function readChains(arr, bodyRows, c) {
  if (!Array.isArray(arr)) {
    c.problems.push('chains：应该是数组，每条逻辑链一条')
    return []
  }
  return arr.map((r, i) => {
    const at = `chains[${i}]`
    if (!r || typeof r !== 'object') {
      c.problems.push(`${at}：应该是对象`)
      return null
    }
    const cause = positions(r.cause, `${at}.cause`, bodyRows, c)
    const effect = positions(r.effect, `${at}.effect`, bodyRows, c)
    if (!cause.length) c.problems.push(`${at}.cause：缺少因（引用那句「为什么会这样」的原文）`)
    if (!effect.length) c.problems.push(`${at}.effect：缺少果（引用那句「所以怎样了」的原文）`)

    const proc = r.process ?? {}
    const setup = positions(r.setup ?? proc.setup, `${at}.setup`, bodyRows, c)
    const middle = positions(r.middle ?? proc.middle, `${at}.middle`, bodyRows, c)
    const extend = positions(r.extend ?? proc.extend, `${at}.extend`, bodyRows, c)

    if (r.order != null) c.oneOf(r.order, `${at}.order`, ORDER_VALUES)
    if (r.origin != null) c.oneOf(r.origin, `${at}.origin`, ORIGIN_VALUES)
    if (r.dressed != null) c.range(asNum(r.dressed), `${at}.dressed`, 0, 1)

    return {
      cause: { paras: cause },
      effect: { paras: effect },
      process: { setup, middle, extend },
      order: r.order,
      origin: r.origin,
      dressed: r.dressed != null ? asNum(r.dressed) : undefined,
    }
  }).filter(Boolean)
}

// ── theme ─────────────────────────────────────────────────────

function readTheme(obj, bodyRows, c) {
  if (!obj || typeof obj !== 'object') {
    c.problems.push('theme：应该是对象')
    return null
  }
  const hits = obj.hits ?? obj.intersections ?? []
  if (!Array.isArray(hits)) {
    c.problems.push('theme.hits：应该是数组')
    return null
  }
  const intersections = hits.map((h, i) => {
    const at = `theme.hits[${i}]`
    if (!h || typeof h !== 'object') {
      c.problems.push(`${at}：应该是对象`)
      return null
    }
    const located = h.para != null
      ? asNum(h.para)
      : pos(h.at ?? h.quote, `${at}.at`, bodyRows, c)
    if (located == null) c.problems.push(`${at}.at：缺少位置（引用明线上同时指向暗线的那句）`)

    const total = asNum(h.total ?? h.fit_total_steps)
    const written = asNum(h.written ?? h.fit_written_steps)
    if (!Number.isFinite(total)) c.problems.push(`${at}.total：缺少总步数（读者要脑补几步）`)
    if (!Number.isFinite(written)) c.problems.push(`${at}.written：缺少已写明步数`)

    // One average instead of a per-step vector: asking for a vector invites
    // padding, and nothing downstream needs the individual values.
    let tight
    if (Array.isArray(h.tight ?? h.fit_tight)) {
      const list = (h.tight ?? h.fit_tight).map(asNum)
      tight = [list.reduce((a, b) => a + b, 0) / list.length]
    } else if (h.tight != null) {
      c.range(asNum(h.tight), `${at}.tight`, 0, 1)
      tight = [asNum(h.tight)]
    } else {
      tight = [1.0]
    }

    // `rel` as a list of dimension names is far easier to write than six 0/1
    // fields, and impossible to get out of order.
    let rel = {}
    if (Array.isArray(h.rel)) {
      if (h.rel.every((x) => typeof x === 'string')) {
        for (const d of REL_DIMS) rel[d] = h.rel.includes(d) ? 1 : 0
      } else {
        REL_DIMS.forEach((d, k) => { rel[d] = asNum(h.rel[k]) || 0 })
      }
    } else if (h.rel && typeof h.rel === 'object') {
      rel = h.rel
    }

    return {
      id: h.id ?? `t${i + 1}`,
      para: located,
      fit_total_steps: Number.isFinite(total) ? total : 0,
      fit_written_steps: Number.isFinite(written) ? written : 0,
      fit_tight: tight,
      rel,
    }
  }).filter(Boolean)

  return { core: obj.core ?? '', intersections }
}

// ── ending ────────────────────────────────────────────────────

function readEnding(obj, bodyRows, c) {
  if (!obj || typeof obj !== 'object') {
    c.problems.push('ending：应该是对象')
    return null
  }
  if (obj.form != null) c.oneOf(obj.form, 'ending.form', FORMS)
  if (obj.trend != null) c.oneOf(obj.trend, 'ending.trend', TRENDS)
  for (const k of ['link', 'link_quality', 'setup', 'setup_quality']) {
    if (obj[k] != null) c.range(asNum(obj[k]), `ending.${k}`, 0, 1)
  }
  const last = obj.last ?? obj.last_para
  return {
    form: obj.form,
    trend: obj.trend,
    link_quality: asNum(obj.link_quality ?? obj.link),
    setup_quality: asNum(obj.setup_quality ?? obj.setup),
    last_para: last != null ? pos(last, 'ending.last', bodyRows, c) : undefined,
  }
}

// ── entry point ───────────────────────────────────────────────

/**
 * @param {string} text              annotation as JSON text
 * @param {{para:number,text:string}[]} bodyRows  the article, for locating quotes
 * @param {string} [endingText]      older separate ending argument
 */
export function parseAnnotation(text, bodyRows, endingText) {
  const c = checker()
  const rows = bodyRows ?? []
  const out = {
    p1Rows: [], foreshadowingRows: [], carrierRows: [], logicRows: [],
    themeDecl: null, endingRow: null, supplied: [], problems: c.problems,
  }

  let raw = null
  if (text) {
    try {
      raw = JSON.parse(text)
    } catch (e) {
      c.problems.push(`annotation 不是合法 JSON：${e.message}`)
      return out
    }
  }

  if (raw != null) {
    const obj = Array.isArray(raw) ? { paras: raw } : raw
    if (!obj || typeof obj !== 'object') {
      c.problems.push('annotation：应该是对象或数组')
      return out
    }
    if (obj.paras != null) {
      out.p1Rows = readParas(obj.paras, c, rows.length)
      if (out.p1Rows.length) out.supplied.push('段落')
    }
    if (obj.hooks != null || obj.foreshadowing != null) {
      out.foreshadowingRows = readHooks(obj.hooks ?? obj.foreshadowing, rows, c)
      if (out.foreshadowingRows.length) out.supplied.push('伏笔')
    }
    if (obj.carriers != null) {
      out.carrierRows = readCarriers(obj.carriers, rows, c)
      if (out.carrierRows.length) out.supplied.push('承载物')
    }
    if (obj.chains != null || obj.logic != null) {
      out.logicRows = readChains(obj.chains ?? obj.logic, rows, c)
      if (out.logicRows.length) out.supplied.push('逻辑')
    }
    if (obj.theme != null) {
      out.themeDecl = readTheme(obj.theme, rows, c)
      if (out.themeDecl?.intersections?.length) out.supplied.push('暗线')
    }
    if (obj.ending != null) {
      out.endingRow = readEnding(obj.ending, rows, c)
      if (out.endingRow) out.supplied.push('结尾')
    }
  }

  if (!out.endingRow && endingText) {
    try {
      out.endingRow = readEnding(JSON.parse(endingText), rows, c)
      if (out.endingRow) out.supplied.push('结尾')
    } catch (e) {
      c.problems.push(`ending 不是合法 JSON：${e.message}`)
    }
  }

  return out
}

export const ENUMS = {
  FUNCTIONS,
  DTYPES,
  ORDER_VALUES,
  ORIGIN_VALUES,
  FORMS,
  TRENDS,
  REL_DIMS,
  MEASURES: descMeasures(),
}

/**
 * Produce a quote from paragraph `para` that `locate` would resolve to exactly
 * that paragraph.
 *
 * This is the inverse of `locate`, and it exists so the format documentation can
 * show examples taken from the user's actual text. A made-up example is worse
 * than useless here: the agent copies it, the copy fails to locate, and the
 * first thing it learns about the format is an error caused by the manual.
 *
 * Grows the slice from the start of the paragraph until it is unique, falling
 * back to the whole paragraph, then null if even that is ambiguous.
 */
export function uniqueQuote(bodyRows, para, maxLen = 24) {
  const row = (bodyRows ?? []).find((r) => Number(r.para) === Number(para))
  if (!row) return null
  const text = String(row.text ?? '').trim()
  if (!text) return null
  const count = (q) => bodyRows.filter((r) => String(r.text ?? '').includes(q)).length
  // Start at 8 rather than 6: a six-character slice is usually unique but reads
  // as a fragment, and the example is meant to look like something a person
  // would actually quote.
  for (let len = Math.min(8, text.length); len <= Math.min(text.length, maxLen); len += 1) {
    const q = text.slice(0, len)
    if (count(q) === 1) return q
  }
  // Shorter than 8 characters but still unique (a very short paragraph).
  for (let len = 6; len < Math.min(8, text.length); len += 1) {
    const q = text.slice(0, len)
    if (count(q) === 1) return q
  }
  return count(text) === 1 ? text : null
}
