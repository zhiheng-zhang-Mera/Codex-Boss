# Phase D/E verification — prove that the merge is a superset of the M baseline, that
# the only test deletions were the two restored ones, and that every divergence from
# M is attributable to a named, sanctioned cause.
#
# Attribution matters. A diff of the final HEAD against 9-10-M mixes two very
# different things: what the MERGE did, and what the INTEGRATION PHASE did afterwards
# (BOM stripping, the R-204 path correction). This script evaluates the merge commit
# and the final HEAD separately and labels each divergence with its cause, so a
# post-merge repair cannot masquerade as a lost M change.
#
# READ-ONLY: compares committed trees, writes one JSON report.
param(
  [string]$WorkDir = "D:\Codex-Boss",
  [string]$Baseline = "9-10-M",
  [string]$HostA = "cde3738eb21f858ae33465f77940ee98e7a30b4f",
  [string]$MergeCommit = "",
  [string]$OutFile = "Update-Plan/Branch-Cleanup/evidence/merge/test-union-verification.json"
)

Set-Location -LiteralPath $WorkDir

function Get-TreeMap([string]$rev) {
  $map = @{}
  $out = & git ls-tree -r $rev
  foreach ($line in $out) {
    if ($line -match '^\d+\s+\w+\s+([0-9a-f]{40})\t(.+)$') { $map[$Matches[2]] = $Matches[1] }
  }
  return $map
}

function Get-ChangedPaths([hashtable]$from, [hashtable]$to) {
  $set = @{}
  foreach ($p in $to.Keys) { if (-not $from.ContainsKey($p) -or $from[$p] -ne $to[$p]) { $set[$p] = $true } }
  foreach ($p in $from.Keys) { if (-not $to.ContainsKey($p)) { $set[$p] = $true } }
  return $set
}

$headRev = (& git rev-parse HEAD).Trim()
$baseRev = (& git rev-parse $Baseline).Trim()
$forkRev = (& git merge-base $baseRev $HostA).Trim()

# Locate the merge commit automatically when not supplied: the first HEAD ancestor
# with two parents.
if ([string]::IsNullOrWhiteSpace($MergeCommit)) {
  $MergeCommit = (& git rev-list --merges -1 HEAD).Trim()
}
if ([string]::IsNullOrWhiteSpace($MergeCommit)) { throw 'could not locate a merge commit on HEAD' }
$mergeRev = (& git rev-parse $MergeCommit).Trim()

$head      = Get-TreeMap 'HEAD'
$base      = Get-TreeMap $baseRev
$fork      = Get-TreeMap $forkRev
$hostATree = Get-TreeMap $HostA
$mergeTree = Get-TreeMap $mergeRev

$aChanged = Get-ChangedPaths $fork $hostATree
$mChanged = Get-ChangedPaths $fork $base

$testPattern = '\.(test|spec)\.(ts|tsx|js|mjs|cjs)$'
$isTest = { param($p) $p -match $testPattern }

$baseTests = @($base.Keys | Where-Object { & $isTest $_ })
$headTests = @($head.Keys | Where-Object { & $isTest $_ })
$mergeTests = @($mergeTree.Keys | Where-Object { & $isTest $_ })

$protectedRestored = @(
  'tests/unit/autonomy-supervisor.test.ts',
  'tests/unit/decision-ledger.test.ts'
)

# --- 1. What did the MERGE do? ------------------------------------------------
$mergeMissing = @(); $mergeModified = @()
foreach ($p in $base.Keys) {
  if (-not $mergeTree.ContainsKey($p)) { $mergeMissing += $p }
  elseif ($mergeTree[$p] -ne $base[$p]) { $mergeModified += $p }
}

$mergeLostMChanges = New-Object System.Collections.ArrayList
$mergeASideUpdates = New-Object System.Collections.ArrayList
foreach ($p in $mergeMissing) {
  if ($mChanged.ContainsKey($p)) {
    [void]$mergeLostMChanges.Add([pscustomobject]@{ path = $p; kind = 'deleted-by-merge'; mChanged = $true; aChanged = [bool]$aChanged.ContainsKey($p) })
  } else {
    [void]$mergeASideUpdates.Add([pscustomobject]@{ path = $p; kind = 'a-side-deletion' })
  }
}
foreach ($p in $mergeModified) {
  if ($mChanged.ContainsKey($p)) {
    [void]$mergeLostMChanges.Add([pscustomobject]@{ path = $p; kind = 'm-version-overwritten'; mChanged = $true; aChanged = [bool]$aChanged.ContainsKey($p) })
  } else {
    [void]$mergeASideUpdates.Add([pscustomobject]@{ path = $p; kind = 'a-side-update' })
  }
}

