// lib/schema.js — zero-dependency portable spec validator. No cordis / @deepseek-ai imports allowed.
const encoder = new TextEncoder()

export const LIMITS = {
  specBytes: 32 * 1024,
  svgBytes: 64 * 1024,
  layers: [2, 6],
  nodesPerLayer: [1, 6],
  edges: 8,
  compareRows: [1, 6],
  steps: [2, 10],
  chartData: [1, 12],
  badgeChars: 4,
  text: 160,
  footnote: 320,
  columnHead: 40,
  edgeLabel: 40,
  unit: 20,
  legendLabel: 40,
}

const KINDS = ['architecture', 'compare', 'timeline', 'chart', 'raw_svg']
const NODE_FIELDS = new Set(['label', 'note'])
const RIGHT_TONES = new Set(['default', 'danger', 'ok', 'muted'])

const err = (path, message) => ({ path, message })

function checkString(out, value, path, { required = false, max = LIMITS.text } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) out.push(err(path, 'must be a non-empty string'))
    return
  }
  if (typeof value !== 'string') {
    out.push(err(path, 'must be a string'))
    return
  }
  if (value.length > max) out.push(err(path, `must be at most ${max} characters, got ${value.length}`))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function checkTextRecord(out, value, path, { extraKeys = [] } = {}) {
  if (!isPlainObject(value)) {
    out.push(err(path, 'must be an object { label, note? }'))
    return
  }
  const allowed = new Set([...NODE_FIELDS, ...extraKeys])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) out.push(err(`${path}.${key}`, `unknown field (allowed: ${[...allowed].join(', ')})`))
  }
  checkString(out, value.label, `${path}.label`, { required: true })
  if (value.note !== undefined) checkString(out, value.note, `${path}.note`)
}

function checkRange(out, count, [min, max], path, what) {
  if (count < min || count > max) out.push(err(path, `must have ${min}-${max} ${what}, got ${count}`))
}

function validateArchitecture(out, spec) {
  checkString(out, spec.title, 'spec.title', { required: true })
  if (!Array.isArray(spec.layers)) {
    out.push(err('spec.layers', 'must be an array'))
  } else {
    checkRange(out, spec.layers.length, LIMITS.layers, 'spec.layers', 'layers')
    spec.layers.forEach((layer, i) => {
      const p = `spec.layers[${i}]`
      if (!isPlainObject(layer)) {
        out.push(err(p, 'must be an object'))
        return
      }
      for (const key of Object.keys(layer)) {
        if (!['label', 'note', 'tone', 'badge', 'nodes'].includes(key)) out.push(err(`${p}.${key}`, 'unknown field'))
      }
      checkString(out, layer.label, `${p}.label`, { required: true })
      if (layer.note !== undefined) checkString(out, layer.note, `${p}.note`)
      if (layer.tone !== undefined && layer.tone !== 'default' && layer.tone !== 'danger') out.push(err(`${p}.tone`, "must be 'default' or 'danger'"))
      if (layer.badge !== undefined && (typeof layer.badge !== 'string' || layer.badge.length === 0 || layer.badge.length > LIMITS.badgeChars)) {
        out.push(err(`${p}.badge`, `must be a 1-${LIMITS.badgeChars}-character string`))
      }
      if (!Array.isArray(layer.nodes)) {
        out.push(err(`${p}.nodes`, 'must be an array'))
        return
      }
      checkRange(out, layer.nodes.length, LIMITS.nodesPerLayer, `${p}.nodes`, 'nodes')
      layer.nodes.forEach((node, j) => checkTextRecord(out, node, `${p}.nodes[${j}]`))
    })
  }
  if (spec.edges !== undefined) {
    const layerCount = Array.isArray(spec.layers) ? spec.layers.length : 0
    if (!Array.isArray(spec.edges) || spec.edges.length > LIMITS.edges) {
      out.push(err('spec.edges', `must be an array of at most ${LIMITS.edges} edges`))
    } else {
      spec.edges.forEach((edge, i) => {
        const p = `spec.edges[${i}]`
        if (!isPlainObject(edge)) {
          out.push(err(p, 'must be an object { from, to, label? }'))
          return
        }
        const indexOk = (v) => Number.isInteger(v) && v >= 0 && v < layerCount
        if (!indexOk(edge.from)) out.push(err(`${p}.from`, `must be an integer layer index in 0..${layerCount - 1}`))
        if (!indexOk(edge.to)) out.push(err(`${p}.to`, `must be an integer layer index in 0..${layerCount - 1}`))
        if (edge.from === edge.to) out.push(err(p, 'from and to must differ'))
        if (edge.label !== undefined) checkString(out, edge.label, `${p}.label`, { max: LIMITS.edgeLabel })
      })
    }
  }
  if (spec.footnote !== undefined) checkString(out, spec.footnote, 'spec.footnote', { max: LIMITS.footnote })
}

