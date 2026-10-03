// test/version.test.js — the release gate. The version lives in package.json;
// the changelog's newest released section and the version badge in every README
// language variant must agree with it, or scripts/release.mjs was bypassed.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const pkg = JSON.parse(read('package.json'))
const changelog = read('CHANGELOG.md')
const script = read(path.join('scripts', 'release.mjs'))

// Every language variant of the README, with the strings that identify it and
// the hero image it must use (each language ships its own rendered picture).
const readmes = [
  { file: 'README.md', lang: 'en', head: /\*\*Description\.\*\*/, keywords: /\*\*Keywords\.\*\*/, switcher: /\*\*English\*\* \| \[中文\]\(README\.zh\.md\)/, hero: 'docs/assets/before-after.png' },
  { file: 'README.zh.md', lang: 'zh', head: /\*\*描述。\*\*/, keywords: /\*\*关键词。\*\*/, switcher: /\[English\]\(README\.md\) \| \*\*中文\*\*/, hero: 'docs/assets/before-after.zh.png' },
]

const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1])
const parse = (v) => v.split('.').map(Number)

test('package.json holds a plain x.y.z version', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
})

test('the changelog carries an Unreleased section', () => {
  assert.match(changelog, /^## \[Unreleased\]/m)
})

test('the newest released changelog section is the package version', () => {
  assert.ok(released.length > 0, 'no released section in CHANGELOG.md')
  assert.equal(released[0], pkg.version, `CHANGELOG top section is ${released[0]}, package.json says ${pkg.version}`)
})

test('released sections are unique and in descending order', () => {
  assert.equal(new Set(released).size, released.length, `duplicate version heading in CHANGELOG.md: ${released.join(', ')}`)
  for (let i = 1; i < released.length; i++) {
    const [a, b] = [parse(released[i - 1]), parse(released[i])]
    const descends = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))
    assert.ok(descends, `${released[i - 1]} must be listed above ${released[i]}`)
  }
})

test('every released section has notes', () => {
  for (const [i, version] of released.entries()) {
    const start = changelog.indexOf(`## [${version}]`)
    const rest = changelog.slice(start)
    const end = rest.slice(1).search(/\n## \[/)
    const body = (end === -1 ? rest : rest.slice(0, end + 1)).split('\n').slice(1).join('\n').trim()
    assert.ok(body.length > 0, `section ${version} is empty (index ${i})`)
  }
})

for (const { file, lang, head, keywords, switcher, hero } of readmes) {
  test(`${file} (${lang}) carries the package version, the head, the switcher and its own hero image`, () => {
    const text = read(file)
    assert.match(text, new RegExp(`version-${pkg.version.replace(/\./g, '\\.')}-`), `${file} badge must read version-${pkg.version}-`)
    assert.match(text, /^# dsh-inline-figures$/m, `${file} needs the repository name as its H1`)
    assert.match(text, head, `${file} needs its description head`)
    assert.match(text, keywords, `${file} needs its keyword line`)
    assert.match(text, switcher, `${file} needs the language switcher`)
    assert.match(text, /Karpathy/, `${file} credits Karpathy`)
    assert.match(text, /ASD-STE100/, `${file} names ASD-STE100`)
    const found = /!\[[^\]]*\]\((docs\/assets\/[^)]+)\)/.exec(text)
    assert.ok(found, `${file} references no hero image under docs/assets/`)
    assert.equal(found[1], hero, `${file} must use its own rendered hero image (${hero})`)
    assert.ok(fs.existsSync(path.join(root, hero)), `${file} hero image missing on disk: ${hero}`)
  })
}

test('both READMEs ship with the package', () => {
  for (const { file } of readmes) assert.ok(pkg.files.includes(file), `${file} must be listed in files`)
})

test('MIT licence, and the release script keeps every language variant in step', () => {
  assert.equal(pkg.license, 'MIT')
  assert.ok(fs.existsSync(path.join(root, 'LICENSE')))
  assert.match(read(path.join('LICENSE')), /^MIT License/)
  for (const file of ['package.json', 'CHANGELOG.md', 'README.md', 'README.zh.md']) {
    assert.ok(script.includes(file), `release.mjs must know about ${file}`)
  }
})
