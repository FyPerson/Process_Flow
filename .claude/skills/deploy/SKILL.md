---
name: deploy
description: 提交代码并部署到生产服务器（业务全景图项目）。当用户输入 /deploy、/deploy <提交信息>、或说"帮我部署"时触发。基于 server-side post-receive hook + 生产构建模式（vite build + Express serve dist + PM2 restart），自动管理语义版本号，并验证 hook 是否真的生效。
disable-model-invocation: true
---

# 部署到生产服务器

## 项目部署模式（v2 生产构建模式 —— 与一般项目不同，先读一遍）

本项目走 **server-side hook 自动部署 + 生产构建** 模式：

- 远端 `server` = `\\172.16.0.138\C$\GitRepos\business-flow.git`（bare repo）
- 推到 bare repo 时触发 `hooks/post-receive`（PowerShell）
- hook **跑在 push 客户端**（git local/file transport 特性，不是服务器进程）：
  1. 用 `--git-dir`/`--work-tree` 显式指定 UNC 路径，把代码同步到 `\\172.16.0.138\E$\business-flow`
  2. 通过 `ssh administrator@172.16.0.138` 在 server 端执行 `npm install --omit=dev` + `npm install --include=dev` + `npm run build`
  3. 通过 ssh 执行 `pm2 restart business-flow --update-env`
- 部署目标：PM2 进程名 `business-flow`，由 [ecosystem.config.cjs](ecosystem.config.cjs) 配置（NODE_ENV=production / DATA_DIR=E:/business-flow-data / PORT=3001）
- 服务端 Express + tsx 运行 server/index.ts，serve `dist/`（vite build 产物）+ `/api/*`

**与之前 Vite HMR 模式的差异**：
- ❌ 不再依赖 HMR 自动 reload；每次部署 PM2 重启，**用户感知 5-10 秒空白**
- ✅ 多人协作场景下 HMR 会打断在编辑的用户，build 模式避免；且 build 阶段就能拒绝 TS / vite 错误
- ❌ 部署多 30-60 秒（npm install + vite build）
- ✅ 生产环境不带 dev server 痕迹，启动更轻

⚠ **核心警告**：hook 输出 "Deployment Complete!" **不代表代码真的部署成功**。必须在 push 后通过 ssh 读部署目录 HEAD 与 PM2 进程的 commit hash 来验证。详见步骤 8/9。

## 执行步骤

按顺序执行，不可跳过：

1. `git status` 检查工作区（无未提交更改且无新文件则停止；只是要重新部署当前 HEAD 到生产，跳到步骤 8）
2. 如存在 `nul` 文件（Windows 保留名），执行 `rm -f ./nul` 清理
3. 读取 `package.json` 获取当前版本号
4. 根据提交前缀计算新版本号（见下表）
5. **显示部署预览，等待用户确认**
6. 如需升级，修改 `package.json` 的 `version` 字段
7. `git add` 相关文件并 `git commit`
8. **执行双 push 与验证**（见下方"步骤 8 详解"）
9. 验证生产环境（HTTP + 进程一致性，见下方"步骤 9 详解"）
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

## 步骤 8 详解：双 push + hook 生效验证

### 8.1 先 push origin（无副作用）

```bash
git push origin main
```

GitHub 是纯备份，不触发任何部署，先推确保备份成功。

### 8.2 再 push server（触发 hook）

```bash
git push server main
```

会看到 hook 的 PowerShell 输出。**不要相信"Deployment Complete!"**，继续验证。

### 8.3 验证 hook 是否真的生效（必做）

记录本地 push 的 commit hash：
```bash
LOCAL_HEAD=$(git rev-parse HEAD)
```

ssh 到生产读部署目录的 HEAD：
```bash
ssh administrator@172.16.0.138 'type E:\business-flow\.git\refs\heads\main'
```

**对比两个 hash**：
- 一致 → hook 生效，进入步骤 9
- 不一致 → hook 报告了"假成功"，执行下面的补救

### 8.4 hook 假成功补救流程

手动复现 hook 该做的事（已知 hook 中 `2>&1 | Out-Null` 会吞错，导致 fetch 失败也不报错）：

```bash
ssh administrator@172.16.0.138 'git -C E:\business-flow fetch production && git -C E:\business-flow reset --hard production/main && git -C E:\business-flow clean -fd'
```

再次读 HEAD 验证一致。

## 步骤 9 详解：生产环境验证

