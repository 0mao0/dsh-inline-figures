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

test('raw_svg: empty and oversize rejected', () => {
  expectErrors({ kind: 'raw_svg', svg: '' }, 'spec.svg')
  expectErrors({ kind: 'raw_svg', svg: `<svg viewBox="0 0 10 10">${'<!--x-->'.repeat(20000)}</svg>` }, 'spec.svg')
  expectOk({ kind: 'raw_svg', svg: '<svg viewBox="0 0 10 10"/>' })
})
