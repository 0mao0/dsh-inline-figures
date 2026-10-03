# LEGACY workaround. The official install path does not need it: the manifest
# declares the host packages as peer dependencies, so pnpm never puts a second
# copy of them in the profile and this scope-identity problem cannot arise.
# Keep this only for an install made by scripts/install-to-profile.ps1.
#
# Nests the profile's flattened @deepseek-ai/* copies under this plugin's own
# node_modules, so the host keeps exactly one copy of each built-in package.
#
# Why this is needed
# ------------------
# DSH resolves a profile plugin's built-in imports with plain Node rules, so an
# external bundle needs a real copy of them under <profile>/node_modules. But
# pnpm (nodeLinker: hoisted, set by the DSH launcher) puts that copy in the
# profile's TOP-LEVEL node_modules - where it also shadows the app's own copies
# for the host's plugin resolution.
#
# That is fatal for scoping: @deepseek-ai/dsh-scope tags a context with
#   const kScope = Symbol("dsh.scope")        # module-level, not Symbol.for
# so two copies of the module never agree on a scope tag. The prompt registry
# then reads scope === undefined, treats the agent-preset's persona row as an
# unscoped global registration, and collides with the deployment persona slot
# that dsh-system-prompt registers unconditionally:
#   agent-preset/invalid: persona (@deepseek-ai/dsh-persona): prompt section
#   "deployment:persona-prefix" is already registered
# New sessions and resume both fail while this is in place.
#
# Nesting the copies fixes it: the host's own resolution falls back to app.asar
# (single instance), while the plugin still resolves its deps from its own
# nested node_modules. Run this after any pnpm reinstall that re-flattens them.
param(
  [string]$Profile = 'desktop',
  [string]$PkgName = 'dsh-inline-figures'
)

$ErrorActionPreference = 'Stop'

$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$nm         = Join-Path $profileDir 'node_modules'
$pkgRel     = $PkgName -replace '/', '\'
$pkgDir     = Join-Path $nm $pkgRel
$nested     = Join-Path $pkgDir 'node_modules'

if (-not (Test-Path (Join-Path $pkgDir 'package.json'))) {
  throw "plugin not installed at $pkgDir - run install-to-profile.ps1 first"
}

New-Item -ItemType Directory -Force -Path $nested | Out-Null

# @standard-schema rides along: it is schemastery's dependency, needed by the
# plugin's nested copy of the tree.
$moved = 0
foreach ($src in @((Join-Path $nm '@deepseek-ai'), (Join-Path $nm '@standard-schema'))) {
  if (-not (Test-Path $src)) { continue }
  $destParent = Join-Path $nested (Split-Path $src -Leaf)
  New-Item -ItemType Directory -Force -Path $destParent | Out-Null
  foreach ($item in Get-ChildItem $src -Force) {
    $target = Join-Path $destParent $item.Name
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    Move-Item $item.FullName $target
    $moved++
  }
  if ((Get-ChildItem $src -Force | Measure-Object).Count -eq 0) { Remove-Item $src -Force }
}

# pnpm leaves a malformed junction behind when a file: dep was copied in.
foreach ($link in Get-ChildItem $nm -Force) {
  if ($link.LinkType -and ($link.Target -join '') -match 'copy:file:') {
    Remove-Item $link.FullName -Force
    Write-Host "removed malformed link: $($link.Name)"
  }
}

if ($moved -eq 0) {
  Write-Host "nothing to nest - profile '$Profile' is already clean"
} else {
  Write-Host "nested $moved package(s) under $pkgRel\node_modules"
  Write-Host 'restart the DSH app for the host to reload its plugin tree'
}
