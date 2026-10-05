import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chart } from '../lib/figures/chart.js'

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden')

function renderAndCheck(name, spec, check) {
  const { svg, warnings } = chart(spec)
  fs.mkdirSync(GOLDEN, { recursive: true })
  const file = path.join(GOLDEN, `${name}.svg`)
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(file, svg)
  assert.ok(fs.existsSync(file), `golden ${name}.svg missing`)
  assert.equal(svg, fs.readFileSync(file, 'utf8'), `golden mismatch for ${name}`)
  check(svg, warnings)
  return { svg, warnings }
}

test('chart bar: golden + bars + rotate warning', () => {
  const spec = {
    kind: 'chart',
    title: '单题耗时 p90 (秒)',
    chartType: 'bar',
    unit: '秒',
    data: [
      { label: 'text', value: 30.9 },
      { label: 'text-image', value: 34.1 },
      { label: 'text-table', value: 35.3 },
      { label: 'text-table-image', value: 40.9 },
      { label: 'other', value: 33.3 },
      { label: '总体', value: 33.9 },
    ],
  }
  renderAndCheck('chart-bar', spec, (svg, warnings) => {
    assert.equal((svg.match(/rx="4"/g) ?? []).length, 6)
    assert.ok(warnings.some((w) => w.includes('rotated 45°')), JSON.stringify(warnings))
  })
})

test('chart bar: grouped series render one group per item with a legend', () => {
  // The shape that was missing on 2026-10-05: a before/after table flattened
  // into five flat bars lost the 图边 修前 value and stopped being a comparison.
  const spec = {
    kind: 'chart',
    title: 'M1 写路径端到端：修前 vs 修后（真库 19 轮会话）',
    chartType: 'bar',
    unit: '计数',
    seriesNames: ['修前', '修后'],
    data: [
      { label: '进图轮次', values: [12, 19] },
      { label: '图节点', values: [5, 24] },
      { label: '图边', values: [13, 41] },
    ],
  }
  renderAndCheck('chart-bar-grouped', spec, (svg, warnings) => {
    assert.equal((svg.match(/rx="4"/g) ?? []).length, 6, 'three groups x two series')
    assert.equal((svg.match(/rx="2.5"/g) ?? []).length, 2, 'one legend swatch per series')
    assert.ok(svg.includes('>修前<') && svg.includes('>修后<'), 'legend names both series')
    assert.ok(svg.includes('>13<'), 'the previously dropped before value is drawn')
    assert.ok(!warnings.some((w) => w.includes('rotated')), JSON.stringify(warnings))
  })
})

test('chart line: grouped series draw one polyline per series', () => {
  const spec = {
    kind: 'chart',
    title: 't',
    chartType: 'line',
    seriesNames: ['前', '后'],
    data: [
      { label: 'a', values: [1, 3] },
      { label: 'b', values: [2, 5] },
    ],
  }
  const { svg } = chart(spec)
  assert.equal((svg.match(/<polyline/g) ?? []).length, 2)
  assert.equal((svg.match(/class="dot"/g) ?? []).length, 4)
})

test('chart line: thins value labels beyond 8 points', () => {
  const spec = {
    kind: 'chart',
    title: 't',
    chartType: 'line',
    data: Array.from({ length: 9 }, (_, i) => ({ label: `p${i + 1}`, value: i + 1 })),
  }
  const { svg, warnings } = chart(spec)
  assert.ok(svg.includes('<polyline'))
  assert.ok(warnings.some((w) => w.includes('thinned')), JSON.stringify(warnings))
})

test('chart pie: golden + slices + legend with percent', () => {
  const spec = {
    kind: 'chart',
    title: '错题来源构成',
    chartType: 'pie',
    data: [
      { label: '判官语义未过', value: 86 },
      { label: '本次新转错', value: 33 },
      { label: '幻觉', value: 15 },
      { label: '空答', value: 2 },
    ],
  }
  renderAndCheck('chart-pie', spec, (svg, warnings) => {
    assert.deepEqual(warnings, [])
    assert.equal((svg.match(/ A86 86 /g) ?? []).length, 4)
    assert.equal((svg.match(/rx="3"/g) ?? []).length, 4)
    assert.ok(svg.includes('63.2%'))
    assert.ok(svg.match(/M\d+ \d+ L.*A86 86 0 1 1/) !== null, 'largest slice needs large-arc flag')
  })
})
