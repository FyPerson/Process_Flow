---
name: deploy
description: 提交代码并部署到生产服务器（业务全景图项目）。当用户输入 /deploy、/deploy <提交信息>、或说"帮我部署"时触发。基于 server-side post-receive hook + Vite HMR 模式，自动管理语义版本号，并验证 hook 是否真的生效。
disable-model-invocation: true
---

# 部署到生产服务器

## 项目部署模式（与一般项目不同，先读一遍）

本项目走 **server-side hook 自动部署**，不是客户端脚本主动 ssh：

- 远端 `server` = `\\172.16.0.138\C$\GitRepos\business-flow.git`（bare repo）
- 推到 bare repo 时触发 `hooks/post-receive`（PowerShell）
- hook 在 `\\172.16.0.138\E$\business-flow` 执行 `git fetch + reset --hard production/main + clean -fd`
- **不重启 PM2**，依赖 Vite HMR 自动 reload（PM2 进程名 `business-flow`，监听 3001）

⚠ **核心警告**：hook 输出 "Code updated successfully" **不代表代码真的更新到了**。必须在 push 后通过 ssh 读 `E:\business-flow\.git\refs\heads\main` 的 commit hash 来验证。详见步骤 8。

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

### 9.3 HMR 健康（仅 src/ 或 public/ 有变更时）

```bash
ssh administrator@172.16.0.138 'pm2 logs business-flow --lines 20 --nostream'
```

确认看到 `[vite] page reload <文件路径>` 并无 ENOENT 或模块图错乱报错。

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

✅ 维护提醒：手动改 ps1 后必须 `cp server-hooks/post-receive.ps1 //172.16.0.138/C$/GitRepos/business-flow.git/hooks/`，文件不在 git 跟踪范围内。失败时 hook 会同步把详细错误写到 `%TEMP%\business-flow-hook.log`，便于事后排查。

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

## 注意事项

- `开发记录.md`、`TODO.md`、`项目潜在风险清单.md`、`docs/历史/` 都在 `.gitignore` 中，本地参考用，不入仓库
- 版本号在部署前由 Claude 更新到 `package.json` 并随同 commit 一起 push
- 远端命名约定：
  - `origin` = GitHub 备份 (`https://github.com/FyPerson/Process_Flow.git`)
  - `server` = 生产部署触发 (`\\172.16.0.138\C$\GitRepos\business-flow.git`)
- 生产环境关键参数：IP `172.16.0.138`、端口 `3001`、PM2 进程名 `business-flow`、部署目录 `E:\business-flow`、ssh 用户 `administrator`（小写在本机已验证可用，与 Task_Pool 项目要求大写不同，注意区分）
