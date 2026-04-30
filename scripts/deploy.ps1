# scripts/deploy.ps1 - 客户端部署脚本（替代 hook 内 ssh 调用）
#
# 背景（详见 .claude/skills/deploy/SKILL.md Gotcha #12）：
# post-receive hook 在 git push 派生的 PowerShell 子进程里执行，调 ssh 时会
# 静默失败（exit 0 + stdout 无错，但远端 PM2 实际没真重启）。
# 已稳定复现 3 次（阶段 1 P1A-C / 阶段 2 P2H / P2I）。
#
# 解决方案：把 ssh 调用搬出 hook、改在主 PowerShell 跑（已验证主 PowerShell 完全工作）。
# hook 现在只做 fetch+reset 同步代码，部署的 ssh + build + pm2 restart 由本脚本完成。
#
# 用法：
#   1. git push origin main 和 git push server main（双 push 仍要做）
#   2. 在主 PowerShell（不是 git push 派生的）跑：
#      pwsh scripts/deploy.ps1
#      或 powershell -File scripts/deploy.ps1
#   3. 脚本完成后会显示新 PID + uptime=0s 确认真重启
#
# 也可以传 -SkipBuild 跳过 build（仅 server/ 改动时不需要重新 build 前端）

param(
    [switch]$SkipBuild,
    [switch]$Force  # 跳过"前置 push 检查"（测试用）
)

$ErrorActionPreference = 'Stop'

$SshTarget = 'administrator@172.16.0.138'
$ServerProjectDir = 'E:\business-flow'
$PM2AppName = 'business-flow'

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Business Flow - Deploy (client-side script)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# 1. 前置检查：本地 HEAD 必须已 push 到 server（否则用户白跑 deploy）
if (-not $Force) {
    Write-Host "[1/5] 检查本地 HEAD 是否已 push 到 server..." -ForegroundColor Yellow
    $localHead = (& git rev-parse HEAD).Trim()
    Write-Host "  本地 HEAD: $localHead"

    # 看 server remote 是否包含这个 commit
    $serverHasCommit = $false
    try {
        $branches = & git branch -r --contains $localHead 2>$null
        if ($branches -match 'server/main') {
            $serverHasCommit = $true
        }
    } catch {}

    if (-not $serverHasCommit) {
        Write-Host "  ✗ server remote 没有这个 commit，请先跑：" -ForegroundColor Red
        Write-Host "    git push origin main && git push server main" -ForegroundColor Red
        Write-Host "    然后再跑本脚本" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ commit 已在 server" -ForegroundColor Green
}

# 2. ssh 到 server 跑 npm install + build + pm2 restart
$sshExe = 'C:\Windows\System32\OpenSSH\ssh.exe'
if (-not (Test-Path $sshExe)) {
    Write-Host "✗ 找不到 OpenSSH: $sshExe" -ForegroundColor Red
    Write-Host "  Windows 10/11 安装：Settings → Apps → Optional Features → 'OpenSSH Client'" -ForegroundColor Red
    exit 1
}

# 构造远端命令（一次性走完 install + build + restart）
$buildPart = if ($SkipBuild) { '' } else { ' && npm run build' }
$remoteCmd = "cd /d $ServerProjectDir && npm install --omit=dev --no-audit --no-fund && npm install --include=dev --no-audit --no-fund$buildPart && pm2 restart $PM2AppName --update-env"

Write-Host ""
Write-Host "[2/5] Server 端 install + build + restart..." -ForegroundColor Yellow
Write-Host "  远端命令: $remoteCmd" -ForegroundColor Gray
Write-Host ""

# 关键：在主 PowerShell 跑这段（不是 hook 派生的子进程）—— 已验证可靠
& $sshExe $SshTarget $remoteCmd
$sshExit = $LASTEXITCODE
if ($sshExit -ne 0) {
    Write-Host ""
    Write-Host "✗ ssh 远端命令失败 (exit $sshExit)" -ForegroundColor Red
    exit 1
}

# 3. 等 PM2 启动一会儿（避免 health 探活过早）
Write-Host ""
Write-Host "[3/5] 等 PM2 启动 3 秒..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# 4. 验 PM2 真重启了（uptime 必须 < 30 秒）
# 不用 pm2 jlist —— 输出含重复 key（username vs USERNAME 等环境变量大小写冲突）
# ConvertFrom-Json 会报 "duplicated keys"。改用 pm2 list 文本 + 正则
Write-Host ""
Write-Host "[4/5] 验证 PM2 进程已重启..." -ForegroundColor Yellow
$pm2Output = & $sshExe $SshTarget "pm2 list" 2>&1
# pm2 list 表格行：│ 3 │ business-flow │ ... │ 0s │ ... │
# 找含 PM2AppName 的那一行，从中找出第一个匹配 \d+(s|m|h|d) 的串作为 uptime
$targetLine = $pm2Output | Where-Object { $_ -match [regex]::Escape($PM2AppName) } | Select-Object -First 1
if ($targetLine) {
    Write-Host "  原始行: $targetLine" -ForegroundColor Gray
    if ($targetLine -match '\b(\d+)([smhd])\b') {
        $uptimeNum = [int]$matches[1]
        $uptimeUnit = $matches[2]
        Write-Host "  uptime: $uptimeNum$uptimeUnit"
        if ($uptimeUnit -eq 's' -or ($uptimeUnit -eq 'm' -and $uptimeNum -eq 0)) {
            Write-Host "  ✓ 进程真重启（uptime $uptimeNum$uptimeUnit < 1m）" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ 进程未真重启？uptime=$uptimeNum$uptimeUnit" -ForegroundColor Yellow
            Write-Host "    建议手动 ssh administrator@172.16.0.138 'pm2 restart $PM2AppName' 强制重启" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ⚠ 找不到 uptime 字段（行里没有 \d+[smhd] 模式）" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ⚠ pm2 list 输出里找不到 $PM2AppName 行" -ForegroundColor Yellow
}

# 5. health 探活
Write-Host ""
Write-Host "[5/5] /api/health 探活..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri 'http://172.16.0.138:3001/api/health' -TimeoutSec 10
    if ($health.ok -and $health.dbWritable) {
        Write-Host "  ✓ health OK: mode=$($health.mode) version=$($health.version) dbWritable=$($health.dbWritable)" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ health 异常: $($health | ConvertTo-Json -Compress)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ✗ health 探活失败: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  部署完成" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
