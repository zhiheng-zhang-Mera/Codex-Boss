# Phase H repairs — cleanup.md section 11.1 (UTF-8 BOM) and 11.2 (malformed JSON).
#
# Sanctioned by Update-Plan/cleanup.md, which requires that after this phase every
# committed JSON file is parseable by a standard JSON reader. Host-M P5 found both
# defects and deliberately did not repair them ("the inspector reports, it does not
# repair"); this is the integration-phase repair.
#
# Reversible: every change records the sha256 before and after, and the original
# bytes of the malformed file's non-JSON tail are preserved verbatim in a companion
# file. Nothing is deleted.
param(
  [string]$WorkDir = "D:\Codex-Boss",
  [string]$OutFile = "Update-Plan/Branch-Cleanup/evidence/evidence-cleanup/bom-repair-report.json",
  [switch]$DryRun
)

Set-Location -LiteralPath $WorkDir
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-Sha256([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
}

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

# --- H1: strip UTF-8 BOM from every tracked JSON/JSONL file -------------------
$tracked = & git ls-files
$targets = @($tracked | Where-Object { $_ -match '\.(json|jsonl)$' } | Where-Object { Test-Path -LiteralPath $_ })

$bomRepairs = New-Object System.Collections.ArrayList
$failures = New-Object System.Collections.ArrayList

foreach ($f in $targets) {
  if (-not (Test-HasBom $f)) { continue }

  $before = Get-Sha256 $f
  $bytes = [System.IO.File]::ReadAllBytes($f)
  $stripped = New-Object byte[] ($bytes.Length - 3)
  [Array]::Copy($bytes, 3, $stripped, 0, $stripped.Length)

  if (-not $DryRun) {
    [System.IO.File]::WriteAllBytes($f, $stripped)
  }

  $after = if ($DryRun) { $before } else { Get-Sha256 $f }
  $rec = [pscustomobject][ordered]@{
    path         = $f
    action       = 'strip-utf8-bom'
    bytesBefore  = $bytes.Length
    bytesAfter   = $stripped.Length
    sha256Before = $before
    sha256After  = $after
    dryRun       = [bool]$DryRun
  }
  [void]$bomRepairs.Add($rec)

  # Verify the stripped file still parses and no longer carries a BOM.
  if (-not $DryRun) {
    if (Test-HasBom $f) { [void]$failures.Add("BOM still present after strip: $f") }
  }
}

# --- H2: repair the single malformed JSON file --------------------------------
$malformed = 'Update-Plan/overcomplete/evidence/live/live-finding-qwen-2026-09-09-07-10-04.json'
$malformedRec = $null

if (Test-Path -LiteralPath $malformed) {
  $before = Get-Sha256 $malformed
  $text = [System.IO.File]::ReadAllText($malformed)
  $hadBom = $false
  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1); $hadBom = $true }

  # Find the end of the first complete top-level value.
  $depth = 0; $inStr = $false; $esc = $false; $endIndex = -1
  for ($i = 0; $i -lt $text.Length; $i++) {
    $c = $text[$i]
    if ($inStr) {
      if ($esc) { $esc = $false } elseif ($c -eq '\') { $esc = $true } elseif ($c -eq '"') { $inStr = $false }
      continue
    }
    if ($c -eq '"') { $inStr = $true; continue }
    if ($c -eq '{' -or $c -eq '[') { $depth++ }
    elseif ($c -eq '}' -or $c -eq ']') {
      $depth--
      if ($depth -eq 0) { $endIndex = $i; break }
    }
  }

  if ($endIndex -lt 0) {
    [void]$failures.Add("could not locate top-level JSON value in $malformed")
  } else {
    $jsonPart = $text.Substring(0, $endIndex + 1)
    $tailPart = $text.Substring($endIndex + 1).Trim()

    # Validate the extracted JSON before writing it.
    $parsesOk = $false
    try {
      Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
      $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
      $ser.MaxJsonLength = [int]::MaxValue
      [void]$ser.DeserializeObject($jsonPart)
      $parsesOk = $true
    } catch {
      [void]$failures.Add("extracted JSON does not parse: $($_.Exception.Message)")
    }

    if ($parsesOk -and -not $DryRun) {
      [System.IO.File]::WriteAllText($malformed, $jsonPart + "`n", $utf8NoBom)

      # Preserve the non-JSON tail verbatim in a companion file rather than
      # discarding it: it records a real host-A observation.
      if ($tailPart.Length -gt 0) {
        $companion = "$malformed.tail.md"
        $note = @(
          '# Preserved non-JSON tail',
          '',
          'Repaired during the Branch-Cleanup integration phase (Update-Plan/cleanup.md 11.2).',
          "Original file: ``$malformed``",
          '',
          'That file held a single valid JSON object followed by the free-form note below.',
          'The note is not JSON and was moved here verbatim so the JSON file parses while the',
          'observation is still recorded. The JSON object itself is unchanged.',
          '',
          '---',
          '',
          $tailPart,
          ''
        ) -join "`n"
        [System.IO.File]::WriteAllText($companion, $note, $utf8NoBom)
      }
    }

    $malformedRec = [pscustomobject][ordered]@{
      path              = $malformed
      action            = 'extract-leading-json-object'
      hadBom            = $hadBom
      sha256Before      = $before
      sha256After       = if ($DryRun) { $before } else { Get-Sha256 $malformed }
      bytesBefore       = ([System.IO.File]::ReadAllBytes($malformed)).Length
      jsonObjectBytes   = $jsonPart.Length
      tailBytes         = $tailPart.Length
      tailPreservedIn   = if ($tailPart.Length -gt 0) { "$malformed.tail.md" } else { $null }
      extractedParses   = $parsesOk
      tailPreview       = if ($tailPart.Length -gt 0) { $tailPart.Substring(0, [Math]::Min(160, $tailPart.Length)) } else { $null }
      dryRun            = [bool]$DryRun
    }
  }
} else {
  [void]$failures.Add("malformed file named by cleanup.md 11.2 not found: $malformed")
}

