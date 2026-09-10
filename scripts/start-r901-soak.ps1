<#
.SYNOPSIS
  Durable detached launcher for the hardened R-901 soak (Host-A Phase D6).

.DESCRIPTION
  Preflight + duplicate-run lock + PID file + runId + detached process +
  stdout/stderr log + status + safe cleanup. The agent later reads evidence /
  heartbeat only; the run is NOT tied to any one agent turn staying alive.

.EXAMPLE
  .\scripts\start-r901-soak.ps1                         # formal 7200s soak
  .\scripts\start-r901-soak.ps1 -ValidateOnly -ValidateSeconds 90
  .\scripts\start-r901-soak.ps1 -Status
  .\scripts\start-r901-soak.ps1 -Stop
#>
param(
  [int]$Seconds = 7200,
  [switch]$ValidateOnly,
  [int]$ValidateSeconds = 90,
  [int]$FailureThreshold = 5,
  [int]$CooldownMs = 60000,
  [string]$RunId = "",
  [string]$EvidenceDir = "",
  [switch]$Status,
  [switch]$Stop,
  [switch]$Preflight
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$evidence = if ($EvidenceDir) { $EvidenceDir } else { Join-Path $root "Update-Plan\2026-09-09-closure\evidence" }
$runDir = Join-Path $root ".cache\r901"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$lockFile = Join-Path $runDir "r901-soak.lock.json"

function Get-RunInfo {
  if (Test-Path $lockFile) {
    try { return (Get-Content $lockFile -Raw | ConvertFrom-Json) } catch { return $null }
  }
  return $null
}
function Test-PidAlive([int]$targetPid) {
  if ($targetPid -le 0) { return $false }
  return [bool](Get-Process -Id $targetPid -ErrorAction SilentlyContinue)
}

if ($Status) {
  $info = Get-RunInfo
  if (-not $info) { Write-Host "R901_STATUS no-run-registered"; exit 0 }
  $alive = Test-PidAlive ([int]$info.pid)
  Write-Host ("R901_STATUS runId={0} pid={1} alive={2} startedAt={3}" -f $info.runId, $info.pid, $alive, $info.startedAt)
  if ($alive) {
    $hb = Get-ChildItem $info.evidenceDir -Filter ("r901-{0}.heartbeat.jsonl" -f $info.runId) -ErrorAction SilentlyContinue
    if ($hb) {
      $lines = Get-Content $hb.FullName -Tail 1
      if ($lines) {
        $last = $lines | ConvertFrom-Json
        Write-Host ("R901_STATUS lastHeartbeat elapsedSec={0} completed={1} fatalFailed={2}" -f $last.elapsedSec, $last.completed, $last.fatalFailed)
      }
    }
    $outLog = Join-Path $runDir ("r901-{0}.out.log" -f $info.runId)
    if (Test-Path $outLog) { Write-Host "--- log tail ---"; Get-Content $outLog -Tail 6 }
  }
  exit 0
}

if ($Stop) {
  $info = Get-RunInfo
  if ($info -and (Test-PidAlive ([int]$info.pid))) {
    Stop-Process -Id ([int]$info.pid) -Force -ErrorAction SilentlyContinue
    Write-Host ("R901_STOP killed pid={0} runId={1}" -f $info.pid, $info.runId)
  } else {
    Write-Host "R901_STOP nothing-running"
  }
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  exit 0
}

# --- preflight ---
$git = (git rev-parse HEAD 2>$null)
if (-not $git) { Write-Host "R901_PREFLIGHT_FAIL git-head-unavailable"; exit 2 }
if (-not (Test-Path (Join-Path $root "dist-electron\electron\commander\execution-supervisor.js"))) {
  Write-Host "R901_PREFLIGHT_FAIL dist-electron-missing (run build:electron first)"; exit 2
}
if (-not (Test-Path (Join-Path $root "scripts\r901-soak.cjs"))) {
  Write-Host "R901_PREFLIGHT_FAIL harness-missing"; exit 2
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "R901_PREFLIGHT_FAIL node-missing"; exit 2 }

$existing = Get-RunInfo
if ($existing -and (Test-PidAlive ([int]$existing.pid))) {
  Write-Host ("R901_PREFLIGHT_FAIL duplicate-run pid={0} runId={1}" -f $existing.pid, $existing.runId); exit 2
}

if ($Preflight) { Write-Host "R901_PREFLIGHT_OK"; exit 0 }

if (-not $ValidateOnly -and $Seconds -lt 7200) {
  Write-Host "R901_FAIL_CLOSED seconds=$Seconds < 7200; use -ValidateOnly for quick runs"; exit 2
}

$runId = if ($RunId) { $RunId } else { ("{0}-{1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ssZ"), ([guid]::NewGuid().ToString("N").Substring(0, 8))) }
$outLog = Join-Path $runDir ("r901-{0}.out.log" -f $runId)
$errLog = Join-Path $runDir ("r901-{0}.err.log" -f $runId)

$nodeArgs = @(
  (Join-Path $root "scripts\r901-soak.cjs"),
  "--seconds", "$Seconds",
  "--run-id", $runId,
  "--evidence-dir", "$evidence",
  "--failure-threshold", "$FailureThreshold",
  "--cooldown-ms", "$CooldownMs"
)
if ($ValidateOnly) { $nodeArgs += @("--validate-only", "--validate-seconds", "$ValidateSeconds") }

# Start DETACHED: independent process, stdout/stderr to files, invisible window.
$proc = Start-Process -FilePath "node" -ArgumentList $nodeArgs -WorkingDirectory $root `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru

$lock = @{
  runId = $runId; pid = $proc.Id; startedAt = (Get-Date).ToUniversalTime().ToString("o");
  gitHead = $git; evidenceDir = $evidence; seconds = $Seconds; validateOnly = [bool]$ValidateOnly; outLog = $outLog; errLog = $errLog
}
$lock | ConvertTo-Json | Set-Content -Path $lockFile -Encoding utf8
Write-Host ("R901_STARTED runId={0} pid={1} seconds={2} validateOnly={3} evidence={4}" -f $runId, $proc.Id, $Seconds, [bool]$ValidateOnly, $evidence)
