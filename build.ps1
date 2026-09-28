# IPMI GUI Builder - Portable Version
Write-Host "=== IPMI GUI Builder ===" -ForegroundColor Cyan

# 1. Kill running app
Write-Host "`n[1/4] Stopping running app..." -ForegroundColor Yellow
Get-Process -Name "ipmi-gui","IPMI管理工具","electron","app-builder" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Clean
Write-Host "[2/4] Cleaning..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }

# 3. Build
#    bin/ 由 electron-builder 的 extraResources 复制到 resources/bin，
#    不再需要构建脚本手动 Copy-Item。
Write-Host "[3/4] Building..." -ForegroundColor Yellow
& npx electron-builder --win --dir
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# 4. Verify ipmitool (与 ipmiTool.resolveIpmiToolPath 首选路径一致)
Write-Host "[4/4] Verifying ipmitool..." -ForegroundColor Yellow
$binDir = "dist\win-unpacked\resources\bin"
if (-not (Test-Path (Join-Path $binDir "ipmitool.exe"))) {
    Write-Host "ERROR: resources\bin\ipmitool.exe 缺失，请检查 electron-builder.yml 的 extraResources" -ForegroundColor Red
    exit 1
}
Get-ChildItem $binDir | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1KB))KB)" }

$exe = Get-ChildItem "dist\win-unpacked\*.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "ipmitool.exe" } |
    Select-Object -First 1

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
if ($exe) { Write-Host "Run: $($exe.FullName) (以管理员身份运行)" -ForegroundColor Green }
