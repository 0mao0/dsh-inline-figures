// scripts/build-offline-closure.mjs — vendor a bundle's full runtime closure offline.
//
// Why: registry installs of @deepseek-ai/* are unreliable on this network, and the
// host resolves the installed bundle's imports from its REAL path - asar internals
// are invisible to that chain. So the installed copy carries its own node_modules.
//
// Walks the transitive union of dependencies + peerDependencies of the package's
// declared deps against a flattened pnpm tree (an unpacked copy of the app's
// node_modules), then copies every hit into <target>/node_modules/<name>,
// dereferencing pnpm junctions into real directories. Reports unresolvable names.
//
// Usage: node build-offline-closure.mjs <packageJson> <treeNodeModules> [<targetNodeModules>]
// With no target: prints the closure package names (one per line) for an external
// copier - Node's cpSync hits EIO on some pnpm junctions; PowerShell Copy-Item does not.
import fs from 'node:fs'
import path from 'node:path'

const [, , pkgJsonPath, treeNode, targetRoot] = process.argv
if (!pkgJsonPath || !treeNode) {
  console.error('usage: node build-offline-closure.mjs <packageJson> <treeNodeModules> [<targetNodeModules>]')
  process.exit(2)
}
const declared = Object.keys(JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).dependencies ?? {})
const seen = new Map()
const missing = []
const queue = [...declared]
while (queue.length > 0) {
  const name = queue.shift()
  if (seen.has(name)) continue
  const dir = path.join(treeNode, name)
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    missing.push(name)
    continue
  }
  seen.set(name, dir)
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  for (const dep of [...Object.keys(pj.dependencies ?? {}), ...Object.keys(pj.peerDependencies ?? {})]) queue.push(dep)
}
if (!targetRoot) {
  for (const name of seen.keys()) console.log(name)
  if (missing.length > 0) console.error(`UNRESOLVED: ${missing.join(', ')}`)
  process.exit(missing.length > 0 ? 1 : 0)
}
fs.mkdirSync(targetRoot, { recursive: true })
for (const [name, dir] of seen) fs.cpSync(dir, path.join(targetRoot, name), { recursive: true, dereference: true })
console.log(`vendored ${seen.size} packages into ${targetRoot}`)
if (missing.length > 0) console.log(`UNRESOLVED: ${missing.join(', ')}`)
