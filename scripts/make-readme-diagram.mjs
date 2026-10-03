// scripts/make-readme-diagram.mjs — build the "how it works" diagram for the
// READMEs: docs/assets/how-it-works.png (English) and .zh.png (Chinese).
//
// One picture, three bands: what the model does, what the plugin does in the
// host process, and how the figure reaches the page. The panel at the bottom
// answers the question the bands raise: what of this touches the disk.
//
// Run:  node scripts/make-readme-diagram.mjs   (or npm run readme-assets)
import path from 'node:path'
import { wrapText, esc } from '../lib/primitives.js'
import { loadSharp, emit } from './readme-assets.mjs'

const W = 1200
const M = 28
const LABEL_W = 96
const GAP_LABEL = 16
const X0 = M + LABEL_W + GAP_LABEL
const X1 = W - M
const CONTENT_W = X1 - X0
const CENTER = X0 + CONTENT_W / 2
const BOX_H = 76
const BAND_H = 104
const DISK_H = 220

const CSS = [
  "text{font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
  '.t{fill:#22221f}.t-dim{fill:#6f6f68}.t-ok{fill:#1c7c46}',
  '.box{fill:#f4f4f2;stroke:#d0d0ca;stroke-width:1}',
  '.chip{fill:#ffffff;stroke:#dcdcd6;stroke-width:1}',
  '.band{fill:#fbfbfa;stroke:#e6e6e1;stroke-width:1}',
  '.accent1{fill:#5b8def}.accent2{fill:#3fa796}.accent3{fill:#dd9a3a}',
  '.rule{stroke:#e6e6e1;stroke-width:1}',
].join('')

const LOCALES = {
  en: {
    out: 'how-it-works',
    bands: [
      {
        label: 'Model',
        boxes: [
          { t: 'Decide the point wants a figure', n: 'parts, flow, comparison, counts', accent: 'accent1' },
          { t: 'Call draw_figure', n: 'spec + alt + slug' },
          { t: 'Paste the returned line', n: '![alt](.dsh-figures/…)' },
        ],
      },
      {
        label: 'Plugin',
        sub: 'host process',
        boxes: [
          { t: 'Validate spec', n: 'fields, limits, enums', accent: 'accent1' },
          { t: 'Lay out or sanitize', n: ['presets compute coordinates', 'raw_svg: sanitize + theme'] },
          { t: 'Write + rasterize', n: 'the .svg and a .png twin' },
          { t: 'Prune', n: '200 figures per session' },
          { t: 'Return one line', n: 'path + markdown + warnings', accent: 'accent3' },
        ],
      },
      {
        label: 'UI',
        boxes: [
          { t: 'Markdown image in the reply', n: 'native ![](path)' },
          { t: 'Authenticated file route', n: 'api/file reads the session workspace' },
          { t: 'Full width, click to zoom', n: 'never collapsed into a tool card', accent: 'accent2' },
        ],
      },
    ],
    disk: {
      title: 'What reaches the disk: the session workspace, nothing else',
      tree: [
        { p: '<session workspace>/.dsh-figures/<session>/', c: '' },
        { p: 'N-slug.svg', c: 'vector original', indent: true },
        { p: 'N-slug.png', c: 'the raster the reply embeds', indent: true },
        { p: '.gitignore', c: 'holds * , so git status stays clean', indent: true },
      ],
      statements: [
        'No network calls, no uploads, no telemetry. At most 200 figures per session directory; older ones are pruned by mtime, and a pruned SVG takes its PNG twin with it.',
        'A figure is a reference, not a copy: delete the files and old replies show a broken image.',
      ],
    },
  },
  zh: {
    out: 'how-it-works.zh',
    bands: [
      {
        label: '模型',
        boxes: [
          { t: '判定这里用图更清楚', n: '结构、流程、对比、计数', accent: 'accent1' },
          { t: '调用 draw_figure', n: 'spec 规格 + alt + slug' },
          { t: '把返回的那一行贴进正文', n: '![说明](.dsh-figures/…)' },
        ],
      },
      {
        label: '插件',
        sub: '宿主进程',
        boxes: [
          { t: '校验 spec', n: '字段、上限、枚举', accent: 'accent1' },
          { t: '排版或消毒', n: ['预设算坐标', 'raw_svg 消毒 + 注入主题'] },
          { t: '写盘 + 栅格', n: '同名 .svg 与 .png 孪生' },
          { t: 'LRU 清理', n: '每会话保留 200 张' },
          { t: '回一行 markdown', n: 'path + markdown + warnings', accent: 'accent3' },
        ],
      },
      {
        label: '界面',
        boxes: [
          { t: '正文里的 Markdown 图片', n: '原生 ![](路径)' },
          { t: '认证文件路由', n: 'api/file 读会话工作区' },
          { t: '满宽渲染、点击放大', n: '不折叠进工具卡', accent: 'accent2' },
        ],
      },
    ],
    disk: {
      title: '落盘：只写会话工作区，别处不落',
      tree: [
        { p: '<会话工作区>/.dsh-figures/<会话>/', c: '' },
        { p: 'N-slug.svg', c: '矢量原件', indent: true },
        { p: 'N-slug.png', c: '正文里嵌的位图', indent: true },
        { p: '.gitignore', c: '内容 * ，git status 保持干净', indent: true },
      ],
      statements: [
        '不联网、不上传、无遥测。每个会话目录最多保留 200 张，超出按 mtime 清理，PNG 随 SVG 一起删。',
        '图是引用而不是副本：删掉文件，旧回答里的图就变成破图。',
      ],
    },
  },
}

