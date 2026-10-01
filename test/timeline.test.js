import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { timeline } from '../lib/figures/timeline.js'

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden')

const SPEC = {
  kind: 'timeline',
  title: '本次修复推进',
  steps: [
    { label: '题库基线复核', note: '136 题逐题标注机制', state: 'done' },
    { label: '裁判语义放宽', state: 'done' },
    { label: '压线带 44 道复核', note: '性价比最高池子', state: 'active' },
    { label: '守卫输给对照臂待办', state: 'todo' },
  ],
}

function renderAndCheck(name, spec, check) {
  const { svg, warnings } = timeline(spec)
  fs.mkdirSync(GOLDEN, { recursive: true })
  const file = path.join(GOLDEN, `${name}.svg`)
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(file, svg)
  assert.ok(fs.existsSync(file), `golden ${name}.svg missing`)
  assert.equal(svg, fs.readFileSync(file, 'utf8'), `golden mismatch for ${name}`)
  check(svg, warnings)
  return { svg, warnings }
}

test('timeline: golden + state markers + connectors', () => {
  renderAndCheck('timeline-basic', SPEC, (svg, warnings) => {
    assert.deepEqual(warnings, [])
    assert.equal((svg.match(/class="ring-done"/g) ?? []).length, 2)
    assert.equal((svg.match(/class="ring-active"/g) ?? []).length, 1)
    assert.equal((svg.match(/class="ring-todo"/g) ?? []).length, 1)
    assert.equal((svg.match(/<line class="axis"/g) ?? []).length, 3)
  })
})

test('timeline: steps default to todo state', () => {
  const { svg } = timeline({ kind: 'timeline', title: 't', steps: [{ label: 'a' }, { label: 'b' }] })
  assert.equal((svg.match(/class="ring-todo"/g) ?? []).length, 2)
})
