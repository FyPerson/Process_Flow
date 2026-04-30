---
name: deploy
description: 提交代码并部署到生产服务器（业务全景图项目）。当用户输入 /deploy、/deploy <提交信息>、或说"帮我部署"时触发。基于客户端 deploy.ps1 脚本（v2 架构，2026-04-30 替代 hook 内 ssh）+ 生产构建模式（vite build + Express serve dist + PM2 restart），自动管理语义版本号，并强制验证部署生效。
disable-model-invocation: true
---

# 部署到生产服务器

## 项目部署模式（v2 客户端 deploy 脚本模式 —— 2026-04-30 起，先读一遍）

本项目走 **代码同步走 hook + 服务端 install/build/restart 走客户端 deploy 脚本** 的两段式部署：

- 远端 `server` = `\\172.16.0.138\C$\GitRepos\business-flow.git`（bare repo）
- 推到 bare repo 时触发 `hooks/post-receive`（PowerShell），**只做 fetch + reset 同步代码到 worktree**：
  · 用 `--git-dir`/`--work-tree` 显式指定 UNC 路径，把代码同步到 `\\172.16.0.138\E$\business-flow`
  · **绝不再调 ssh**（避免 Gotcha #12 派生 PowerShell 静默失败）
  · 末尾打印明确提示："Code synced. Next step: powershell -File scripts/deploy.ps1"
- 客户端 [`scripts/deploy.ps1`](../../../scripts/deploy.ps1) 由用户**在主 PowerShell** 跑（不是 hook 派生的子进程）：
  · ssh + npm install --omit=dev + npm install --include=dev + npm run build + pm2 restart --update-env
  · 自动验证 PM2 真重启（uptime < 1m）+ /api/health 探活（mode=production + dbWritable）
  · 任何验证失败 → exit 1（不再"假绿字"）
- 部署目标：PM2 进程名 `business-flow`，由 [ecosystem.config.cjs](../../../ecosystem.config.cjs) 配置（NODE_ENV=production / DATA_DIR=E:/business-flow-data / PORT=3001）
- 服务端 Express + tsx 运行 server/index.ts，serve `dist/`（vite build 产物）+ `/api/*`

**为什么要 v2 客户端 deploy 脚本**：v1 hook 内调 ssh 会在 git push 派生的 PowerShell 子进程里**静默失败** —— exit 0、stdout 看似成功，但 server 端 PM2 实际没真重启。已在阶段 1 / 阶段 2 P2H / P2I 共 3 次踩坑。详见 Gotcha #12（已解决）。

**与之前 Vite HMR 模式的差异**：
- ❌ 不再依赖 HMR 自动 reload；每次部署 PM2 重启，**用户感知 5-10 秒空白**
- ✅ 多人协作场景下 HMR 会打断在编辑的用户，build 模式避免；且 build 阶段就能拒绝 TS / vite 错误
- ❌ 部署多 30-60 秒（npm install + vite build）
- ✅ 生产环境不带 dev server 痕迹，启动更轻
- ❌（v2 取舍）失去"push 即部署"的便利性，必须额外跑 deploy.ps1
- ✅（v2 取舍）部署结果可信（不再"假绿字"），且失败立即 exit 1

## 执行步骤

按顺序执行，不可跳过：

1. `git status` 检查工作区（无未提交更改且无新文件则停止；只是要重新部署当前 HEAD 到生产，跳到步骤 8）
2. 如存在 `nul` 文件（Windows 保留名），执行 `rm -f ./nul` 清理
3. 读取 `package.json` 获取当前版本号
4. 根据提交前缀计算新版本号（见下表）
5. **显示部署预览，等待用户确认**
6. 如需升级，修改 `package.json` 的 `version` 字段
7. `git add` 相关文件并 `git commit`
8. **执行双 push**：`git push origin main` + `git push server main`（hook 自动 fetch+reset 同步代码）
9. **执行客户端 deploy 脚本**：`powershell -File scripts/deploy.ps1`
   · 仅 server/ 改动可加 `-SkipBuild` 跳过前端 build 节省 30s
   · 仅 docs/.claude/README.md 改动**不需要**跑 deploy.ps1（无运行时影响）
   · 脚本会自动验 PM2 uptime + /api/health；任何验证失败 exit 1
