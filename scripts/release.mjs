#!/usr/bin/env node
// scripts/release.mjs — cut a release in one command.
//
//   node scripts/release.mjs                  # bump patch (0.0.1 -> 0.0.2): changelog, README badge, tests, commit, tag
//   node scripts/release.mjs --dry-run        # print the plan, change nothing
//   node scripts/release.mjs --no-git         # edit files, do not commit or tag
//   node scripts/release.mjs --push           # also push the commit and the tag
//   node scripts/release.mjs --bump minor     # 0.0.2 -> 0.1.0 (patch is the default)
//   node scripts/release.mjs --date 2026-10-04
//   node scripts/release.mjs --notes 0.0.1    # print one changelog section (used by CI)
//
// The version lives in package.json. This script keeps these in step:
// package.json, the CHANGELOG's newest released section, and the version badge
// in every README language variant. test/version.test.js fails the build if they
// ever drift apart.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkgFile = path.join(pkgRoot, 'package.json')
const logFile = path.join(pkgRoot, 'CHANGELOG.md')
const readmeFiles = ['README.md', 'README.zh.md'].map((name) => path.join(pkgRoot, name))
const BADGE = /version-\d+\.\d+\.\d+-/

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const help = `usage: node scripts/release.mjs [--dry-run] [--no-git] [--push] [--bump patch|minor|major] [--date YYYY-MM-DD] [--allow-empty] [--notes <version>]`
if (flag('help') || flag('h')) {
  console.log(help)
  process.exit(0)
}

const read = (file) => fs.readFileSync(file, 'utf8')
const changelog = read(logFile)
const readmes = new Map(readmeFiles.map((file) => [file, read(file)]))

// --- notes mode: print one released section and stop -------------------------
function section(version) {
  const heading = `## [${version}]`
  const start = changelog.indexOf(heading)
  if (start === -1) return null
  const rest = changelog.slice(start + heading.length)
  const end = rest.search(/\n## \[/)
  return (end === -1 ? rest : rest.slice(0, end)).replace(/^[^\n]*\n+/, '').trimEnd()
}
if (value('notes')) {
  const wanted = value('notes')
  const body = section(wanted)
  if (body === null) {
    console.error(`no '## [${wanted}]' section in CHANGELOG.md`)
    process.exit(1)
  }
  console.log(body)
  process.exit(0)
}

// --- plan --------------------------------------------------------------------
const pkg = JSON.parse(read(pkgFile))
const current = pkg.version
const bump = value('bump') ?? 'patch'
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`--bump must be patch, minor or major (got ${bump})`)
  process.exit(1)
}
const [maj, min, pat] = current.split('.').map(Number)
const next = bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
const date = value('date') ?? new Date().toISOString().slice(0, 10)

const unreleased = /^## \[Unreleased\][^\n]*\n/m.exec(changelog)
if (!unreleased) {
  console.error("CHANGELOG.md has no '## [Unreleased]' heading; add one and put notes under it")
  process.exit(1)
}
const afterUnreleased = changelog.slice(unreleased.index + unreleased[0].length)
const nextHeading = afterUnreleased.search(/^## \[/m)
let notes = (nextHeading === -1 ? afterUnreleased : afterUnreleased.slice(0, nextHeading)).trim()
if (notes === '' && !flag('allow-empty')) {
  console.error('the Unreleased section is empty. Add notes first, or pass --allow-empty for a no-notes release.')
  process.exit(1)
}
if (notes === '') notes = '- Maintenance release; no user-visible changes.'
for (const [file, text] of readmes) {
  if (!BADGE.test(text)) {
    console.error(`${path.basename(file)} has no shields version badge (expected something like version-0.0.1-blue); fix the badge before releasing`)
    process.exit(1)
  }
}

const nextLog = changelog.slice(0, unreleased.index) +
  `## [Unreleased]\n\n## [${next}] - ${date}\n\n${notes}\n\n` +
  afterUnreleased.slice(nextHeading === -1 ? undefined : nextHeading)
const nextReadmes = new Map([...readmes].map(([file, text]) => [file, text.replace(BADGE, `version-${next}-`)]))

console.log(`release plan
  version   ${current} -> ${next}  (${bump})
  date      ${date}
  changelog roll the Unreleased section into '## [${next}] - ${date}'
  readme    badge version-${current}- -> version-${next}- in README.md and README.zh.md
  files     package.json, CHANGELOG.md, README.md, README.zh.md${flag('no-git') ? '' : ', then commit + tag v' + next}`)
if (notes) console.log(`\nnotes to publish:\n${notes.split('\n').map((l) => '  ' + l).join('\n')}`)
if (flag('dry-run')) {
  console.log('\ndry run: nothing written, tests not run')
  process.exit(0)
}

// --- git precondition --------------------------------------------------------
if (!flag('no-git')) {
  // stdio:'ignore' on purpose: a sandboxed shell cannot create the pipes that
  // spawnSync would otherwise open. The exit code is all we need.
  const dirty = spawnSync('git', ['diff-index', '--quiet', 'HEAD', '--'], { cwd: pkgRoot, stdio: 'ignore' })
  if (dirty.status !== 0) {
    console.error('\nworking tree has uncommitted changes to tracked files. Commit or stash them first, then release:')
    spawnSync('git', ['status', '--short'], { cwd: pkgRoot, stdio: 'inherit' })
    process.exit(1)
  }
}

// --- write (restorable) ------------------------------------------------------
const originals = new Map([[pkgFile, read(pkgFile)], [logFile, changelog], ...readmes])
const restore = () => {
  for (const [file, text] of originals) fs.writeFileSync(file, text)
}
pkg.version = next
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
fs.writeFileSync(logFile, nextLog)
for (const [file, text] of nextReadmes) fs.writeFileSync(file, text)
console.log(`\nwrote package.json (${next}), CHANGELOG.md, README.md, README.zh.md`)

// --- tests -------------------------------------------------------------------
// A sandboxed shell blocks the piped stdio that `node --test` needs for its
// per-file children; --test-isolation=none runs the same suite in one process.
const runTests = () => spawnSync(process.execPath, ['--test', ...(isolated ? ['--test-isolation=none'] : [])], { cwd: pkgRoot, stdio: 'inherit' })
let isolated = false
let tests = runTests()
if (tests.status !== 0 && !isolated) {
  console.log('\nretrying the suite in one process (--test-isolation=none)')
  isolated = true
  tests = runTests()
}
if (tests.status !== 0) {
  restore()
  console.error('\ntests failed; files restored, nothing committed')
  process.exit(1)
}
console.log('tests pass')

// --- commit + tag ------------------------------------------------------------
if (flag('no-git')) {
  console.log(`\nfiles updated, no commit (--no-git). Review the diff, then commit and tag v${next}.`)
  process.exit(0)
}
const git = (args) => {
  const r = spawnSync('git', args, { cwd: pkgRoot, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`)
}
try {
  git(['add', 'package.json', 'CHANGELOG.md', 'README.md', 'README.zh.md'])
  git(['commit', '-m', `chore(release): v${next}`])
  git(['tag', '-a', `v${next}`, '-m', `v${next}`])
} catch (error) {
  console.error(`\n${error.message}\nthe files are edited and committed state is unchanged; fix and rerun, or reset with: git reset --hard`)
  process.exit(1)
}
console.log(`\nreleased v${next} locally`)
if (flag('push')) {
  git(['push'])
  git(['push', 'origin', `v${next}`])
  console.log(`pushed. The release workflow verifies the tag and publishes the GitHub Release from the changelog.`)
} else {
  console.log(`publish with:  git push && git push origin v${next}\n(or rerun with --push)`)
}
