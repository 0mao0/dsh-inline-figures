# dsh-inline-figures

[![version](https://img.shields.io/badge/version-0.0.1-blue)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![ci](https://github.com/0mao0/dsh-inline-figures/actions/workflows/ci.yml/badge.svg)](https://github.com/0mao0/dsh-inline-figures/actions/workflows/ci.yml)

**English** | [中文](README.zh.md)

**Description.** A **DeepSeek Harness (DSH) host plugin** that makes the model draw **clean vector figures inline between the paragraphs of its reply**. One `draw_figure` tool call turns a JSON figure spec or a hand-authored SVG into a full-width figure file and returns a single Markdown line; the model pastes that line where the figure belongs. Text, figure, text — and nothing collapses into a tool card when the turn ends.

**Keywords.** DeepSeek Harness plugin · DSH host plugin · Cordis bundle · `draw_figure` · inline SVG figures · text–figure–text answers · vector diagrams in AI chat · ASD-STE100 figure labels · LLM output readability

![The same answer without the plugin on the left, and with the plugin on the right](docs/assets/before-after.png)

*Same facts, same answer. Left: plain Markdown. Right: the model drew the structure and deleted the paragraph it replaced.*

## Why

Long model answers are walls of text. Two fixes are well known, and this plugin does both:

- **Write plainer.** The injected guidance asks for prose at roughly 80% **ASD-STE100** — Simplified Technical English, the controlled language of aircraft maintenance manuals. Andrej Karpathy [recommended ASD-STE100](https://www.searchenginejournal.com/karpathy-llm-aircraft-manual-writing/591813/) for exactly this problem, and [ranked diagrams above prose](https://www.explainx.ai/blog/karpathy-understand-llm-outputs-ste100-diagrams-html-video-2026) as the next step for understanding a model's output. Figure labels here are the strictest tier of the same style: noun phrases, six words at most, one concept per label.
- **Draw the structure.** Anything with parts, flow, sequence, comparison, or counts becomes a figure instead of a paragraph, placed at the point it illuminates.

## Install

DSH has its own plugin manager, so nothing is copied by hand and no package-manager command runs against your profile.

```powershell
# from this repository (works today, no registry involved)
dsh plugin --profile <profile> add github:0mao0/dsh-inline-figures

# from npm, once the package is published there
dsh plugin --profile <profile> add dsh-inline-figures
```

The Web sidebar's **Plugins** page does the same thing with a form, and an agent can do it with the `plugin_manager` tool (`install_bundle`, target = the directory of a local clone).

Then **restart DSH**. Host-side plugin code is loaded once per process, so a fresh JavaScript generation needs a restart; the plugin list can keep showing the previous state until then.

There is no build step. The harness supplies the packages this plugin imports, and `sharp` — the rasterizer behind previewable figures — ships prebuilt binaries.

### What the harness checks before it installs

`package.json` pins the DSH runtime version this release was verified against, as **peer dependencies** on `@deepseek-ai/dsh-*`. The plugin manager evaluates those peers first and refuses an install on a different runtime with `incompatible-version` — a clear refusal, instead of a plugin that mounts and then misbehaves. To run it on another runtime anyway, grant the exact-version exemption:

```powershell
dsh plugin --profile <profile> allow-version dsh-inline-figures@0.0.1 --dsh-version <runtime> --accept-risk
```

Verified against **dsh 0.2.0-rc.2** (cordis 4.0.4). If you need a machine that cannot reach a registry at all, [docs/MAINTAINER-NOTES.md](docs/MAINTAINER-NOTES.md) keeps the offline installer as an unsupported fallback.

## The `draw_figure` tool

```
draw_figure({ spec, alt, slug? }) -> { path, markdown, warnings }
```

A preset spec, laid out for you — never hand-write coordinates for these:

```json
{ "kind": "compare", "title": "Current vs target",
  "rows": [{ "left": { "label": "Manual review" },
             "right": { "label": "Automated gate", "tone": "ok" } }] }
```

The returned line, to paste verbatim:

```
![Current vs target](.dsh-figures/s3f2a9c1e-6f7d-4/1-compare.png)
```

| `kind` | Shape | Limits |
|---|---|---|
| `raw_svg` | Hand-authored SVG for trees, branching pipelines, state machines, anything custom | 32 KB spec |
| `architecture` | Layered boxes, P0/P1 badges, danger groups, feedback edges | 2–6 layers × 1–6 nodes, 8 edges |
| `compare` | Left/right columns with semantic tones (`default`/`danger`/`ok`/`muted`) | 1–6 rows |
| `timeline` | Vertical steps marked `done`/`active`/`todo` | 2–10 steps |
| `chart` | `bar`, `line` or `pie`, with axis ticks and label auto-rotation | 1–12 points |

Specs are validated before layout and every error names its field, so a bad call comes back as a fixable message instead of a broken image. Figures are always SVG — never ASCII art, Unicode box drawing, or a code block.

`raw_svg` is the primary path for free-form structure. The sanitizer rejects scripts, doctypes, entities and iframes, strips event attributes, external references, `<image>` and `<foreignObject>`, then injects a theme stylesheet and an arrow marker, so a hand-authored figure still follows the active colour scheme.

## Files it writes

```
<session workspace>/.dsh-figures/<session>/<n>-<slug>.svg   vector original
                                          <n>-<slug>.png   raster twin, embedded in the reply
```

A `.gitignore` holding `*` goes in the session directory, so `git status` stays clean. Each directory keeps its newest 200 figures; a pruned SVG takes its PNG twin with it. If rasterization fails, the reply embeds the SVG and the model is told why in `warnings` — a figure never fails the answer.

## Use the engine without DSH

`lib/` imports nothing from `@deepseek-ai/*` or cordis, and a test enforces it. The `./engine` entry is a plain module:

```js
// from a clone:        import { ... } from './lib/engine.js'
// from the package:    import { ... } from 'dsh-inline-figures/engine'
import { drawFigure, validateSpec, sanitizeSvg, GUIDANCE_TEXT } from './lib/engine.js'

const { svg, warnings } = drawFigure({
  kind: 'timeline', title: 'Rollout',
  steps: [{ label: 'Design', state: 'done' }, { label: 'Build', state: 'active' }],
})
```

To reuse it in your own agent: register an equivalent tool with the same schema, paste `GUIDANCE_TEXT` into your system prompt, and render the returned SVG (or your own raster of it) through your Markdown image channel.

## Development

```powershell
node --test                                            # full suite, no dependencies
$env:UPDATE_GOLDEN='1'; node --test test/architecture.test.js   # refresh layout snapshots, then eyeball the diff
node scripts/make-readme-image.mjs                     # rebuild the README image
node scripts/_repro-png-check.mjs                      # real cordis: mounts the plugin, executes all five kinds, proves unload cleanup
node scripts/_repro-nudge.mjs                          # real cordis: drives the nudge events
```

`test/compliance.test.js` is the gate for the official host contract described under [Install](#what-the-harness-checks-before-it-installs): host packages as peers, the compatibility check armed, the patch row matching the package name, publishable identity, the display metadata, and every resource registered through `ctx.effect`.

Under a sandboxed shell, `node --test` can fail with `spawn EPERM` (it spawns one child per test file). `node --test --test-isolation=none` runs the same suite in one process.

## Releasing

Patch-only for now: 0.0.1 -> 0.0.2 -> 0.0.3.

```powershell
# add notes under "## [Unreleased]" in CHANGELOG.md, then:
node scripts/release.mjs              # bump, roll the changelog, sync both README badges, test, commit, tag
node scripts/release.mjs --dry-run    # print the plan, change nothing
node scripts/release.mjs --push       # also push the commit and tag
```

Pushing a `v*` tag makes the release workflow verify that the tag matches `package.json`, run the tests, and publish the GitHub Release from the changelog section. `node scripts/release.mjs --notes 0.0.1` prints one section, for notes elsewhere.

## Known issues

- **Figures render light in a dark GUI.** The PNG raster path freezes the stylesheet's light values, so text that sits on the transparent canvas (titles, axis labels, timeline labels) is hard to read on a dark background. Box interiors stay readable. Fix planned: an opaque figure background before rasterizing.
- **Concurrent draws can collide.** Three or more `draw_figure` calls in one step with the same slug can fail to allocate a file name. Fix planned: more write retries.

## License

[MIT](LICENSE)