10. 更新项目状态文档（见下方"步骤 10 详解"）
11. 输出部署结果与可选的 `/remember` 提醒

## 版本升级规则

| 前缀 | 升级 | 示例 |
|------|------|------|
| `feat:` | minor | 1.0.0 → 1.1.0 |
| `fix:` / `style:` / `refactor:` / `perf:` | patch | 1.0.0 → 1.0.1 |
| `docs:` / `chore:` / `test:` | 不升级 | 1.0.0 → 1.0.0 |
| `BREAKING:` | major | 1.0.0 → 2.0.0 |

## 步骤 5：部署预览格式

```
## 部署预览

- 待提交文件：<文件列表>
- 提交信息：<提交信息>
- 当前版本：<旧版本>
- 新版本：<新版本>（或"不变"）
- 推送目标：origin（GitHub 备份）+ server（生产部署）

是否继续部署？
```

## 步骤 8 详解：双 push（同步代码 + 触发 hook fetch+reset）

### 8.1 先 push origin（无副作用）

```bash
git push origin main
```

GitHub 是纯备份，不触发任何部署，先推确保备份成功。

### 8.2 再 push server（触发 hook 同步代码）

```bash
git push server main
```

v2 hook 输出形如：

```
[1/2] Fetching...
[2/2] Resetting + cleaning...
  + Code synced: <hash> <commit message>
=============================================
  Code synced. Build + restart NOT done by hook.
=============================================
Next step: powershell -File scripts/deploy.ps1
```

**hook 不再调 ssh，所以也不再有"假成功"风险**。fetch+reset 失败会 exit 1。

如果改动**只涉及 docs/ / .claude/ / README.md 等非运行时文件**，到此就行（不需要跑 deploy.ps1）。

如果改动涉及 `src/` / `server/` / `package.json` / `ecosystem.config.cjs` —— 进入步骤 9 跑 deploy.ps1。

## 步骤 9 详解：客户端 deploy.ps1（install + build + pm2 restart + 强制验证）

### 9.1 在主 PowerShell 跑 deploy 脚本

**关键：必须在你自己的主 PowerShell 跑，不是 git push 的派生子进程**（否则会触发 Gotcha #12）。

```powershell
powershell -File scripts/deploy.ps1
```

仅 server/ 改动可加 `-SkipBuild` 跳过前端 build 节省 30s：

```powershell
powershell -File scripts/deploy.ps1 -SkipBuild
```

### 9.2 deploy.ps1 内置 5 步流程

脚本会自动执行 + 验证，**任何步骤失败 exit 1**（不再"假绿字"）：

1. **前置检查**：本地 HEAD == server/main HEAD（`git ls-remote server refs/heads/main` 直接读 server 端 hash 严格 `==`，不用 `git branch -r --contains`，避免子集匹配假阳性）
2. **ssh 远端**：`cd E:\business-flow && npm install --omit=dev && npm install --include=dev && npm run build && pm2 restart business-flow --update-env`
3. **等 PM2 启动 3 秒**
4. **验 PM2 真重启**：`pm2 list` 解析 uptime 列；`uptime < 1m` 视为真重启，否则 exit 1
5. **/api/health 探活**：`{"ok":true,"version":"X.Y.Z","mode":"production","dbWritable":true}`
   · `ok != true` → exit 1
   · `mode != 'production'` → exit 1（PM2 没读到 NODE_ENV）
   · `dbWritable != true` → exit 1（DB 异常）

### 9.3 deploy.ps1 失败时怎么办

- **前置检查失败**：忘记 `git push server main`，先做完
- **ssh 远端失败**：可能 server 端 npm install 网络问题（参 Gotcha #9 prebuild 缓存）；查 ssh 输出
- **PM2 uptime >= 1m**：极少见。手动 `ssh administrator@172.16.0.138 'pm2 restart business-flow --update-env'` 强制重启
- **health 探活失败**：进程崩溃。`ssh administrator@172.16.0.138 'pm2 logs business-flow --lines 50 --nostream'` 看错误

### 9.4 进程一致性检查（防孤儿 PM2，仅在 deploy.ps1 验证不过时手动跑）

