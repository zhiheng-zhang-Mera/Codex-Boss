# Restore node_modules/.bin for the Codex Boss pnpm layout.
#
# The directory was lost when a temporary measurement worktree's node_modules
# junction was removed. The pnpm store (node_modules/.pnpm) and every package
# symlink are intact; only the .bin shim directory was removed, which is why
# `npx vitest` / `npx tsc` / `vite` stopped resolving.
#
# Shims are recreated from each package's own declared "bin" field, so the result
# matches what pnpm would have linked rather than being guessed.
param(
  [string]$WorkDir = "D:\Codex-Boss"
)

Set-Location -LiteralPath $WorkDir

$binDir = Join-Path $WorkDir 'node_modules\.bin'
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }

$packages = @('typescript', 'vite', 'vitest', 'concurrently', 'cross-env', 'wait-on', 'electron')

$created = New-Object System.Collections.ArrayList
$skipped = New-Object System.Collections.ArrayList
$utf8 = New-Object System.Text.UTF8Encoding($false)

foreach ($pkg in $packages) {
  $pkgDir = Join-Path $WorkDir "node_modules\$pkg"
  $pkgJsonPath = Join-Path $pkgDir 'package.json'
  if (-not (Test-Path $pkgJsonPath)) { [void]$skipped.Add("$pkg (no package.json)"); continue }

  $json = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
  if (-not $json.bin) { [void]$skipped.Add("$pkg (no bin field)"); continue }

  $entries = @()
  if ($json.bin -is [string]) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($json.name)
    $entries += [pscustomobject]@{ name = $base; target = $json.bin }
  } else {
    foreach ($p in $json.bin.PSObject.Properties) { $entries += [pscustomobject]@{ name = $p.Name; target = $p.Value } }
  }

  foreach ($e in $entries) {
    $rel = ($e.target -replace '^\./', '') -replace '/', '\'
    $target = Join-Path $pkgDir $rel
    if (-not (Test-Path $target)) { [void]$skipped.Add("$pkg/$($e.name) (target missing: $rel)"); continue }

    $name = $e.name
    $relForNode = "..\$pkg\$rel"

    # POSIX sh shim
    $sh = '#!/bin/sh' + "`n" + 'basedir=$(dirname "$0")' + "`n" + 'exec node "$basedir/' + $relForNode.Replace('\', '/') + '" "$@"' + "`n"
    [System.IO.File]::WriteAllText((Join-Path $binDir $name), $sh, $utf8)

    # Windows cmd shim (single-quoted here-string: no PowerShell interpolation)
    $cmd = @'
@ECHO off
SETLOCAL
SET "dp0=%~dp0"
node "%dp0%__REL__" %*
'@
    $cmd = $cmd.Replace('__REL__', $relForNode)
    [System.IO.File]::WriteAllText((Join-Path $binDir "$name.cmd"), $cmd, $utf8)

    # PowerShell shim
    $ps1 = '#!/usr/bin/env pwsh' + "`n" + '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent' + "`n" +
           '& node "$basedir/' + $relForNode + '" $args' + "`n" + 'exit $LASTEXITCODE' + "`n"
    [System.IO.File]::WriteAllText((Join-Path $binDir "$name.ps1"), $ps1, $utf8)

    [void]$created.Add($name)
  }
}

$uniqueCreated = @($created | Sort-Object -Unique)
Write-Output ("created shims: {0}" -f ($uniqueCreated -join ', '))
if ($skipped.Count -gt 0) { Write-Output ("skipped: {0}" -f ($skipped -join '; ')) }
