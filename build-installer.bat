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

echo [3/4] Building unpacked app and copying ipmitool...
call npx electron-builder --win --dir
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo [4/4] Copying ipmitool to resources\bin\...
if not exist "dist\win-unpacked\resources\bin" mkdir "dist\win-unpacked\resources\bin"
copy /y "bin\ipmitool.exe" "dist\win-unpacked\resources\bin\"
copy /y "bin\cygwin1.dll" "dist\win-unpacked\resources\bin\"
copy /y "bin\cygcrypto-1.0.0.dll" "dist\win-unpacked\resources\bin\"
copy /y "bin\cygz.dll" "dist\win-unpacked\resources\bin\"
echo Files copied:
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
