import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('package.json exposes host, engine and patch entries', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-inline-figures')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./engine'], './lib/engine.js')
  assert.equal(pkg.exports['./guidance'], './lib/guidance.js')
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(pkg.exports['./package.json'], './package.json')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(pkg.peerDependencies['@deepseek-ai/cordis'])
  for (const entry of ['cordis.patch.yml', 'icon.svg', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(root, entry)), `${entry} missing`)
  }
})

test('cordis patch inserts the inline-figures row under the package name', () => {
  const yml = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(yml, /insert:/)
  assert.match(yml, /id:\s*inline-figures/)
  assert.match(yml, /name:\s*'dsh-inline-figures'/)
})

test('every file the exports promise ships with the package', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  for (const value of Object.values(pkg.exports)) {
    const target = value.startsWith('./') ? value.slice(2) : value
    if (target.includes('*')) continue
    assert.ok(fs.existsSync(path.join(root, target)), `exports target missing on disk: ${target}`)
  }
})
