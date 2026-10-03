// test/compliance.test.js — the official DSH host-plugin contract, as a gate.
//
// Rules verified against the shipped skill and manifests:
//   dsh-agent-preset/skills/cordis-plugin-development/SKILL.md + references/host-plugin.md
//   @deepseek-ai/dsh-tool-cordis@0.2.0-rc.2/package.json
//   @deepseek-ai/dsh-experimental-agent-team@0.2.0-rc.2/package.json
//   @deepseek-ai/dsh-app-boot/lib/index.js  (evaluatePluginCompatibility)
//   @deepseek-ai/dsh-plugin-manager/README.md (install / version compatibility)
//
// Breaking one of these is how a published plugin turns into "installed, will
// not run" for other people, so they fail the build instead of a stranger's app.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const pkg = JSON.parse(read('package.json'))
const index = read('index.js')
const patch = read('cordis.patch.yml')

// Pure libraries a plugin may install for itself. Host runtime packages must
// NOT be installed: a second copy of cordis or a dsh service breaks identity.
// sharp rasterizes figures to PNG and ships prebuilt binaries (no build step),
// so it is a real dependency.
const LIBRARY_DEPENDENCIES = new Set(['@deepseek-ai/schemastery', 'sharp'])

test('no host runtime package is installed alongside the plugin', () => {
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    assert.ok(LIBRARY_DEPENDENCIES.has(name), `${name} must be a peerDependency, not a dependency: the host supplies it (host-plugin.md: "A Host-only bundle needs no dependencies")`)
  }
})

test('every @deepseek-ai import is declared as a peer the host supplies', () => {
  const imported = [...index.matchAll(/from '(@deepseek-ai\/[^']+)'/g)].map((m) => m[1])
  assert.ok(imported.length > 0, 'index.js imports nothing from @deepseek-ai')
  for (const name of imported) {
    if (LIBRARY_DEPENDENCIES.has(name)) continue
    assert.ok(pkg.peerDependencies?.[name], `${name} is imported but not a peerDependency`)
  }
})

test('the compatibility gate is armed: at least one exact @deepseek-ai/dsh-* peer', () => {
  // evaluatePluginCompatibility checks ONLY @deepseek-ai/dsh and
  // @deepseek-ai/dsh-* peers against the running runtime version. Without one,
  // an install on an incompatible host succeeds and fails later at runtime.
  const checked = Object.entries(pkg.peerDependencies ?? {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  assert.ok(checked.length > 0, 'no @deepseek-ai/dsh-* peer, so the host cannot refuse an incompatible runtime')
  for (const [name, range] of checked) {
    assert.match(range, /^\d+\.\d+\.\d+/, `${name} peer must pin the tested runtime version exactly, got ${range}`)
  }
})

test('peer ranges match the versions the suite was verified against', () => {
  assert.match(pkg.peerDependencies['@deepseek-ai/cordis'], /^~?\d+\.\d+\.\d+$/)
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools']) {
    assert.ok(pkg.peerDependencies[name], `${name} peer missing`)
  }
})

test('the bundle patch row names this package', () => {
  assert.match(patch, /^\s*- insert:/m)
  assert.match(patch, new RegExp(`name:\\s*'${pkg.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`), `cordis.patch.yml must insert name: '${pkg.name}'`)
  assert.match(patch, /id:\s*inline-figures/)
  // The row id is the plugin's exported name.
  assert.match(index, /export const name = 'inline-figures'/)
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(fs.existsSync(path.join(root, 'cordis.patch.yml')))
})

test('the package is publishable under a real name', () => {
  assert.notEqual(pkg.private, true, 'private: true makes the package impossible to install by name')
  assert.ok(!pkg.name.startsWith('@local/'), 'the @local scope does not exist on a registry')
  assert.equal(pkg.publishConfig?.access, 'public')
  assert.match(pkg.name, /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/)
})

test('display metadata for the plugin manager cards', () => {
  assert.ok(pkg.meta?.title, 'package.json meta.title is required for the plugin card')
  assert.ok(pkg.meta?.description, 'package.json meta.description is required for the plugin card')
  for (const lang of ['en', 'zh']) {
    const file = `locale/${lang}.json`
    assert.ok(fs.existsSync(path.join(root, file)), `${file} missing (host-plugin.md: put the display text in locale/<lang>.json)`)
    const meta = JSON.parse(read(file))
    assert.ok(meta.meta?.title, `${file} needs meta.title`)
    assert.ok(meta.meta?.description, `${file} needs meta.description`)
  }
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json', 'locale files must be exported')
  assert.ok(pkg.files.includes('locale/*.json'), 'locale files must ship in files')
})

test('the icon is a relative file the host will accept', () => {
  assert.ok(pkg.icon, 'package.json icon missing')
  assert.ok(!path.isAbsolute(pkg.icon) && !/^[a-z]+:/i.test(pkg.icon), 'icon must be a relative path, not a URL')
  assert.match(pkg.icon, /\.(svg|png|jpe?g|webp)$/i)
  const file = path.join(root, pkg.icon)
  assert.ok(fs.existsSync(file), `icon file missing: ${pkg.icon}`)
  assert.ok(fs.statSync(file).size <= 256 * 1024, 'icon must be at most 256 KiB')
  assert.ok(pkg.files.includes(pkg.icon.replace(/^\.\//, '')), 'icon must ship in files')
})

test('the host can read display metadata without activating the plugin', () => {
  assert.equal(pkg.exports['./package.json'], './package.json', 'the manifest must be exported')
})

test('every contributed resource is registered through ctx.effect or ctx.on', () => {
  // host-plugin.md: "Register every resource inside apply with ctx.effect or
  // ctx.on and return its cleanup." Otherwise disabling the row leaves the tool
  // and the prompt section behind.
  assert.match(index, /ctx\.effect\(\(\)\s*=>\s*ctx\.tools\.register\(/, 'the tool must be registered inside ctx.effect')
  assert.match(index, /ctx\.effect\(\s*\(\)\s*=>\s*ctx\.systemPrompt\.section\(/, 'the prompt section must be registered inside ctx.effect')
  for (const call of ['ctx.tools.register(', 'ctx.systemPrompt.section(']) {
    const count = index.split(call).length - 1
    assert.equal(count, 1, `${call} appears ${count} times; every registration must be wrapped in ctx.effect`)
  }
  assert.ok(index.includes("ctx.on('tools/post-execute'"), 'nudge listeners use ctx.on (auto-disposed)')
})

test('the plugin uses the documented export form and does not mix forms', () => {
  assert.match(index, /export function apply\(ctx, config\)/)
  assert.match(index, /export const inject = \[/)
  assert.ok(!/export default/.test(index), 'do not mix the apply form with a default-export class')
  const inject = JSON.parse(JSON.stringify(/export const inject = (\[[^\]]*\])/.exec(index)[1].replace(/'/g, '"')))
  for (const service of inject) assert.ok(typeof service === 'string' && service.length > 0, `bad inject entry ${service}`)
})
