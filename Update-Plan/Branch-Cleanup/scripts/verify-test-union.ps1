# Phase D/E verification — prove the merge is a superset of the M baseline and
# that the only test deletions were the two restored ones.
#
# READ-ONLY: compares committed trees, writes one JSON report.
param(
  [string]$WorkDir = "D:\Codex-Boss",
  [string]$Baseline = "9-10-M",
  [string]$HostA = "cde3738eb21f858ae33465f77940ee98e7a30b4f",
  [string]$OutFile = "Update-Plan/Branch-Cleanup/evidence/merge/test-union-verification.json"
)

Set-Location -LiteralPath $WorkDir

function Get-TreeMap([string]$rev) {
  $map = @{}
  $out = & git ls-tree -r $rev
  foreach ($line in $out) {
    # <mode> SP <type> SP <sha> TAB <path>
    if ($line -match '^\d+\s+\w+\s+([0-9a-f]{40})\t(.+)$') {
      $map[$Matches[2]] = $Matches[1]
    }
  }
  return $map
}

$headRev  = (& git rev-parse HEAD).Trim()
$baseRev  = (& git rev-parse $Baseline).Trim()
$forkRev  = (& git merge-base $baseRev $HostA).Trim()

$head = Get-TreeMap 'HEAD'
$base = Get-TreeMap $baseRev
$fork = Get-TreeMap $forkRev
$hostATree = Get-TreeMap $HostA

# Which side changed each path relative to the fork point? A path that diverges
# from M in the merged tree is only a defect when M itself changed it: an A-side
# change to a path M never touched is the sanctioned Host-A update (cleanup.md 7).
function Get-ChangedPaths([hashtable]$from, [hashtable]$to) {
  $set = @{}
  foreach ($p in $to.Keys) {
    if (-not $from.ContainsKey($p) -or $from[$p] -ne $to[$p]) { $set[$p] = $true }
  }
  foreach ($p in $from.Keys) {
    if (-not $to.ContainsKey($p)) { $set[$p] = $true }
  }
  return $set
}

$aChanged = Get-ChangedPaths $fork $hostATree
$mChanged = Get-ChangedPaths $fork $base

$missing = New-Object System.Collections.ArrayList
$modified = New-Object System.Collections.ArrayList
foreach ($path in $base.Keys) {
  if (-not $head.ContainsKey($path)) { [void]$missing.Add($path) }
  elseif ($head[$path] -ne $base[$path]) { [void]$modified.Add($path) }
}

$added = New-Object System.Collections.ArrayList
foreach ($path in $head.Keys) {
  if (-not $base.ContainsKey($path)) { [void]$added.Add($path) }
}

$testPattern = '\.(test|spec)\.(ts|tsx|js|mjs|cjs)$'
$isTest = { param($p) $p -match $testPattern }

$baseTests = @($base.Keys  | Where-Object { & $isTest $_ })
$headTests = @($head.Keys  | Where-Object { & $isTest $_ })
$missingTests = @($missing | Where-Object { & $isTest $_ })
$modifiedTests = @($modified | Where-Object { & $isTest $_ })
$addedTests = @($added | Where-Object { & $isTest $_ })

# The two tests that A's Phase L curation deleted and this integration restored.
$protectedRestored = @(
  'tests/unit/autonomy-supervisor.test.ts',
  'tests/unit/decision-ledger.test.ts'
)

$protectedStatus = New-Object System.Collections.ArrayList
foreach ($p in $protectedRestored) {
  $present = $head.ContainsKey($p)
  $identical = $present -and ($head[$p] -eq $base[$p])
  [void]$protectedStatus.Add([pscustomobject][ordered]@{
    path             = $p
    presentInMerged  = $present
    identicalToM     = $identical
  })
}

$verdict = 'PASS'
$reasons = New-Object System.Collections.ArrayList

# Classify every divergence from the M baseline.
$lostMChanges = New-Object System.Collections.ArrayList   # M changed it, merged tree does not carry M's version
$aSideUpdates = New-Object System.Collections.ArrayList   # only A changed it: sanctioned closure update
$mPreserved   = New-Object System.Collections.ArrayList   # M changed it and the merged tree keeps it

foreach ($p in $missing) {
  if ($mChanged.ContainsKey($p) -and $aChanged.ContainsKey($p)) {
    [void]$lostMChanges.Add([pscustomobject]@{ path = $p; kind = 'deleted-by-merge'; mChanged = $true; aChanged = $true })
  } elseif ($mChanged.ContainsKey($p)) {
    [void]$lostMChanges.Add([pscustomobject]@{ path = $p; kind = 'deleted-by-merge'; mChanged = $true; aChanged = $false })
  } else {
    [void]$aSideUpdates.Add([pscustomobject]@{ path = $p; kind = 'a-side-deletion'; note = 'A deleted a path M never changed (sanctioned: superseded closure asset)' })
  }
}

