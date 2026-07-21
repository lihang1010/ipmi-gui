@echo off

echo [1/3] Stopping running app...
taskkill /f /im ipmi-gui.exe >nul 2>&1
taskkill /f /im electron.exe >nul 2>&1
taskkill /f /im app-builder.exe >nul 2>&1

echo [2/3] Cleaning old build...
if exist dist rd /s /q dist 2>nul
if exist dist (
    echo ERROR: Cannot remove dist folder.
    pause
    exit /b 1
)

echo [3/3] Building NSIS installer...
call npx electron-builder --win nsis
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo.
echo Verify bin files:
dir "dist\win-unpacked\bin\" /b 2>nul || echo bin not found in win-unpacked
dir "dist\win-unpacked\resources\bin\" /b 2>nul || echo bin not found in resources
echo.
echo === Build Complete ===
echo Installer:
dir dist\*.exe /b
echo.
pause
