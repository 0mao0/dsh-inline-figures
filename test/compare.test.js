import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare } from '../lib/figures/compare.js'

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden')

const SPEC = {
  kind: 'compare',
  title: '理想 vs 实况',
  columnHeads: ['方案声称', '实际结果'],
  rows: [
    { left: { label: '一次通过', note: '文档承诺' }, right: { label: '需三轮重试', note: '实测 3 次', tone: 'danger' } },
    { left: { label: '零人工' }, right: { label: '需一次确认', tone: 'ok' } },
    { left: { label: '全量覆盖' }, right: { label: '覆盖 82%', tone: 'muted' } },
  ],
  footnote: '差异最大项应优先复核',
}

function renderAndCheck(name, spec, check) {
  const { svg, warnings } = compare(spec)
  fs.mkdirSync(GOLDEN, { recursive: true })
  const file = path.join(GOLDEN, `${name}.svg`)
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(file, svg)
  assert.ok(fs.existsSync(file), `golden ${name}.svg missing`)
  assert.equal(svg, fs.readFileSync(file, 'utf8'), `golden mismatch for ${name}`)
  check(svg, warnings)
  return { svg, warnings }
}

test('compare: golden + tone classes + arrows', () => {
  renderAndCheck('compare-basic', SPEC, (svg, warnings) => {
    assert.deepEqual(warnings, [])
    assert.equal((svg.match(/class="chip chip-danger"/g) ?? []).length, 1)
    assert.equal((svg.match(/class="chip chip-ok"/g) ?? []).length, 1)
    assert.equal((svg.match(/class="line"/g) ?? []).length, 3)
    assert.ok(svg.includes('方案声称') && svg.includes('实际结果'))
  })
})

test('compare: default tone when omitted', () => {
  const { svg } = compare({ kind: 'compare', title: 't', rows: [{ left: { label: 'a' }, right: { label: 'b' } }] })
  assert.ok(svg.includes('class="chip" x='))
  assert.ok(!/<rect class="chip chip-danger"/.test(svg))
})
