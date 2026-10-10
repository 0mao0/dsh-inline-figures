// test/font-check.test.js — the host-can't-draw-CJK check.
// Every probe is injected, so no test spawns fc-list.
import test from 'node:test'
import assert from 'node:assert/strict'
import { specContainsCjk, cjkFontWarning } from '../lib/font-check.js'

const ZH_TIMELINE = {
  kind: 'timeline',
  title: '从定位到提 issue',
  steps: [{ label: '第一行中文', note: 'note', state: 'done' }],
}
const EN_TIMELINE = {
  kind: 'timeline',
  title: 'from diagnosis to issue',
  steps: [{ label: 'step one', note: 'note', state: 'done' }],
}
const ZH_RAW_SVG = {
  kind: 'raw_svg',
  svg: '<svg viewBox="0 0 680 120"><text x="12" y="30" font-size="14">中文标签</text></svg>',
}

const fontsFound = async () => ({ ok: true, stdout: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc\n' })
const fontsEmpty = async () => ({ ok: true, stdout: '\n' })
const cliMissing = async () => ({ ok: false, code: 'ENOENT' })
const inconclusive = async () => ({ ok: false, code: 'EACCES' })

test('specContainsCjk finds CJK anywhere in a nested spec', () => {
  assert.equal(specContainsCjk(ZH_TIMELINE), true)
  assert.equal(specContainsCjk(ZH_RAW_SVG), true)
  assert.equal(specContainsCjk({ kind: 'compare', rows: [{ left: { label: 'ok' }, right: { label: '好' } }] }), true)
  assert.equal(specContainsCjk({ kind: 'chart', data: [{ label: 'x', values: [1, 2] }] }), false)
})

test('specContainsCjk tolerates non-string and empty values', () => {
  assert.equal(specContainsCjk(EN_TIMELINE), false)
  assert.equal(specContainsCjk(undefined), false)
  assert.equal(specContainsCjk(null), false)
  assert.equal(specContainsCjk(''), false)
  assert.equal(specContainsCjk({ steps: [{ label: 12 }, { label: null }] }), false)
})

test('an ASCII-only spec never probes the font system', async () => {
  let called = false
  const warning = await cjkFontWarning({
    spec: EN_TIMELINE,
    run: async () => {
      called = true
      return { ok: true, stdout: '' }
    },
  })
  assert.equal(warning, undefined)
  assert.equal(called, false, 'a figure with no CJK labels cannot lose CJK glyphs')
})

test('CJK labels with a covering font installed warn nothing', async () => {
  assert.equal(await cjkFontWarning({ spec: ZH_TIMELINE, run: fontsFound }), undefined)
})

test('a font database without a CJK font warns and names the install', async () => {
  const warning = await cjkFontWarning({ spec: ZH_TIMELINE, run: fontsEmpty, platform: 'linux' })
  assert.match(warning, /empty boxes/)
  assert.match(warning, /fontconfig fonts-noto-cjk/)
})

test('a missing fontconfig CLI on Linux without fonts.conf warns', async () => {
  const warning = await cjkFontWarning({
    spec: ZH_TIMELINE,
    run: cliMissing,
    platform: 'linux',
    hasFontConfig: () => false,
  })
  assert.match(warning, /empty boxes/)
  assert.match(warning, /\/etc\/fonts\/fonts\.conf is absent/)
})

test('a missing fontconfig CLI on Linux WITH fonts.conf stays silent', async () => {
  // A font database exists; the CLI alone is missing, so this check cannot
  // claim the fonts are unusable.
  const warning = await cjkFontWarning({
    spec: ZH_TIMELINE,
    run: cliMissing,
    platform: 'linux',
    hasFontConfig: () => true,
  })
  assert.equal(warning, undefined)
})

test('a missing fontconfig CLI off Linux stays silent', async () => {
  // macOS and Windows resolve fonts through the OS; a missing fc-list proves
  // nothing there, and a false warning on every figure would be worse than none.
  for (const platform of ['darwin', 'win32']) {
    const warning = await cjkFontWarning({
      spec: ZH_TIMELINE,
      run: cliMissing,
      platform,
      hasFontConfig: () => false,
    })
    assert.equal(warning, undefined, `${platform} must not be judged by fc-list`)
  }
})

test('an inconclusive probe failure stays silent', async () => {
  const warning = await cjkFontWarning({ spec: ZH_TIMELINE, run: inconclusive, platform: 'linux' })
  assert.equal(warning, undefined)
})
