param([switch]$Apply)
$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$roots = @((Join-Path $env:LOCALAPPDATA "CodexBoss"), (Join-Path $env:APPDATA "codex-boss"))
$cacheNames = @("Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "GraphiteDawnCache", "ShaderCache", "CacheStorage", "ScriptCache")
$targets = @()
foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $root = [IO.Path]::GetFullPath($root)
    if ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked legacy root: $root" }
    foreach ($entry in (Get-ChildItem -LiteralPath $root -Directory -Recurse -Force)) {
        if ($entry.Name -notin $cacheNames) { continue }
        $full = [IO.Path]::GetFullPath($entry.FullName)
        if (-not $full.StartsWith($root + "\", [StringComparison]::OrdinalIgnoreCase)) { throw "Out-of-scope path: $full" }
        $ancestor = $entry
        while ($ancestor -and $ancestor.FullName.Length -ge $root.Length) {
            if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked cache ancestor: $full" }
            $ancestor = $ancestor.Parent
        }
        $targets += $full
    }
}
$targets = @($targets | Sort-Object -Unique)
if ($Apply) {
    $marker = Join-Path $projectRoot ".cache\browser-profile\.codex-boss-profile-ready"
    if (-not (Test-Path -LiteralPath $marker)) { throw "Verified D-drive profile is required before cleanup" }
    $running = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($projectRoot + "\", [StringComparison]::OrdinalIgnoreCase) }
    if ($running) { throw "Close Codex Boss before cache cleanup" }
}
$bytes = 0L
foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $size = (Get-ChildItem -LiteralPath $target -Recurse -Force -File | Measure-Object Length -Sum).Sum
    $bytes += $size
    [pscustomobject]@{ Path = $target; Bytes = $size; Delete = [bool]$Apply }
    if ($Apply) {
        Remove-Item -LiteralPath $target -Recurse -Force
        if (Test-Path -LiteralPath $target) { throw "Cache directory still exists after deletion: $target" }
    }
}
Write-Output "Cache total bytes: $bytes; applied: $Apply"
