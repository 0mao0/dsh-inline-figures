# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html); releases move the patch digit (0.0.1 -> 0.0.2 -> 0.0.3) until the spec stabilizes.

Add entries under `## [Unreleased]` as you work. `node scripts/release.mjs` rolls that section into a dated release, bumps `package.json`, updates the README badge, runs the tests, commits, and tags.

## [Unreleased]

### Changed

- README head is a machine-readable `name` / `description` table, so a reader — human or model — can tell what the plugin is before reading any prose.
- README gained a "How it works" diagram, one render per language, and an explicit "What it writes to disk" section: the session workspace only, no network calls, no uploads, no telemetry, 200 figures per session, and the note that a figure is a reference rather than a copy.
- README dropped its Releasing and Known issues sections. Release steps now live in `docs/MAINTAINER-NOTES.md`, together with the two open defects that were already tracked there.

## [0.0.1] - 2026-10-04

First public release.

### Added

- `draw_figure` host tool: a JSON figure spec (or a hand-authored SVG) goes in, a full-width figure file plus one inline Markdown line comes out.
- Five spec kinds: `raw_svg` (primary path, for free-form structures), `architecture`, `compare`, `timeline`, `chart`.
- Deterministic layout engine in `lib/figures/` — 680-unit logical canvas, 1600-wide intrinsic size, golden-snapshot tested, never draws outside the canvas.
- SVG sanitizer for model-authored figures: rejects scripts, doctypes, entities, iframes, embeds and objects; strips event attributes, external references, `<image>`, `<foreignObject>` and comments.
- Portable `./engine` entry with zero DSH or cordis dependencies, so the same renderer works in any Node or browser app.
- System-prompt guidance section: when to draw, how to place the figure, and the ASD-STE100-style prose and label rules.
- Soft nudge: one self-contained reminder when a session draws far below the guidance rate.
- PNG raster twin for every figure, because the GUI serves files with a CSP `sandbox` header and Chromium refuses to rasterize an SVG served that way. `sharp` is a normal dependency and ships prebuilt binaries, so the install needs no build step.
- Figure hygiene: per-session `.gitignore`, monotonic file numbering, and a 200-file LRU prune that removes a PNG twin with its SVG.
- Unit tests for the schema, the four presets, the sanitizer, the host file helpers, the nudge policy, the guidance text, the release gates and the official host-plugin contract, run with `node --test`.

### Changed

- Packaged for the **official install path**. The harness supplies the `@deepseek-ai/*` runtime packages, so they are **peer dependencies**, not dependencies: nothing duplicates the runtime inside the profile, and the plugin manager refuses an incompatible runtime before it installs anything. `dsh plugin add` and the Web **Plugins** page are the supported ways in; the hand-rolled offline installer is kept only as a fallback for machines that cannot reach a registry.
- Renamed from `@local/dsh-inline-figures` to `dsh-inline-figures`; the bundle patch row now names the package, and the two are checked against each other.
- Every contributed resource registers through `ctx.effect`, so disabling the plugin row removes both the tool and the prompt section.
- Added the display metadata the plugin manager reads without activating the plugin: `locale/en.json`, `locale/zh.json`, and an exported `icon.svg`.
- README in two languages: `README.md` (English, default) and `README.zh.md`, each with a switcher at the top and **its own rendered hero image** (`docs/assets/before-after.png`, `docs/assets/before-after.zh.png`). Both come from one script, so they cannot drift apart. `scripts/release.mjs` keeps the version badge of every variant in step, and the test suite fails if one drifts or if a variant points at the other language's picture.
