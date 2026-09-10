# Phase B — create, verify and push archive tags for every branch scheduled for
# deletion, so that no branch is deleted without its HEAD preserved.
#
# Runs BEFORE any promotion or deletion and never touches a branch ref: it only
# creates tags, which is exactly what cleanup.md section 1.1 requires before a
# branch may be deleted.
#
# Idempotent. Re-running skips tags already at the correct SHA and fails loudly if a
# tag exists at the WRONG SHA. Network access is batched into one `ls-remote` call.
param(
  [string]$WorkDir = "D:\Codex-Boss",
  [switch]$Push,
  [string]$OutFile = "Update-Plan/Branch-Cleanup/evidence/promotion/archive-tags-report.json"
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
  # One network call for every remote ref we care about.
  $r = Invoke-Git -GitArgs @('ls-remote', 'origin')
  $map = @{}
  if ($r.code -ne 0) { return $map }
  foreach ($line in ($r.out -split "`n")) {
    $t = $line.Trim()
    if ($t.Length -eq 0) { continue }
    $parts = $t -split '\s+'
    if ($parts.Count -ge 2) { $map[$parts[1]] = $parts[0] }
  }
  return $map
}

$plan = @(
  @{ tag = 'archive/9-3-remote';           branch = '9-3-remote';           class = 'C' },
  @{ tag = 'archive/9-3';                  branch = '9-3';                  class = 'C' },
  @{ tag = 'archive/9-4';                  branch = '9-4';                  class = 'C' },
  @{ tag = 'archive/9-5';                  branch = '9-5';                  class = 'C' },
  @{ tag = 'archive/9-6';                  branch = '9-6';                  class = 'C' },
  @{ tag = 'archive/9-7';                  branch = '9-7';                  class = 'C' },
  @{ tag = 'archive/9-8';                  branch = '9-8';                  class = 'C' },
  @{ tag = 'archive/9-8-overcomplete';     branch = '9-8-overcomplete';     class = 'C' },
  @{ tag = 'archive/closure-2026-09-09';   branch = '2026-09-09-closure';   class = 'D' },
  @{ tag = 'archive/closure-9-2026-09-09'; branch = '9-2026-09-09-closure'; class = 'D' },
  @{ tag = 'archive/host-a-final';         branch = '9-10-A';               class = 'A' },
  @{ tag = 'archive/host-m-final';         branch = '9-10-M';               class = 'A' }
)

$forkLocal  = Get-Rev 'refs/heads/owner-result'
$forkRemote = Get-Rev 'refs/remotes/origin/owner-result'

# The owner-result fork tags are resolved explicitly, because the local branch and
# origin point at different commits and neither may be silently dropped.
$plan += @{ tag = 'archive/owner-result-r43'; branch = $null; class = 'B-fork'; literalSha = $forkRemote; note = 'published r43 head (origin/owner-result)' }
$plan += @{ tag = 'archive/owner-result-r43-local-diverged'; branch = $null; class = 'B-fork'; literalSha = $forkLocal; note = 'unpublished local head (refs/heads/owner-result)' }

$results = New-Object System.Collections.ArrayList
$failures = New-Object System.Collections.ArrayList
$created = 0
$alreadyOk = 0

