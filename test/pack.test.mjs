/**
 * What `npm publish` would actually ship.
 *
 * npm's `files` rules are not glob-only: a bare directory name ships everything
 * under it, and `*` matches inside one segment. Getting this check wrong in
 * either direction is expensive — too generous publishes stray files, too strict
 * drops the docs or locale files users need.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const walk = (dir) => {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    if (e.name.startsWith('__') || e.name === '_swap.py') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(relative(ROOT, p).replace(/\\/g, '/'))
  }
  return out
}

/** One `files` entry against one relative path. */
const matches = (file, entry) => {
  // A bare directory name ships its whole subtree.
  if (!entry.includes('*')) {
    return file === entry || file.startsWith(entry + '/')
  }
  // Otherwise translate the glob: `**` spans segments, `*` stays within one.
  const re = new RegExp(
    '^' + entry
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*') + '$',
  )
  return re.test(file)
}

const all = walk(ROOT)
// package.json is always included by npm, plus README/LICENSE at the root.
const always = new Set(['package.json', 'README.md', 'LICENSE'])
const shipped = all.filter(
  (f) => always.has(f) || (pkg.files ?? []).some((entry) => matches(f, entry)),
)
const skipped = all.filter((f) => !shipped.includes(f))

const kb = (list) =>
  Math.round(list.reduce((a, f) => a + statSync(join(ROOT, f)).size, 0) / 1024)

console.log(`会发布 ${shipped.length} 个文件，共 ${kb(shipped)} KB`)
for (const f of shipped.sort()) console.log('  ✓ ' + f)

console.log(`\n不带走的 ${skipped.length} 个：`)
for (const f of skipped.sort()) console.log('  · ' + f)

// The things users need must be present; the things developers need must not.
const MUST_SHIP = [
  'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg',
  'lib/core.js', 'lib/engine.js', 'lib/score.js', 'lib/annotation.js',
  'lib/rules.json', 'lib/scoring.json', 'lib/demo-report.md',
  'locale/zh.json', 'locale/en.json',
  'docs/DETAIL.md', 'README.md', 'LICENSE',
]
// The sample contains a complete published short story. It must never ship —
// not the body, not the annotations (they carry quoted lines from it).
const MUST_NOT = [
  'test/parity.test.js',
  'docs/发布清单.md',
  'docs/实测反馈.md',
  'lib/samples/body.jsonl',
  'test/fixtures/samples/body.jsonl',
  'test/fixtures/samples/annotation.jsonl',
]

const missing = MUST_SHIP.filter((f) => !shipped.includes(f))
const leaked = MUST_NOT.filter((f) => shipped.includes(f))

console.log('')
if (missing.length) console.log('✗ 该带却没带：' + missing.join(', '))
if (leaked.length) console.log('✗ 不该带却带了：' + leaked.join(', '))
if (!missing.length && !leaked.length) console.log('✓ 该带的都带了，不该带的都没带')