```bash
ssh administrator@172.16.0.138 'netstat -ano | findstr ":3001"'
```

记下监听 3001 的 pid。再查 PM2：

```bash
ssh administrator@172.16.0.138 'pm2 list'
```

从 list 中找 `business-flow` 的 pid。**两个 pid 必须一致**——否则说明又出现了孤儿进程（详见 Gotcha #2）。

## 步骤 10 详解：更新项目状态文档

### 10.1 `开发记录.md` 头部（注意：本项目此文档无固定头部，需在第 3 行 `>` 引用块下、第一个 `---` 之前插入）

最终头部应为：

```markdown
# 业务全景图 - 开发记录

> 本文档记录项目当前情况、开发进度和部署方式，仅供本地参考。
>
> **最后更新**: YYYY-MM-DD
> **当前版本**: vX.Y.Z
> **最新提交**: `前缀: 提交信息`

---
```

每次部署覆盖这三行（不是追加）。

### 10.2 `开发记录.md` 顶部追加"已完成功能"或"已知问题修复记录"

如果是 `feat:` / `fix:`，按既有"## 当前功能进度"段落格式追加条目。普通 `chore:` 不必追加。

## 步骤 11：输出结果

显示：
- 部署状态（成功/失败 + hook 是否需要补救）
- 版本变化（vX.Y.Z → vX.Y.Z 或不变）
- 提交 hash（短）
- 部署目录 HEAD（短）
- 访问地址 http://172.16.0.138:3001/

### 完成后引导（按 commit 前缀分级）

- 含 `feat:` / `refactor:` / `BREAKING:` 前缀 → 输出末尾追加：
  > 部署完成。本次涉及新功能/重构，**建议执行 `/remember` 沉淀关键决策、踩坑与里程碑**。

- 仅 `fix:` / `style:` / `perf:` 前缀 → 输出末尾追加：
  > 部署完成。如本次有值得沉淀的踩坑或决策，可执行 `/remember`。

- 仅 `chore:` / `docs:` / `test:` 前缀 → 输出末尾不追加提醒。

## Gotchas（踩坑记录，持续追加）

### 1. ❌ Hook 报告 "Deployment Complete!" 但代码未更新到部署目录（2026-04-28 定位根因）

**表面现象**：post-receive.ps1 输出绿字成功但部署目录 HEAD 不动。

**真正根因**：本项目 `server` remote 是 UNC 路径 `\\172.16.0.138\C$\GitRepos\...`，属于 git 的 local/file transport——hook 实际跑在 **push 客户端**（执行 `git push` 的 Windows 用户），不是服务器 172.16.0.138 上。Git 在调 hook 前会导出 `GIT_DIR=.` 等环境变量；hook 里再调 `git fetch` 会继承这些变量，子进程把 `.` 当 git 目录，于是报 `fatal: not a git repository: '.'`，与 cwd / Set-Location / `git -C` / 映射盘符无关。原 hook 的 `2>&1 | Out-Null` 还把这个错误整段吞掉，伪装成"成功"。

✅ 已修复：当前 [scripts/server-hooks/post-receive.ps1](../../../scripts/server-hooks/post-receive.ps1) 在调任何 git 命令前，先用 `git rev-parse --local-env-vars` + 一份显式列表清空 `GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / ...`，再用 `--git-dir`/`--work-tree` 显式参数调用 git。错误不再吞，捕获后 throw 出来。

✅ 维护提醒：
- 手动改 ps1 后必须 `cp scripts/server-hooks/post-receive.ps1 //172.16.0.138/C$/GitRepos/business-flow.git/hooks/`（仓库的 `scripts/server-hooks/` 是唯一模板源）；改完用 `cmp` 验证两边一致，避免双份漂移：
  ```bash
  cmp scripts/server-hooks/post-receive.ps1 //172.16.0.138/C$/GitRepos/business-flow.git/hooks/post-receive.ps1
  # 无输出 = 一致；有 differ at byte X = 漂移，需重新 cp
  ```