# --- 2. What did the integration phase change after the merge? -----------------
$postMergeChanged = New-Object System.Collections.ArrayList
foreach ($p in $mergeTree.Keys) {
  if (-not $head.ContainsKey($p)) { [void]$postMergeChanged.Add([pscustomobject]@{ path = $p; kind = 'deleted-after-merge' }) }
  elseif ($head[$p] -ne $mergeTree[$p]) { [void]$postMergeChanged.Add([pscustomobject]@{ path = $p; kind = 'modified-after-merge' }) }
}
foreach ($p in $head.Keys) {
  if (-not $mergeTree.ContainsKey($p)) { [void]$postMergeChanged.Add([pscustomobject]@{ path = $p; kind = 'added-after-merge' }) }
}

$postMergePaths = @{}
foreach ($e in $postMergeChanged) { $postMergePaths[$e.path] = $e.kind }

# --- 3. Final HEAD vs M, with attribution -------------------------------------
$finalMissing = @(); $finalModified = @()
foreach ($p in $base.Keys) {
  if (-not $head.ContainsKey($p)) { $finalMissing += $p }
  elseif ($head[$p] -ne $base[$p]) { $finalModified += $p }
}

$attributed = New-Object System.Collections.ArrayList
$unexplained = New-Object System.Collections.ArrayList
foreach ($p in ($finalMissing + $finalModified)) {
  $cause = $null
  if ($postMergePaths.ContainsKey($p)) { $cause = "integration-phase: $($postMergePaths[$p])" }
  elseif ($aChanged.ContainsKey($p)) { $cause = 'A-side change (sanctioned under cleanup.md section 7)' }
  elseif ($mChanged.ContainsKey($p)) { $cause = 'UNEXPLAINED M-side change' }
  else { $cause = 'UNEXPLAINED (neither side changed this path)' }
  $rec = [pscustomobject]@{ path = $p; cause = $cause }
  if ($cause -like 'UNEXPLAINED*') { [void]$unexplained.Add($rec) } else { [void]$attributed.Add($rec) }
}

# --- 4. Verdicts --------------------------------------------------------------
$protectedStatus = New-Object System.Collections.ArrayList
foreach ($p in $protectedRestored) {
  [void]$protectedStatus.Add([pscustomobject]@{
    path            = $p
    presentInMerged = $head.ContainsKey($p)
    identicalToM    = ($head.ContainsKey($p) -and $head[$p] -eq $base[$p])
    identicalInMergeCommit = ($mergeTree.ContainsKey($p) -and $mergeTree[$p] -eq $base[$p])
  })
}

$mergeVerdict = 'PASS'
$mergeReasons = New-Object System.Collections.ArrayList
if ($mergeLostMChanges.Count -gt 0) {
  $mergeVerdict = 'FAIL'
  [void]$mergeReasons.Add("$($mergeLostMChanges.Count) M-side change(s) were lost by the merge itself")
}
foreach ($s in $protectedStatus) {
  if (-not $s.identicalInMergeCommit) {
    $mergeVerdict = 'FAIL'
    [void]$mergeReasons.Add("protected test not intact in the merge commit: $($s.path)")
  }
}

$finalVerdict = 'PASS'
$finalReasons = New-Object System.Collections.ArrayList
if ($unexplained.Count -gt 0) {
  $finalVerdict = 'FAIL'
  [void]$finalReasons.Add("$($unexplained.Count) divergence(s) from $Baseline have no sanctioned cause")
}
foreach ($s in $protectedStatus) {
  if (-not ($s.presentInMerged -and $s.identicalToM)) {
    $finalVerdict = 'FAIL'
    [void]$finalReasons.Add("protected test not intact at HEAD: $($s.path)")
  }
}
if ($headTests.Count -lt $baseTests.Count) {
  $finalVerdict = 'FAIL'
  [void]$finalReasons.Add('merged test file count is below the M baseline')
}

