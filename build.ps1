# IPMI GUI 构建脚本
Write-Host "=== IPMI GUI Builder ===" -ForegroundColor Cyan

# 1. 清理
Write-Host "`n[1/3] Cleaning..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }

# 2. 构建解压版
Write-Host "[2/3] Building unpacked version..." -ForegroundColor Yellow
& npx electron-builder --win --dir
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# 3. 复制 ipmitool 到解压目录
Write-Host "[3/3] Copying ipmitool files..." -ForegroundColor Yellow
$binDir = "dist\win-unpacked\resources\bin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
Copy-Item -Path "bin\*" -Destination $binDir -Force
Write-Host "  Copied to: $binDir" -ForegroundColor Green

# 验证
Write-Host "`nVerifying files:" -ForegroundColor Cyan
Get-ChildItem $binDir | ForEach-Object { Write-Host "  $($_.Name) - $([math]::Round($_.Length/1KB))KB" }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Run from: dist\win-unpacked\IPMI管理工具.exe"
