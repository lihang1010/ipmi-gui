# IPMI GUI Builder
Write-Host "=== IPMI GUI Builder ===" -ForegroundColor Cyan

# 1. Kill running app
Write-Host "`n[1/3] Stopping running app..." -ForegroundColor Yellow
Get-Process -Name "ipmi-gui","electron","app-builder" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Clean
Write-Host "[2/3] Cleaning..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }

# 3. Build with installer
Write-Host "[3/3] Building..." -ForegroundColor Yellow
& npx electron-builder --win nsis
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# Verify
Write-Host "`nFiles in resources\bin:" -ForegroundColor Cyan
$binDir = "dist\win-unpacked\resources\bin"
if (Test-Path $binDir) {
    Get-ChildItem $binDir | ForEach-Object { Write-Host "  $($_.Name)" }
} else {
    Write-Host "  bin directory not found!" -ForegroundColor Red
}

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Get-ChildItem dist\*.exe | ForEach-Object { Write-Host "  $($_.Name)" }