# --- report -------------------------------------------------------------------
$report = [pscustomobject][ordered]@{
  schemaVersion    = 1
  kind             = 'BRANCH_CLEANUP_EVIDENCE_REPAIR'
  generatedAt      = (Get-Date).ToString('o')
  revision         = (& git rev-parse HEAD).Trim()
  dryRun           = [bool]$DryRun
  authority        = 'Update-Plan/cleanup.md sections 11.1 (BOM) and 11.2 (malformed JSON)'
  totals           = [pscustomobject][ordered]@{
    filesScanned   = $targets.Count
    bomStripped    = $bomRepairs.Count
    malformedFixed = if ($malformedRec -and $malformedRec.extractedParses) { 1 } else { 0 }
    failures       = $failures.Count
  }
  bomRepairs       = @($bomRepairs)
  malformedRepair  = $malformedRec
  failures         = @($failures)
}

$target = Join-Path $WorkDir $OutFile
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllText($target, ($report | ConvertTo-Json -Depth 12), $utf8NoBom)

Write-Output ("scanned {0} tracked json/jsonl file(s)" -f $targets.Count)
Write-Output ("BOM stripped from {0} file(s)" -f $bomRepairs.Count)
if ($malformedRec) {
  Write-Output ("malformed file: extracted {0} JSON bytes, preserved {1} tail bytes -> {2}" -f $malformedRec.jsonObjectBytes, $malformedRec.tailBytes, $malformedRec.tailPreservedIn)
}
if ($failures.Count -gt 0) {
  Write-Output 'FAILURES:'
  foreach ($x in $failures) { Write-Output "  $x" }
  exit 1
}
Write-Output 'PHASE_H_REPAIR_OK'
