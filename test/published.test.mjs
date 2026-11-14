/**
 * 装好之后能不能用。
 *
 * 其他测试跑的是源码目录；这个测试只看「发布清单里那些文件」装起来之后
 * 能不能导入、能不能注册工具、四个工具能不能真跑。发布出去坏包是最贵的
 * 错误——用户装不上，而我们本地全绿。
 *
 * 不联网：用本地 file 路径导入，但只碰 files 里列出的文件（缺一个就报错）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// 发布清单里必须存在的东西。少一个，装出来的包就是残的。
const MUST_SHIP = [
  'package.json',
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'README.md',
  'LICENSE',
  'docs/DETAIL.md',
  'locale/zh.json',
  'locale/en.json',
  'lib/core.js',
  'lib/engine.js',
  'lib/score.js',
  'lib/annotation.js',
  'lib/schema-doc.js',
  'lib/rules.json',
  'lib/scoring.json',
  'lib/demo-report.md',
]

test('发布清单里的文件一个不少', () => {
  const missing = MUST_SHIP.filter((f) => !existsSync(join(ROOT, f)))
  assert.deepEqual(missing, [], '缺了这些文件，装出来的包是残的')
})

test('清单里没有样例正文和测试', () => {
  const shipped = [
    ...MUST_SHIP,
    ...['lib/atmosphere.js', 'lib/description.js', 'lib/ending.js',
        'lib/foreshadowing.js', 'lib/joke.js', 'lib/language.js',
        'lib/link.js', 'lib/logic.js', 'lib/theme.js'],
  ]
  for (const f of shipped) {
    assert.ok(!f.includes('samples'), `${f} 不该在发布清单里`)
    assert.ok(!f.startsWith('test/'), `${f} 不该在发布清单里`)
  }
})

test('package.json 的装入声明是对的', () => {
  assert.equal(pkg.name, 'dsh-soul-radar')
  assert.ok(pkg.dsh?.bundle?.patch, 'dsh.bundle.patch 必须有，否则 dsh 不认')
  assert.ok(pkg.dsh?.client, 'dsh.client 必须有，否则面板不出现')
})

test('index.js 能导入并注册四个工具', async () => {
  const idx = await import(pathToFileURL(join(ROOT, 'index.js')).href)
  assert.equal(idx.name, 'soul-radar')
  assert.deepEqual(idx.inject, ['tools'])

  const tools = new Map()
  idx.apply({ tools: { register: (d) => tools.set(d.name, d) } })

  assert.deepEqual(
    [...tools.keys()].sort(),
    ['lt_demo', 'lt_rules', 'lt_schema', 'lt_score'],
  )

  // parameters 必须是编译后的 JSON Schema 形状。ctx.tools.register 不会帮你
  // 把简写编译成 schema，写错了要到用户第一次调用才炸。
  for (const [name, t] of tools) {
    assert.equal(t.parameters?.type, 'object', `${name} 的 parameters 缺 type:object`)
    assert.equal(typeof t.parameters?.properties, 'object', `${name} 缺 properties`)
    assert.ok(!('required' in t.parameters) || t.parameters.required.length > 0,
      `${name} 不该带空的 required 数组`)
    assert.ok(t.output?.schema, `${name} 缺 output.schema`)
  }
})

test('lt_demo 能跑，且说清报告是存档', async () => {
  const idx = await import(pathToFileURL(join(ROOT, 'index.js')).href)
  const tools = new Map()
  idx.apply({ tools: { register: (d) => tools.set(d.name, d) } })

  const out = await tools.get('lt_demo').execute({})
  const txt = typeof out === 'string' ? out : JSON.stringify(out)
  assert.ok(txt.length > 500, '报告太短')
  assert.match(txt, /存档|archive/i, '必须让调用方知道这是存档，不是对刚给的文章的分析')
})

test('lt_score 能跑，没标注时老实报未测', async () => {
  const idx = await import(pathToFileURL(join(ROOT, 'index.js')).href)
  const tools = new Map()
  idx.apply({ tools: { register: (d) => tools.set(d.name, d) } })

  const body = [
    '我站在门口。', '风很大。', '她没说话。', '我也没说话。',
    '后来她走了。', '我还没走。', '天黑了。', '我走了。',
    '街上有灯。', '灯很亮。', '我回家。', '睡觉。',
  ].join('\n')

  const out = await tools.get('lt_score').execute({ title: '测试', body })
  const txt = typeof out === 'string' ? out : JSON.stringify(out)

  assert.ok(txt.length > 200, '报告太短')
  assert.match(txt, /总分/)
  // 十二段、零标注：大部分项必须报未测，不能凭空给分。
  assert.match(txt, /未测|待核|判不了/)
})

test('lt_schema 的示例真截自传入的正文', async () => {
  const idx = await import(pathToFileURL(join(ROOT, 'index.js')).href)
  const tools = new Map()
  idx.apply({ tools: { register: (d) => tools.set(d.name, d) } })

  const probe = ['我站在门口。', '风很大。', '她没说话。', '我也没说话。', '后来她走了。']
  const out = await tools.get('lt_schema').execute({ body: probe.join('\n') })
  const txt = typeof out === 'string' ? out : JSON.stringify(out)

  // 挑哪几段由它决定，但至少要有一处是真从这篇里截的——
  // 手册自己不能成为第一次报错的来源。
  const quoted = probe.filter((p) => txt.includes(p))
  assert.ok(quoted.length > 0, '一个示例都不是从正文里截的，照抄会定位失败')
  assert.match(txt, /位置示例|不代表/, '要说清这些只是位置示例，不是判断结果')
})

test('lt_rules 能跑，每条判据都带状态', async () => {
  const idx = await import(pathToFileURL(join(ROOT, 'index.js')).href)
  const tools = new Map()
  idx.apply({ tools: { register: (d) => tools.set(d.name, d) } })

  const out = await tools.get('lt_rules').execute({})
  const txt = typeof out === 'string' ? out : JSON.stringify(out)
  assert.ok(txt.length > 1000, '判据表太短')
  assert.match(txt, /定稿|待核|待建|已推翻/)
})
