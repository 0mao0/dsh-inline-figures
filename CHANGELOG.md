# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html); releases move the patch digit (0.0.1 -> 0.0.2 -> 0.0.3) until the spec stabilizes.

Add entries under `## [Unreleased]` as you work. `node scripts/release.mjs` rolls that section into a dated release, bumps `package.json`, updates the README badge, runs the tests, commits, and tags.

## [Unreleased]

### Added

- **The closing check now verifies that embedded figures EXIST.** A tool cannot place an image, so the plugin reads the answer a session is about to close on, resolves every workspace-relative figure path against the session workspace, and steers the agent when any of them is not a file. The steer names the broken paths and lists the figures that do exist, so the repair is mechanical. Measured 2026-10-05 on a live AnGIneer session: **5 of 28 embedded figures pointed at files that were never written** — the model invented a plausible name (`23-mechanism-usage.svg`) while the tool had returned `23-challenge-verdict.png`, one answer repeated the `.dsh-figures/` prefix twice, and three answers linked figures no run ever drew. Verified against those real answers: the check catches exactly those 5 and flags none of the 23 valid references.

### Changed

- The guidance and the tool description now state that the returned markdown line must be copied BYTE FOR BYTE: never retype the file name, never "improve" the slug, never repeat the `.dsh-figures/` prefix. A retyped name resolves to nothing, and the reader sees a broken-image box.

### Fixed

- **`draw_figure` failed every call with `value is not lossless JSON`.** The host validates each tool result with `isJsonValue` (dsh-tools) and rejects a value of `undefined`, so the `coverage` field added in 0.1.0 — present but `undefined` whenever the session had not yet embedded a figure — failed the gate on every call, including the simplest `timeline`. An absent field must be an absent KEY, never a key holding `undefined`. `scripts/_repro-png-check.mjs` now asserts with the host's own validator instead of `JSON.stringify` (which drops `undefined` keys and cannot see the difference); putting the bug back turns all five cases red.
- An invented figure path was indistinguishable from a real one until a reader looked at it. The repair steer shares the steer budget (two per session), so a model that keeps inventing names cannot loop the turn.

## [0.1.0] - 2026-10-05

### Added

- **Grouped bar and line charts.** `chart` takes `seriesNames` plus one `values` array per item: `{seriesNames: ["修前","修后"], data: [{label:"图边", values:[13,41]}]}` draws one group of two bars per metric, with a legend. A before/after comparison had no way to be expressed, so it was flattened into one bar per metric-and-time with the time tag concatenated into the label — which stops being a comparison.
- **Closing-turn channel (the figure no longer depends on the model remembering).** `agent/turn-stopping` now runs the same structure check the nudge uses: when a drawing session tries to close on an answer that carries structure (a table, five-plus list items, or comparison/plan/flow prose) and no figure, the plugin steers the agent, which re-opens the inbox so the model owes another step and draws the figure. Capped at two steers per session with a two-turn gap, so it cannot loop. Measured cause: an AnGIneer session drew 12 figures over 29 turns while individual answers shipped tables, and the old rate-only rule stayed silent for all 29 turns — the model's own reasoning said "I already drew 9 figures, I'll use a table here".
- Guidance runs as a procedure, not a preference: plan the structures first, make the `draw_figure` calls in the same batch, write the answer around the figures, then self-check the prepared answer for a table or long list that should have been a figure.
- `raster-diagnostic.txt` in the session workspace records every raster degradation where the user can read it, plus a session figure-coverage line in the tool result (figures embedded in replies versus figures drawn).

### Fixed

