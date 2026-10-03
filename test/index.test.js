import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'index.js'), 'utf8')

test('index.js is the sole @deepseek-ai importer', () => {
  assert.match(src, /from '@deepseek-ai\/schemastery'/)
  assert.match(src, /from '@deepseek-ai\/dsh-tools'/)
  assert.match(src, /export function apply\(ctx, config\)/)
})

test('declares plugin identity, inject and volatile config', () => {
  assert.match(src, /export const name = 'inline-figures'/)
  assert.match(src, /export const inject = \['tools', 'systemPrompt'\]/)
  assert.match(src, /enabled: z\.boolean\(\)\.default\(true\)\.volatile\(\)/)
  assert.match(src, /if \(!config\.enabled\) return/)
})

test('registers draw_figure tool and the guidance section', () => {
  assert.match(src, /name: 'draw_figure'/)
  assert.match(src, /ctx\.tools\.register\(defineTool/)
  assert.match(src, /async execute\(args, exec\)/)
  assert.match(src, /exec\.agent\?\.session\?\.header\?\.cwd/)
  assert.match(src, /exec\.signal\.throwIfAborted\(\)/)
  assert.match(src, /\.dsh-figures/)
  assert.match(src, /ctx\.systemPrompt\.section\(\{/)
  assert.match(src, /interpolate: false/)
  // Host contract (verified against dsh-persona + the SystemPrompt service):
  // section `text` is a literal string; a function would be stringified into the prompt.
  assert.match(src, /text: GUIDANCE_TEXT,/)
  assert.ok(!/text: \(\{ scope \}/.test(src), 'section text must not be a function')
})

// Host reality (grep of the app bundle): session ids come in THREE shapes -
//   dsh-session:      `session-${++counter}`
//   dsh-api-session:  `session-${randomUUID()}`
//   dsh-agent-loop:   `${id}-session-${randomUUID()}`
// figureDirName must map every one to a well-formed, per-session-UNIQUE dir
// name, or the embedded URL breaks ('session-' dirs shipped 44 dead figures
// once). Collisions across sessions are forbidden: shared dirs would share
// the .gitignore and the prune(200) budget.
test('figure dir naming survives every host session-id shape', async () => {
  const { figureDirName } = await import('../lib/host-utils.js')
  // 1) dsh-session counter ids.
  assert.equal(figureDirName('session-12'), 's12')
  assert.equal(figureDirName('session-7'), 's7')
  // Distinct counter ids never collide.
  assert.notEqual(figureDirName('session-12'), figureDirName('session-3'))
  // 2) api-session uuid ids ('-' is URL/filesafe, kept).
  assert.equal(figureDirName('session-3f2a9c1e-6f7d-4c8b-9a2d-1e5b8c7d9f0a'), 's3f2a9c1e-6f7d-4')
  // 3) agent-loop compound ids: the leading hex run wins (may itself be a UUID).
  assert.equal(figureDirName('abc123def-session-3f2a9c1e-6f7d-4c8b-9a2d-1e5b8c7d9f0a'), 'abc123de')
  assert.equal(figureDirName('e446dbb6-5d73-44a8-b83f-0b45e80f5b33-session-9'), 'e446dbb6')
  // 4) plain hex UUID -> first 8 hex chars (original behaviour preserved).
  assert.equal(figureDirName('e446dbb6-5d73-44a8-b83f-0b45e80f5b33'), 'e446dbb6')
  // 5) degenerate -> fallback, never empty or path-breaking.
  assert.equal(figureDirName(''), 'fallback')
  assert.equal(figureDirName(undefined), 'fallback')
  assert.equal(figureDirName('session-'), 'fallback')
})

test('soft nudge wires like the first-party repeat-tool-reminder plugin', () => {
  // Same proven delivery channel: additionalContexts on tools/post-execute,
  // turn counting via agent/pre-step user-source messages (verified against
  // the bundled plugin source, not guessed).
  assert.match(src, /ctx\.on\('tools\/post-execute'/)
  assert.match(src, /additionalContexts: \[reminder/)
  assert.match(src, /ctx\.on\('agent\/pre-step'/)
  assert.match(src, /message\.source\?\.kind === 'user'/)
  // The reminder message MUST carry the producer source kind (unlabeled
  // contexts render as user prompts in derived history - host contract).
  assert.match(src, /source: \{ \.\.\.NUDGE_SOURCE, form: 'notice'/)
  assert.match(src, /createUserMessage/)
  // Successful draws feed the policy counter.
  assert.match(src, /usageOf\(exec\.agent\)\.drawCalls \+= 1/)
  // Nudge is gated by its own volatile config, defaulting on.
  assert.match(src, /nudge: z\.boolean\(\)\.default\(true\)\.volatile\(\)/)
  assert.match(src, /if \(config\.nudge\) \{/)
})

test('output contract matches the portable render fields', () => {
  assert.match(src, /render: \(_args, value\) =>/)
  for (const field of ['path', 'markdown', 'warnings']) {
    assert.match(src, new RegExp(`${field}: \\{ type: '(?:string|array)'.*?required: true`), `${field} required via per-property flag`)
  }
})

// Verified end-to-end against the installed host (scripts/_repro-png-check.mjs invokes
// draw_figure for every spec kind). Two host constraints, learned the hard way:
//  1. defineTool throws at registration if an object node omits additionalProperties.
//  2. At runtime an object with additionalProperties:false rejects every key NOT in
//     its `properties` whitelist. spec is heterogeneous (raw_svg + 4 preset kinds with
//     nested layers/nodes/rows/steps/data), so it MUST stay OPEN (true); deep validation
//     is validateSpec()/drawFigure() at execute time. Regressing this to false makes
//     every call fail with `invalid arguments: "spec.kind" is not a declared property`.
test('defineTool schema satisfies the host schema compiler', () => {
  assert.match(src, /spec: \{ type: 'object', required: true, additionalProperties: true/)
  // The output value-schema DSL rejects a top-level required array; scope the check
  // to the output schema block (between `output: {` and `render:`) so SPEC/comments don't false-positive.
  const outputBlock = src.slice(src.indexOf('output: {'), src.indexOf('render:'))
  assert.ok(outputBlock.length > 0)
  assert.ok(!/required: \[/.test(outputBlock), 'no top-level required array in the output value schema')
})

test('rasterizes to PNG with graceful SVG fallback (option A)', () => {
  // The GUI serves files with CSP sandbox; Chromium refuses to rasterize SVG
  // served that way, so the embedded image MUST be the PNG twin.
  // Rasterizer availability: host-side staging of the app's own sharp.
  assert.match(src, /loadRasterizer\(\)/)
  // Both layers name the .cjs ENTRY FILE and import it by absolute file URL.
  // A bare import('sharp') is deliberately NOT used: node_modules resolution is
  // layout-dependent and was probe-verified landing on an unrelated older copy
  // in the user's home node_modules instead of this plugin's staged one
  // (scripts/_validate-cache-load.cjs prints the resolved path).
  assert.match(src, /await import\(pathToFileURL\(LOCAL_SHARP\)\.href\)/, 'layer 1: the nested layout and the offline staging copy')
  assert.match(src, /await import\('sharp'\)/, "layer 2: bare resolution - the official profile install hoists the declared dependency to the profile root")
  assert.match(src, /await import\(pathToFileURL\(STAGED_SHARP\)\.href\)/, 'layer 3: the offline staging cache')
  // Order matters: the declared copy must win over the unrelated copy in the
  // user's home node_modules that bare resolution once landed on.
  assert.ok(src.indexOf("await import('sharp')") < src.indexOf('pathToFileURL(STAGED_SHARP)'), 'layers must stay in order')
  // Failed loads leave a visible trace for the human, not just the model.
  assert.match(src, /raster-diagnostic\.txt/)
  // Staged host sharp: plugin-local copy first, then the ~/.dsh cache (both
  // extracted from app.asar by stage-sharp.mjs; cacheRoot decides which).
  assert.match(src, /STAGED_SHARP/)
  assert.match(src, /LOCAL_SHARP/)
  assert.match(src, /\.dsh.*inline-figures.*sharp-js/)
  // Load happens once, lazily (a cached promise), never per call.
  assert.match(src, /rasterPromise === null/)
  // Raster failure degrades to SVG embedding + a warning, never a failed draw.
  assert.ok(src.includes("file.replace(/\\.svg$/, '.png')"), 'PNG twin derived from the svg name')
  assert.match(src, /PNG raster failed/)
  assert.match(src, /PNG rasterizer unavailable/)
  const embed = src.slice(src.indexOf('let embedRel'), src.indexOf('await pruneFigures'))
  assert.ok(embed.includes('embedRel = svgRel'), 'embed starts as SVG')
  assert.match(embed, /embedRel = `\.dsh-figures\/\$\{dirName\}\/\$\{pngFile\}`/, 'successful raster embeds the PNG')
  // Return value follows the embed target.
  assert.match(src, /markdown: `!\[\$\{args\.alt\}\]\(\$\{embedRel\}\)`/)
})

test('the rasterized PNG gets an opaque canvas, the SVG archive does not', () => {
  // A rasterizer has no prefers-color-scheme: without a backdrop the PNG is
  // transparent, and its light-mode text lands dark-on-dark in a dark GUI.
  assert.match(src, /const PNG_BACKDROP = '<rect width="100%" height="100%" fill="#/)
  assert.match(src, /export function withBackdrop\(svg\)/)
  assert.match(src, /raster\(Buffer\.from\(withBackdrop\(rendered\.svg\), 'utf8'\)\)/, 'the rasterizer must receive the backdrop version')
  // The written .svg must stay the transparent one, or the archive loses its
  // theme adaptivity for the browser that renders it.
  assert.match(src, /writeFigure\(dir, rendered\.svg, args\.slug/, 'the archived svg must not carry the backdrop')
  assert.ok(!/writeFigure\(dir, withBackdrop/.test(src), 'do not bake the backdrop into the archive')
})

test('delegates to portable modules only (no inline layout logic)', () => {
  for (const importee of ['./lib/engine.js', './lib/host-utils.js']) assert.ok(src.includes(importee), importee)
  assert.ok(!src.includes('function architecture('))
})
