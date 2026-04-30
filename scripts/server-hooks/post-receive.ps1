# Git post-receive hook (PowerShell) - Auto-deployment for business-flow
#
# 运行环境：push 客户端（执行 `git push` 的 Windows 用户进程），不是 server。
# 因为 server remote 是 UNC 共享 \\172.16.0.138\C$\GitRepos\... 走 git local/file transport。
#
# === v2 架构（2026-04-30）===
# 旧架构里 hook 还会通过 ssh 调 server 跑 npm install + build + pm2 restart。
# 那个 ssh 调用在 git push 派生的 PowerShell 子进程里**会静默失败**：
# - exit 0、stdout 无错、看似成功
# - 但 server 端 pm2 实际没真重启（uptime 不为 0）
# - 已稳定复现 3 次（阶段 1 P1A-C / 阶段 2 P2H / P2I）
# 详见 .claude/skills/deploy/SKILL.md Gotcha #12
#
# v2 把 ssh 调用搬到 scripts/deploy.ps1，**用户在主 PowerShell 跑**（已验证可靠）。
# hook 现在只做 fetch+reset 同步代码，**绝不再调 ssh**。
#
# 历史背景（v4.1 修订前的踩坑总结）：
# - GIT_DIR 等 hook 环境变量必须先清，否则子 git 子进程把 . 当 git 目录
# - 不要全局 $ErrorActionPreference = 'Stop'：PowerShell 5.1 下会把 git stderr 进度
#   行升级成 NativeCommandError 导致假失败
# - git 调用必须 --git-dir / --work-tree 显式指定，不依赖 cwd 或仓库发现

# Note: do NOT set $ErrorActionPreference = 'Stop' globally — under PowerShell
# 5.1 it turns every native-command stderr line (incl. git progress) into a
# terminating NativeCommandError, faking a failure even when git exits 0.

$WorkTree = '\\172.16.0.138\E$\business-flow'
$BareRepo = '\\172.16.0.138\C$\GitRepos\business-flow.git'
$GitDir = Join-Path $WorkTree '.git'
$Branch = 'main'

function Clear-GitHookEnv {
    $names = @(
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_COMMON_DIR',
        'GIT_NAMESPACE',
        'GIT_PREFIX',
        'GIT_SHALLOW_FILE',
        'GIT_QUARANTINE_PATH'
    )
    try {
        $names += & git rev-parse --local-env-vars 2>$null
    } catch {}
    foreach ($name in ($names | Sort-Object -Unique)) {
        Remove-Item -LiteralPath "Env:\$name" -ErrorAction SilentlyContinue
    }
}

function Invoke-Git {
    param([string[]]$GitArgs)
    $output = & git @GitArgs 2>&1
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "git $($GitArgs -join ' ') failed (exit ${code}):`n$($output -join "`n")"
    }
    return $output
}

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Business Flow - Code sync (v2 hook)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Hook host: $env:COMPUTERNAME" -ForegroundColor Gray
Write-Host "Hook user: $env:USERDOMAIN\$env:USERNAME" -ForegroundColor Gray
Write-Host "Target:    $WorkTree" -ForegroundColor Gray

if (-not (Test-Path -LiteralPath $GitDir)) {
    Write-Host "Error: not a Git worktree: $WorkTree" -ForegroundColor Red
    exit 1
}

Clear-GitHookEnv
Set-Location -LiteralPath 'C:\'

git config --global --add safe.directory '*' 2>&1 | Out-Null

$gitBase = @('--git-dir', $GitDir, '--work-tree', $WorkTree)

try {
    # === 1. 同步代码到部署目录 ===
    Write-Host "[1/2] Fetching..." -ForegroundColor Yellow
    Invoke-Git -GitArgs ($gitBase + @(
        'fetch', '--prune',
        $BareRepo,
        "+refs/heads/${Branch}:refs/remotes/production/${Branch}"
    )) | Out-Null

    Write-Host "[2/2] Resetting + cleaning..." -ForegroundColor Yellow
    Invoke-Git -GitArgs ($gitBase + @(
        'reset', '--hard',
        "refs/remotes/production/${Branch}"
    )) | Out-Null

    Invoke-Git -GitArgs ($gitBase + @('clean', '-fd')) | Out-Null

    $head = Invoke-Git -GitArgs ($gitBase + @('log', '-1', '--oneline'))
    Write-Host "  + Code synced: $head" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "! Code sync failed:" -ForegroundColor Red
    foreach ($line in ($_.Exception.Message -split "`r?`n")) {
        Write-Host "    $line" -ForegroundColor Red
    }
    try {
        $logPath = Join-Path $env:TEMP 'business-flow-hook.log'
        @(
            "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =====",
            "Host: $env:COMPUTERNAME"
            "User: $env:USERDOMAIN\$env:USERNAME"
            $_.Exception.Message
        ) | Out-File -FilePath $logPath -Encoding utf8 -Append
        Write-Host "    (full log: $logPath)" -ForegroundColor Red
    } catch {}
    exit 1
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Yellow
Write-Host "  Code synced. Build + restart NOT done by hook." -ForegroundColor Yellow
Write-Host "=============================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next step on YOUR machine (the push client, NOT this hook process):" -ForegroundColor White
Write-Host ""
Write-Host "  cd <project root>" -ForegroundColor Cyan
Write-Host "  powershell -File scripts/deploy.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "Reason: hook runs in a derived PowerShell child process where ssh" -ForegroundColor Gray
Write-Host "calls silently fail (exit 0 but server-side commands never executed)." -ForegroundColor Gray
Write-Host "Running deploy.ps1 in your top-level shell is verified reliable." -ForegroundColor Gray
Write-Host ""
Write-Host "(Skip-Build for server-only changes: powershell -File scripts/deploy.ps1 -SkipBuild)" -ForegroundColor Gray
Write-Host ""

exit 0
