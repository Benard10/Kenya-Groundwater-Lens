$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'

if ((Split-Path -Leaf $distRoot) -ne 'dist' -or (Split-Path -Parent $distRoot) -ne $projectRoot) {
  throw "Refusing to rebuild an unexpected path: $distRoot"
}

if (Test-Path -LiteralPath $distRoot) {
  Get-ChildItem -LiteralPath $distRoot -Force | Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $distRoot | Out-Null
}

$files = @(
  'index.html',
  'icons8-favicon-100.png'
)

$directories = @(
  'css',
  'js',
  'public',
  'docs',
  'vendor'
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $distRoot $file) -Force
}

foreach ($directory in $directories) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination (Join-Path $distRoot $directory) -Recurse -Force
}

Write-Host "Built static site at $distRoot"
