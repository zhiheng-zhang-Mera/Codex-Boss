@echo off
setlocal
set "CODEX_BOSS_LAUNCH_ARGS=-WaitForApp"
if /I "%~1"=="--smoke-test" set "CODEX_BOSS_LAUNCH_ARGS=-SmokeTest -WaitForApp"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\start-codex-boss.ps1" %CODEX_BOSS_LAUNCH_ARGS%
exit /b %ERRORLEVEL%
