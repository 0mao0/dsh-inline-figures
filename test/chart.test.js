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
