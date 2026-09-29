@echo off
rem ============================================================
rem  Local self-test build ONLY.
rem
rem  Produces dist\win-unpacked\ and nothing else -- it does NOT
rem  create the NSIS installer, the .blockmap, or latest.yml.
rem  A package built this way can never be picked up by
rem  auto-update (the updater needs latest.yml).
rem
rem  For a releasable package:  powershell -File build.ps1
rem  To publish a release:      push a v<version> tag, then
rem                             .github/workflows/release.yml
rem                             builds and publishes it.
rem
rem  NOTE: keep this file ASCII-only. cmd.exe reads .bat as the
rem  system ANSI codepage, so non-ASCII bytes get garbled.
rem ============================================================

echo [1/4] Stopping running app...
rem Only kill processes belonging to THIS project.
rem A blanket "taskkill /f /im electron.exe" would also kill every
rem other Electron app on the machine (editors, chat clients, ...).
taskkill /f /im IPMI*.exe >nul 2>&1
powershell -NoProfile -Command "Get-Process electron,app-builder -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*ipmi-gui*' } | Stop-Process -Force" >nul 2>&1

echo [2/4] Cleaning old build...
if exist dist rd /s /q dist 2>nul
if exist dist (
    echo ERROR: Cannot remove dist folder.
    pause
    exit /b 1
)

echo [3/4] Building app...
rem bin/ is copied to resources/bin by electron-builder extraResources
call npx electron-builder --win --dir
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo [4/4] Verifying ipmitool...
if not exist "dist\win-unpacked\resources\bin\ipmitool.exe" (
    echo ERROR: resources\bin\ipmitool.exe missing, check extraResources in electron-builder.yml
    pause
    exit /b 1
)
dir "dist\win-unpacked\resources\bin\" /b
echo.
echo Build complete!  [self-test only -- no auto-update artifacts]
echo Run: dist\win-unpacked\  -- run the exe as Administrator
echo.
echo For a releasable build:  powershell -ExecutionPolicy Bypass -File build.ps1
echo.
pause
