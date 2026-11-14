/**
 * Emotion radar — a DSH bundle that simulates a reader.
 *
 * Three tools, no daemon, no Python, no absolute paths: the sample data ships
 * inside the package and is located with `import.meta.url`, so the bundle works
 * from any install location.
 *
 * The host requires every tool to declare `output: { schema, render }`: execute
 * returns a value shaped by the schema, and render turns that value into
 * content. Returning a bare content array is rejected at activation.
 *
 * @module dsh-soul-radar
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { allRules, summary } from './lib/core.js'
import { parseAnnotation } from './lib/annotation.js'
import { renderSchemaDoc } from './lib/schema-doc.js'
import { scorePiece } from './lib/score.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Cordis plugin name. */
export const name = 'soul-radar'
/** This plugin registers tools and nothing else. */
export const inject = ['tools']

/**
 * Every tool returns one block of text; the report is Markdown.
 *
 * These are already-compiled JSON Schemas, not the author-facing shorthand.
 * `defineTool()` normally compiles the shorthand via
 * `parameterSchemaSpecToJsonSchema` / `valueSchemaSpecToJsonSchema`, but this
 * bundle registers through `ctx.tools.register()` directly — importing
 * `@deepseek-ai/dsh-tools` would need module resolution this package does not
 * have. So the shapes below must be what the model-facing API expects.
 */
const OUTPUT = {
  schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Markdown the agent reads.' },
    },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

/**
 * Build the model-facing parameter schema for one tool.
 *
 * Byte-for-byte the shape `parameterSchemaSpecToJsonSchema` produces:
 *
 *   { type: "object", properties, ...(required ? { required } : {}) }
 *
 * Note the conditional: with no required arguments the compiler omits the key
 * entirely rather than emitting `required: []`. Keeping that exact avoids a
 * schema the host has never round-tripped.
 */
function params(properties, required = []) {
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
  }
}

/**
 * The demo report, read from disk.
 *
 * It used to be computed live from a bundled sample. That meant shipping a
 * published short story — the full text plus six annotation files — inside an
 * npm package, which is not a thing to do. The article is gone from the
 * distribution; what remains is the report it once produced, with a banner that
 * says so.
 *
 * The fixtures stay in `test/fixtures/`, outside `files`, so the test suite can
 * still exercise the real pipeline end to end.
 */
function demoReport() {
  return readFileSync(join(HERE, 'lib', 'demo-report.md'), 'utf8')
}

