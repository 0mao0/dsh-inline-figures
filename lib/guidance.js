// lib/guidance.js — portable guidance constants (exported for reuse in any agent host). No cordis imports.
export const GUIDANCE_TITLE = 'inline-figures:guidance'

export const GUIDANCE_TEXT = `# Inline explanatory figures
You can render clean vector figures inline in your replies with the draw_figure tool.
WHEN TO DRAW: answers that explain an architecture, a process, a before/after comparison, a timeline, or quantitative data should include 1-3 figures placed inside the prose. Pure factual answers, short edits, and code delivery need none. If the user says they do not want figures, stop drawing them.
HOW:
1. Call draw_figure with a JSON spec (kind: architecture | compare | timeline | chart) and short alt text. Layout is computed for you - never hand-write coordinates.
2. The tool returns a relative path and a markdown line. Copy that markdown line VERBATIM into your reply at the exact position where the figure belongs.
3. Alternate text and figures: one figure = one topic, always introduced and followed by prose. Never stack two figures back to back, and never repeat in text what the figure already shows.
4. Keep node labels short (about 12 characters); put nuance in the surrounding prose. Figures must reflect real numbers from context - never invent data to fill a chart.
ESCAPE HATCH: if no preset fits, hand-author an SVG file with the write tool (bare <svg> root with viewBox, no scripts or external references) and embed it the same way.
FAILURE: if draw_figure reports an invalid spec, fix it once; on a second failure continue the answer in plain text. Never loop.`
