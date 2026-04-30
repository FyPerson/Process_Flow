# Server-side Git hooks 模板

这两份文件是**业务全景图项目** server bare repo 的 post-receive hook 模板（v2 架构）：

- `post-receive` —— 简单 sh wrapper，调用 PowerShell
- `post-receive.ps1` —— 真正的 hook 逻辑（fetch + reset，**不再调 ssh**）

## 用途

如果重新搭建生产 server 或 server bare repo 损坏需要重建，把这两份文件部署到：

```
\\172.16.0.138\C$\GitRepos\business-flow.git\hooks\
```

## v2 架构 vs v1 区别

- v1：hook 自动 ssh + npm install + build + pm2 restart（**有 Gotcha #12 静默失败问题**）
- v2：hook 只做 fetch + reset 同步代码 → 末尾打印提示让用户跑 `scripts/deploy.ps1`

详见 [.claude/skills/deploy/SKILL.md](../../.claude/skills/deploy/SKILL.md) Gotcha #12。

## 注意

server bare repo 的硬路径（`\\172.16.0.138\E$\business-flow` 等）在 .ps1 里硬编码。
如果新部署到不同 server，需要改这些字符串。

## 防双份漂移（重要）

**`scripts/server-hooks/` 是唯一模板源**。bare repo 里 `\\172.16.0.138\C$\GitRepos\business-flow.git\hooks\` 的副本是**部署时同步出去**的拷贝。

每次改完模板，**必须同步到 bare repo**：
```bash
cp scripts/server-hooks/post-receive.ps1 //172.16.0.138/C$/GitRepos/business-flow.git/hooks/
cp scripts/server-hooks/post-receive //172.16.0.138/C$/GitRepos/business-flow.git/hooks/
```

然后**用 cmp 验证两端一致**（避免一边改了一边忘）：
```bash
cmp scripts/server-hooks/post-receive.ps1 //172.16.0.138/C$/GitRepos/business-flow.git/hooks/post-receive.ps1
# 无输出 = 一致
# differ at byte X = 漂移，重新 cp
```

如果只改了模板没同步：模板入仓库被审查到，bare repo 仍在跑旧版 → 实际行为和文档不一致。
如果只改了 bare repo 没同步回模板：仓库和实际部署不一致，下个开发者按模板部署会拿到旧版。
