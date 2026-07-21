# IPMI GUI Builder
Write-Host "=== IPMI GUI Builder ===" -ForegroundColor Cyan

# 0. Kill running app
Write-Host "`n[0/3] Stopping running app..." -ForegroundColor Yellow
Get-Process -Name "ipmi-gui","electron","app-builder" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

# 1. Clean
Write-Host "[1/3] Cleaning..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }

# 2. Build
Write-Host "[2/3] Building..." -ForegroundColor Yellow
& npx electron-builder --win nsis
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# 3. Verify
Write-Host "[3/3] Verifying..." -ForegroundColor Yellow
$binPath = "dist\win-unpacked\resources\bin\ipmitool.exe"
if (Test-Path $binPath) {
    Write-Host "SUCCESS: ipmitool.exe found" -ForegroundColor Green
    Get-ChildItem "dist\win-unpacked\resources\bin\" | ForEach-Object { Write-Host "  $($_.Name)" }
} else {
    Write-Host "WARNING: ipmitool.exe not found at $binPath" -ForegroundColor Yellow
}

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Get-ChildItem dist\*.exe | ForEach-Object { Write-Host "  $($_.Name)" }
