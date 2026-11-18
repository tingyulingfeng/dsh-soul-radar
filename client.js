/**
 * Soul radar — the browser half.
 *
 * 这个面板不输入任何东西。第一版做成了一个粘贴框 + 复制按钮，后来查了
 * DSH 的输入框才发现那是多余的：对话输入框本身是 Lexical 编辑器
 * （contentEditable + data-composer-input），能粘长文、能拖文件、能直接发送。
 * 在面板里粘完再复制、切窗口、粘贴、发送是四步；直接在对话里贴是一步。
 *
 * 而且这个插槽拿不到发送能力 —— dsh-client-ui-layout 的
 * `renderSlot('main', {}, { entryKey })` 第二个参数是空对象，
 * 没有 send，没有 composer。想让面板把文章直接送进对话，这里做不到。
 *
 * 所以它现在只做一件事：**把怎么用说清楚**。一个让人多做四步的入口不如没有；
 * 一个能回答「这东西到底干什么、我该怎么用」的说明页才有价值。
 *
 * ## Styling
 *
 * 用 Canvas / CanvasText 这套系统色：实色、跟随亮/暗主题。之前用 currentColor
 * 的半透明混色，在壁纸背景上糊成一片，用户看不清。
 */

window.__ModuleLoader__.load({
  id: 'dsh-soul-radar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 面板上显示的版本号。**由 publish-npm.mjs 在打包前从 package.json 自动同步**，
    // 别手改——manifest.test.mjs 会校验两者一致。
    const PLUGIN_VERSION = '0.5.6'

    const PANEL_ID = 'soul-radar'
    const SLOT_PANEL_LIST = 'sidebar.panellist'
    const SLOT_MAIN = 'main'
    const PANEL_ORDER = 90

    // ── the sidebar icon ────────────────────────────────────────
    function PanelIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true, fill: 'none' },
        h('circle', {
          cx: 12, cy: 12, r: 9,
          stroke: 'currentColor', strokeWidth: 1.6, opacity: 0.9,
        }),
        h('circle', {
          cx: 12, cy: 12, r: 4.5,
          stroke: 'currentColor', strokeWidth: 1.4, opacity: 0.6,
        }),
        h('circle', { cx: 12, cy: 12, r: 1.4, fill: 'currentColor' }),
        h('path', {
          d: 'M12 3v3M12 18v3M3 12h3M18 12h3',
          stroke: 'currentColor', strokeWidth: 1.3, opacity: 0.55,
          strokeLinecap: 'round',
        }),
      )
    }

    // ── the panel: four lines, no manual ─────────────────────────
    function Panel() {
      const S = {
        wrap: {
          height: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: '40px 44px',
          background: 'Canvas', color: 'CanvasText', font: 'inherit',
        },
        inner: { maxWidth: 520 },
        title: { fontSize: 19, fontWeight: 600, margin: '0 0 18px' },
        lead: {
          fontSize: 14.5, lineHeight: 2.0, margin: '0 0 4px',
        },
        sub: {
          fontSize: 13, lineHeight: 1.9, opacity: 0.65, margin: '0 0 22px',
        },
        body: {
          fontSize: 13.5, lineHeight: 2.0, margin: '0 0 6px',
        },
        weak: {
          fontSize: 13, lineHeight: 1.9, opacity: 0.65, margin: '18px 0 0',
        },
        version: {
          fontSize: 12, lineHeight: 1.6, opacity: 0.45, margin: '-12px 0 16px',
          fontVariantNumeric: 'tabular-nums',
        },
      }

      return h('div', { style: S.wrap },
        h('div', { style: S.inner },
          // 标题带功能副标题：名字负责记住，副标题负责第一眼知道干什么。
          h('div', { style: S.title }, '灵魂雷达 · 文章解析与输出辅助'),
          // 作者 2026-11-19：面板要能看出当前版本号，免得「装的哪一版」说不清。
          h('div', { style: S.version }, `v${PLUGIN_VERSION}`),
          h('p', { style: S.lead },
            '以模拟读者真实情绪反应为基础。把文章贴进对话输入框，发送就行。',
          ),
          h('p', { style: S.sub },
            '不用分段，不用标注，不用选任何东西。',
          ),
          h('p', { style: S.body },
            '你会拿到：总分、问题在哪、一句鞭策、和改哪里的意见。',
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject(SLOT_PANEL_LIST, () =>
          ctx.slots.register(
            {
              name: SLOT_PANEL_LIST,
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: () => '灵魂雷达',
            },
            PanelIcon,
          ),
        )
        ctx.slots.inject(SLOT_MAIN, () =>
          ctx.slots.register({ name: SLOT_MAIN, key: PANEL_ID }, Panel),
        )
      },
    }
  },
})
