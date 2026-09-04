param([string]$PackagePath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $PackagePath) { $PackagePath = (Get-Content -LiteralPath (Join-Path $projectRoot 'artifacts/latest-package.json') -Raw | ConvertFrom-Json).destination }
$runId = [Guid]::NewGuid().ToString('N')
$dataPath = Join-Path $projectRoot "artifacts/smoke-$runId"
$stdout = Join-Path $projectRoot "artifacts/smoke-$runId.stdout.log"
$stderr = Join-Path $projectRoot "artifacts/smoke-$runId.stderr.log"
$executable = Join-Path $PackagePath 'Codex Boss.exe'
$arguments = @('--codex-boss-smoke-test', ('--boss-data-dir="' + $dataPath + '"'))
$process = Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$null = $process.Handle
if (-not $process.WaitForExit(30000)) { Stop-Process -Id $process.Id -Force; throw 'Packaged smoke timed out' }
$process.WaitForExit()
if ($process.ExitCode -ne 0) { Get-Content -LiteralPath $stderr; throw "Packaged smoke failed: $($process.ExitCode)" }
$resultPath = Join-Path $dataPath 'smoke-result.json'
$result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
if (-not ($result.rendererLoaded -and $result.nativeCompleted -and $result.completionVisible)) { throw 'Smoke evidence is incomplete' }
@{ dataPath=$dataPath; result=$result } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $projectRoot 'artifacts/latest-smoke.json')
Write-Output "PACKAGED_SMOKE_PASS: $resultPath"
