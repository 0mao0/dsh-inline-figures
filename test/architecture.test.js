import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { architecture } from '../lib/figures/architecture.js'

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden')

const COMPLEX = {
  kind: 'architecture',
  title: 'Nightly 评测流水线',
  layers: [
    { label: '输入层', nodes: [{ label: '136 题题库', note: '金标+机制标注' }, { label: '基线结果' }] },
    { label: '生成层', tone: 'danger', badge: 'P1', note: '生成端噪声是主要翻转源', nodes: [{ label: '模型A' }, { label: '模型B' }, { label: '对照臂' }] },
    { label: '判分层', badge: 'P0', nodes: [{ label: 'LLM 裁判' }, { label: '规则裁判' }] },
    { label: '汇总层', nodes: [{ label: 'p90 耗时' }, { label: '错题机制' }] },
  ],
  footnote: '橙色压线带 (0.3~0.65) 是复核性价比最高的池子',
}

function renderAndCheck(name, spec, check) {
  const { svg, warnings } = architecture(spec)
  fs.mkdirSync(GOLDEN, { recursive: true })
  const file = path.join(GOLDEN, `${name}.svg`)
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(file, svg)
  assert.ok(fs.existsSync(file), `golden ${name}.svg missing - run: UPDATE_GOLDEN=1 node --test test/${name}.test.js`)
  assert.equal(svg, fs.readFileSync(file, 'utf8'), `golden mismatch for ${name}`)
  check(svg, warnings)
  return { svg, warnings }
}

test('architecture: complex golden + structure', () => {
  renderAndCheck('architecture-complex', COMPLEX, (svg, warnings) => {
    assert.deepEqual(warnings, [])
    assert.equal((svg.match(/class="box[ "]/g) ?? []).length, 4)
    assert.equal((svg.match(/class="chip"/g) ?? []).length, 9)
    assert.equal((svg.match(/class="line"/g) ?? []).length, 3)
    assert.equal((svg.match(/class="badge"/g) ?? []).length, 2)
    assert.ok(svg.includes('class="box box-danger"'))
    assert.ok(svg.includes('prefers-color-scheme:dark'))
    assert.ok(!svg.includes('<script'))
  })
})

test('architecture: explicit edges replace default chain', () => {
  const { svg, warnings } = architecture({
    kind: 'architecture',
    title: 't',
    layers: COMPLEX.layers.slice(0, 2).map((l) => ({ label: l.label, nodes: [{ label: 'x' }] })),
    edges: [{ from: 1, to: 0, label: '反馈' }],
  })
  assert.equal((svg.match(/class="line"/g) ?? []).length, 1)
  assert.ok(svg.includes('反馈'))
  assert.deepEqual(warnings, [])
})

test('architecture: truncation emits warnings', () => {
  const { warnings } = architecture({
    kind: 'architecture',
    title: 't',
    layers: [
      { label: '一个很长很长很长很长很长很长很长很长的层名称占满标题区', note: '長'.repeat(60), nodes: [{ label: 'x' }] },
      { label: 'b', nodes: [{ label: 'y' }] },
    ],
  })
  assert.ok(warnings.some((w) => w.includes('note truncated')), JSON.stringify(warnings))
})
