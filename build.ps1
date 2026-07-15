# IPMI GUI Builder
Write-Host "=== IPMI GUI Builder ===" -ForegroundColor Cyan

# 1. Clean
Write-Host "`n[1/3] Cleaning..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }

# 2. Build
Write-Host "[2/3] Building..." -ForegroundColor Yellow
& npx electron-builder --win --dir
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# 3. Copy ipmitool
Write-Host "[3/3] Copying ipmitool..." -ForegroundColor Yellow
$binDir = "dist\win-unpacked\resources\bin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
Copy-Item -Path "bin\*" -Destination $binDir -Force

# Verify
Write-Host "`nFiles in resources\bin:" -ForegroundColor Cyan
Get-ChildItem $binDir | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1KB))KB)" }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Location: dist\win-unpacked\"
Write-Host "Run: dist\win-unpacked\IPMI管理工具.exe (右键以管理员身份运行)"
Write-Host ""
Write-Host "To create portable zip:" -ForegroundColor Yellow
Write-Host "  1. Close this terminal"
Write-Host "  2. Right-click dist\win-unpacked folder"
Write-Host "  3. Send to > Compressed (zipped) folder"