- 失败时 hook 会把详细错误同步写到 `%TEMP%\business-flow-hook.log`，便于事后排查（push 输出有时只显示首行）。
- ps1 里**不要**设 `$ErrorActionPreference = 'Stop'`：PowerShell 5.1 下它会把 git 的 stderr 进度行也升级成 `NativeCommandError` 触发假失败。改用 `try/catch` + 显式 `throw`。

✅ 防御：v2 hook 只做 fetch+reset，不再调 ssh，不再有"假成功"风险。如果未来又出现"hook 报告成功但 hash 不动"（fetch+reset 自身失败），看 `%TEMP%\business-flow-hook.log`。

### 2. ❌ 双 PM2 节点错位：孤儿进程占 3001，PM2 管的进程跑在 3002（2026-04-28 首次发现并修复）

历史原因不明，PM2 daemon 重启时丢了对早期 fork 的引用，新启动的进程因 3001 被占自动让位到 3002。`pm2 list` 看不到孤儿，`pm2 restart business-flow` 长期对真正服务用户的进程无效。

✅ 修复方案（中断窗口约 5~15 秒）：
```
pm2 stop business-flow                    # 释放 PM2 管理的进程
taskkill /F /PID <孤儿pid>                # 释放 3001
pm2 start business-flow                   # PM2 重新独占 3001
```
然后 `netstat -ano | findstr ":3001"` 与 `pm2 jlist` 比对 pid 必须一致。

✅ 预防：deploy.ps1 步骤 4 自动验 PM2 uptime；不一致或想手动复查走步骤 9.4（进程一致性）。

### 3. ❌ ssh 默认进 cmd shell（Windows Server），bash 风格路径与管道在某些命令里失败

ssh 进去之后 `cd /c/...` 风格路径不通，复杂管道 `head -N` 也不存在。

✅ 修复：
- 路径统一用 `C:\GitRepos\...` 或 `E:\business-flow\...`（backslash + 盘符）
- 切目录用 `git -C <path>` 而非 `cd ...`
- 不靠 `head/tail`，让本地 Bash 工具来切片输出

### 4. ❌ Windows 残留 `nul` 文件（多次出现）

`> nul` 在 bash 里被当成文件而非黑洞，留下 0 字节文件，git add 时报错。

✅ 步骤 2 已固化 `rm -f ./nul`。

### 5. ❌ HMR 在大量文件被删/重命名后行为可能异常

观察过：清理 4 个目录数十个文件后 Vite HMR 正常发 page reload，但跨度大的变更可能导致模块图错乱、ENOENT。

✅ 处理：deploy.ps1 步骤 5 / 步骤 9.4 看进程一致性；如日志有错乱执行 `pm2 restart business-flow`（确认 PM2 管的就是 3001 监听者，否则 restart 可能落空）。

### 6. ❌ 直接 `git push server main` 而不走 `/deploy` skill

会绕开版本号 bump（步骤 6）+ 文档同步（步骤 10）+ deploy.ps1 严格验证（步骤 9）+ 进程一致性检查（步骤 9.4）。

✅ 除非紧急 hotfix 或明确要跳过版本管理，否则必须走 `/deploy`。

### 6.1 ❌ 跳过 push server（"反正只是文档改动"）—— 阶段 0 收尾发现

我曾经因为某个 commit 只改文档、不影响 src/server/dist 而**只 push origin、跳过 push server**，导致 origin/main 和 server/main 不一致（差 1 个 commit）。

理由貌似合理（不影响运行时 + 节省一次 hook 触发时间），但**违反 deploy skill 步骤 8 的双 push 规则**。代价：
- 三端 HEAD 不一致让未来 reset/rebase 风险变高
- 用户会问"我们项目要推服务器，你刚才只 push GitHub 了吗？" —— 真实场景

✅ **铁律**：每个进入 main 的 commit，无论代码还是文档，都必须**双 push（origin + server）**。简单规则比"判断该不该 push"省脑力。

### 7. ❌ Windows cmd 不支持 inline `KEY=value cmd` 赋值（C2 阶段发现）

`"start": "NODE_ENV=production tsx server/index.ts"` 在 Windows cmd 下会报 `'NODE_ENV' 不是内部或外部命令`。

✅ 已修复：用 `cross-env`：`"start": "cross-env NODE_ENV=production tsx server/index.ts"`。

