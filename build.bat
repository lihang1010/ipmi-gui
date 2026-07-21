@echo off
chcp 65001 >nul

echo [1/5] Stopping running app...
taskkill /f /im "IPMI管理工具.exe" >nul 2>&1
taskkill /f /im "IPMI GUI.exe" >nul 2>&1
taskkill /f /im electron.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/5] Cleaning old build...
if exist dist rmdir /s /q dist

echo [3/5] Building app...
call npx electron-builder --win nsis --dir
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo [4/5] Copying ipmitool files...
if not exist "dist\win-unpacked\resources\bin" mkdir "dist\win-unpacked\resources\bin"
copy /y "bin\ipmitool.exe" "dist\win-unpacked\resources\bin\" >nul
copy /y "bin\cygwin1.dll" "dist\win-unpacked\resources\bin\" >nul
copy /y "bin\cygcrypto-1.0.0.dll" "dist\win-unpacked\resources\bin\" >nul
copy /y "bin\cygz.dll" "dist\win-unpacked\resources\bin\" >nul
echo Files copied to: dist\win-unpacked\resources\bin\

echo [5/5] Repackaging NSIS installer...
call npx electron-builder --win nsis
if errorlevel 1 (
    echo Package failed!
    pause
    exit /b 1
)

echo.
echo === Build Complete ===
dir dist\*.exe /b
echo.
pause
