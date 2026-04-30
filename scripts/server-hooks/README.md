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
