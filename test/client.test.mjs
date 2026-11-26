/**
 * Local contract + render test for client.js.
 *
 * There is no browser here, so the point is not appearance. It is to catch the
 * failures that actually happen (a syntax error, an undefined name inside the
 * component, a registration shape the slot will reject) and to keep the panel
 * from growing back into a dashboard.
 *
 * 2026-11-14: the panel no longer takes input. It used to be a paste box plus a
 * copy button, but DSH's composer is already a Lexical editor that accepts long
 * text and file drops, and this slot gets no send function at all
 * (`renderSlot('main', {}, ...)`). So the panel became a page that explains how
 * to use the tool. The tests below assert that explanation, and explicitly assert
 * that no input came back.
 *
 *   node --test test/client.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../client.js', import.meta.url))
const code = readFileSync(SRC, 'utf8')

/**
 * Execute client.js with a fake module loader and a minimal React.
 */
function loadPlugin(states = []) {
  let captured = null
  const queue = [...states]

  const fakeReact = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') return type(props ?? {}, ...children)
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      return queue.length ? [queue.shift(), () => {}] : [initial, () => {}]
    },
    useEffect() {},
    useRef(initial) {
      return { current: initial }
    },
  }

  const win = {
    __ModuleLoader__: {
      load({ id, factory }) {
        captured = { id, factory }
      },
    },
  }

  // `navigator` is a read-only getter on Node 24, so it cannot be swapped on
  // globalThis; both globals arrive as wrapper parameters instead.
  const fakeNav = { clipboard: { writeText: async () => {} } }
  const prevWindow = globalThis.window
  globalThis.window = win
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'navigator', code)(win, fakeNav)
  } finally {
    globalThis.window = prevWindow
  }

  assert.ok(captured, 'client.js 应该调用 window.__ModuleLoader__.load')
  const plugin = captured.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error('unexpected require: ' + name)
  })
  return { id: captured.id, plugin }
}

/** Render the panel and return its rendered tree. */
function renderPanel(props = {}) {
  const { plugin } = loadPlugin()
  let Panel = null
  plugin.apply({
    slots: {
      inject: (n, make) => make(),
      register: (o, c) => { if (o.name === 'main') Panel = c },
    },
  })
  assert.ok(Panel, '注册时要拿到面板组件')
  return Panel(props)
}

/** Collect every string in a rendered tree. */
function textOf(node) {
  if (node == null || node === false) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textOf)
  if (typeof node === 'object') return textOf(node.children ?? [])
  return []
}

/** Find every element of a given tag in a rendered tree. */
function elementsOf(node, tag) {
  if (node == null || typeof node !== 'object') return []
  const self = node.type === tag ? [node] : []
  return self.concat(Array.isArray(node.children) ? node.children.flatMap((c) => elementsOf(c, tag)) : [])
}

/** The whole panel as one string. */
const panelText = () => textOf(renderPanel()).join(' ')

// ── module + registration contract ───────────────────────────

test('client.js registers one module under the package name', () => {
  const { id } = loadPlugin()
  assert.equal(id, 'dsh-soul-radar', 'module id 必须等于包名')
})

test('injects slots and registers both the sidebar row and the panel', () => {
  const { plugin } = loadPlugin()
  assert.deepEqual(plugin.inject, ['slots'])

  const registered = []
  let injected = 0
  plugin.apply({
    slots: {
      inject: (n, make) => { injected += 1; make() },
      register: (o, c) => { registered.push({ name: o.name, id: o.id, key: o.key, c }) },
    },
  })

  assert.equal(injected, 2, '两个插槽各注入一次')
  const list = registered.find((r) => r.name === 'sidebar.panellist')
  assert.ok(list, '侧栏那一行要注册')
  assert.equal(list.id, 'soul-radar')
  assert.equal(typeof list.c, 'function', '图标是组件')

  const main = registered.find((r) => r.name === 'main')
  assert.ok(main, '主面板要注册')
  assert.equal(main.key, 'soul-radar')
  assert.equal(typeof main.c, 'function')
})

test('the panel has no input at all', () => {
  // 关键回归：粘贴框已经删掉了。DSH 的对话输入框本身就能粘长文、能拖文件，
  // 而这个插槽又拿不到发送能力 —— 在面板里粘完再复制是让人多做四步。
  const tree = renderPanel()
  assert.equal(elementsOf(tree, 'textarea').length, 0, '不该再有粘贴框')
  assert.equal(elementsOf(tree, 'input').length, 0, '不该有输入框')
  assert.equal(elementsOf(tree, 'button').length, 0, '不该有按钮')
})

test('it says where to put the article', () => {
  const t = panelText()
  assert.match(t, /对话输入框/, '要指明是在对话输入框里贴')
  assert.match(t, /发送/, '要说清发出去就行')
  // 用户最想知道的那一句：不用自己动手整理。
  assert.match(t, /不用分段/, '要说明不用自己分段')
  assert.match(t, /不用标注/, '要说明不用自己标注')
})

test('it says what the user gets back', () => {
  const t = panelText()
  for (const word of ['总分', '问题在哪', '鞭策', '意见']) {
    assert.ok(t.includes(word), `要说明会给出「${word}」`)
  }
})

test('the page stays short — no manual', () => {
  // 作者 2026-11-14：说明太复杂了，精简总结就行。这条守住「短」。
  const t = panelText()
  assert.ok(t.length < 200, `说明页不该超过 200 字，现在是 ${t.length} 字`)
})

test('it does not explain the tool/dsh division of labour to the user', () => {
  // 作者 2026-11-14：那是给 DSH 的，不是给用户看的。说明页只回答
  //「怎么用」和「会拿到什么」。看不见的分工不该占用户的注意力。
  const t = panelText()
  assert.ok(!/DSH 拿着这些数据/.test(t), '不该跟用户解释谁评判')
  assert.ok(!/不是评判写得好不好/.test(t), '不该否认评判——那是 DSH 的活')
})

// ── the negative tests: noise must not come back ─────────────

test('the panel shows no item scores or counts', () => {
  const t = panelText()
  assert.ok(!/\d+\s*段/.test(t), '不该显示段数')
  assert.ok(!/\d+\s*字/.test(t), '不该显示字数')
  assert.ok(!/可测/.test(t), '不该显示能测几项')
})

test('the panel never shows a raw percentage', () => {
  const t = panelText()
  assert.ok(!/\d+(\.\d+)?%/.test(t), '说明页不该出现百分比')
})

test('styling uses real colors that survive a wallpaper', () => {
  // 之前的 currentColor 半透明混色在壁纸背景上糊成一片。用系统色是实色。
  assert.match(code, /Canvas/, '要用 Canvas 系统色')
  assert.match(code, /CanvasText/, '要用 CanvasText 系统色')
  assert.ok(!/background:\s*'transparent'/.test(code), '不该再用透明背景')
})
