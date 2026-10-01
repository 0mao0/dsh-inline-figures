import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('package.json exposes host, engine and patch entries', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, '@local/dsh-inline-figures')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./engine'], './lib/engine.js')
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(pkg.exports['./package.json'], './package.json')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(pkg.peerDependencies['@deepseek-ai/cordis'])
  for (const entry of ['cordis.patch.yml', 'icon.svg']) {
    assert.ok(fs.existsSync(path.join(root, entry)), `${entry} missing`)
  }
})

test('cordis patch inserts the inline-figures row', () => {
  const yml = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(yml, /insert:/)
  assert.match(yml, /id:\s*inline-figures/)
  assert.match(yml, /name:\s*'@local\/dsh-inline-figures'/)
})

test('host deps are exact-pinned @deepseek-ai runtime copies (asar is invisible to bundle resolution)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.dependencies, 'dependencies required for file: install')
  for (const [name, range] of Object.entries(pkg.dependencies)) {
    assert.ok(name.startsWith('@deepseek-ai/'), `unexpected dep ${name}`)
    assert.match(range, /^\d+\.\d+\.\d+/, `${name} must be an exact version`)
  }
  assert.ok(pkg.dependencies['@deepseek-ai/dsh-tools'], 'dsh-tools dep required')
  assert.ok(pkg.dependencies['@deepseek-ai/schemastery'], 'schemastery dep required')
})