✅ 但 PM2 启动**不走** npm scripts，所以单靠 cross-env 不够：[ecosystem.config.cjs](ecosystem.config.cjs) 必须显式声明 `env: { NODE_ENV: 'production', ... }`。codex C4 复审专门点出这个坑。

### 8. ❌ npm/pm2 启动的 node 子进程在 stop 时残留（C2 阶段发现）

`pm2 stop` 或 `kill <npm pid>` 后，底层 tsx node 进程可能继续 listening，端口被占。这与昨天 PM2 错位的孤儿进程同根因。

✅ 排查：`netstat -ano | findstr ":3001"` 看 LISTENING 的 pid + `pm2 jlist | grep business-flow` 比对 pid，必须一致；不一致就 `taskkill /F /PID <孤儿>` + `pm2 start ecosystem.config.cjs`。

### 9. ❌ 服务器 GitHub 带宽不足，native prebuild 下载超时（B1 阶段发现）

服务器（172.16.0.138）curl github.com HTTP 200 但 ~50KB/s，1MB prebuild 60 秒下不下来 → npm install better-sqlite3 失败 → 回落到 node-gyp 本地编译 → 没装 VS C++ 工具链失败。

✅ 解决方案：
1. 本机网络通畅时 `curl -L -o /tmp/<file>.tar.gz https://github.com/WiseLibs/better-sqlite3/releases/download/vX.Y.Z/<file>` 拉到本地
2. `scp /tmp/<file>.tar.gz administrator@172.16.0.138:C:/Users/Administrator/AppData/Local/npm-cache/_prebuilds/<hash>-<file>`
   - hash 前缀（如 `99329f`）从 `npm install --loglevel=verbose` 输出里读
3. 服务器再 `npm install` 时命中本地缓存跳过下载
4. 任何 native 模块（其他 prebuild）都可走此模式

### 12. ✅ Hook 里 ssh 调用在派生 PowerShell 里"空跑"——已解决（2026-04-30 改造完成）

**症状**（已根治）：post-receive.ps1 在 git push 派生的 PowerShell 子进程里 `& $sshExe $SshTarget $Command` 静默失败 —— exit 0、stdout 无错，但 server 端 PM2 实际没真重启。

**根因猜测**（codex 八审）：git bash 派生的 PowerShell 里 ssh 子进程的非交互 stdin/stdout/stderr 或 MSYS 环境影响 ssh 行为，让 ssh 进程根本没真正建立 TCP 连接但还是返回 exit 0。在主 PowerShell 跑同样代码完全工作 ✓。

**已踩坑 3 次**：
- 阶段 1 P1A-C commit `104a76c`（dotenv 依赖未装 → HTTP 504）
- 阶段 2 P2H 期间（PM2 5h 没重启 → 7 个 commit 都没生效）
- 阶段 2 P2I 期间（同样 PM2 没重启）

**v2 解决方案**（2026-04-30，commit `_FILL_`）：
- post-receive.ps1 **只做 fetch+reset 同步代码**，绝不调 ssh
- 部署的 install + build + pm2 restart 改到客户端 [scripts/deploy.ps1](../../../scripts/deploy.ps1)，**用户在主 PowerShell 跑**（已验证可靠）

✅ **现在的部署流程**：
```bash
git push origin main          # 同步 GitHub
git push server main          # 同步生产 bare repo（hook 自动 fetch+reset 代码到 worktree）

# 然后在主 PowerShell（不是 git push 派生的）跑：
powershell -File scripts/deploy.ps1
# 或仅服务端代码改动（跳过前端 build）：
powershell -File scripts/deploy.ps1 -SkipBuild
```

deploy.ps1 内置：
- 前置检查 server remote 已收到 commit
- ssh + npm install + npm run build + pm2 restart
- 验证 PM2 进程 uptime < 1m（=真重启）
- /api/health 探活

**触发条件**（什么时候要跑 deploy.ps1）：
- 改了 `src/`（前端）→ 必须，要重新 build
- 改了 `server/` / `ecosystem.config.cjs`（后端运行时）→ 必须，要重启 PM2
- 改了 `package.json`（依赖）→ 必须，要 npm install
- 仅改了 `docs/` / `.claude/` / `README.md` 等非运行时文件 → 不需要

