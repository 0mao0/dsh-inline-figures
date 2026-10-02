import test from 'node:test'
import assert from 'node:assert/strict'
import { decideNudge, NUDGE_DEFAULTS, NUDGE_REMINDER, NUDGE_SOURCE } from '../lib/nudge.js'

const U = (drawCalls, turns, nudgesSent = 0) => ({ drawCalls, turns, nudgesSent })

test('nudge defaults are conservative', () => {
  assert.equal(NUDGE_DEFAULTS.minTurns, 2)
  assert.equal(NUDGE_DEFAULTS.maxNudges, 2)
})

test('first turn never nudges; silence waits for evidence', () => {
  assert.equal(decideNudge(U(0, 0)), 'none')
  assert.equal(decideNudge(U(0, 1)), 'none')
})

test('zero-figure sessions get reminded, then go quiet at the cap', () => {
  assert.equal(decideNudge(U(0, 2)), 'remind')
  assert.equal(decideNudge(U(0, 9, NUDGE_DEFAULTS.maxNudges)), 'none')
})

test('a healthy figure rate stays quiet from the start', () => {
  assert.equal(decideNudge(U(2, 2)), 'none') // ratio 1.0
  assert.equal(decideNudge(U(1, 3)), 'none') // ratio 0.33 >= quietRatio
})

test('a far-below-rate session is reminded up to the cap', () => {
  assert.equal(decideNudge(U(1, 10)), 'remind') // ratio 0.1 < 0.3
  assert.equal(decideNudge(U(1, 10, NUDGE_DEFAULTS.maxNudges)), 'none')
})

test('garbage input degrades to none, never throws', () => {
  assert.equal(decideNudge(undefined), 'none')
  assert.equal(decideNudge({}), 'none')
  assert.equal(decideNudge({ drawCalls: 'x', turns: 'y', nudgesSent: null }), 'none')
})

test('the reminder is self-contained and carries producer identity', () => {
  // Self-contained: survives context compaction, so it re-states the rule inline.
  assert.match(NUDGE_REMINDER, /draw_figure/)
  assert.match(NUDGE_REMINDER, /at least one figure/)
  assert.match(NUDGE_REMINDER, /DELETE the paragraph it replaces/)
  assert.match(NUDGE_REMINDER, /atomic answer/)
  assert.equal(NUDGE_REMINDER.length <= 900, true, 'reminder stays one compact block')
  assert.equal(NUDGE_SOURCE.kind, 'inline-figures-nudge')
})
