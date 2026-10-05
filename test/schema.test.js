import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSpec, LIMITS } from '../lib/schema.js'

const paths = (errors) => errors.map((e) => e.path)
const expectErrors = (spec, ...expected) => {
  const errors = validateSpec(spec)
  for (const p of expected) assert.ok(errors.some((e) => e.path === p), `expected error at ${p}, got ${JSON.stringify(errors)}`)
  assert.ok(errors.length > 0)
}
const expectOk = (spec) => assert.deepEqual(validateSpec(spec), [])

const twoLayers = [
  { label: 'A', nodes: [{ label: 'a' }] },
  { label: 'B', nodes: [{ label: 'b' }] },
]

test('limits exported', () => {
  assert.equal(LIMITS.layers[0], 2)
  assert.ok(LIMITS.specBytes >= 16 * 1024)
  assert.ok(LIMITS.svgBytes >= 32 * 1024)
})

test('non-object spec', () => {
  expectErrors('nope', 'spec')
  expectErrors(null, 'spec')
  expectErrors([1, 2], 'spec')
})

test('unknown kind', () => expectErrors({ kind: 'mindmap', title: 't' }, 'spec.kind'))

test('spec byte cap', () => expectErrors({ kind: 'timeline', title: 'x'.repeat(40000), steps: [{ label: 'a' }, { label: 'b' }] }, 'spec'))

test('architecture: valid minimal + full', () => {
  expectOk({ kind: 'architecture', title: 't', layers: twoLayers })
  expectOk({
    kind: 'architecture',
    title: 't',
    layers: [
      { label: 'A', tone: 'danger', badge: 'P1', note: 'nn', nodes: [{ label: 'a', note: 'x' }] },
      { label: 'B', nodes: [{ label: 'b' }] },
    ],
    edges: [{ from: 0, to: 1, label: 'go' }],
    footnote: 'fn',
  })
})

test('architecture: layer count bounds + shape errors', () => {
  expectErrors({ kind: 'architecture', title: 't', layers: [{ label: 'A', nodes: [{ label: 'a' }] }] }, 'spec.layers')
  expectErrors({ kind: 'architecture', title: 't', layers: 'oops' }, 'spec.layers')
  expectErrors({ kind: 'architecture', layers: twoLayers }, 'spec.title')
})

test('architecture: nodes required per layer + unknown node field', () => {
  expectErrors({ kind: 'architecture', title: 't', layers: [{ label: 'A', nodes: [] }, twoLayers[1]], }, 'spec.layers[0].nodes')
  expectErrors({ kind: 'architecture', title: 't', layers: [{ label: 'A', nodes: [{ label: 'a', color: 'red' }] }, twoLayers[1]] }, 'spec.layers[0].nodes[0].color')
})

test('architecture: badge length cap', () => expectErrors({ kind: 'architecture', title: 't', layers: [{ label: 'A', badge: 'TOOLONG', nodes: [{ label: 'a' }] }, twoLayers[1]] }, 'spec.layers[0].badge'))

test('architecture: edge validation', () => {
  expectErrors({ kind: 'architecture', title: 't', layers: twoLayers, edges: [{ from: 0, to: 9 }] }, 'spec.edges[0].to')
  expectErrors({ kind: 'architecture', title: 't', layers: twoLayers, edges: [{ from: 1, to: 1 }] }, 'spec.edges[0]')
})

test('compare: valid + tone enum', () => {
  expectOk({ kind: 'compare', title: 't', rows: [{ left: { label: 'l' }, right: { label: 'r', tone: 'danger' } }] })
  expectErrors({ kind: 'compare', title: 't', rows: [{ left: { label: 'l' }, right: { label: 'r', tone: 'neon' } }] }, 'spec.rows[0].right.tone')
})

test('compare: rows bounds + columnHeads shape', () => {
  expectErrors({ kind: 'compare', title: 't', rows: [] }, 'spec.rows')
  expectErrors({ kind: 'compare', title: 't', rows: [{ left: { label: 'l' }, right: { label: 'r' } }], columnHeads: ['a'] }, 'spec.columnHeads')
})

test('timeline: valid + state enum', () => {
  expectOk({ kind: 'timeline', title: 't', steps: [{ label: 'a', state: 'done' }, { label: 'b' }] })
  expectErrors({ kind: 'timeline', title: 't', steps: [{ label: 'a', state: 'wip' }, { label: 'b' }] }, 'spec.steps[0].state')
  expectErrors({ kind: 'timeline', title: 't', steps: [{ label: 'a' }] }, 'spec.steps')
})

