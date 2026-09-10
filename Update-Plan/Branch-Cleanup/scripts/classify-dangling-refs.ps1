# Phase H3 — classify dangling references with an evidence-file index.
#
# The Host-M inspector resolves a citation against three anchors. Real citations in
# this plan resolve against a fourth kind of anchor: the citation is relative to a
# *program* evidence directory (e.g. a manifest under Update-Plan/10-x writes
# "evidence/10A/10A-architecture.json", which lives at
# Update-Plan/10-x/evidence/10A/10A-architecture.json). Those are not broken; the
# inspector simply has no anchor that reaches them.
#
# This script indexes every evidence-ish file in the tree and then classifies each
# reported dangling reference by longest-suffix match, so a citation is only called
# broken when no file in the repository ends with that path.
#
# READ-ONLY: writes one JSON report.
param(
  [string]$WorkDir = "D:\Codex-Boss",
  [string]$InspectorJson = "Update-Plan/Branch-Cleanup/evidence/evidence-cleanup/host-evidence-inspector.json",
  [string]$OutFile = "Update-Plan/Branch-Cleanup/evidence/evidence-cleanup/dangling-reference-classification.json"
)

Set-Location -LiteralPath $WorkDir
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$inspector = Get-Content $InspectorJson -Raw | ConvertFrom-Json
$all = @($inspector.issues | Where-Object { $_.kind -eq 'dangling' })

# --- index every tracked file by its normalized path ---------------------------
$tracked = @(& git ls-files)
$index = @{}          # normalized path (lowercase, forward slashes) -> real path
foreach ($f in $tracked) {
  $n = $f -replace '\\', '/'
  $index[$n.ToLower()] = $n
}

function Resolve-BySuffix([string]$ref) {
  if ([string]::IsNullOrWhiteSpace($ref)) { return $null }
  $r = ($ref -replace '\\', '/').TrimStart('/').ToLower()
  if ($r.Length -eq 0) { return $null }

  # Exact match first.
  if ($index.ContainsKey($r)) { return $index[$r] }

  # Longest-suffix match: the deepest path segment sequence that matches a real
  # file's trailing segments. Require at least two segments so a bare filename
  # cannot mask a genuinely missing artifact.
  $parts = $r -split '/'
  for ($start = 0; $start -lt ($parts.Count - 1); $start++) {
    $suffix = ($parts[$start..($parts.Count - 1)] -join '/')
    if (($suffix -split '/').Count -lt 2) { break }
    if ($index.ContainsKey($suffix)) { return $index[$suffix] }
    foreach ($k in $index.Keys) {
      if ($k.EndsWith("/$suffix")) { return $index[$k] }
    }
  }
  return $null
}

# --- does any tracked document cite the reference? ----------------------------
$textFiles = @($tracked | Where-Object { $_ -match '\.(md|json|jsonl|txt|mjs|cjs|ts|tsx|ps1)$' })
$citationCache = @{}

function Get-Citers([string]$ref) {
  if ([string]::IsNullOrWhiteSpace($ref)) { return @() }
  $base = Split-Path $ref -Leaf
  if ($citationCache.ContainsKey($base)) { return $citationCache[$base] }
  $found = @()
  foreach ($f in $textFiles) {
    $hit = Select-String -LiteralPath $f -SimpleMatch -Pattern $base -ErrorAction SilentlyContinue
    if ($hit) { $found += $f }
  }
  $citationCache[$base] = $found
  return $found
}

$entries = New-Object System.Collections.ArrayList
foreach ($issue in $all) {
  $detail = "$($issue.detail)"
  $ref = $null
  if ($detail -match '^references (.+?), which resolves') { $ref = $Matches[1] }
  elseif ($issue.path) { $ref = "$($issue.path)" }

  $resolved = Resolve-BySuffix $ref
  $citers = Get-Citers $ref

  $category = $null
  $rationale = $null

  $isGenerated = ($ref -match '__seeded_')

  if ($isGenerated) {
    $category = 'generated-runtime'
    $rationale = 'the seeded acceptance creates this file inside its own clone/workspace; absence from this checkout is by design'
  } elseif ($resolved) {
    $category = 'historical-only'
    $rationale = "the referenced artifact exists in this tree as '$resolved'; the citation is a historical record resolved by suffix rather than by the inspector's anchors"
  } else {
    $category = 'real broken ref'
    if ($citers.Count -gt 0) {
      $rationale = 'no file in this tree ends with this path, and tracked documents still cite it'
    } else {
      $rationale = 'no file in this tree ends with this path, but no tracked document cites it either (the inspector reports a reference that no longer has a live citation)'
    }
  }

  [void]$entries.Add([pscustomobject][ordered]@{
    referencedPath = $ref
    resolvedAs     = $resolved
    category       = $category
    rationale      = $rationale
    citedBy        = @($citers | Select-Object -First 8)
    citationCount  = $citers.Count
  })
}

$broken = @($entries | Where-Object { $_.category -eq 'real broken ref' })
$brokenWithCiters = @($broken | Where-Object { $_.citationCount -gt 0 })

$report = [pscustomobject][ordered]@{
  schemaVersion = 1
  kind          = 'BRANCH_CLEANUP_DANGLING_REFERENCE_CLASSIFICATION'
  generatedAt   = (Get-Date).ToString('o')
  revision      = (& git rev-parse HEAD).Trim()
  authority     = 'Update-Plan/cleanup.md section 11.3'
  method        = 'longest-suffix match against every git-tracked path, plus a citation search for each unresolved leaf filename'
  totals        = [pscustomobject][ordered]@{
    danglingReported   = $entries.Count
    generatedRuntime   = @($entries | Where-Object { $_.category -eq 'generated-runtime' }).Count
    historicalOnly     = @($entries | Where-Object { $_.category -eq 'historical-only' }).Count
    realBrokenRefs     = $broken.Count
    realBrokenCited    = $brokenWithCiters.Count
    realBrokenUncited  = ($broken.Count - $brokenWithCiters.Count)
  }
  realBrokenRefs = @($broken | ForEach-Object {
    [pscustomobject][ordered]@{
      referencedPath = $_.referencedPath
      citationCount  = $_.citationCount
      citedBy        = $_.citedBy
    }
  })
  allEntries = @($entries)
}

$target = Join-Path $WorkDir $OutFile
[System.IO.File]::WriteAllText($target, ($report | ConvertTo-Json -Depth 12), $utf8NoBom)

Write-Output ("dangling reported : {0}" -f $report.totals.danglingReported)
Write-Output ("generated-runtime : {0}" -f $report.totals.generatedRuntime)
Write-Output ("historical-only   : {0}" -f $report.totals.historicalOnly)
Write-Output ("REAL BROKEN REFS  : {0}  (cited: {1}, uncited: {2})" -f $report.totals.realBrokenRefs, $report.totals.realBrokenCited, $report.totals.realBrokenUncited)
Write-Output ''
Write-Output '--- real broken references that documents still cite ---'
foreach ($b in $brokenWithCiters) {
  Write-Output ("  {0}   (cited by {1} doc(s))" -f $b.referencedPath, $b.citationCount)
  foreach ($c in $b.citedBy) { Write-Output ("        $c") }
}
Write-Output ''
Write-Output '--- real broken references with no live citation ---'
$uncited = @($broken | Where-Object { $_.citationCount -eq 0 })
if ($uncited.Count -gt 0) {
  $uncited | ForEach-Object { Write-Output ("  {0}" -f $_.referencedPath) }
} else {
  Write-Output '  none'
}
