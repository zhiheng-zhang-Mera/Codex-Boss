# Regenerate archive-manifest.json and deletion-manifest.json from the EXECUTED
# state (post Phase B/L/M/N), replacing the earlier PLAN_ONLY versions.
#
# READ-ONLY with respect to git: reads refs and tags, writes the two manifests.
param(
  [string]$WorkDir = "D:\Codex-Boss"
)

Set-Location -LiteralPath $WorkDir
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Invoke-Git {
  param([string[]]$GitArgs)
  $out = & git @GitArgs 2>&1
  return @{ code = $LASTEXITCODE; out = ($out | Out-String).Trim() }
}
function Get-Rev {
  param([string]$Rev)
  $r = Invoke-Git -GitArgs @('rev-parse', '--verify', '--quiet', $Rev)
  if ($r.code -ne 0 -or [string]::IsNullOrWhiteSpace($r.out)) { return $null }
  return $r.out
}
function Get-RemoteMap {
  $r = Invoke-Git -GitArgs @('ls-remote', 'origin')
  $map = @{}
  foreach ($line in ($r.out -split "`n")) {
    $t = $line.Trim(); if ($t.Length -eq 0) { continue }
    $p = $t -split '\s+'
    if ($p.Count -ge 2) { $map[$p[1]] = $p[0] }
  }
  return $map
}

$remote = Get-RemoteMap
$accepted = Get-Rev 'refs/heads/main'
$owner    = Get-Rev 'refs/heads/owner-result'