### 9.1 HTTP 探活

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code} | %{size_download} bytes | %{time_total}s\n' http://172.16.0.138:3001/
```

期待：`HTTP 200`，几十毫秒以内。

### 9.2 进程一致性检查（防孤儿 PM2 复发）

```bash
ssh administrator@172.16.0.138 'netstat -ano | findstr ":3001"' 
```

记下监听 3001 的 pid。再查 PM2：

```bash
ssh administrator@172.16.0.138 'pm2 jlist' 
```

从 jlist 中找 `business-flow` 的 pid。**两个 pid 必须一致**——否则说明又出现了孤儿进程，PM2 管的不是真正服务用户的那个。详见 Gotcha #2 的修复方法。

### 9.3 PM2 运行健康检查（取代旧版 HMR 检查）

```bash
ssh administrator@172.16.0.138 'pm2 logs business-flow --lines 30 --nostream'
```

期待看到：
- `[server] [db] ready`（带 journalMode=wal、foreignKeys=1）
- `[server] production mode, serving dist`
- `[server] listening`（mode=production、port=3001）
- 之后是 `request completed` JSON 行（pino 结构化日志）

不应该出现：
- 任何 ERROR 级别日志
- `Error: ENOENT` / `Cannot find module` / `Database` 异常
- `[vite]` 开头的日志（生产模式不应有 vite 痕迹，如有则说明 NODE_ENV 没生效）

### 9.4 /api/health 端到端验证（v2 生产模式新增）

```bash
curl -sS http://172.16.0.138:3001/api/health
```

期待 JSON 响应：
```json
{"ok":true,"version":"X.Y.Z","mode":"production","dbWritable":true,"timestamp":...}
```

**关键字段**：
- `ok: true` + `dbWritable: true` —— DB 连接和 WAL 文件都活
- `mode: "production"` —— **必须**是 production，否则说明 PM2 没读到 NODE_ENV
- `version: "X.Y.Z"` —— 与本地 `package.json` 一致，确认部署的是新代码

如果 `mode: "development"` → ecosystem.config.cjs 的 env 没生效，需要 `pm2 restart business-flow --update-env`。

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

✅ 已修复：当前 [server-hooks/post-receive.ps1](server-hooks/post-receive.ps1) 在调任何 git 命令前，先用 `git rev-parse --local-env-vars` + 一份显式列表清空 `GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / ...`，再用 `--git-dir`/`--work-tree` 显式参数调用 git。错误不再吞，捕获后 throw 出来。

✅ 维护提醒：
- 手动改 ps1 后必须 `cp server-hooks/post-receive.ps1 //172.16.0.138/C$/GitRepos/business-flow.git/hooks/`，文件不在 git 跟踪范围内。
- 失败时 hook 会把详细错误同步写到 `%TEMP%\business-flow-hook.log`，便于事后排查（push 输出有时只显示首行）。
- ps1 里**不要**设 `$ErrorActionPreference = 'Stop'`：PowerShell 5.1 下它会把 git 的 stderr 进度行也升级成 `NativeCommandError` 触发假失败。改用 `try/catch` + 显式 `throw`。

✅ 防御：步骤 8.3 的 hash 比对依然保留——一旦未来又出现"hook 报告成功但 hash 不动"，立刻能感知到，再走步骤 8.4 手动补救。

### 2. ❌ 双 PM2 节点错位：孤儿进程占 3001，PM2 管的进程跑在 3002（2026-04-28 首次发现并修复）

历史原因不明，PM2 daemon 重启时丢了对早期 fork 的引用，新启动的进程因 3001 被占自动让位到 3002。`pm2 list` 看不到孤儿，`pm2 restart business-flow` 长期对真正服务用户的进程无效。

✅ 修复方案（中断窗口约 5~15 秒）：
```
pm2 stop business-flow                    # 释放 PM2 管理的进程
taskkill /F /PID <孤儿pid>                # 释放 3001
pm2 start business-flow                   # PM2 重新独占 3001
```
然后 `netstat -ano | findstr ":3001"` 与 `pm2 jlist` 比对 pid 必须一致。

✅ 预防：每次部署都跑步骤 9.2 检查一致性，越早发现越省事。

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

✅ 处理：步骤 9.3 看一眼日志；如有错乱执行 `pm2 restart business-flow`（**注意先做完步骤 9.2 的进程一致性确认**，否则 restart 可能落空）。

### 6. ❌ 直接 `git push server main` 而不走 `/deploy` skill

会绕开版本号 bump（步骤 6）+ 文档同步（步骤 10）+ hook 验证（步骤 8.3）+ 进程一致性检查（步骤 9.2）。

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

### 12. ⚠️ Hook 里 ssh 调用在 hook 派生 PowerShell 上下文里"空跑"（阶段 0 端到端验证发现，未根治）

**现象**：post-receive.ps1 用 `& $sshExe $SshTarget $Command 2>&1` 调用本应在 server 跑 `pm2 restart business-flow`，hook stdout 显示步骤完成（"+ PM2 restarted"绿字），但 server 端 PM2 列表显示 pid 不变、↺ 计数不增 —— **ssh 命令空跑了**。

排除过的原因：
- ssh 路径 PATH 顺序（已用绝对路径 `C:\Windows\System32\OpenSSH\ssh.exe`）
- 双引号转义（已用 PowerShell native call & 替代 cmd /c）
- 在我手动启动的 PowerShell + 同样代码：完全工作 ✓

唯一区别：hook 由 git push → git bash sh → powershell.exe -File 启动，**子 PowerShell 的某些环境（具体不明）让 native ssh 调用静默失败**。

✅ 当前对策（不阻塞）：
- hook 自动同步代码 ✓（git fetch + reset，这部分稳定）
- npm install + build + pm2 restart 实际**未在 hook 内执行**，但因为 dist 仍是上次手动 build 的产物，前端访问不受影响
- 真有代码变更需让新版本生效时，**手动**: `ssh administrator@172.16.0.138 'cd /d E:\business-flow && pm2 restart business-flow --update-env'`
- 步骤 9.4 的 `/api/health` mode 检查能感知是否 restart 成功

✅ 待修复（不紧急）：
- 选项 1：让 hook 不直接调 ssh，改写文件触发器（比如往一个监控目录里 touch 一个文件，server 端 watcher 看到就执行 npm/build/restart）
- 选项 2：写个 server 端 standalone 守护脚本（轮询 git HEAD），不依赖 hook ssh
- 选项 3：把 hook 从 post-receive 改到客户端的 deploy script（直接 npm + ssh 调，不在 git hook 上下文）—— 但这违背"push 即部署"目标
- 当前 P3 优先级，等 5 人协作真的进入日常使用再回来修

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
