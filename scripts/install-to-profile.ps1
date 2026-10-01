# Installs the dsh-inline-figures bundle into a DSH profile (default: desktop).
#
# Why this script exists: the DSH Node process resolves an external bundle's
# `@deepseek-ai/*` imports with plain Node rules from the package's REAL path, and
# those packages live inside the app's asar - invisible to that resolution chain.
# So the bundle must carry an installed copy of its runtime deps under its own
# <profile>/node_modules subtree. Two pnpm hazards this script defends against:
#   - never point file:/link: at the live workspace (pnpm has destroyed a source
#     dir through the junction when later removing such a dependency);
#   - staging is a PERSISTENT vendor copy (a temp dir would leave the manifest's
#     file: reference dangling for the next pnpm validation pass, which prunes
#     anything it cannot resolve).
#
# Flow: remove old entry -> stage a fresh copy under ~/.dsh/vendor ->
# `dsh plugin add file:<staging>` -> `npm install --omit=dev` inside the installed
# dir (exact-pinned deps come from npm) -> reject link:/junction-escape -> load
# probe under the profile's resolution. If the DSH app later upgrades its runtime
# versions, re-pin dependencies in package.json and run this script again.
param(
  [string]$Profile = 'desktop',
  [string]$DshCli = (Join-Path ${env:LOCALAPPDATA} 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
)
$ErrorActionPreference = 'Stop'
$pkgDir = Split-Path -Parent $PSScriptRoot
$pkgJson = Get-Content (Join-Path $pkgDir 'package.json') -Raw | ConvertFrom-Json
$pkgName = $pkgJson.name
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$staging = Join-Path $env:USERPROFILE '.dsh\vendor\dsh-inline-figures'
$installDir = Join-Path $profileDir "node_modules\$pkgName"

# 1) fresh persistent staging (package files only, no node_modules, no .git)
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
foreach ($item in @('index.js', 'cordis.patch.yml', 'icon.svg', 'package.json', 'README.md', 'lib')) {
  Copy-Item (Join-Path $pkgDir $item) (Join-Path $staging $item) -Recurse
}

# 2) drop any previous registration and stray entries (tolerant)
& $DshCli plugin --profile $Profile remove $pkgName 2>&1 | Out-Null
foreach ($stray in @((Join-Path $profileDir 'node_modules\dsh-inline-figures'))) {
  if (Test-Path $stray) { Remove-Item $stray -Recurse -Force -ErrorAction SilentlyContinue }
}

# 3) register from the persistent staging copy
Write-Host "== installing '$pkgName' into profile '$Profile' from $staging =="
& $DshCli plugin --profile $Profile add ('file:' + $staging)
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed (exit $LASTEXITCODE)" }

# 4) manifest must reference the persistent staging, never the working tree
$manifest = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
$dep = $manifest.dependencies.$pkgName
if ($dep -like 'link:*') { throw "manifest dep is a link ('$dep'); refusing to continue - pnpm may later replace the install with a junction to a mutable path" }
Write-Host "== manifest dep: $dep =="

# 5) installed copy must be real (or a junction into .pnpm), never a junction out of profile
if (-not (Test-Path (Join-Path $installDir 'index.js'))) { throw "installed bundle not found at $installDir" }
$item = Get-Item $installDir
if ($item.LinkType) {
  $target = [System.IO.Path]::GetFullPath(($item.Target | Select-Object -First 1))
  if (-not $target.StartsWith($profileDir, [StringComparison]::OrdinalIgnoreCase)) { throw "install junction escapes the profile: $target" }
}

# 6) pull the exact-pinned runtime closure into the installed dir (network)
Push-Location $installDir
try { npm install --omit=dev --no-audit --no-fund --ignore-scripts } finally { Pop-Location }

# 7) load probe under the profile's own resolution
Push-Location $profileDir
try {
  $probe = & node -e "import('$pkgName').then((m)=>console.log('LOAD OK:',Object.keys(m).join(',')),(e)=>{console.error('LOAD FAIL:',e.message);process.exit(1)})"
  if ($LASTEXITCODE -ne 0) { throw "load probe failed: $probe" }
  Write-Host $probe
} finally { Pop-Location }
Write-Host "== installed. Restart the DSH app, then check Settings -> plugins -> inline-figures shows running =="
