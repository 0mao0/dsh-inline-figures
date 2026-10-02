// lib/nudge.js — portable nudge decision core. Zero dependencies; host-agnostic.
// The host adapter tracks per-session figure usage (draw_figure calls + answered
// turns) and asks decideNudge() whether this turn start deserves one short,
// self-contained reminder injected as model-visible context.

export const NUDGE_REMINDER = [
  'Inline-figure check (from the inline-figures plugin): so far in this conversation you have produced',
  'text answers with ZERO draw_figure calls, yet the guidance for that tool says most explanatory answers',
  'should carry at least one figure. Before you finish this answer, scan it for structure - components',
  'and relations, a flow or sequence, a comparison or trade-off, counts/proportions, a plan or phase',
  'list. If any exists, call draw_figure for it and embed the returned markdown line where that point',
  'is discussed, then DELETE the paragraph it replaces. Only an atomic answer (one number, one date,',
  'one name, a one-line definition, a small edit, pure code) may skip drawing. This applies even when',
  'the question is about our own tooling, status, or this plugin itself.',
].join(' ')

const DEFAULTS = { minTurns: 2, maxNudges: 2, quietFloor: 1, quietRatio: 0.3 }

/**
 * Pure nudge decision from a usage snapshot.
 * @param usage - { drawCalls: number, turns: number, nudgesSent: number }
 * @param opts - optional overrides for minTurns / maxNudges / quietRatio / quietFloor.
 * @returns 'none' | 'remind'
 */
export function decideNudge(usage, opts = {}) {
  const { minTurns, maxNudges, quietFloor, quietRatio } = { ...DEFAULTS, ...opts }
  const draws = Number(usage?.drawCalls) || 0
  const turns = Number(usage?.turns) || 0
  const sent = Number(usage?.nudgesSent) || 0
  if (turns < minTurns) return 'none'
  if (sent >= maxNudges) return 'none'
  // The session draws at a healthy rate: stay quiet permanently.
  if (draws >= quietFloor && draws / Math.max(turns, 1) >= quietRatio) return 'none'
  // Zero figures, or figures far below the expected rate: one short reminder.
  return 'remind'
}

export const NUDGE_DEFAULTS = DEFAULTS

// Producer identity stamped on every injected reminder. The `{kind}` label is
// load-bearing: an unlabeled context would render as a user prompt in derived
// history (same contract as the first-party repeat-tool-reminder source).
export const NUDGE_SOURCE = { kind: 'inline-figures-nudge' }