foreach ($item in $plan) {
  $tag = $item.tag
  $sha = $null
  $source = $null

  if ($item.branch) {
    $source = "refs/heads/$($item.branch)"
    $sha = Get-Rev $source
    if (-not $sha) { $source = "refs/remotes/origin/$($item.branch)"; $sha = Get-Rev $source }
  } elseif ($item.literalSha) {
    $sha = $item.literalSha
    $source = 'explicit pre-flight SHA'
  }

  if (-not $sha) {
    [void]$failures.Add("could not resolve a SHA for $tag")
    continue
  }

  $existing = Get-Rev "refs/tags/$tag"
  $action = $null

  if ($existing) {
    if ($existing -eq $sha) { $action = 'ALREADY_PRESENT_OK'; $alreadyOk++ }
    else {
      [void]$failures.Add("tag $tag exists at $existing but must be $sha")
      $action = 'CONFLICT_WRONG_SHA'
    }
  } else {
    $c = Invoke-Git -GitArgs @('tag', $tag, $sha)
    if ($c.code -ne 0) {
      [void]$failures.Add("git tag $tag $sha failed: $($c.out)")
      continue
    }
    $action = 'CREATED'; $created++
  }

  $localTagSha = Get-Rev "refs/tags/$tag"
  $tr = Invoke-Git -GitArgs @('ls-tree', '-r', '--name-only', $sha)

  [void]$results.Add([pscustomobject][ordered]@{
    tag          = $tag
    class        = $item.class
    source       = $source
    expectedSha  = $sha
    localTagSha  = $localTagSha
    tagShaMatch  = ($localTagSha -eq $sha)
    treeReadable = ($tr.code -eq 0 -and $tr.out.Length -gt 0)
    remoteSha    = $null
    remoteMatch  = $false
    action       = $action
    note         = $item.note
  })
}

# --- push ---------------------------------------------------------------------
$pushOut = $null
if ($Push) {
  $tagNames = @($results | Where-Object { $_.action -ne 'CONFLICT_WRONG_SHA' } | ForEach-Object { $_.tag })
  if ($tagNames.Count -gt 0) {
    $p = Invoke-Git -GitArgs (@('push', 'origin') + $tagNames)
    $pushOut = $p.out
    if ($p.code -ne 0) { [void]$failures.Add("git push origin <tags> failed: $($p.out)") }
  }
}

# --- verify against origin (single ls-remote) ---------------------------------
$remoteMap = Get-RemoteRefMap
foreach ($r in $results) {
  $key = "refs/tags/$($r.tag)"
  if ($remoteMap.ContainsKey($key)) { $r.remoteSha = $remoteMap[$key] }
  $r.remoteMatch = ($r.remoteSha -eq $r.expectedSha)
  if ($Push -and -not $r.remoteMatch) {
    [void]$failures.Add("remote tag $($r.tag) does not match expected $($r.expectedSha) (got $($r.remoteSha))")
  }
}

$report = [pscustomobject][ordered]@{
  schemaVersion = 1
  kind          = 'BRANCH_CLEANUP_ARCHIVE_TAGS'
  generatedAt   = (Get-Date).ToString('o')
  authority     = 'Update-Plan/cleanup.md sections 1.1, 20, 21'
  pushed        = [bool]$Push
  fork          = [pscustomobject][ordered]@{
    localOwnerResult  = $forkLocal
    remoteOwnerResult = $forkRemote
    diverged          = ($forkLocal -ne $forkRemote)
  }
  totals        = [pscustomobject][ordered]@{
    planned     = $results.Count
    created     = $created
    alreadyOk   = $alreadyOk
    tagShaMatch = @($results | Where-Object { $_.tagShaMatch }).Count
    remoteMatch = @($results | Where-Object { $_.remoteMatch }).Count
    failures    = $failures.Count
  }
  pushOutput    = $pushOut
  tags          = @($results)
  failures      = @($failures)
}

$target = Join-Path $WorkDir $OutFile
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllText($target, ($report | ConvertTo-Json -Depth 10), $utf8NoBom)

Write-Output ("owner-result fork: local={0} remote={1} diverged={2}" -f $forkLocal, $forkRemote, ($forkLocal -ne $forkRemote))
Write-Output ("planned={0} created={1} alreadyOK={2} tagShaMatch={3} remoteMatch={4} failures={5}" -f $results.Count, $created, $alreadyOk, $report.totals.tagShaMatch, $report.totals.remoteMatch, $failures.Count)
Write-Output ''
foreach ($r in $results) {
  Write-Output ("  {0,-42} {1,-19} sha={2} local={3} remote={4}" -f $r.tag, $r.action, ($r.expectedSha.Substring(0,12)), $r.tagShaMatch, $r.remoteMatch)
}
if ($failures.Count -gt 0) {
  Write-Output ''
  Write-Output 'FAILURES:'
  foreach ($f in $failures) { Write-Output "  $f" }
  exit 1
}
Write-Output 'PHASE_B_TAGS_OK'
