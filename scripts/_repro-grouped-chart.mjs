// Render the corrected before/after chart through the LIVE workspace engine.
import fs from 'node:fs'
import { drawFigure, validateSpec, formatErrors } from '../lib/engine.js'

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

const errors = validateSpec(spec)
console.log('validation:', errors.length === 0 ? 'OK' : formatErrors(errors))
const { svg, warnings } = drawFigure(spec)
console.log('warnings:', JSON.stringify(warnings))
const out = 'C:/Users/飞/Documents/deepseek-harness/default-workspace/_probe/fixed-chart.svg'
fs.writeFileSync(out, svg)
console.log('wrote', out, svg.length, 'bytes')

// The rejected shape from the transcript must still be rejected, with the fix.
const bad = {
  kind: 'chart',
  title: 'old',
  chartType: 'bar',
  data: [
    { label: '进图轮次 修前', value: 12 },
    { label: '进图轮次 修后', value: 19 },
    { label: '图节点 修前', value: 5 },
    { label: '图节点 修后', value: 24 },
    { label: '图边 修后', value: 41 },
  ],
}
console.log('old shape:', formatErrors(validateSpec(bad)))
