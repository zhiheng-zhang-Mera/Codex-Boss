# Phase 0 §4.2 remote/local validation chain, run exactly as CI runs it.
# Each step's exit code is captured explicitly so a non-zero step is never
# masked by PowerShell's stderr handling.
$ErrorActionPreference = "Continue"
$root = "D:\Git-Projects\Codex-Boss"
$log = Join-Path $root "artifacts\phase0-chain.log"
if (Test-Path $log) { Remove-Item $log }
$steps = @(
  @{ name = "install"; cmd = "corepack pnpm install --frozen-lockfile" },
  @{ name = "install:electron"; cmd = "corepack pnpm run install:electron" },
  @{ name = "typecheck"; cmd = "corepack pnpm run typecheck" },
  @{ name = "security:scan"; cmd = "corepack pnpm run security:scan" },
  @{ name = "build"; cmd = "corepack pnpm run build" },
  @{ name = "test"; cmd = "corepack pnpm test" },
  @{ name = "acceptance:workbook"; cmd = "corepack pnpm run acceptance:workbook" },
  @{ name = "acceptance:knowledge"; cmd = "corepack pnpm run acceptance:knowledge" },
  @{ name = "acceptance:architecture"; cmd = "corepack pnpm run acceptance:architecture" },
  @{ name = "acceptance:theme"; cmd = "corepack pnpm run acceptance:theme" },
  @{ name = "acceptance:requirements"; cmd = "corepack pnpm run acceptance:requirements" },
  @{ name = "acceptance:plan"; cmd = "corepack pnpm run acceptance:plan" },
  @{ name = "acceptance:verify"; cmd = "corepack pnpm run acceptance:verify" },
  @{ name = "acceptance:review"; cmd = "corepack pnpm run acceptance:review" },
  @{ name = "acceptance:self-healing"; cmd = "corepack pnpm run acceptance:self-healing" },
  @{ name = "acceptance:capability-gap"; cmd = "corepack pnpm run acceptance:capability-gap" },
  @{ name = "acceptance:github-machine"; cmd = "corepack pnpm run acceptance:github-machine" },
  @{ name = "benchmark"; cmd = "corepack pnpm run benchmark" },
  @{ name = "package:portable"; cmd = "corepack pnpm run package:portable" },
  @{ name = "smoke-portable"; cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-portable.ps1" },
  @{ name = "acceptance-restart"; cmd = "node scripts\acceptance-restart.cjs" },
  @{ name = "acceptance:desktop-workbook"; cmd = "corepack pnpm run acceptance:desktop-workbook" }
)
$results = @()
foreach ($step in $steps) {
  $started = Get-Date
  $out = Join-Path $root ("artifacts\phase0-" + ($step.name -replace "[:\.]", "-") + ".log")
  cmd /c "cd /d $root && $($step.cmd) > `"$out`" 2>&1"
  $code = $LASTEXITCODE
  $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  $line = "[chain] {0,-28} exit={1} seconds={2}" -f $step.name, $code, $seconds
  Add-Content -Path $log -Value $line
  Write-Output $line
  $results += [pscustomobject]@{ step = $step.name; exit = $code; seconds = $seconds; log = $out }
}
$failing = @($results | Where-Object { $_.exit -ne 0 } | ForEach-Object { $_.step })
Add-Content -Path $log -Value ("[chain] failing steps: " + ($failing -join ", "))
$results | ConvertTo-Json -Depth 3 | Set-Content -Path (Join-Path $root "artifacts\phase0-chain.json")
Write-Output ("[chain] DONE failing=" + $failing.Count + " " + ($failing -join ", "))
