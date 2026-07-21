# IPMI GUI Builder
Write-Host "=== IPMI GUI Builder ===" -ForegroundColor Cyan

# 1. Kill running app
Write-Host "`n[1/5] Stopping running app..." -ForegroundColor Yellow
Get-Process -Name "ipmi-gui","electron","app-builder" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Clean
Write-Host "[2/5] Cleaning..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }

# 3. Build
Write-Host "[3/5] Building..." -ForegroundColor Yellow
& npx electron-builder --win --dir
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# 4. Copy ipmitool
Write-Host "[4/5] Copying ipmitool..." -ForegroundColor Yellow
$binDir = "dist\win-unpacked\resources\bin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
Copy-Item -Path "bin\*" -Destination $binDir -Force

# Verify
Write-Host "`nFiles in resources\bin:" -ForegroundColor Cyan
Get-ChildItem $binDir | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1KB))KB)" }

# 5. Create NSIS installer
Write-Host "[5/5] Creating NSIS installer..." -ForegroundColor Yellow
& npx electron-builder --win nsis
if ($LASTEXITCODE -ne 0) { Write-Host "Package failed!" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Portable: dist\win-unpacked\ipmi-gui.exe" -ForegroundColor Green
Write-Host "Installer:" -ForegroundColor Green
Get-ChildItem dist\*.exe | ForEach-Object { Write-Host "  $($_.Name)" }
