/**
 * The annotation format document — what the agent reads before writing one.
 *
 * Kept out of `index.js` because it is prose, not plumbing, and because the
 * examples have to be generated from the user's own text.
 *
 * **Why the examples are generated:** a made-up example is worse than useless.
 * The agent copies it verbatim, the quote fails to locate, and the first thing
 * it learns about the format is an error the manual caused. So `lt_schema`
 * accepts the same `body` the user pasted, and every example quote is a real
 * slice of it, grown until it resolves to exactly one paragraph.
 */

import { uniqueQuote, ENUMS } from './annotation.js'

const NONE = {
  plant: '（挖坑的那句原文）',
  resolve: '（回收的那句原文）',
  carrier: '（承载住情绪的那句原文）',
  what: '（那个物，几个字）',
  cause: '（因的原文）',
  effect: '（果的原文）',
  setup: '（因之前的段）',
  middle: '（因果之间的段）',
  extend: '（果之后的段）',
  hit: '（明线上同时指向暗线的那句）',
}

/** How many demo tokens to show before telling the caller the real count. */
const DEMO_COUNT = 4

/**
 * @param {{para:number,text:string}[]} bodyRows  what the user pasted (may be empty)
 * @returns {string}
 */
export function renderSchemaDoc(bodyRows = []) {
  const { FUNCTIONS, DTYPES, ORDER_VALUES, ORIGIN_VALUES, FORMS, TRENDS, REL_DIMS } = ENUMS
  const L = []
  const p = (...s) => L.push(...s)
  const n = bodyRows.length
  const real = n > 0

  // Spread the examples across the piece so it is obvious that quotes come from
  // different places, and fall back to the nearest paragraph that has a unique one.
  const q = (para) => (real ? uniqueQuote(bodyRows, para) : null)
  const at = (frac) => Math.max(1, Math.min(n, Math.round(n * frac)))
  const first = real ? (q(at(0.03)) ?? q(1)) : null
  const middle = real ? (q(at(0.5)) ?? q(at(0.3))) : null
  const last = real ? (q(at(0.97)) ?? q(n)) : null

  // A few real tokens, so the shape is obvious without implying the caller may
  // stop early: the doc states the true paragraph count next to them.
  const demoTokens = real
    ? bodyRows.slice(0, DEMO_COUNT)
      .map((_, i) => (i % 3 === 0 ? '2+铺环' : i % 3 === 1 ? '1+蓄心' : '3-释心'))
      .join(' ')
    : ''

  p('# 标注格式（给 DSH 用）', '')
  p('用户只贴文章——**不要求他们分段，也不要求他们标注**。')
  p('分段、标注、打分都是你的活。用户把文字放进来就完了。', '')
  p('你读一遍，把能诚实判的填进 `annotation`，一次传给 `lt_score`。')
  p('**判不了的整段省略**——对应的项会报未测并退出分母。不要编数把分数凑完整。', '')

  if (real) {
    p(`> 下面的引用是从这片正文里真截出来的（共 ${n} 段），**照抄就能定位**。`)
    p('> 注意：它们只是**位置示例**——那几个段落碰巧有唯一片段，不代表它们真的是伏笔或承载物。')
    p('')
  } else {
    p('> **示例里的引用（括号里那些）都是占位符，照抄会报「正文里找不到」。**')
    p('> 把 `body` 一起传进来，示例就会换成正文里的真句子。', '')
  }

  p('## 最重要的一条：不要数段号', '')
  p('**除了 `paras`，任何地方都不要写段号。** 引用原文，工具自己定位。')
  p('数段号是最容易错的一步，错一位整份读数都偏，而且看不出来。', '')
  p('引用要能唯一定位——那句话在好几段里都有就多抄几个字。')
  p('标点差一点没关系（工具会去掉标点再匹配一次）；**改写或概括不行**。', '')

  p('## paras 用四字编码，别用对象', '')
  p('`paras` 是最大的一块。用对象写，88 段要 2900 字；用四字编码，只要 440 字。')
  p('**省下来的不是你的力气，是能不能装得下。**', '')
  p('每段一个 token，`强度 + 方向 + 功能首字 + 描写对象首字`：')
  p('')
  p('```')
  p('2+铺环   强度 2，往上抬，铺垫，环境')
  p('3-释心   强度 3，往下压，释放，心理')
  p('10蓄事   强度 1，方向平，蓄势，事')
  p('2-释心!  末尾加 ! 表示这段是笑点')
  p('2+转无   这一段没有描写对象（纯对话、时间标记、信息交代）')
  p('```', '')
  p('首字表（都不撞，直接取第一个字）：')
  p('')
  p(`- 功能：${FUNCTIONS.map((x) => x).join(' / ')}`)
  p(`- 描写对象：${DTYPES.map((x) => x).join(' / ')}`)
  p('')
  p(
    '**描写对象不是「写得越多越好」的计分项。** 作者的分类是为了给不同判法：' +
      '声音按台阶判（拟声词 → 直接互动 → 细节比喻，音乐只能旁敲侧击）、视觉按角度判（颜色/光影/主观感受是并列的，' +
      '不是梯度）、心理按台阶判（直接下结论 → 生理反应 → 潜意识错觉）。' +
      '少了哪一类不是问题，**标错类才会判不准**。',
    '',
  )
  p(
    '**景与物还有两层判法（2026-11-16 补）：** ' +
      '环境分动静——动态是台阶（基础情况 → 加时间差 → 加新维度，通常到第三层就够，再多臃肿），' +
      '静态不看高低（靠同一画面调细节：首尾呼应、极动转极静）；' +
      '物的描写看互动层次（物与物 → 物与环境 → 物与人 → 交叉互动）。' +
      '**这些都只出读数，分数归「详略」**——够不够写、该写到第几层，是另一套依据。',
    '',
  )
  p(
    '**「无」很重要。** 一篇 88 段的短篇里，纯叙述（对话、时间标记、信息交代）能占二十多段——' +
      '那些段没有描写对象，不是分类失败。老实标「无」，别硬塞给某一类。',
    '',
  )
  p('token 用空格隔开，**数量必须等于正文段数**——少一段会报错，报错会告诉你正文有几段。')
  p('')
  p('### groups —— 逻辑链段落群（可选）', '')
  p('把文章切成一条条**完整逻辑链**（交代/铺垫 → 转折/释放 算一条），每群写成一个 `[起, 止]`：')
  p('`{"groups": [[1, 4], [5, 9], [10, 14]]}`——整数、升序、不重叠，**从第 1 段覆盖到最后一段**。')
  p('写错会逐条报错（越界 / 倒序 / 重叠 / 没覆盖全）。**不写也可以**，工具会按词面纽带自己切，但那样切出的群很粗。')
  p('它只影响「描写层数」这一项读数（平常一层、节点前的铺垫最多三层、节点前后更多）。')
  p('不想用编码也行：直接给对象数组 `[{"s":2,"d":1,"f":"铺垫","t":"环境"}, ...]`，结果完全一样。', '')

  p('## 结构', '')
  p('```json')
  p(JSON.stringify({
    // A few real tokens for shape. No trailing prose here: everything inside
    // the string is parsed as tokens, so a "…(共 N 个)" note would itself be
    // an invalid token. The real count is stated in the prose below instead.
    paras: real ? demoTokens : '2+铺环 1+蓄心 3-释心',
    hooks: [{ plant: first ?? NONE.plant, resolve: last ?? NONE.resolve, quality: 0.9, layers: 2 }],
    carriers: [{ at: middle ?? NONE.carrier, what: real ? '（那个物，几个字）' : NONE.what }],
    chains: [{
      cause: first ?? NONE.cause,
      effect: last ?? NONE.effect,
      setup: [first ?? NONE.setup],
      middle: [middle ?? NONE.middle],
      extend: [last ?? NONE.extend],
      order: '正叙',
      origin: '天然',
      dressed: 0.9,
    }],
    theme: {
      core: '（一句核心）',
      hits: [{
        at: last ?? NONE.hit,
        total: 4,
        written: 2,
        tight: 0.85,
        rel: ['time', 'event', 'item'],
      }],
    },
    ending: { form: '首尾相连', trend: '反转', link: 0.9, setup: 0.8 },
  }, null, 2))
  p('```', '')
  if (real) {
    p(`> \`paras\` 那行我只写了 ${DEMO_COUNT} 个 token 示意，**正文实际有 ${n} 段**。`)
    if (n > DEMO_COUNT) {
      p(`> 照抄这个示例会报「给了 ${DEMO_COUNT} 段，正文有 ${n} 段」——那就是提醒你补齐。`, '')
    } else {
      p(`> 这篇正好 ${n} 段，所以示例的段数是对的，可以直接跑。`, '')
    }
  }
  p('六个键都可以只给一部分。**`paras` 最值钱**——它一给，氛围和笑料就活了。', '')

  p('## 每个键', '')
  p('### paras —— 四字编码，**第 1 个 token 就是第 1 段**')
  p('- 强度 1~3：这一段把情绪推/压了多少')
  p('`1` = 段内的轻微起伏（一句带过）　`2` = 这一段的主情绪　`3` = 全篇级的翻面（高潮/转折）')
  p('- 方向 `+` / `0` / `-`')
  p(`- 功能首字：${FUNCTIONS.map((x) => x[0]).join(' ')}`)
  p(`- 维度首字：${DTYPES.map((x) => x[0]).join(' ')}`)
  p('- 末尾 `!`：你觉得这段是个笑点（黑色幽默这种词表抓不到的，标上来）')
  p('')
  p('**`方向` 指的是读者情绪的上下，不是紧张程度。**')
  p('`+` = 往亮处走（暖、松、希望、被安慰）；`-` = 往暗处走（压、冷、怕、失落）；`0` = 平铺。')
  p('一句话判断：**读完这一段，读者心里是往上还是往下。**')
  p('搞错这一条，40 分的起伏项和共鸣系数会整个反过来，所以别猜。', '')
  p('或者写成对象：`{"s":2,"d":1,"f":"铺垫","t":"环境","joke":true}` —— 同分，只是长。')
  p('')
  p('### hooks —— 伏笔，引用挖坑和填坑的原文')
  p('- `plant` 挖坑、`resolve` 填坑，都给原文')
  p('- `quality` 0~1：这条伏笔弄得好不好（一个数够了，不用分因/果）')
  p('- `layers` 整数：坑和填之间铺了几层')
  p('')
  p('### carriers —— 情感落在了什么具体的物上')
  p('- `at` 引原文（承载住情绪的那句）')
  p('- `what` 那个物是什么，几个字')
  p('- `cause` 可选：它承接的是哪句原文里的因')
  p('- `ok: false`：**这一处该有承载物却没有**（情感在飘）。不写就等于「落了」，')
  p('  所以只列落住的、把没落住的也标 `ok: false`，覆盖率才不作假。')
  p('')
  p('**`chan` 可选：这处描写靠哪条通道把情绪送到读者身上。** 不标只是没有判法，落住率照旧算。')
  p('但标了就要标对——**两套判法的标法不一样，标错会被拒收**：')
  p('')
  p('```')
  p('台阶   声音  拟声词 → 直接互动 → 细节+比喻')
  p('       心理  直接下结论 → 生理反应 → 潜意识错觉（第三级可选）')
  p('       → 给 level：1~3，或者直接写级的名字')
  p('')
  p('菜单   视觉  颜色 / 光影 / 主观感受   ← 三个并列，「第三级不一定更好」')
  p('       → 给 angles：用哪几个写哪几个。**不许给 level**')
  p('')
  p('特殊   音乐  时间→空间翻译不了，只能旁敲侧击（比喻 / 通感 / 烘托）')
  p('       角色  总判据是「和现实中的人/群体有没有类比联系」，三层只报交付形式')
  p('       → 给 way：音乐写做法；角色写这一处在交付哪一层（角色背景 / 剧情节点 / 细节）')
  p('       特殊判法都不比高低，**不许给 level / angles**')
  p('```')
  p('')
  p('- `{"at": "（那句原文）", "what": "（那个物）", "chan": "声音", "level": 3}`')
  p('- `{"at": "（那句原文）", "what": "（那个物）", "chan": "视觉", "angles": ["光影", "颜色"]}`')
  p('')
  p('**为什么菜单不许给级数：** 颜色和光影是两把并列的钥匙，不是台阶的两级。')
  p('「用了两个角度」和「走到第三级」不是一回事——台阶有先后，菜单只有情况。')
  p('所以视觉写 `level` 会直接报错，不要蒙一个数。')
  p('')
  p('**判法现在只报读数，不进分。** 台阶类会报最高到第几级，菜单类报用了哪几个角度、')
  p('不排名次；扣分侧永远只问落没落住。这一级怎么加权等作者的「描述」依据，工具不替他定。')
  p('')
  p('### chains —— 逻辑链')
  p('- `cause` 因（引用「为什么会这样」的原文）')
  p('- `effect` 果（引用「所以怎样了」的原文）')
  p('- `setup` 因**之前**的段（定下限：读者接不接受）')
  p('- `middle` 因果**之间**的段（过程；缺了就是只写答案）')
  p('- `extend` 果**之后**的段（定上限：会不会「就这？」）')
  p(`- \`order\`：${ORDER_VALUES.join(' / ')}　\`origin\`：${ORIGIN_VALUES.join(' / ')}`)
  p('- `dressed` 0~1：**后加**的链必须 ≥0.5，否则读者觉得是硬接')
  p('')
  p('### theme —— 暗线')
  p('- `core` 一句核心')
  p('- `hits[]`：明线上哪个点同时指向暗线（`at` 引原文）')
  p('- `total` 读者要脑补几步、`written` 你已经写明几步。')
  p('  **注意：工具会拿「要脑补几步」去比一条理想曲线**（篇幅越长，越要求写明），')
  p('  差得越远扣得越狠。所以 `total` 别随手往大了填——填你真实估计的那个数。')
  p('- `tight` 0~1：这几点贴不贴（**一个平均分**，不要逐条列）')
  p(`- \`rel\`：这个点同时指向暗线的哪几个方面，**命中几个写几个**，取值 ${REL_DIMS.join(' / ')}`)
  p('  关联度 = 命中数 ÷ 6，**所以只写两三个就是在说这条暗线只连了两三个面**。')
  p('  不是「挑最像的写」，是「凡是真连上的都写」。', '')
  p('### ending —— 结尾')
  p(`- \`form\`：${FORMS.join(' / ')}（\`首尾相连\` 要 ≥0.85 才有分）`)
  p(`- \`trend\`：${TRENDS.join(' / ')}（\`顺势\` 不给分——额外加分只认**卓越**，不认**及格**）`)
  p('- `link` / `setup` 0~1')
  p('')
  p('## 三条硬规矩', '')
  p('1. **判不了就省略**，不要填 0 或 0.5 冒充判断。')
  p('2. 填完要在报告里说明「这是你自己的阅读」——`lt_score` 会自动带一句，别删。')
  p('3. 引用照抄原文。找不到会明确报错，改了重来，**不要为了过校验去编**。')

  return L.join('\n')
}