$report = [pscustomobject][ordered]@{
  schemaVersion    = 1
  kind             = 'BRANCH_CLEANUP_TEST_UNION_VERIFICATION'
  generatedAt      = (Get-Date).ToString('o')
  mergeCommit      = $mergeRev
  finalHead        = $headRev
  mBaselineRev     = $baseRev
  mBaselineBranch  = $Baseline
  hostASource      = $HostA
  forkPoint        = $forkRev
  rule             = 'Tests(final) = Tests(M) union useful Tests(A); no M test may be removed by the merge'
  mergeVerdict     = $mergeVerdict
  mergeReasons     = @($mergeReasons)
  finalVerdict     = $finalVerdict
  finalReasons     = @($finalReasons)
  verdict          = if ($mergeVerdict -eq 'PASS' -and $finalVerdict -eq 'PASS') { 'PASS' } else { 'FAIL' }
  mergeTotals      = [pscustomobject][ordered]@{
    mFiles                = $base.Count
    mergeFiles            = $mergeTree.Count
    mFilesMissing         = $mergeMissing.Count
    mFilesModified        = $mergeModified.Count
    mLostChanges          = $mergeLostMChanges.Count
    aSideUpdates          = $mergeASideUpdates.Count
    testFilesInM          = $baseTests.Count
    testFilesInMergeCommit = $mergeTests.Count
  }
  finalTotals      = [pscustomobject][ordered]@{
    finalFiles        = $head.Count
    mFilesMissing     = $finalMissing.Count
    mFilesModified    = $finalModified.Count
    attributed        = $attributed.Count
    unexplained       = $unexplained.Count
    postMergeChanges  = $postMergeChanged.Count
    testFilesInM      = $baseTests.Count
    testFilesAtHead   = $headTests.Count
    testFilesMissing  = @($finalMissing | Where-Object { & $isTest $_ }).Count
  }
  mergeLostMChanges = @($mergeLostMChanges)
  mergeASideUpdates = @($mergeASideUpdates)
  postMergeChanges  = @($postMergeChanged)
  attributedDivergences = @($attributed)
  unexplainedDivergences = @($unexplained)
  protectedTests    = $protectedStatus
}

$target = Join-Path $WorkDir $OutFile
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllText($target, ($report | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))

Write-Output "MERGE VERDICT : $mergeVerdict"
Write-Output "FINAL VERDICT : $finalVerdict"
Write-Output "OVERALL       : $($report.verdict)"
Write-Output ''
Write-Output "merge commit  : $mergeRev"
Write-Output "final head    : $headRev"
Write-Output "fork point    : $forkRev"
Write-Output ''
Write-Output "--- merge commit did ---"
Write-Output ("  M files missing   : {0}" -f $mergeMissing.Count)
Write-Output ("  M files modified  : {0}" -f $mergeModified.Count)
Write-Output ("  M changes LOST    : {0}" -f $mergeLostMChanges.Count)
Write-Output ("  A-side updates    : {0}" -f $mergeASideUpdates.Count)
Write-Output ("  tests: M={0} merge={1} head={2}" -f $baseTests.Count, $mergeTests.Count, $headTests.Count)
Write-Output ''
Write-Output "--- integration phase did after the merge ---"
Write-Output ("  changed paths     : {0}" -f $postMergeChanged.Count)
foreach ($e in $postMergeChanged) { Write-Output ("    {0,-24} {1}" -f $e.kind, $e.path) }
Write-Output ''
Write-Output "--- final HEAD vs M attribution ---"
Write-Output ("  attributed        : {0}" -f $attributed.Count)
Write-Output ("  UNEXPLAINED       : {0}" -f $unexplained.Count)
foreach ($e in $unexplained) { Write-Output ("    !! {0}  <- {1}" -f $e.path, $e.cause) }
Write-Output ''
foreach ($s in $protectedStatus) {
  Write-Output ("  protected {0} present={1} identicalToM={2} identicalInMerge={3}" -f $s.path, $s.presentInMerged, $s.identicalToM, $s.identicalInMergeCommit)
}
foreach ($r in $mergeReasons) { Write-Output "  merge reason: $r" }
foreach ($r in $finalReasons) { Write-Output "  final reason: $r" }
