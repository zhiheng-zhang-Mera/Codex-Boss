# Phase H recon — scan committed + on-disk JSON for the evidence defects named in
# cleanup.md section 11: UTF-8 BOM, malformed/concatenated JSON.
#
# READ-ONLY: reads files, writes one JSON report. Repairs nothing.
param(
  [string]$WorkDir = "D:\Codex-Boss",
  [string]$OutFile = "Update-Plan/Branch-Cleanup/evidence/evidence-cleanup/json-health-scan.json"
)

Set-Location -LiteralPath $WorkDir

$utf8Bom = New-Object System.Text.UTF8Encoding($true)

function Test-HasBom([string]$path) {
  try {
    $fs = [System.IO.File]::OpenRead($path)
    try {
      if ($fs.Length -lt 3) { return $false }
      $b = New-Object byte[] 3
      [void]$fs.Read($b, 0, 3)
      return ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
    } finally { $fs.Dispose() }
  } catch { return $false }
}

function Test-JsonStrict([string]$path) {
  # Strict parse. PowerShell's ConvertFrom-Json is lenient (it accepts trailing
  # commas and duplicate keys), so use JavaScriptSerializer for a verdict closer to
  # JSON.parse. A BOM is stripped first: whether the BOM is *present* is reported
  # separately, and must not by itself masquerade as a parse failure.
  try {
    if (-not ('System.Web.Script.Serialization.JavaScriptSerializer' -as [type])) {
      Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
    }
    $text = [System.IO.File]::ReadAllText($path)
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = [int]::MaxValue
    [void]$ser.DeserializeObject($text)
    return @{ ok = $true; error = $null }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

function Test-JsonBalanced([string]$path) {
  # A second, dependency-free check: after trimming, a valid JSON document must be
  # fully consumed by its first top-level value. Detect trailing content after the
  # closing brace/bracket, which is the signature of concatenated objects.
  try {
    $text = [System.IO.File]::ReadAllText($path)
    $t = $text.Trim()
    if ($t.Length -eq 0) { return @{ ok = $false; error = 'empty file' } }
    $first = $t[0]
    if ($first -ne '{' -and $first -ne '[') { return @{ ok = $true; error = $null } }
    $depth = 0; $inStr = $false; $esc = $false; $endIndex = -1
    for ($i = 0; $i -lt $t.Length; $i++) {
      $c = $t[$i]
      if ($inStr) {
        if ($esc) { $esc = $false }
        elseif ($c -eq '\') { $esc = $true }
        elseif ($c -eq '"') { $inStr = $false }
        continue
      }
      if ($c -eq '"') { $inStr = $true; continue }
      if ($c -eq '{' -or $c -eq '[') { $depth++ }
      elseif ($c -eq '}' -or $c -eq ']') {
        $depth--
        if ($depth -eq 0) { $endIndex = $i; break }
      }
    }
    if ($endIndex -lt 0) { return @{ ok = $false; error = 'unbalanced braces' } }
    $trailing = $t.Substring($endIndex + 1).Trim()
    if ($trailing.Length -gt 0) {
      return @{ ok = $false; error = "trailing content after top-level value: $($trailing.Substring(0, [Math]::Min(40, $trailing.Length)))" }
    }
    return @{ ok = $true; error = $null }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

# Committed JSON only: the cleanup applies to the final integration tree.
$tracked = & git ls-files
$jsonFiles = @($tracked | Where-Object { $_ -match '\.json$' })
$jsonlFiles = @($tracked | Where-Object { $_ -match '\.jsonl$' })

$bom = New-Object System.Collections.ArrayList
$malformed = New-Object System.Collections.ArrayList
$bomAndMalformed = New-Object System.Collections.ArrayList

foreach ($f in $jsonFiles) {
  if (-not (Test-Path -LiteralPath $f)) { continue }
  $hasBom = Test-HasBom $f
  $strict = Test-JsonStrict $f
  $bal = Test-JsonBalanced $f

  $isBad = (-not $strict.ok) -or (-not $bal.ok)
  if ($hasBom) { [void]$bom.Add($f) }
  if ($isBad) {
    $err = if (-not $bal.ok) { $bal.error } else { $strict.error }
    [void]$malformed.Add([pscustomobject]@{ path = $f; error = $err; strictOk = $strict.ok; balancedOk = $bal.ok })
    if ($hasBom) { [void]$bomAndMalformed.Add($f) }
  }
}

# The specific file cleanup.md 11.2 names.
$named = 'Update-Plan/overcomplete/evidence/live/live-finding-qwen-2026-09-09-07-10-04.json'
$namedExists = Test-Path -LiteralPath $named
$namedDetail = $null
if ($namedExists) {
  $namedDetail = [pscustomobject][ordered]@{
    path      = $named
    hasBom    = Test-HasBom $named
    strictOk  = (Test-JsonStrict $named).ok
    balancedOk = (Test-JsonBalanced $named).ok
    error     = (Test-JsonBalanced $named).error
    tracked   = ($tracked -contains $named)
  }
}

$report = [pscustomobject][ordered]@{
  schemaVersion       = 1
  kind                = 'BRANCH_CLEANUP_EVIDENCE_JSON_HEALTH'
  generatedAt         = (Get-Date).ToString('o')
  scannedRevision     = (& git rev-parse HEAD).Trim()
  scope               = 'git-tracked *.json in the integration tree'
  totals              = [pscustomobject][ordered]@{
    jsonFilesScanned  = $jsonFiles.Count
    jsonlFilesScanned = $jsonlFiles.Count
    withBom           = $bom.Count
    malformed         = $malformed.Count
    bomAndMalformed   = $bomAndMalformed.Count
  }
  bomFiles            = @($bom)
  malformedFiles      = @($malformed)
  namedInCleanupMd    = $namedDetail
}

$target = Join-Path $WorkDir $OutFile
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$json = $report | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($target, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Output ("json files scanned : {0}" -f $jsonFiles.Count)
Write-Output ("with UTF-8 BOM     : {0}" -f $bom.Count)
Write-Output ("malformed          : {0}" -f $malformed.Count)
Write-Output ("BOM + malformed    : {0}" -f $bomAndMalformed.Count)
Write-Output ''
Write-Output '--- BOM files ---'
foreach ($f in $bom) { Write-Output "  $f" }
Write-Output ''
Write-Output '--- malformed files ---'
foreach ($m in $malformed) { Write-Output ("  {0}`n      {1}" -f $m.path, $m.error) }
Write-Output ''
Write-Output '--- named in cleanup.md 11.2 ---'
if ($namedDetail) { $namedDetail | ConvertTo-Json -Depth 5 } else { Write-Output "  $named : NOT PRESENT in integration tree" }
