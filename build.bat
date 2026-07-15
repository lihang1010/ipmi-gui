@echo off
chcp 65001 >nul

echo [1/4] Cleaning old build...
if exist dist rmdir /s /q dist

echo [2/4] Building app...
call npx electron-builder --win nsis --dir
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo [3/4] Copying ipmitool files...
if not exist "dist\win-unpacked\resources\bin" mkdir "dist\win-unpacked\resources\bin"
copy /y "bin\ipmitool.exe" "dist\win-unpacked\resources\bin\" >nul
copy /y "bin\cygwin1.dll" "dist\win-unpacked\resources\bin\" >nul
copy /y "bin\cygcrypto-1.0.0.dll" "dist\win-unpacked\resources\bin\" >nul
copy /y "bin\cygz.dll" "dist\win-unpacked\resources\bin\" >nul
echo Files copied to: dist\win-unpacked\resources\bin\

echo [4/4] Repackaging NSIS installer...
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
