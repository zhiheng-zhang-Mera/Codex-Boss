# Phase A — branch freeze and HEAD snapshot.
# READ-ONLY: this script never creates, moves, tags or deletes any ref.
param(
  [string]$OutFile = "Update-Plan/Branch-Cleanup/branch-heads-before.json",
  [string]$WorkDir = "D:\Codex-Boss"
)

Set-Location -LiteralPath $WorkDir

$planned = @(
  'main','owner-result','9-10-M','9-10-A','A-main-integration',
  '9-2026-09-09-closure','2026-09-09-closure','9-8-overcomplete','9-8',
  '9-7','9-6','9-5','9-4','9-3','9-3-remote'
)

function Get-LocalBranches {
  $out = & git for-each-ref --format='%(refname:short)' refs/heads 2>$null
  if ($null -eq $out) { return @() }
  return @($out | Where-Object { $_ -and $_.Trim().Length -gt 0 } | ForEach-Object { $_.Trim() })
}

function Get-RemoteBranches {
  $out = & git for-each-ref --format='%(refname:short)' refs/remotes/origin 2>$null
  if ($null -eq $out) { return @() }
  return @($out |
    Where-Object { $_ -and $_.Trim().Length -gt 0 } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne 'origin/HEAD' -and $_ -ne 'origin' } |
    ForEach-Object { $_ -replace '^origin/', '' })
}

$local  = Get-LocalBranches
$remote = Get-RemoteBranches
$names  = @($planned + $local + $remote | Sort-Object -Unique)

$now    = (Get-Date).ToString('o')
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()

$entries = New-Object System.Collections.ArrayList
foreach ($name in $names) {
  $localRef  = "refs/heads/$name"
  $remoteRef = "refs/remotes/origin/$name"

  $hasLocal  = $local  -contains $name
  $hasRemote = $remote -contains $name

  $sha = $null
  if ($hasLocal)  { $sha = (& git rev-parse --verify --quiet $localRef) }
  elseif ($hasRemote) { $sha = (& git rev-parse --verify --quiet $remoteRef) }
  if ($null -ne $sha) { $sha = $sha.Trim() }
  if ([string]::IsNullOrWhiteSpace($sha)) { $sha = $null }

  $rec = [ordered]@{
    branch         = $name
    existsLocal    = [bool]$hasLocal
    existsRemote   = [bool]$hasRemote
    sha            = $sha
    localSha       = if ($hasLocal)  { ((& git rev-parse --verify --quiet $localRef).Trim()) }  else { $null }
    remoteSha      = if ($hasRemote) { ((& git rev-parse --verify --quiet $remoteRef).Trim()) } else { $null }
    localEqualsRemote = $null
    commitDate     = $null
    commitMessage  = $null
    refScope       = $null
  }

  if ($hasLocal -and $hasRemote) {
    $rec.localEqualsRemote = ($rec.localSha -eq $rec.remoteSha)
    $rec.refScope = 'both'
  } elseif ($hasLocal)  { $rec.refScope = 'local-only' }
  elseif ($hasRemote)   { $rec.refScope = 'remote-only' }

  if ($null -ne $rec.sha) {
    $rec.commitDate    = (& git show -s --format=%cI $rec.sha).Trim()
    $rec.commitMessage = (& git show -s --format=%s $rec.sha).Trim()
  }

  [void]$entries.Add([pscustomobject]$rec)
}

$baselineName = '9-10-M'
$baselineSha  = $null
foreach ($e in $entries) { if ($e.branch -eq $baselineName) { $baselineSha = $e.sha } }

$manifest = [pscustomobject][ordered]@{
  generatedAt          = $now
  workDir              = $WorkDir
  recordedBy           = 'A-main-integration phase A'
  baselineBranch       = $baselineName
  baselineRef          = 'origin/9-10-M'
  baselineSha          = $baselineSha
  integrationBranch    = 'A-main-integration'
  currentBranch        = $branch
  tagCountBefore       = @(& git tag -l).Count
  plannedFromCleanupMd = $planned
  localBranches        = $local
  remoteBranches       = $remote
  branches             = $entries
}

$target = Join-Path $WorkDir $OutFile
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$json = $manifest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($target, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "WROTE $OutFile"
Write-Output "baseline $baselineName = $baselineSha"
Write-Output "current branch = $branch"
foreach ($e in $entries) {
  $flag = ''
  if ($e.refScope -eq 'remote-only') { $flag = ' (remote-only)' }
  if ($null -eq $e.sha) { $flag = ' (MISSING)' }
  $shaText = $e.sha
  if ($null -eq $shaText -or "$shaText" -eq '') { $shaText = '-' }
  "{0,-24} {1} {2}{3}" -f $e.branch, $shaText, $e.commitDate, $flag | Write-Output
}