/**
 * Register the tools.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // ── score a piece ────────────────────────────────────────────
  ctx.tools.register({
    name: 'lt_score',
    description:
      'Read a piece the way a reader would and return the reading data plus a report. ' +
      '\n\n' +
      '**The user supplies only the article.** Do not ask them to split it into paragraphs, ' +
      'to annotate it, or to choose anything. All of that is your work: ' +
      'split the text by meaning, write the annotation from your own reading, then call this. ' +
      '\n\n' +
      '**Split before you score.** Paragraph boundaries are themselves measured — atmosphere ' +
      'reads the swing between paragraphs, link reads whether one paragraph reaches the next, ' +
      'and paragraph length feeds the reading-experience coefficient. So if `body` has no line ' +
      'breaks, split it yourself first and pass one paragraph per line. ' +
      'A whole piece passed as one block is still scored and plainly labelled — it is not ' +
      'refused — but paragraph structure, paragraph length and the reading-experience ' +
      'coefficient all come out as bad as they can be, so the number describes the missing ' +
      'split more than it describes the writing.',

    parameters: params({
      title: { type: 'string', description: 'Article title. Optional.' },
      body: {
        type: 'string',
        description:
          'The article, one paragraph per line. The user pastes it as-is; if it arrives without ' +
          'line breaks you split it first (see above). Blank lines are ignored.',
      },
      annotation: {
        type: 'string',
        description:
          'Optional annotation as JSON, built from your own reading of the piece. ' +
          'Call `lt_schema` first and pass it this `body` — that returns the exact format with ' +
          'real copyable quotes. This description deliberately does not repeat it: two copies of ' +
          'a format drift apart, and the one you read would be the stale one. ' +
          'Top-level keys are paras, hooks, carriers, chains, theme, ending; all are optional. ' +
          'Give only what you can honestly judge — anything omitted reports 未测 and leaves the ' +
          'denominator. Do not invent values to make the score complete.',
      },
      ending: {
        type: 'string',
        description:
          'Optional ending annotation. It can also go inside `annotation` under the "ending" key; ' +
          'this argument is the older separate slot and still works.',
      },
    }, ['body']),

    output: OUTPUT,

    async execute(args) {
      const bodyRows = String(args.body ?? '')
        .split(/\n+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text, i) => ({ para: i + 1, text }))

      if (!bodyRows.length) {
        return { text: '没有收到正文。把文章按段落分行贴进来就行。' }
      }

      // A single long block means the caller did not split it — but that is not
      // a reason to refuse. "One long paragraph" is itself something this tool
      // measures: paragraph structure and the reading-experience coefficient
      // both read it directly, and refusing made the most severe case the one
      // case that never got scored. Score it as it came, and say what the number
      // is describing.
      let splitNote = ''
      if (bodyRows.length === 1 && bodyRows[0].text.length > 120) {
        const n = bodyRows[0].text.length
        splitNote =
          `> **这篇是一整段（${n} 字），没有分段。** 下面的读数是按原稿现在的样子算的：` +
          '段落结构、段长、整体阅读体验系数都按「一整段」计。\n' +
          '> 分段本身是测量项，所以这不是错误，是它现在的形态。' +
          '如果你按语义分好段再测一版，起伏和衔接才测得出来；两版对比着看更有用。\n\n'
      }

      // Parsing lives in lib/annotation.js: non-trivial because the wire format
      // is flattened for the agent and expanded back for the modules, and
      // because every problem is collected instead of thrown at the first one.
      const ann = parseAnnotation(args.annotation, bodyRows, args.ending)

      if (ann.problems.length) {
        return {
          text: '标注没读进去，先修这些问题再跑：\n\n' +
            ann.problems.map((p) => `- ${p}`).join('\n') +
            '\n\n正文已经收到，没有丢。' +
            (ann.supplied.length ? `\n已认出的部分：${ann.supplied.join('、')}` : '') +
            '\n\n完整的格式说明用 `lt_schema` 看。',
        }
      }

      const r = scorePiece({
        title: args.title ?? '',
        bodyRows,
        p1Rows: ann.p1Rows,
        foreshadowingRows: ann.foreshadowingRows,
        carrierRows: ann.carrierRows,
        logicRows: ann.logicRows,
        themeDecl: ann.themeDecl,
        endingRow: ann.endingRow,
      })

      // Say who did the reading when the reading is the caller's own.
      const note = ann.supplied.length
        ? `\n\n---\n\n> 标注是你自己写的（${ann.supplied.join('、')}），所以这份读数是**你的阅读**，` +
          '不是独立第三方的。引用分数时请说明这一点。'
        : ''
      return { text: splitNote + r.report + note }
    },
  })

  // ── the criteria themselves ──────────────────────────────────
  ctx.tools.register({
    name: 'lt_rules',
    description:
      'List every scoring criterion with its status and the evidence it rests on. ' +
      'Useful when a score needs justifying, or when deciding whether a rule is still provisional.',

    parameters: params({
      status: {
        type: 'string',
        description:
          'Only show rules with this status: 定稿 / 待核 / 待建 / 待测 / 已推翻. Omit for all.',
      },
    }),

    output: OUTPUT,

    async execute(args) {
      const want = args.status
      const rows = allRules()
        .map((x) => x.rule)
        .filter((r) => !want || r.status === want)

      const s = summary()
      const L = []
      L.push(`共 ${s.total} 条判据：定稿 ${s.byStatus.final} / 待核 ${s.byStatus.review} / ` +
        `待建 ${s.byStatus.todo} / 已推翻 ${s.byStatus.overturned}。`)
      L.push(`分项 ${s.bySide.score} 条、额外加分 ${s.bySide.bonus} 条。`)
      L.push('')
      for (const r of rows) {
        L.push(`- **${r.id}** [${r.status}] ${r.desc ?? ''}`)
        if (r.basis) L.push(`  - 依据：${r.basis}`)
        if (r.note) L.push(`  - 备注：${String(r.note).replace(/\n/g, ' ')}`)
      }
      return { text: L.join('\n') }
    },
  })

  // ── the annotation format ────────────────────────────────────
  ctx.tools.register({
    name: 'lt_schema',
    description:
      'Show the annotation format `lt_score` accepts, with a worked example and the enum values. ' +
      'Pass the same `body` you are about to score and every example quote is a real slice of it, ' +
      'so copying the example actually works. ' +
      'Call this before writing an annotation for the first time, or when `lt_score` reports a format problem.',

    parameters: params({
      body: {
        type: 'string',
        description:
          'Optional. Pass the article you are about to score; the examples become real quotes ' +
          'from it. Omit it and the examples are placeholders that will not resolve.',
      },
    }),

    output: OUTPUT,

    async execute(args) {
      const bodyRows = String(args.body ?? '')
        .split(/\n+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text, i) => ({ para: i + 1, text }))
      return { text: renderSchemaDoc(bodyRows) }
    },
  })

  // ── the bundled sample ───────────────────────────────────────
  ctx.tools.register({
    name: 'lt_demo',
    description:
      'Show a saved report from a real article, so you can see what a report looks like before ' +
      'supplying a piece. The article itself is not in the package — the output is an archive, ' +
      'not an analysis of anything the user sent, and it says so at the top.',

    parameters: params({}),

    output: OUTPUT,

    async execute() {
      return { text: demoReport() }
    },
  })
}