foreach ($p in $modified) {
  if ($mChanged.ContainsKey($p) -and $aChanged.ContainsKey($p)) {
    [void]$lostMChanges.Add([pscustomobject]@{ path = $p; kind = 'm-version-overwritten'; mChanged = $true; aChanged = $true })
  } elseif ($mChanged.ContainsKey($p)) {
    [void]$lostMChanges.Add([pscustomobject]@{ path = $p; kind = 'm-version-overwritten'; mChanged = $true; aChanged = $false })
  } else {
    [void]$aSideUpdates.Add([pscustomobject]@{ path = $p; kind = 'a-side-update'; note = 'A updated a path M never changed (sanctioned: closure acceptance asset)' })
  }
}

foreach ($p in $mChanged.Keys) {
  if ($head.ContainsKey($p) -and $head[$p] -eq $base[$p]) { [void]$mPreserved.Add($p) }
}

if ($lostMChanges.Count -gt 0) {
  $verdict = 'FAIL'
  [void]$reasons.Add("$($lostMChanges.Count) M-side change(s) were not preserved by the merge")
}
foreach ($s in $protectedStatus) {
  if (-not ($s.presentInMerged -and $s.identicalToM)) {
    $verdict = 'FAIL'
    [void]$reasons.Add("protected test not intact: $($s.path)")
  }
}
if ($missingTests.Count -gt 0) {
  $verdict = 'FAIL'
  [void]$reasons.Add("$($missingTests.Count) test file(s) lost by the merge")
}
if ($headTests.Count -lt $baseTests.Count) {
  $verdict = 'FAIL'
  [void]$reasons.Add('merged test file count is below the M baseline')
}

$report = [pscustomobject][ordered]@{
  schemaVersion        = 1
  kind                 = 'BRANCH_CLEANUP_TEST_UNION_VERIFICATION'
  generatedAt          = (Get-Date).ToString('o')
  mergedHead           = $headRev
  mBaselineRev         = $baseRev
  mBaselineBranch      = $Baseline
  hostASource          = $HostA
  forkPoint            = $forkRev
  rule                 = 'Tests(final) = Tests(M) union useful Tests(A); no M test may be removed by the merge'
  verdict              = $verdict
  reasons              = @($reasons)
  totals               = [pscustomobject][ordered]@{
    filesInM           = $base.Count
    filesInMerged      = $head.Count
    filesAdded         = $added.Count
    filesMissing       = $missing.Count
    filesModified      = $modified.Count
    testFilesInM       = $baseTests.Count
    testFilesInMerged  = $headTests.Count
    testFilesAdded     = $addedTests.Count
    testFilesMissing   = $missingTests.Count
    testFilesModified  = $modifiedTests.Count
    mChangedPaths      = $mChanged.Count
    aChangedPaths      = $aChanged.Count
    mLostChanges       = $lostMChanges.Count
    aSideUpdates       = $aSideUpdates.Count
    mChangesPreserved  = $mPreserved.Count
  }
  missingFiles         = @($missing)
  modifiedFiles        = @($modified)
  addedTestFiles       = @($addedTests)
  missingTestFiles     = @($missingTests)
  modifiedTestFiles    = @($modifiedTests)
  mLostChanges         = @($lostMChanges)
  aSideUpdates         = @($aSideUpdates)
  mChangesPreserved    = @($mPreserved)
  protectedTests       = $protectedStatus
}

$target = Join-Path $WorkDir $OutFile
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$json = $report | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($target, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "VERDICT: $verdict"
Write-Output ("fork point: {0}" -f $forkRev)
Write-Output ("files: M={0} merged={1} added={2} missing={3} modified={4}" -f $base.Count, $head.Count, $added.Count, $missing.Count, $modified.Count)
Write-Output ("tests: M={0} merged={1} added={2} missing={3}" -f $baseTests.Count, $headTests.Count, $addedTests.Count, $missingTests.Count)
Write-Output ("classification: mChanged={0} aChanged={1} mLostChanges={2} aSideUpdates={3} mPreserved={4}" -f $mChanged.Count, $aChanged.Count, $lostMChanges.Count, $aSideUpdates.Count, $mPreserved.Count)
foreach ($r in $reasons) { Write-Output "  reason: $r" }
foreach ($s in $protectedStatus) { Write-Output ("  protected {0} present={1} identicalToM={2}" -f $s.path, $s.presentInMerged, $s.identicalToM) }
foreach ($s in $aSideUpdates) { Write-Output ("  a-side {0}: {1} ({2})" -f $s.kind, $s.path, $s.note) }
foreach ($s in $lostMChanges) { Write-Output ("  LOST M CHANGE {0}: {1}" -f $s.kind, $s.path) }
