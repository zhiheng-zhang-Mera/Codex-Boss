param(
    [switch]$SmokeTest,
    [switch]$WaitForApp
)

$ErrorActionPreference = "Stop"

function Write-LauncherLog {
    param([string]$Message)

    $timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffK"
    [System.IO.File]::AppendAllText($script:logPath, "[$timestamp] $Message`r`n")
}

function Show-LauncherError {
    param([string]$Message)

    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        $Message,
        "Codex Boss Launcher Error",
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
}

try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $launcherData = Join-Path $projectRoot ".codex-boss"
    [System.IO.Directory]::CreateDirectory($launcherData) | Out-Null
    $script:logPath = Join-Path $launcherData "launcher.log"
    $stdoutLog = Join-Path $launcherData "electron.stdout.log"
    $stderrLog = Join-Path $launcherData "electron.stderr.log"
    Write-LauncherLog "Launcher started. root=$projectRoot smoke=$SmokeTest wait=$WaitForApp"
    $portableApp = Join-Path $projectRoot "release\Codex Boss.exe"
    $localElectron = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
    $rendererEntry = Join-Path $projectRoot "dist\index.html"
    $mainEntry = Join-Path $projectRoot "dist-electron\electron\main.js"

    if (Test-Path -LiteralPath $portableApp) {
        $arguments = if ($SmokeTest) { @("--codex-boss-smoke-test") } else { @() }
        $process = Start-Process -FilePath $portableApp -ArgumentList $arguments -WorkingDirectory $projectRoot -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
        Write-LauncherLog "Started packaged app. pid=$($process.Id)"
    } elseif ((Test-Path -LiteralPath $localElectron) -and
              (Test-Path -LiteralPath $rendererEntry) -and
              (Test-Path -LiteralPath $mainEntry)) {
        $arguments = @($projectRoot)
        if ($SmokeTest) { $arguments += "--codex-boss-smoke-test" }
        $process = Start-Process -FilePath $localElectron -ArgumentList $arguments -WorkingDirectory $projectRoot -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
        Write-LauncherLog "Started local production app. pid=$($process.Id)"
    } else {
        throw "Production build not found. Run 'pnpm install' and 'pnpm run build', then double-click Start-Codex-Boss.cmd again."
    }

    if ($SmokeTest) {
        if (-not $process.WaitForExit(15000)) {
            Stop-Process -Id $process.Id -Force
            throw "Launcher smoke test timed out."
        }
        if (($null -ne $process.ExitCode) -and ($process.ExitCode -ne 0)) {
            throw "Desktop application exited unexpectedly. Exit code: $($process.ExitCode)."
        }
        Write-LauncherLog "Smoke test completed successfully."
    } elseif ($WaitForApp) {
        $process.WaitForExit()
        Write-LauncherLog "Application exited. exitCode=$($process.ExitCode)"
    }
} catch {
    if ($script:logPath) { Write-LauncherLog "ERROR: $($_.Exception.Message)" }
    if ($SmokeTest) {
        Write-Error $_
        exit 1
    }
    Show-LauncherError -Message $_.Exception.Message
    exit 1
}
