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
#    刻意不用 --dir：--dir 只产出 win-unpacked，既不生成 NSIS 安装包，
#    也不会生成自动更新所需的 latest.yml 与 .blockmap。
#    --publish never 明确禁止构建时上传，产物由人工放到更新源目录。
Write-Host "[3/4] Building..." -ForegroundColor Yellow
& npx electron-builder --win --publish never
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

# 自动更新产物校验：缺 latest.yml 客户端就永远收不到更新
if (-not (Test-Path "dist\latest.yml")) {
    Write-Host "ERROR: dist\latest.yml 缺失，自动更新不可用（检查 electron-builder.yml 的 publish 配置）" -ForegroundColor Red
    exit 1
}
Write-Host "Auto-update artifacts:" -ForegroundColor Gray
Get-ChildItem "dist\*.exe","dist\*.blockmap","dist\latest.yml" -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1MB,1))MB)" }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
if ($exe) { Write-Host "Run: $($exe.FullName) (以管理员身份运行)" -ForegroundColor Green }

# 本地构建只用于自测；正式发布交给 GitHub Actions（见 .github/workflows/release.yml），
# 这样不必在本机存 GitHub 凭据。
$pkgVersion = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
Write-Host "`n发布新版本（推 tag 后由 GitHub Actions 自动构建并发布 Release）：" -ForegroundColor Cyan
Write-Host "  1. 先把 package.json 的 version 改成新版本号并提交" -ForegroundColor Gray
Write-Host "  2. git tag v$pkgVersion" -ForegroundColor Gray
Write-Host "  3. git push origin v$pkgVersion" -ForegroundColor Gray
Write-Host "  注意：tag 必须与 package.json 的版本一致，且 tag 要带 v 前缀。" -ForegroundColor Yellow
