// lib/font-check.js — can this host draw CJK at all?
//
// The rasterizer is sharp/librsvg, which resolves text through fontconfig. On a
// host with no font database (a bare container: /usr/share/fonts empty, no
// /etc/fonts/fonts.conf, no fc-list) every CJK glyph in the PNG comes out as an
// empty box while the Latin text in the same figure renders normally. Measured
// 2026-10-10 on an aarch64 container: a full-width figure with Chinese labels
// delivered 0 readable glyphs, and the .svg twin was correct — so the loss is
// introduced by the raster, silently, and the SVG cannot show it.
//
// Nothing else in this plugin can notice that: the raster SUCCEEDS, the embed
// path is normal, and warnings stays empty. The reader is the only detector, so
// the check has to ask the font system directly.
//
// Node APIs only (no cordis APIs); the probe is injectable, so no unit test
// spawns a process.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { CJK } from './primitives.js'

// fontconfig's CLI answers "which fonts claim to cover Chinese?" — the same
// question the rasterizer asks, so a mismatch here is the reader's mismatch.
const FC_LIST_ARGS = [':lang=zh', '--format=%{file}\n']
const PROBE_TIMEOUT_MS = 2000
const FONTCONFIG_CONF = '/etc/fonts/fonts.conf'

const INSTALL_HINT = 'install fontconfig and a CJK font (e.g. `apt-get install -y fontconfig fonts-noto-cjk`)'

/** Does any string inside this spec carry a CJK character? */
export function specContainsCjk(value) {
  const stack = [value]
  while (stack.length > 0) {
    const current = stack.pop()
    if (typeof current === 'string') {
      if (CJK.test(current)) return true
      continue
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item)
      continue
    }
    if (current !== null && typeof current === 'object') {
      for (const item of Object.values(current)) stack.push(item)
    }
  }
  return false
}

/**
 * Run `fc-list :lang=zh` once. `{ ok: false, code: 'ENOENT' }` means fontconfig's
 * CLI is not installed; any other failure is inconclusive and stays silent.
 */
function runFcList() {
  return new Promise((resolve) => {
    execFile('fc-list', FC_LIST_ARGS, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) resolve({ ok: false, code: error.code })
      else resolve({ ok: true, stdout: String(stdout ?? '') })
    })
  })
}

// Probed once per process, deliberately. The rasterizer resolves fonts inside
// THIS process, and its fontconfig cache is built on first use: fonts installed
// afterwards are invisible to it until a restart (measured 2026-10-10 — the
// child-process probe saw the new fonts while the running rasterizer kept
// emitting tofu). Re-probing per draw would therefore let this check claim
// fonts the rasterizer cannot see, which is the one answer worse than silence.
let probedOnce

function probeOnce() {
  if (probedOnce === undefined) probedOnce = runFcList()
  return probedOnce
}

/**
 * One warning when a figure with CJK labels cannot be drawn on this host, or
 * undefined when there is nothing to report.
 *
 * @param spec - the draw_figure spec; only a CJK-containing spec is checked.
 * @param run - probe override for tests (defaults to the cached fc-list call).
 * @param platform - probe override for tests.
 * @param hasFontConfig - probe override for tests: is /etc/fonts/fonts.conf there?
 * @returns the warning text, or undefined.
 */
export async function cjkFontWarning({
  spec,
  run = probeOnce,
  platform = process.platform,
  hasFontConfig = () => fs.existsSync(FONTCONFIG_CONF),
} = {}) {
  if (!specContainsCjk(spec)) return undefined
  const probe = await run()
  if (probe.ok) {
    if (probe.stdout.trim() !== '') return undefined
    return `CJK labels will rasterize as empty boxes: this host has a font database but no font that covers Chinese/Japanese/Korean. To fix, ${INSTALL_HINT}, then draw the figure again.`
  }
  // No fontconfig CLI. On Linux that means no font database at all — the
  // bare-container case, where /etc/fonts/fonts.conf is missing too. On macOS
  // and Windows the rasterizer may resolve fonts through the OS, so the absence
  // of this CLI proves nothing and the check stays silent.
  if (probe.code === 'ENOENT' && platform === 'linux' && !hasFontConfig()) {
    return `CJK labels will rasterize as empty boxes: this host has no font configuration (${FONTCONFIG_CONF} is absent) and no font that covers Chinese/Japanese/Korean. To fix, ${INSTALL_HINT}, then draw the figure again.`
  }
  return undefined
}