- **An asymmetric before/after chart is refused with the fix in the message.** A chart whose label pairs a metric with 修后 but not 修前 (or the reverse) is not a comparison, and the missing half silently drops a number the answer's own table carries. The validator names the group, the missing side, and the grouped spec to send instead. Measured case: a chart shipped `进图轮次 修前/修后, 图节点 修前/修后, 图边 修后` while the same answer's table read "图规模 5 节点/13 边 → 24 节点/41 边" — the 图边 修前 value 13 was lost.
- **The closing channel is gated on the session's own shape.** It arms only in a session that has drawn at least once; the cheap reminder channel only in a session that has already produced a structured answer. Without that gate a working session (code, commits, verification logs) would be steered into drawing figures it does not need, at one extra model step each time.
- **A raster failure no longer produces a broken image.** The GUI serves figure files with `Content-Security-Policy: sandbox; default-src 'none'`, and Chromium refuses to rasterize an SVG loaded that way — so falling back to a relative `.svg` link (`option A`'s documented fallback) rendered nothing at all. Measured live in the DSH Web GUI on 2026-10-05: the `.svg` link is a broken image while the PNG twin renders. The fallback order is now PNG → inline SVG data URI (32 KB budget) → relative path with a loud warning.
- A failed `sharp` load is cached per attempt instead of forever, and the diagnostic moved out of the plugin directory: under the shell sandbox an install below `~/.dsh` cannot be written, so the old one-time `raster-diagnostic.txt` write failed silently and the degradation stayed invisible for two days.
- The nudge's per-session counters are keyed by session and dropped on `agent/disposed`. The `session/event` observer cannot iterate a `WeakMap`, and reading the agent map threw `usage.values is not a function` — caught by `scripts/_repro-nudge-channels.mjs`.
- **Neither channel could read the answer, so both were silently dead.** Two separate causes, both found by probing the live event path rather than reading the code: (1) the usage ledger is created lazily at the first `agent/pre-step`, so a session's FIRST assistant message arrived before the ledger existed and was dropped; (2) the ledger clears its own text copy at every turn boundary, so a `tools/post-execute` read always saw an empty string. The reply text now lives in a session-keyed `latestText` map that only `agent/disposed` clears. A frame that was measured as "12 draws, 0 nudges" is what this looked like from outside.
- The session key accepts `session.id`, `session.header.id`, `agent.sessionId` and `agent.id`. Reading only `session.id` works on the real `Session` (a getter over its header) but degraded every equivalent object to `'unknown'`, which is what the repro exposed.
- `decideNudge` reads the reply text from `usage`, never from `opts`: text passed in the wrong argument silently degraded every call to the counter fallback. The readable-text path also had no reminder exit at all — only the steer — so a session that stopped drawing went silent instead of reminding.

## [0.0.3] - 2026-10-03

### Added

- Published to npm: `npm i dsh-inline-figures`, or `dsh plugin --profile <profile> add dsh-inline-figures`.

### Changed

- The Chinese README is `README-zh.md` (was `README.zh.md`). npm picks the README for a package page by globbing `{README,README.*}` in the package root and taking the first match, in directory order — with two matches the Chinese file won, so the package page showed Chinese for an English-default project. A hyphen keeps it out of that glob, which makes the English README the only candidate.
- README install order is npm first again, now that the package is on npm.
- The `allow-version` example no longer pins a stale version; it takes `<version>`.

## [0.0.2] - 2026-10-03

### Added

- A "How it works" diagram in the README, one render per language, generated from a single layout by `scripts/make-readme-diagram.mjs`.

### Changed

- README head is a machine-readable `name` / `description` table, so a reader — human or model — can tell what the plugin is before reading any prose.
- README install order: the repository spec comes first, because the package is not on npm yet.
- README "What it writes to disk" spells out the persistence: the session workspace only, no network calls, no uploads, no telemetry, 200 figures per session, and a figure is a reference rather than a copy.
- README dropped its Releasing and Known issues sections. Release steps now live in `docs/MAINTAINER-NOTES.md`, together with the open defects.
- Line endings are LF everywhere, matching the `.gitattributes` the repository declares.

### Fixed

- **Figures are readable in a dark GUI.** A rasterizer has no `prefers-color-scheme`, so the PNG kept the stylesheet's light values on a transparent canvas and left titles, axis labels and timeline labels dark-on-dark. The PNG now gets an opaque canvas; the archived `.svg` stays transparent and theme-adaptive.
- **Concurrent draws no longer collide.** Three or more same-slug `draw_figure` calls in one step could fail to allocate a file name. A retry now re-reads the directory instead of incrementing a number that was read before the first write.
- The CHANGELOG carried two `## [Unreleased]` headings, which made `scripts/release.mjs` read an empty section and refuse to release.

## [0.0.1] - 2026-10-03

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
