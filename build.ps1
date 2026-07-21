# IPMI GUI Builder - Portable Version
Write-Host "=== IPMI GUI Builder ===" -ForegroundColor Cyan

# 1. Kill running app
Write-Host "`n[1/4] Stopping running app..." -ForegroundColor Yellow
Get-Process -Name "ipmi-gui","electron","app-builder" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Clean
Write-Host "[2/4] Cleaning..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }

# 3. Build
Write-Host "[3/4] Building..." -ForegroundColor Yellow
& npx electron-builder --win --dir
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# 4. Copy ipmitool
Write-Host "[4/4] Copying ipmitool..." -ForegroundColor Yellow
$binDir = "dist\win-unpacked\resources\bin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
Copy-Item -Path "bin\*" -Destination $binDir -Force

# Verify
Write-Host "`nFiles in resources\bin:" -ForegroundColor Cyan
Get-ChildItem $binDir | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1KB))KB)" }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Run: dist\win-unpacked\ipmi-gui.exe" -ForegroundColor Green