function box(x, y, w, h, { t, n, accent }, titleSize = 14, noteSize = 12) {
  const parts = [
    `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>`,
  ]
  if (accent) parts.push(`<rect class="${accent}" x="${x}" y="${y}" width="5" height="${h}" rx="2.5"/>`)
  parts.push(`<text class="t" x="${x + 14}" y="${y + 27}" font-size="${titleSize}" font-weight="600">${esc(t)}</text>`)
  if (n) {
    // A string wraps to the box; an array is used line by line.
    const lines = Array.isArray(n) ? n : wrapText(n, w - 28, noteSize)
    lines.forEach((line, i) => parts.push(`<text class="t-dim" x="${x + 14}" y="${y + 47 + i * 17}" font-size="${noteSize}">${esc(line)}</text>`))
  }
  return parts.join('')
}

const arrowRight = (x, y) => `<path d="M${x} ${y} L${x + 12} ${y}" stroke="#7b828d" stroke-width="1.6" fill="none" marker-end="url(#arr)"/>`
const arrowDown = (x, y) => `<path d="M${x} ${y} L${x} ${y + 16}" stroke="#7b828d" stroke-width="1.6" fill="none" marker-end="url(#arr)"/>`

function build(L) {
  const parts = []
  let y = 24

  // Three bands: model, plugin, UI.
  L.bands.forEach((band, bi) => {
    parts.push(`<rect class="band" x="${M}" y="${y}" width="${W - M * 2}" height="${BAND_H}" rx="14"/>`)
    parts.push(`<text class="t" x="${M + 22}" y="${y + 46}" font-size="15" font-weight="700">${esc(band.label)}</text>`)
    if (band.sub) parts.push(`<text class="t-dim" x="${M + 22}" y="${y + 66}" font-size="12">${esc(band.sub)}</text>`)

    const count = band.boxes.length
    const gap = count > 3 ? 14 : 18
    const w = Math.floor((CONTENT_W - gap * (count - 1)) / count)
    band.boxes.forEach((b, i) => {
      const bx = X0 + i * (w + gap)
      parts.push(box(bx, y + 14, w, BOX_H, b, count > 3 ? 13 : 14, count > 3 ? 11.5 : 12))
      if (i < count - 1) parts.push(arrowRight(bx + w + 1, y + 14 + BOX_H / 2))
    })
    y += BAND_H
    if (bi < L.bands.length - 1) {
      parts.push(arrowDown(CENTER, y + 1))
      y += 20
    } else {
      y += 24
    }
  })

  // Disk panel.
  const disk = L.disk
  parts.push(`<rect class="box" x="${M}" y="${y}" width="${W - M * 2}" height="${DISK_H}" rx="14"/>`)
  parts.push(`<text class="t" x="${M + 24}" y="${y + 34}" font-size="15" font-weight="700">${esc(disk.title)}</text>`)
  let ty = y + 64
  for (const row of disk.tree) {
    // SVG collapses leading spaces, so indent children by moving x.
    const tx = M + 24 + (row.indent ? 26 : 0)
    parts.push(`<text class="t" x="${tx}" y="${ty}" font-size="13">${esc(row.p)}</text>`)
    if (row.c) parts.push(`<text class="t-dim" x="${M + 24 + 300}" y="${ty}" font-size="12.5">${esc(row.c)}</text>`)
    ty += 24
  }
  parts.push(`<line class="rule" x1="${M + 24}" y1="${ty + 2}" x2="${W - M - 24}" y2="${ty + 2}"/>`)
  ty += 26
  for (const s of disk.statements) {
    for (const line of wrapText(s, W - M * 2 - 48, 12.5)) {
      parts.push(`<text class="t-dim" x="${M + 24}" y="${ty}" font-size="12.5">${esc(line)}</text>`)
      ty += 19
    }
    ty += 4
  }

  const H = y + DISK_H + 40
  return {
    svg: [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">`,
      `<style>${CSS}</style>`,
      '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9a9a92"/></marker></defs>',
      parts.join(''),
      '</svg>',
    ].join(''),
    height: H,
  }
}

const { sharp, why } = await loadSharp()
for (const [code, L] of Object.entries(LOCALES)) {
  const { svg, height } = build(L)
  const note = await emit(L.out, svg, sharp)
  console.log(`${code}:  ${note}  (${W}x${height} logical, ${W * 2}x${height * 2} raster)`)
}
if (!sharp) console.error(`sharp unavailable, .png files not written:\n  ${why.join('\n  ')}`)