function validateCompare(out, spec) {
  checkString(out, spec.title, 'spec.title', { required: true })
  if (spec.columnHeads !== undefined) {
    if (!Array.isArray(spec.columnHeads) || spec.columnHeads.length !== 2) {
      out.push(err('spec.columnHeads', 'must be exactly 2 head labels'))
    } else {
      spec.columnHeads.forEach((head, i) => checkString(out, head, `spec.columnHeads[${i}]`, { required: true, max: LIMITS.columnHead }))
    }
  }
  if (!Array.isArray(spec.rows)) {
    out.push(err('spec.rows', 'must be an array'))
  } else {
    checkRange(out, spec.rows.length, LIMITS.compareRows, 'spec.rows', 'rows')
    spec.rows.forEach((row, i) => {
      const p = `spec.rows[${i}]`
      if (!isPlainObject(row)) {
        out.push(err(p, 'must be an object { left, right }'))
        return
      }
      for (const key of Object.keys(row)) {
        if (!['left', 'right'].includes(key)) out.push(err(`${p}.${key}`, 'unknown field'))
      }
      checkTextRecord(out, row.left, `${p}.left`)
      if (!isPlainObject(row.right)) {
        out.push(err(`${p}.right`, 'must be an object { label, note?, tone? }'))
        return
      }
      for (const key of Object.keys(row.right)) {
        if (!['label', 'note', 'tone'].includes(key)) out.push(err(`${p}.right.${key}`, 'unknown field'))
      }
      checkTextRecord(out, { label: row.right.label, note: row.right.note }, `${p}.right`)
      if (row.right.tone !== undefined && !RIGHT_TONES.has(row.right.tone)) out.push(err(`${p}.right.tone`, 'must be one of default|danger|ok|muted'))
    })
  }
  if (spec.footnote !== undefined) checkString(out, spec.footnote, 'spec.footnote', { max: LIMITS.footnote })
}

function validateTimeline(out, spec) {
  checkString(out, spec.title, 'spec.title', { required: true })
  if (!Array.isArray(spec.steps)) {
    out.push(err('spec.steps', 'must be an array'))
    return
  }
  checkRange(out, spec.steps.length, LIMITS.steps, 'spec.steps', 'steps')
  spec.steps.forEach((step, i) => {
    const p = `spec.steps[${i}]`
    if (!isPlainObject(step)) {
      out.push(err(p, 'must be an object'))
      return
    }
    checkTextRecord(out, step, p, { extraKeys: ['state'] })
    if (step.state !== undefined && !['done', 'active', 'todo'].includes(step.state)) out.push(err(`${p}.state`, 'must be one of done|active|todo'))
  })
}

function validateChart(out, spec) {
  checkString(out, spec.title, 'spec.title', { required: true })
  if (!['bar', 'line', 'pie'].includes(spec.chartType)) out.push(err('spec.chartType', 'must be one of bar|line|pie'))
  if (spec.unit !== undefined) checkString(out, spec.unit, 'spec.unit', { max: LIMITS.unit })
  if (!Array.isArray(spec.data)) {
    out.push(err('spec.data', 'must be an array'))
    return
  }
  checkRange(out, spec.data.length, LIMITS.chartData, 'spec.data', 'items')
  let sum = 0
  spec.data.forEach((item, i) => {
    const p = `spec.data[${i}]`
    if (!isPlainObject(item)) {
      out.push(err(p, 'must be an object { label, value }'))
      return
    }
    for (const key of Object.keys(item)) {
      if (!['label', 'value'].includes(key)) out.push(err(`${p}.${key}`, 'unknown field'))
    }
    checkString(out, item.label, `${p}.label`, { required: true, max: LIMITS.legendLabel })
    if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0) {
      out.push(err(`${p}.value`, 'must be a finite non-negative number'))
    } else {
      sum += item.value
    }
  })
  if (spec.chartType === 'pie' && sum <= 0) out.push(err('spec.data', 'pie chart requires a positive sum of values'))
}

export function validateSpec(spec) {
  if (!isPlainObject(spec)) return [err('spec', 'must be an object')]
  const bytes = encoder.encode(JSON.stringify(spec)).length
  const errors = []
  if (bytes > LIMITS.specBytes) errors.push(err('spec', `serialized size ${bytes} bytes exceeds limit ${LIMITS.specBytes}`))
  switch (spec.kind) {
    case 'architecture':
      validateArchitecture(errors, spec)
      break
    case 'compare':
      validateCompare(errors, spec)
      break
    case 'timeline':
      validateTimeline(errors, spec)
      break
    case 'chart':
      validateChart(errors, spec)
      break
    case 'raw_svg': {
      if (typeof spec.svg !== 'string' || spec.svg.trim() === '') {
        errors.push(err('spec.svg', 'must be a non-empty string'))
      } else {
        const svgBytes = encoder.encode(spec.svg).length
        if (svgBytes > LIMITS.svgBytes) errors.push(err('spec.svg', `serialized size ${svgBytes} bytes exceeds limit ${LIMITS.svgBytes}`))
      }
      break
    }
    default:
      errors.push(err('spec.kind', `must be one of ${KINDS.join('|')}`))
  }
  return errors
}

export function formatErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.message}`).join('; ')
}
