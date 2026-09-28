@echo off

echo [1/4] Stopping running app...
taskkill /f /im ipmi-gui.exe >nul 2>&1
taskkill /f /im electron.exe >nul 2>&1
taskkill /f /im app-builder.exe >nul 2>&1

echo [2/4] Cleaning old build...
if exist dist rd /s /q dist 2>nul
if exist dist (
    echo ERROR: Cannot remove dist folder.
    pause
    exit /b 1
)

echo [3/5] Building unpacked app...
rem bin/ 由 electron-builder 的 extraResources 复制到 resources/bin
call npx electron-builder --win --dir
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo [4/5] Verifying ipmitool...
if not exist "dist\win-unpacked\resources\bin\ipmitool.exe" (
    echo ERROR: resources\bin\ipmitool.exe missing, check extraResources in electron-builder.yml
    pause
    exit /b 1
)
dir "dist\win-unpacked\resources\bin\" /b

echo [5/5] Creating NSIS installer from prepackaged app...
call npx electron-builder --win nsis --prepackaged dist\win-unpacked
if errorlevel 1 (
    echo Package failed!
    pause
    exit /b 1
)

echo.
echo === Build Complete ===
echo Installer:
dir dist\*.exe /b
echo.
pause
