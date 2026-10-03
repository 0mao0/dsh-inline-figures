# LEGACY / UNSUPPORTED - the supported install path is the official one:
#     dsh plugin --profile <profile> add dsh-inline-figures
#     dsh plugin --profile <profile> add github:0mao0/dsh-inline-figures
# or the Web sidebar's Plugins page, or the plugin_manager tool. Those run pnpm
# in the profile, resolve the bundle's peer dependencies from the harness, and
# arm the runtime version check. Keep this script only for an offline machine
# where no registry is reachable; it hand-writes the profile manifest, which the
# official flow deliberately does for you.
#
# Installs the dsh-inline-figures bundle into a DSH profile (default: desktop) - FULLY OFFLINE.
#
# Why this script exists: the DSH Node process resolves an external bundle's
# @deepseek-ai/* imports with plain Node rules from the package's REAL path, and
# those packages live inside the app's asar - invisible to that chain. The bundle
# therefore carries its own vendored dependency closure (node_modules inside the
# installed copy, built by scripts/build-offline-closure.mjs from an unpacked copy
# of the app's own node_modules). Registry installs are NOT used: the npm registry
# is too slow/flaky here and `dsh plugin add` (pnpm) failed mid-download and
# ROLLED BACK the manifest, silently unregistering the bundle. Manual
# placement + manifest edit is what the app's cordis loader actually consumes.
#
# Hazards encoded here:
#   - never point file:/link: at the live workspace (pnpm has destroyed a source
#     dir through a junction when later removing such a dependency);
#   - pnpm prunes undeclared top-level node_modules entries, so the closure lives
#     INSIDE the installed package dir, not at the profile root;
#   - a persistent staging copy (~/.dsh/vendor) keeps the manifest's file:
#     reference resolvable for any future pnpm pass.
#
# After running: restart the DSH app, then Settings -> plugins -> inline-figures
# must show running. If the app later upgrades runtime versions, re-extract the
# app tree and rebuild the closure with build-offline-closure.mjs.
param(
  [string]$Profile = 'desktop',
  [string]$Tree = ''
)
$ErrorActionPreference = 'Stop'
$pkgDir = Split-Path -Parent $PSScriptRoot
$pkgName = (Get-Content (Join-Path $pkgDir 'package.json') -Raw | ConvertFrom-Json).name
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$vendor = Join-Path $env:USERPROFILE '.dsh\vendor\dsh-inline-figures'
$installDir = Join-Path $profileDir "node_modules\$pkgName"

# The host package tree: DSH ships it inside resources/app.asar, so it has to be
# extracted once (scripts/extract-app-tree.mjs). Without -Tree we probe the two
# layouts this repo produces.
if (-not $Tree) {
  $roots = @((Get-Location).Path, $pkgDir)
  $candidates = @()
  foreach ($r in $roots) {
    $candidates += (Join-Path $r '.dsh-tree\dsh\node_modules')
    $candidates += (Join-Path $r '_probe\dshtree\dsh\node_modules')
  }
  $Tree = ($candidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
}
if (-not $Tree -or -not (Test-Path $Tree)) {
  throw @"
app node_modules tree not found. Extract it once, then install:

  node scripts/extract-app-tree.mjs "<app>\resources\app.asar" .dsh-tree "dsh/node_modules/"
  pwsh -File scripts/install-to-profile.ps1 -Profile $Profile -Tree ".dsh-tree/dsh/node_modules"
"@
}

# 1) fresh package files into both the install dir and the persistent staging
foreach ($d in @($installDir, $vendor)) {
  if (Test-Path $d) { Remove-Item $d -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  foreach ($item in @('index.js', 'cordis.patch.yml', 'icon.svg', 'package.json', 'README.md', 'lib')) {
    Copy-Item (Join-Path $pkgDir $item) (Join-Path $d $item) -Recurse -Force
  }
}

# 2) vendor the dependency closure into both copies (junction-safe Copy-Item)
$clist = & node (Join-Path $PSScriptRoot 'build-offline-closure.mjs') (Join-Path $vendor 'package.json') $Tree
if ($LASTEXITCODE -ne 0) { throw "closure build failed: $clist" }
foreach ($t in @((Join-Path $installDir 'node_modules'), (Join-Path $vendor 'node_modules'))) {
  foreach ($name in $clist) {
    $rel = $name.Replace('/', '\')
    $dst = Join-Path $t $rel
    if (Test-Path $dst) { continue }
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) -ErrorAction SilentlyContinue | Out-Null
    Copy-Item (Join-Path $Tree $rel) $dst -Recurse -Force
  }
}

# 3) register in the profile manifest (cordis reads this at app start; no pnpm)
$manifestPath = Join-Path $profileDir 'package.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if (-not $manifest.dependencies) { $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$manifest.dependencies | Add-Member -NotePropertyName $pkgName -NotePropertyValue ('file:' + $vendor.Replace('\','/')) -Force
$bundles = @($manifest.dsh.profile.bundles) | Where-Object { $_ -ne $pkgName }
$manifest.dsh.profile.bundles = @($bundles + $pkgName)
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 10))
Write-Host "== registered '$pkgName' in $manifestPath =="

# 4) self-containment probe: resolution must stay inside the profile and load
Push-Location $profileDir
try {
  $probe = & node --input-type=module -e "import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; const dir = fs.realpathSync(fileURLToPath(new URL('.', import.meta.resolve('$pkgName')))); if (!dir.startsWith(fs.realpathSync(process.cwd()))) throw new Error('resolution escapes profile: ' + dir); const m = await import('$pkgName'); console.log('LOAD OK:', Object.keys(m).join(','));"
  if ($LASTEXITCODE -ne 0) { throw "load probe failed: $probe" }
  Write-Host $probe
} finally { Pop-Location }
Write-Host "== installed. Restart the DSH app, then check Settings -> plugins -> inline-figures shows running =="
