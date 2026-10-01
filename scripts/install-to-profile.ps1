# Installs the dsh-inline-figures bundle into a DSH profile (default: desktop).
#
# Why this script exists: the DSH Node process resolves an external bundle's
# `@deepseek-ai/*` imports with plain Node rules from the package's REAL path, and
# those packages live inside the app's asar - invisible to that resolution chain.
# So the bundle must ship its deps as an installed copy under
# <profile>/node_modules, and pnpm cannot see the live workspace as the file:
# source (pnpm has destroyed the source dir through the junction when later
# removing a file: dependency - never point file: at your working tree).
#
# Flow: copy the package to a temp staging dir -> `dsh plugin add file:<staging>`
# -> verify the installed entry loads under the profile's resolution.
# Requires network: exact-pinned @deepseek-ai/* runtime deps come from npm.
# If the DSH app later upgrades its runtime versions, re-pin dependencies in
# package.json to the versions bundled in the app and run this script again.
param(
  [string]$Profile = 'desktop',
  [string]$DshCli = (Join-Path ${env:LOCALAPPDATA} 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
)
$ErrorActionPreference = 'Stop'
$pkgDir = Split-Path -Parent $PSScriptRoot
$pkgName = (Get-Content (Join-Path $pkgDir 'package.json') -Raw | ConvertFrom-Json).name

$staging = Join-Path $env:TEMP ('dsh-inline-figures-stage-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
  foreach ($item in @('index.js', 'cordis.patch.yml', 'icon.svg', 'package.json', 'README.md', 'lib')) {
    Copy-Item (Join-Path $pkgDir $item) (Join-Path $staging $item) -Recurse
  }
  Write-Host "== installing into profile '$Profile' (network + ~2 min expected) =="
  & $DshCli plugin --profile $Profile add ('file:' + $staging)
  if ($LASTEXITCODE -ne 0) { Write-Warning 'dsh plugin add reported a nonzero exit; falling back to on-disk verification.' }

  # pnpm's isolated layout does not give a file:-copied bundle a resolvable
  # dependency tree; hoist a flat tree with npm (same registry versions).
  $installDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile\node_modules\$pkgName"
  if (-not (Test-Path (Join-Path $installDir 'index.js'))) { throw "installed bundle not found at $installDir" }
  Push-Location $installDir
  try { npm install --omit=dev --no-audit --no-fund --ignore-scripts } finally { Pop-Location }

  Push-Location (Join-Path $env:USERPROFILE ".dsh\profiles\$Profile")
  try {
    $probe = & node -e "import('$pkgName').then((m)=>console.log('LOAD OK:',Object.keys(m).join(',')),(e)=>{console.error('LOAD FAIL:',e.message);process.exit(1)})"
    if ($LASTEXITCODE -ne 0) { throw "load probe failed: $probe" }
    Write-Host $probe
  } finally { Pop-Location }
  Write-Host "== installed. Restart the DSH app, then check Settings -> plugins -> inline-figures shows running =="
} finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
