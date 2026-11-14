/**
 * Package-manifest checks.
 *
 * The manifest is the one file where a mistake takes the whole bundle down:
 * a bad `exports` path makes the Host entry unimportable, and a bad `dsh.client`
 * block makes the bundle fail to activate before any of our code runs. Those are
 * cheap to assert and expensive to discover in the running app.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const exists = (rel) => existsSync(join(ROOT, rel))

test('the manifest is valid and self-consistent', () => {
  assert.equal(pkg.name, 'dsh-soul-radar')
  assert.equal(pkg.type, 'module', 'Host 与 client 都是 ESM')
  assert.ok(pkg.license, '要有 license')
  assert.ok(pkg.description && pkg.description.length > 20, '要有像样的描述')
})

test('engines allows the running prerelease', () => {
  // `>=0.2.2` does NOT match 0.2.2-rc.2 — semver excludes prereleases unless the
  // range names one. This is the difference between installing and being refused.
  assert.equal(pkg.engines.dsh, '>=0.2.2-0')
})

test('every exports target exists on disk', () => {
  for (const [key, target] of Object.entries(pkg.exports)) {
    if (key.includes('*')) continue
    assert.ok(exists(target), `exports["${key}"] 指向的 ${target} 不存在`)
  }
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./client'], './client.js', 'client 入口必须声明')
  assert.equal(pkg.main, './index.js')
})

test('the client declaration matches what the host expects', () => {
  const c = pkg.dsh?.client
  assert.ok(c, 'dsh.client 必须存在，否则 UI 不会加载')
  assert.equal(c.platform, 'web')
  assert.equal(c.immediately, true, '面板要立刻可用')
  assert.ok(Array.isArray(c.inject), 'inject 是数组')
  // `inject` only orders activation; naming a package that does not exist is
  // harmless, but naming the conversation UI keeps the order sensible.
  assert.ok(c.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
})

test('the bundle patch and its declared path agree', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(exists('cordis.patch.yml'), 'cordis.patch.yml 必须存在')
})

test('files ships everything the manifest references', () => {
  const files = pkg.files ?? []
  // package.json itself is always included by npm; everything else must match.
  for (const need of ['index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'LICENSE', 'icon.svg']) {
    const covered = files.some((f) => f === need || (f.endsWith('/**') && need.startsWith(f.slice(0, -3))))
    assert.ok(covered, `files 里没有覆盖 ${need}`)
  }
  assert.ok(files.includes('lib/**'), 'lib 要整个带上')
  // Only the user-facing detail document ships. The release checklist and the
  // usability-test notes are for whoever maintains this, not for installers.
  assert.ok(files.includes('docs/DETAIL.md'), 'DETAIL 要带上')
  assert.ok(!files.includes('docs'), 'docs 整个目录会把内部文档也发出去')
  assert.ok(!files.some((f) => f.includes('发布清单')), '发布清单不该发布')
  assert.ok(!files.some((f) => f.includes('实测反馈')), '实测反馈不该发布')
  for (const f of files) {
    if (f.includes('*')) continue
    assert.ok(exists(f), `files 里写了 ${f} 但文件不存在`)
  }
})

test('keywords carry the discovery tags that registries look for', () => {
  // The community catalog indexes on these; omitting them is why a plugin is
  // never found.
  for (const kw of ['dsh', 'dsh-plugin', 'deepseek-harness']) {
    assert.ok(pkg.keywords.includes(kw), `keywords 缺少 ${kw}`)
  }
})

test('the host entry still imports cleanly', async () => {
  // Guards against a manifest change that breaks the Host half. The URL form is
  // required: on Windows a bare absolute path is not importable by the ESM loader.
  const mod = await import(new URL('../index.js', import.meta.url).href)
  assert.equal(mod.name, 'soul-radar')
  assert.deepEqual(mod.inject, ['tools'])
  const tools = []
  mod.apply({ tools: { register: (t) => tools.push(t) } })
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'lt_demo', 'lt_rules', 'lt_schema', 'lt_score',
  ])
})
