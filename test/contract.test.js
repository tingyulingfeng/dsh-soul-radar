/**
 * Tool contract tests — the shapes the host and the model-facing API require.
 *
 * These exist because a wrong shape does not fail at load. It fails later, when
 * the schemas are projected into a model request, and it takes the whole turn
 * down with it:
 *
 *   Invalid schema for function 'lt_score':
 *   {"type":"string","description":"…"} is not of type "string"
 *
 * The cause: `defineTool()` compiles author-facing shorthand through
 * `parameterSchemaSpecToJsonSchema`, which wraps the property map in
 * `{ type: "object", properties, required? }`. This bundle registers with
 * `ctx.tools.register()` directly and therefore has to supply that compiled
 * shape itself. Load-time validation only checks `output`, so a bad
 * `parameters` sails through activation and explodes one request later.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../index.js'

const register = () => {
  const reg = []
  plugin.apply({ tools: { register: (t) => reg.push(t) } })
  return reg
}

const SCALARS = new Set(['string', 'number', 'integer', 'boolean'])

/** Everything `assertSupportedJsonSchema` and the model API care about. */
function assertObjectSchema(schema, where) {
  assert.ok(schema && typeof schema === 'object', `${where} 必须是对象`)
  assert.equal(schema.type, 'object', `${where} 根节点必须是 type:"object"`)
  assert.ok(
    schema.properties && typeof schema.properties === 'object',
    `${where} 必须有 properties`,
  )
  if (schema.required !== undefined) {
    assert.ok(Array.isArray(schema.required), `${where}.required 必须是数组`)
    for (const k of schema.required) {
      assert.ok(k in schema.properties, `${where}.required 里有不存在的参数 ${k}`)
    }
  }
  for (const [k, v] of Object.entries(schema.properties)) {
    assert.ok(v && typeof v === 'object', `${where}.${k} 必须是 schema 对象`)
    assert.ok(SCALARS.has(v.type), `${where}.${k}.type 非法: ${JSON.stringify(v.type)}`)
    // `required` belongs on the root list, never on a property.
    assert.equal(v.required, undefined, `${where}.${k} 不该带 required`)
  }
}

test('the plugin declares the host-required metadata', () => {
  assert.equal(plugin.name, 'soul-radar')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('every tool registers output { schema, render }', () => {
  for (const t of register()) {
    assert.ok(t.output, `${t.name} 没有 output`)
    assert.equal(typeof t.output.render, 'function', `${t.name} 没有 render`)
    assertObjectSchema(t.output.schema, `${t.name}.output.schema`)
    assert.deepEqual(t.output.schema.required, ['text'], `${t.name} 必须返回 text`)
  }
})

test('every tool declares a compiled parameter object schema', () => {
  // This is the assertion that would have caught the shipped-broken version:
  // `{ title: {...} }` has no type/properties and the API rejects it.
  for (const t of register()) {
    assertObjectSchema(t.parameters, `${t.name}.parameters`)
  }
})

test('render produces a text block from a shaped value', () => {
  for (const t of register()) {
    const blocks = t.output.render({}, { text: 'hello' })
    assert.ok(Array.isArray(blocks), `${t.name} render 必须返回数组`)
    assert.equal(blocks[0].type, 'text')
    assert.equal(blocks[0].text, 'hello')
  }
})

test('lt_score requires a body and nothing else', () => {
  const score = register().find((t) => t.name === 'lt_score')
  // Only the article is mandatory; annotation and ending are opt-in, because
  // making them required would push the annotation work onto the user.
  assert.deepEqual(score.parameters.required, ['body'])
  assert.deepEqual(
    Object.keys(score.parameters.properties).sort(),
    ['annotation', 'body', 'ending', 'title'],
  )
})

test('lt_demo takes no arguments', () => {
  const demo = register().find((t) => t.name === 'lt_demo')
  assert.deepEqual(demo.parameters.properties, {})
  // parameterSchemaSpecToJsonSchema omits the key entirely when nothing is
  // required; it does not emit an empty array. Match that exactly.
  assert.equal('required' in demo.parameters, false, '没有必填参数时不该有 required 键')
})

test('parameter schemas carry only what the compiler emits', () => {
  // `parameterSchemaSpecToJsonSchema` produces exactly:
  //   { type:'object', properties, ...(required.length ? {required} : {}) }
  // and each property is whatever the author wrote minus the author-only
  // `required` flag. So the shape to assert is: three possible root keys, and
  // properties carrying only type/description/default/examples.
  const ALLOWED_ROOT = new Set(['type', 'properties', 'required'])
  const ALLOWED_PROP = new Set(['type', 'description', 'default', 'examples'])

  for (const t of register()) {
    for (const k of Object.keys(t.parameters)) {
      assert.ok(ALLOWED_ROOT.has(k), `${t.name}.parameters 多了根字段 ${k}`)
    }
    assert.equal(t.parameters.type, 'object')
    for (const [name, prop] of Object.entries(t.parameters.properties)) {
      for (const k of Object.keys(prop)) {
        assert.ok(
          ALLOWED_PROP.has(k),
          `${t.name}.parameters.${name} 多了字段 ${k}（编译器只输出 type/description/default/examples）`,
        )
      }
      assert.equal(
        'required' in prop,
        false,
        `${t.name}.parameters.${name} 的 required 该提到根上的数组里`,
      )
    }
    // Empty required is omitted, never emitted as [].
    if ('required' in t.parameters) {
      assert.ok(t.parameters.required.length > 0, `${t.name} 的 required 不该是空数组`)
    }
  }
})
