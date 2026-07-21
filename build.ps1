# IPMI GUI Builder
Write-Host "=== IPMI GUI Builder ===" -ForegroundColor Cyan

# 0. Kill running app
Write-Host "`n[0/4] Stopping running app..." -ForegroundColor Yellow
Get-Process -Name "IPMI管理工具","IPMI GUI","electron" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# 1. Clean
Write-Host "[1/4] Cleaning..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }

# 2. Build
Write-Host "[2/4] Building..." -ForegroundColor Yellow
& npx electron-builder --win --dir
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# 3. Copy ipmitool
Write-Host "[3/4] Copying ipmitool..." -ForegroundColor Yellow
$binDir = "dist\win-unpacked\resources\bin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
Copy-Item -Path "bin\*" -Destination $binDir -Force

# 4. Package
Write-Host "[4/4] Packaging NSIS installer..." -ForegroundColor Yellow
& npx electron-builder --win nsis
if ($LASTEXITCODE -ne 0) { Write-Host "Package failed!" -ForegroundColor Red; exit 1 }

# Verify
Write-Host "`nFiles in resources\bin:" -ForegroundColor Cyan
Get-ChildItem $binDir | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1KB))KB)" }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Installer: dist\IPMI管理工具-*.exe" -ForegroundColor Green
Write-Host "Portable:  dist\win-unpacked\" -ForegroundColor Green
Write-Host ""
Write-Host "To run portable version:" -ForegroundColor Yellow
Write-Host "  dist\win-unpacked\IPMI管理工具.exe (右键以管理员身份运行)"
