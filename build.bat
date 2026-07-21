@echo off
chcp 65001 >nul

echo [1/4] Stopping running app...
taskkill /f /im electron.exe >nul 2>&1
taskkill /f /im app-builder.exe >nul 2>&1
timeout /t 3 /nobreak >nul

echo [2/4] Cleaning old build...
if exist dist (
    rd /s /q dist 2>nul
    if exist dist (
        echo Warning: dist folder still exists, retrying...
        timeout /t 2 /nobreak >nul
        rd /s /q dist 2>nul
    )
)
if exist dist (
    echo ERROR: Cannot remove dist folder. Please close any file explorer windows
    echo        pointing to the dist directory and try again.
    pause
    exit /b 1
)

echo [3/4] Building app...
call npx electron-builder --win nsis
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo [4/4] Verifying build output...
if exist "dist\win-unpacked\resources\bin\ipmitool.exe" (
    echo SUCCESS: ipmitool.exe found in resources\bin\
    dir "dist\win-unpacked\resources\bin\" /b
) else (
    echo WARNING: ipmitool.exe not found in expected location
    echo Checking asar contents...
    if exist "dist\win-unpacked\resources\app.asar.unpacked" (
        echo Unpacked directory exists
        dir "dist\win-unpacked\resources\app.asar.unpacked\" /b
    )
)

echo.
echo === Build Complete ===
dir dist\*.exe /b
echo.
pause