**如果 deploy.ps1 失败**：脚本会报具体步骤的错。退到老办法：
```bash
ssh administrator@172.16.0.138 'cd /d E:\business-flow && npm install --no-audit --no-fund && npm run build && pm2 restart business-flow --update-env'
```

### 11. ❌ Hook 里调 ssh 报 "Could not resolve hostname X: Name or service not known"（阶段 0 部署切换发现，调试链很长）

三个嵌套问题：

**a. PATH 优先级**：post-receive hook 从 git push 触发时继承 git bash PATH，`Get-Command ssh` 会找到 `C:\Program Files\Git\usr\bin\ssh.exe`（Cygwin 风格）。Cygwin ssh 对 Windows cmd 风格双引号转义处理不一致，把含空格的远端命令拆成多个 argv → "Could not resolve hostname"。

**b. cmd /c 在 hook 上下文沉默**：直接用 `cmd /c "ssh.exe ... \"<command>\""` 包装在我自己 PowerShell 里能跑，但在 hook 触发的 PowerShell 子进程里**ssh 命令空跑**——返回 exit 0 但 stdout 没东西、远端命令也没真执行。父进程 = git bash sh 似乎影响了 cmd 子进程的行为。

**c. Test-Path 异常**：在 hook 派生的 PowerShell 里 `Test-Path -LiteralPath $sshExe` 报 "LiteralPath 空值"。

✅ 最终修复：**PowerShell native call + 绝对路径 Windows OpenSSH**：
```powershell
$sshExe = 'C:\Windows\System32\OpenSSH\ssh.exe'
$output = & $sshExe $SshTarget $Command 2>&1
```
- `& $sshExe` 用调用算子，PowerShell 把 argv 直接传 ssh.exe（不经过 cmd），无引号歧义
- 绝对路径绕开 PATH 顺序问题
- 不要 `Test-Path` 预检（hook 上下文行为异常），直接调，失败靠 `$LASTEXITCODE` 捕获

### 10. ❌ node-gyp 把 SSMS 误判为 Visual Studio（B1 阶段发现）

`unknown version "undefined" found at "C:\Program Files\Microsoft SQL Server Management Studio 21\Release"` —— node-gyp 扫 Program Files 找 VS 时把 SSMS 当成 VS 候选。

✅ 不是真正的失败原因，只要 prebuild 命中就根本不走 node-gyp。看到这个红鲱鱼直接跳过，去看 prebuild 那一行。

## 注意事项

- `开发记录.md`、`TODO.md`、`项目潜在风险清单.md`、`docs/历史/` 都在 `.gitignore` 中，本地参考用，不入仓库
- 版本号在部署前由 Claude 更新到 `package.json` 并随同 commit 一起 push
- 远端命名约定：
  - `origin` = GitHub 备份 (`https://github.com/FyPerson/Process_Flow.git`)
  - `server` = 生产部署触发 (`\\172.16.0.138\C$\GitRepos\business-flow.git`)
- 生产环境关键参数：
  - IP `172.16.0.138`、端口 `3001`
  - PM2 进程名 `business-flow`，由 [ecosystem.config.cjs](ecosystem.config.cjs) 配置
  - 部署目录 `E:\business-flow`、数据目录 `E:\business-flow-data`（仓库工作区**外**）
  - ssh 用户 `administrator`（小写，本机已验证可用，与 Task_Pool 项目要求大写不同）
- 生产构建模式（v2 起）：每次部署 PM2 restart，用户感知 5-10 秒空白；不再依赖 Vite HMR

## 通用规则（不只是这个项目）

下面三条不是"本项目特有"，是**任何用 git hook 自动部署 + 本地存储的项目都该遵守**：

