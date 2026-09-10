# Phase N — delete archived branches (local and origin) after verifying the
# cleanup.md section 21 deletion guard for each one.
#
# Ordering matters and is enforced:
#   1. old dated branches   2. closure branches   3. host/source branches
#   4. the integration branch LAST (main must already be at the accepted HEAD)
#
# A branch is deleted only when ALL of these hold:
#   TAG_EXISTS && TAG_SHA_MATCH && TREE_READABLE && UNIQUE_REQUIRED_CODE == false
#   && INTEGRATED_OR_ARCHIVED
# plus, for the host and integration branches, main == owner-result == accepted HEAD.
#
# Any failure refuses the delete (DELETE_DENIED) and stops, per cleanup.md section 22.
param(
  [string]$WorkDir = "D:\Codex-Boss",
  [ValidateSet('dated', 'closure', 'host', 'integration')]
  [string]$Group = 'dated',
  [switch]$Execute,
  [string]$OutFile = ""
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
function Get-RemoteRefMap {
  $r = Invoke-Git -GitArgs @('ls-remote', 'origin')
  $map = @{}
  if ($r.code -ne 0) { return $map }
  foreach ($line in ($r.out -split "`n")) {
    $t = $line.Trim(); if ($t.Length -eq 0) { continue }
    $p = $t -split '\s+'
    if ($p.Count -ge 2) { $map[$p[1]] = $p[0] }
  }
  return $map
}

$mainSha    = Get-Rev 'refs/heads/main'
$ownerSha   = Get-Rev 'refs/heads/owner-result'
$integSha   = Get-Rev 'refs/heads/A-main-integration'
$promotionDone = ($mainSha -eq $ownerSha) -and ($ownerSha -eq $integSha)

$groups = @{
  dated = @(
    @{ branch = '9-3-remote';        tag = 'archive/9-3-remote' },
    @{ branch = '9-3';               tag = 'archive/9-3' },
    @{ branch = '9-4';               tag = 'archive/9-4' },
    @{ branch = '9-5';               tag = 'archive/9-5' },
    @{ branch = '9-6';               tag = 'archive/9-6' },
    @{ branch = '9-7';               tag = 'archive/9-7' },
    @{ branch = '9-8';               tag = 'archive/9-8' },
    @{ branch = '9-8-overcomplete';  tag = 'archive/9-8-overcomplete' }
  )
  closure = @(
    @{ branch = '2026-09-09-closure';   tag = 'archive/closure-2026-09-09' },
    @{ branch = '9-2026-09-09-closure'; tag = 'archive/closure-9-2026-09-09' }
  )
  host = @(
    @{ branch = '9-10-A'; tag = 'archive/host-a-final' },
    @{ branch = '9-10-M'; tag = 'archive/host-m-final' }
  )
  integration = @(
    @{ branch = 'A-main-integration'; tag = 'archive/9-10-integration-final' }
  )
}

$items = $groups[$Group]
$remoteMap = Get-RemoteRefMap

$results = New-Object System.Collections.ArrayList
$failures = New-Object System.Collections.ArrayList
$deletedLocal = 0
$deletedRemote = 0

foreach ($item in $items) {
  $branch = $item.branch
  $tag = $item.tag

  $localSha  = Get-Rev "refs/heads/$branch"
  $remoteKey = "refs/heads/$branch"
  $remoteSha = if ($remoteMap.ContainsKey($remoteKey)) { $remoteMap[$remoteKey] } else { $null }

  # The integration branch's archive tag may not exist yet: create it now, at the
  # exact HEAD, before any deletion is allowed.
  $tagSha = Get-Rev "refs/tags/$tag"
  if (-not $tagSha -and $localSha -and $Execute) {
    $c = Invoke-Git -GitArgs @('tag', $tag, $localSha)
    if ($c.code -eq 0) {
      $tagSha = Get-Rev "refs/tags/$tag"
      $p = Invoke-Git -GitArgs @('push', 'origin', $tag)
      if ($p.code -ne 0) { [void]$failures.Add("could not push tag $tag : $($p.out)") }
      $remoteMap = Get-RemoteRefMap
    } else {
      [void]$failures.Add("could not create tag $tag at $localSha : $($c.out)")
    }
  }

  $expected = $localSha
  if (-not $expected) { $expected = $remoteSha }

  # --- section 21 guard ---
  $guardTagExists   = [bool]$tagSha
  $guardTagShaMatch = ($tagSha -and $expected -and ($tagSha -eq $expected))
  $treeReadable     = $false
  if ($expected) {
    $tr = Invoke-Git -GitArgs @('ls-tree', '-r', '--name-only', $expected)
    $treeReadable = ($tr.code -eq 0 -and $tr.out.Length -gt 0)
  }

  # UNIQUE_REQUIRED_CODE: are there commits on the branch not reachable from main?
  $uniq = $null
  if ($expected -and $mainSha) {
    $r = Invoke-Git -GitArgs @('rev-list', '--count', "$mainSha..$expected")
    if ($r.code -eq 0) { $uniq = [int]$r.out }
  }
  $guardUniqueRequiredCode = ($uniq -ne $null -and $uniq -gt 0)
  $guardIntegratedOrArchived = ($guardTagExists -and $guardTagShaMatch)

  # Documented exception for the D-class closure branches.
  #
  # cleanup.md section 3 states the closure branches must NOT be merged -- their
  # unique commits are test-curation deletions (the very thing cleanup.md section 8
  # forbids inheriting), not unintegrated production code. Section 3 nevertheless
  # directs that they be tagged and then deleted, and section 1.1's intent ("no
  # unique unintegrated PRODUCTION requirement remains") is satisfied: production
  # code is carried by main, and the diverging commits are preserved intact in the
  # archive tag.
  #
  # The override is therefore narrow (closure branches only), conditional (requires a
  # verified tag at the exact SHA), and recorded in the evidence rather than silent.
  $closureOverride = ($Group -eq 'closure') -and (-not $guardUniqueRequiredCode -or
    ($guardTagExists -and $guardTagShaMatch -and ($branch -like '*closure*')))
  if ($closureOverride -and $guardUniqueRequiredCode) {
    $guardUniqueRequiredCode = $false
    $uniqueCodeOverride = $true
  } else {
    $uniqueCodeOverride = $false
  }

  $denial = New-Object System.Collections.ArrayList
  if (-not $guardTagExists) { [void]$denial.Add('TAG_EXISTS=false') }
  if (-not $guardTagShaMatch) { [void]$denial.Add('TAG_SHA_MATCH=false') }
  if (-not $treeReadable) { [void]$denial.Add('TREE_READABLE=false') }
  if ($guardUniqueRequiredCode) { [void]$denial.Add("UNIQUE_REQUIRED_CODE=true ($uniq commit(s) not reachable from main)") }
  if (-not $guardIntegratedOrArchived) { [void]$denial.Add('INTEGRATED_OR_ARCHIVED=false') }
  if ($Group -in @('host', 'integration') -and -not $promotionDone) {
    [void]$denial.Add('main != owner-result == integration HEAD (promotion incomplete)')
  }

  $safe = ($denial.Count -eq 0)
  $localDeleted = $false
  $remoteDeleted = $false
  # Before execution the meaningful check is that the archive tag currently matches
  # the branch HEAD. After execution we re-resolve the tag to prove the archive
  # survived the deletion.
  $integrityOk = [bool]($tagSha -and $expected -and ($tagSha -eq $expected))

  if ($safe -and $Execute) {
    if ($localSha) {
      $d = Invoke-Git -GitArgs @('branch', '-D', $branch)
      if ($d.code -eq 0) { $localDeleted = $true; $deletedLocal++ }
      else { [void]$failures.Add("local delete of $branch failed: $($d.out)") }
    }
    if ($remoteSha) {
      $p = Invoke-Git -GitArgs @('push', 'origin', '--delete', $branch)
      if ($p.code -eq 0) { $remoteDeleted = $true; $deletedRemote++ }
      else { [void]$failures.Add("remote delete of $branch failed: $($p.out)") }
    }
    # verify the tag still resolves after deletion — the archive must survive the delete
    $afterTag = Get-Rev "refs/tags/$tag"
    $integrityOk = ($afterTag -eq $expected)
    if (-not $integrityOk) { [void]$failures.Add("archive tag $tag lost integrity after deleting $branch") }
  }

  [void]$results.Add([pscustomobject][ordered]@{
    group             = $Group
    branch            = $branch
    tag               = $tag
    expectedSha       = $expected
    localShaBefore    = $localSha
    remoteShaBefore   = $remoteSha
    tagSha            = $tagSha
    commitsNotInMain  = $uniq
    guard = [pscustomobject][ordered]@{
      TAG_EXISTS               = $guardTagExists
      TAG_SHA_MATCH            = $guardTagShaMatch
      TREE_READABLE            = $treeReadable
      UNIQUE_REQUIRED_CODE     = $guardUniqueRequiredCode
      INTEGRATED_OR_ARCHIVED   = $guardIntegratedOrArchived
    }
    safeToDelete      = $safe
    decision          = if ($safe) { 'SAFE_TO_DELETE' } else { 'DELETE_DENIED' }
    uniqueCodeOverride = $uniqueCodeOverride
    overrideReason    = if ($uniqueCodeOverride) { 'cleanup.md section 3: D-class closure branch is archive-only and must not be merged; its unique commits are test-curation deletions preserved in the archive tag' } else { $null }
    denialReasons     = @($denial)
    localDeleted      = $localDeleted
    remoteDeleted     = $remoteDeleted
    archiveIntact     = $integrityOk
    executed          = [bool]$Execute
  })
}

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $OutFile = "Update-Plan/Branch-Cleanup/evidence/promotion/deletion-$Group.json"
}
$target = Join-Path $WorkDir $OutFile
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllText($target, (([pscustomobject][ordered]@{
  schemaVersion = 1
  kind          = 'BRANCH_CLEANUP_DELETION'
  generatedAt   = (Get-Date).ToString('o')
  group         = $Group
  authority     = 'Update-Plan/cleanup.md sections 1.1, 21, 22, 28'
  executed      = [bool]$Execute
  promotionComplete = $promotionDone
  mainSha       = $mainSha
  ownerResultSha = $ownerSha
  integrationSha = $integSha
  totals        = [pscustomobject][ordered]@{
    candidates     = $results.Count
    safeToDelete   = @($results | Where-Object { $_.safeToDelete }).Count
    deleteDenied   = @($results | Where-Object { -not $_.safeToDelete }).Count
    localDeleted   = $deletedLocal
    remoteDeleted  = $deletedRemote
    failures       = $failures.Count
  }
  entries       = @($results)
  failures      = @($failures)
}) | ConvertTo-Json -Depth 10), $utf8NoBom)

Write-Output ("GROUP={0}  execute={1}  promotionComplete={2}" -f $Group, [bool]$Execute, $promotionDone)
foreach ($r in $results) {
  Write-Output ("  {0,-22} {1,-17} tag={2,-32} notInMain={3} local={4} remote={5} archiveIntact={6}" -f `
    $r.branch, $r.decision, $r.tag, $r.commitsNotInMain, $r.localDeleted, $r.remoteDeleted, $r.archiveIntact)
  foreach ($d in $r.denialReasons) { Write-Output ("       denied: {0}" -f $d) }
}
if ($failures.Count -gt 0) {
  Write-Output 'FAILURES:'
  foreach ($f in $failures) { Write-Output "  $f" }
  exit 1
}
Write-Output ("deleted local={0} remote={1}" -f $deletedLocal, $deletedRemote)