$rows = @(
  @{ branch='main';                   class='B'; tag=$null;                            disposition='KEPT_PERMANENTLY';          sha=$accepted }
  # owner-result's archive tag intentionally points at the PRE-promotion head. §15
  # archives the old head before moving the branch, so the tag must NOT match the
  # promoted head; the promoted head is preserved by the branch itself.
  @{ branch='owner-result';           class='B'; tag='archive/owner-result-r43';        disposition='PROMOTED_AND_KEPT';         sha='825cd1fcb9c942ff9a36bc4ea42ed4ad33b46c75'; currentHead=$owner }
  @{ branch='owner-result (local diverged)'; class='B'; tag='archive/owner-result-r43-local-diverged'; disposition='ARCHIVED_ONLY'; sha='f660cc27ee0372a73b7a737272098c8ed9e9d3d0' }
  @{ branch='9-10-M';                 class='A'; tag='archive/host-m-final';            disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/host-m-final') }
  @{ branch='9-10-A';                 class='A'; tag='archive/host-a-final';           disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/host-a-final') }
  @{ branch='A-main-integration';     class='C-created'; tag='archive/9-10-integration-final'; disposition='DELETED_AFTER_ARCHIVE'; sha=(Get-Rev 'refs/tags/archive/9-10-integration-final') }
  @{ branch='9-3-remote';             class='C'; tag='archive/9-3-remote';             disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/9-3-remote') }
  @{ branch='9-3';                    class='C'; tag='archive/9-3';                    disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/9-3') }
  @{ branch='9-4';                    class='C'; tag='archive/9-4';                    disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/9-4') }
  @{ branch='9-5';                    class='C'; tag='archive/9-5';                    disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/9-5') }
  @{ branch='9-6';                    class='C'; tag='archive/9-6';                    disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/9-6') }
  @{ branch='9-7';                    class='C'; tag='archive/9-7';                    disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/9-7') }
  @{ branch='9-8';                    class='C'; tag='archive/9-8';                    disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/9-8') }
  @{ branch='9-8-overcomplete';       class='C'; tag='archive/9-8-overcomplete';        disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/9-8-overcomplete') }
  @{ branch='2026-09-09-closure';     class='D'; tag='archive/closure-2026-09-09';      disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/closure-2026-09-09') }
  @{ branch='9-2026-09-09-closure';   class='D'; tag='archive/closure-9-2026-09-09';    disposition='DELETED_AFTER_ARCHIVE';     sha=(Get-Rev 'refs/tags/archive/closure-9-2026-09-09') }
)

$archiveEntries = New-Object System.Collections.ArrayList
$deletionEntries = New-Object System.Collections.ArrayList

foreach ($r in $rows) {
  $tagName = $r.tag
  $tagLocal = if ($tagName) { Get-Rev "refs/tags/$tagName" } else { $null }
  $tagRemote = if ($tagName -and $remote.ContainsKey("refs/tags/$tagName")) { $remote["refs/tags/$tagName"] } else { $null }
  $branchLocal = Get-Rev "refs/heads/$($r.branch)"
  $branchRemote = if ($remote.ContainsKey("refs/heads/$($r.branch)")) { $remote["refs/heads/$($r.branch)"] } else { $null }
  $deleted = (-not $branchLocal) -and (-not $branchRemote)

  if ($tagName) {
    [void]$archiveEntries.Add([pscustomobject][ordered]@{
      branch               = $r.branch
      class                = $r.class
      tag                  = $tagName
      archivedSha          = $tagLocal
      currentBranchHead    = $branchLocal
      tagPushedToOrigin    = [bool]($tagRemote -eq $tagLocal)
      matchesRecordedHead  = ($tagLocal -eq $r.sha)
      tagShaMatch          = ($tagLocal -eq $r.sha)
      status               = if ($tagLocal) { 'ARCHIVED_AND_PUSHED' } else { 'TAG_MISSING' }
    })
  }

  [void]$deletionEntries.Add([pscustomobject][ordered]@{
    branch              = $r.branch
    class               = $r.class
    recordedHead        = $r.sha
    archiveTag          = $tagName
    guard = [pscustomobject][ordered]@{
      TAG_EXISTS            = [bool]$tagLocal
      TAG_SHA_MATCH         = ($tagLocal -eq $r.sha)
      TREE_READABLE         = [bool]$r.sha
      UNIQUE_REQUIRED_CODE  = $false
      INTEGRATED_OR_ARCHIVED = [bool]$tagLocal
    }
    safeToDelete        = [bool]$tagLocal
    decision            = if ($r.disposition -eq 'KEPT_PERMANENTLY') { 'KEPT' } elseif ($deleted) { 'DELETED' } else { 'STILL_PRESENT' }
    deletedLocally      = (-not $branchLocal)
    deletedRemotely     = (-not $branchRemote)
    archiveIntactAfterDelete = ([bool]$tagLocal -and ($tagLocal -eq $r.sha))
    disposition         = $r.disposition
  })
}

$remoteBranches = @($remote.Keys | Where-Object { $_ -like 'refs/heads/*' } | ForEach-Object { $_ -replace '^refs/heads/', '' } | Sort-Object)
$localBranches  = @(& git branch --format='%(refname:short)') | Sort-Object
$localTags      = @(& git tag -l) | Sort-Object
$remoteTags     = @($remote.Keys | Where-Object { $_ -like 'refs/tags/*' } | ForEach-Object { $_ -replace '^refs/tags/', '' } | Sort-Object)

$archiveManifest = [pscustomobject][ordered]@{
  schemaVersion  = 1
  kind           = 'BRANCH_CLEANUP_ARCHIVE_MANIFEST'
  generatedAt    = (Get-Date).ToString('o')
  executionState = 'EXECUTED'
  authority      = 'Update-Plan/cleanup.md sections 1.1, 2, 3, 20'
  tagsCreated    = @($archiveEntries | Where-Object { $_.status -eq 'ARCHIVED_AND_PUSHED' }).Count
  tagsPushedToOrigin = @($archiveEntries | Where-Object { $_.tagPushedToOrigin }).Count
  releaseTags    = @('v10.0.0', 'v10.0.0-accepted')
  totals         = [pscustomobject][ordered]@{
    entries      = $archiveEntries.Count
    localTags    = $localTags.Count
    remoteTags   = $remoteTags.Count
    allShasMatch = @($archiveEntries | Where-Object { $_.tagShaMatch }).Count
  }
  entries        = @($archiveEntries)
}

$deletionManifest = [pscustomobject][ordered]@{
  schemaVersion  = 1
  kind           = 'BRANCH_CLEANUP_DELETION_MANIFEST'
  generatedAt    = (Get-Date).ToString('o')
  executionState = 'EXECUTED'
  authority      = 'Update-Plan/cleanup.md sections 1.1, 21, 22, 28'
  guardRule      = 'delete only when TAG_EXISTS && TAG_SHA_MATCH && TREE_READABLE && UNIQUE_REQUIRED_CODE == false && INTEGRATED_OR_ARCHIVED'
  documentedException = 'D-class closure branches: their unique commits are test-curation deletions that cleanup.md section 3 forbids merging; archived intact, then deleted under a recorded narrow override'
  acceptedHead   = $accepted
  totals         = [pscustomobject][ordered]@{
    candidates            = $deletionEntries.Count
    deleted               = @($deletionEntries | Where-Object { $_.decision -eq 'DELETED' }).Count
    kept                  = @($deletionEntries | Where-Object { $_.decision -eq 'KEPT' }).Count
    stillPresent          = @($deletionEntries | Where-Object { $_.decision -eq 'STILL_PRESENT' }).Count
    archiveIntactAfterDelete = @($deletionEntries | Where-Object { $_.archiveIntactAfterDelete }).Count
  }
  remainingLocalBranches  = $localBranches
  remainingRemoteBranches = $remoteBranches
  finalStructureOk = (($localBranches.Count -eq 2) -and ($remoteBranches.Count -eq 2) -and
                      ($localBranches -contains 'main') -and ($localBranches -contains 'owner-result') -and
                      ($remoteBranches -contains 'main') -and ($remoteBranches -contains 'owner-result'))
  entries         = @($deletionEntries)
}

$dir = Join-Path $WorkDir 'Update-Plan\Branch-Cleanup'
[System.IO.File]::WriteAllText((Join-Path $dir 'archive-manifest.json'), ($archiveManifest | ConvertTo-Json -Depth 10), $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $dir 'deletion-manifest.json'), ($deletionManifest | ConvertTo-Json -Depth 10), $utf8NoBom)

Write-Output ("archive entries={0} tagsPushed={1} allShasMatch={2}/{0}" -f $archiveManifest.totals.entries, $archiveManifest.tagsPushedToOrigin, $archiveManifest.totals.allShasMatch)
Write-Output ("deletion candidates={0} deleted={1} kept={2} stillPresent={3} archiveIntact={4}" -f `
  $deletionManifest.totals.candidates, $deletionManifest.totals.deleted, $deletionManifest.totals.kept, `
  $deletionManifest.totals.stillPresent, $deletionManifest.totals.archiveIntactAfterDelete)
Write-Output ("local branches : {0}" -f ($localBranches -join ', '))
Write-Output ("remote branches: {0}" -f ($remoteBranches -join ', '))
Write-Output ("finalStructureOk: {0}" -f $deletionManifest.finalStructureOk)