1. **数据目录必须放仓库工作区外**：因为 post-receive hook 通常含 `git clean -fd`，万一 ignore 规则漂了或加了 `-x`，会永久丢失生产数据。本项目用 `E:\business-flow-data\` 而不是 `E:\business-flow\data\`。
2. **PM2 进程的 NODE_ENV 必须由 ecosystem.config.cjs 显式声明**，不能依赖 npm scripts 的 cross-env—— PM2 启动不走 npm。
3. **每个进入 main 的 commit 都双 push（origin + server），无论代码还是文档**。三端 HEAD 始终一致才能让 reset/rebase 可预测；省一次 push 是错的优化。

---

## codex 审查归档流程

每次跑 codex 审查时**必须**走以下闭环，避免 `/tmp` 累积 + 审查结果丢失。
（背景：阶段 2 P2H 期间跑了 8 轮审查，过程中 prompt + stdout.log 在 `/tmp` 累积 ~3MB，结果文件没归档到仓库 → 后续清理时差点误删）。

### 标准流程（4 步）

#### 步骤 1：写 prompt 到 `/tmp/codex-prompt.txt`
```bash
cat > /tmp/codex-prompt.txt << 'PROMPT'
（审查范围、重点、输出格式...）
PROMPT
```

#### 步骤 2：跑 codex 后台执行
```bash
codex exec --skip-git-repo-check --sandbox read-only --color never \
  -o /tmp/codex-result.md \
  "$(cat /tmp/codex-prompt.txt)" \
  < /dev/null > /tmp/codex-stdout.log 2>&1
```
**关键点**：
- `< /dev/null` 必须有，否则 codex 等 stdin 会卡 20+ 分钟（已踩坑）
- `-o /tmp/codex-result.md` 把审查结论直接写文件
- `> /tmp/codex-stdout.log 2>&1` 把过程噪音收纳进文件，不污染对话
- 用 `run_in_background: true` 跑，配合 ScheduleWakeup 4-5 分钟后兜底检查

#### 步骤 3：读结果给用户
```bash
cat /tmp/codex-result.md
```
（用 Read 工具读，不是 cat 在 Bash 里输出，避免占对话上下文）

把审查结论给用户，用户拍板下一步动作。

#### 步骤 4：归档 + 清理（一次性做完，不留尾巴）

```bash
# 4.1 归档到仓库（路径规则：docs/规划/codex审查记录/<阶段>/<NN>-<轮次>-<commit>-<主题>.md）
STAGE="P2I"          # 阶段标识，与目录名一致
ROUND="01"           # 该阶段内审查编号（01/02/03...）
TOPIC="一审"         # 一审/二审/整体审/终审 等
COMMIT="abc1234"     # 被审的 commit hash 前缀
SUBJECT="导入导出 UI 首次审查"  # 主题描述

mkdir -p "docs/规划/codex审查记录/$STAGE"
mv /tmp/codex-result.md "docs/规划/codex审查记录/$STAGE/$ROUND-$TOPIC-$COMMIT-$SUBJECT.md"

# 4.2 清理 /tmp 中间文件（prompt + stdout，无保留价值）
rm /tmp/codex-prompt.txt /tmp/codex-stdout.log

# 4.3 更新跨阶段总索引（首次进入新阶段才需要更新表格行）
# 编辑 docs/规划/codex审查记录/README.md，给该阶段加一行
# （如果该阶段已有行，仅在阶段结束写 <阶段>/README.md 时再回来更新评级和经验链接）
```

### 阶段叙事（阶段结束时）

阶段所有审查跑完后，写一份 `docs/规划/codex审查记录/<阶段>/README.md`：
- 时间线表格（轮次 × commit × 主题 × 评级演化）
- 关键经验沉淀（可复用到其他项目的设计经验）
- 残留风险（写进 `docs/规划/多人协作-方案.md` 风险章节，并在此简短记录指针）

参考 [docs/规划/codex审查记录/P2H/README.md](../../../docs/规划/codex审查记录/P2H/README.md) 是已经做好的样例。

### 跨阶段总索引

[docs/规划/codex审查记录/README.md](../../../docs/规划/codex审查记录/README.md) **只**做"阶段表格索引"，不复制阶段内细节。
- 加新阶段：append 一行表格
- 阶段评级变化：更新对应行的"评级"列
- 不要把阶段经验沉淀写进总索引（那是阶段 README 的职责）

### 命令兜底参考

如果按上面步骤忘了哪一步，至少做最后一个清理：
```bash
ls /tmp/codex-* 2>/dev/null  # 看有没有遗留
# 有 result.md 没归档 → 先归档再删
# 有 prompt + stdout 但 result 已归档 → 直接 rm
```
