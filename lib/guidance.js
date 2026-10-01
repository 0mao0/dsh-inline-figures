// lib/guidance.js — portable guidance constants (exported for reuse in any agent host). No cordis imports.
export const GUIDANCE_TITLE = 'inline-figures:guidance'

export const GUIDANCE_TEXT = `# Inline explanatory figures
You can render clean vector figures inline in your replies with the draw_figure tool. Figures are always SVG - never ASCII art, Unicode box drawing, or code-block diagrams.
WHEN TO DRAW: answers that explain an architecture, a process, a before/after comparison, a timeline, or quantitative data should include 1-3 figures placed inside the prose. Pure factual answers, short edits, and code delivery need none. If the user says they do not want figures, stop drawing them.
PRIORITY - SVG FIRST:
1. Free-form SVG (primary): for any structure a preset does not cover (trees, branching pipelines, state flows, decision graphs, custom diagrams), author the SVG yourself and call draw_figure with {kind:'raw_svg', svg:'<svg ...>'}. The tool sanitizes it, scales it to full column width, and injects theme-aware styles and arrowheads so it stays legible in light and dark mode.
2. Preset spec (fallback): when a standard shape fits exactly, or the figure is numeric and you want guaranteed spacing, call draw_figure with a JSON spec - kind: architecture | compare | timeline | chart. Its layout engine computes all positions; never hand-write coordinates for these.
HAND-AUTHORED SVG RULES: bare <svg> root with viewBox="0 0 680 H" (width is set for you; choose H to fit the content, ~24px vertical padding around every element). Every label is a <text> with font-size >= 12 and line advance >= 19. Reuse the injected classes (.box .chip .badge .t .t-inv .t-dim .t-danger .t-ok .axis .grid .dot .ring-done .ring-active .ring-todo) and class="line" for arrows - they already follow the active color scheme. Keep labels about 12 characters. No scripts, entities, external hrefs, or <image>.
HOW: the tool returns a relative path and a markdown line. Copy that markdown line VERBATIM into your reply at the exact position where the figure belongs. Alternate text and figures: one figure = one topic, always introduced and followed by prose. Never stack two figures back to back, and never repeat in text what the figure already shows.
KEEP IT TRUE: put nuance in the surrounding prose, not inside the figure. Figures must reflect real numbers from context - never invent data to fill a chart.
FAILURE: if draw_figure reports an invalid spec or rejected SVG, fix it once; on a second failure continue the answer in plain text. Never loop.`