test('chart: bar valid + negative + empty data', () => {
  expectOk({ kind: 'chart', title: 't', chartType: 'bar', data: [{ label: 'a', value: 1 }, { label: 'b', value: 2.5 }] })
  expectErrors({ kind: 'chart', title: 't', chartType: 'bar', data: [{ label: 'a', value: -1 }] }, 'spec.data[0].value')
  expectErrors({ kind: 'chart', title: 't', chartType: 'scatter', data: [{ label: 'a', value: 1 }] }, 'spec.chartType')
})

test('chart: pie requires positive sum', () => {
  expectErrors({ kind: 'chart', title: 't', chartType: 'pie', data: [{ label: 'a', value: 0 }] }, 'spec.data')
  expectOk({ kind: 'chart', title: 't', chartType: 'pie', data: [{ label: 'a', value: 0 }, { label: 'b', value: 3 }] })
})

test('chart: grouped series are valid, and pie rejects them', () => {
  const grouped = {
    kind: 'chart',
    title: 't',
    chartType: 'bar',
    seriesNames: ['修前', '修后'],
    data: [{ label: '进图轮次', values: [12, 19] }, { label: '图节点', values: [5, 24] }],
  }
  expectOk(grouped)
  expectErrors({ ...grouped, data: [{ label: 'a', values: [1, 2, 3] }] }, 'spec.data[0].values')
  expectErrors({ ...grouped, data: [{ label: 'a', values: [1, 2], value: 3 }] }, 'spec.data[0]')
  expectErrors({ ...grouped, data: [{ label: 'a', values: [1, -2] }] }, 'spec.data[0].values[1]')
  expectErrors({ ...grouped, seriesNames: ['only'] }, 'spec.seriesNames')
  expectErrors({ kind: 'chart', title: 't', chartType: 'pie', seriesNames: ['a', 'b'], data: [{ label: 'x', values: [1, 2] }] }, 'spec.data')
})

// The mis-shaped comparison that shipped on 2026-10-05: five flat bars where a
// before/after table needed three groups of two, and the 图边 修前 value was
// silently missing from the chart while the answer's own table carried it.
test('chart: an asymmetric before/after pair is rejected with the fix in the message', () => {
  const spec = {
    kind: 'chart',
    title: 'M1 写路径端到端：修前 vs 修后',
    chartType: 'bar',
    data: [
      { label: '进图轮次 修前', value: 12 },
      { label: '进图轮次 修后', value: 19 },
      { label: '图节点 修前', value: 5 },
      { label: '图节点 修后', value: 24 },
      { label: '图边 修后', value: 41 },
    ],
  }
  const errors = validateSpec(spec)
  assert.equal(errors.length, 1, JSON.stringify(errors))
  assert.equal(errors[0].path, 'spec.data[4]')
  assert.match(errors[0].message, /图边/)
  assert.match(errors[0].message, /add the 修前 value/)
  assert.match(errors[0].message, /values: \[修前, 修后\]/)
})

test('chart: a complete before/after pair is accepted either way', () => {
  const pairs = [
    { label: '进图轮次 修前', value: 12 },
    { label: '进图轮次 修后', value: 19 },
    { label: '图边 修前', value: 13 },
    { label: '图边 修后', value: 41 },
  ]
  expectOk({ kind: 'chart', title: 't', chartType: 'bar', data: pairs })
  expectOk({
    kind: 'chart',
    title: 't',
    chartType: 'bar',
    seriesNames: ['修前', '修后'],
    data: [{ label: '进图轮次', values: [12, 19] }, { label: '图边', values: [13, 41] }],
  })
  // Labels without a before/after marker are an ordinary single series: untouched.
  expectOk({ kind: 'chart', title: 't', chartType: 'bar', data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] })
})

test('raw_svg: empty and oversize rejected', () => {
  expectErrors({ kind: 'raw_svg', svg: '' }, 'spec.svg')
  expectErrors({ kind: 'raw_svg', svg: `<svg viewBox="0 0 10 10">${'<!--x-->'.repeat(20000)}</svg>` }, 'spec.svg')
  expectOk({ kind: 'raw_svg', svg: '<svg viewBox="0 0 10 10"/>' })
})
