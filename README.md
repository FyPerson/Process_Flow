# 业务流程全景图

基于 React Flow 的业务流程可视化协作工具。集团内部 5 人并发使用，支持多人节点级权限、批注、admin 管理后台。

- **当前版本**：v1.19.0（游客草稿能力 D-1~D-8 全闭环 + 登录用户 PNG 导出 + 起止节点背景色调色修复，2026-05-14）
- **生产**：http://172.16.0.138:3001/
- **使用手册**：http://172.16.0.138:3001/manual.html（业务用户向 / 顶栏📖入口直达）
- **技术栈**：React 19 + TypeScript + Vite + React Flow / Express + better-sqlite3 + PM2

## 快速开始

```bash
# 安装依赖
npm install

# 启动 dev（api + vite 双进程）
npm run dev
# 访问 http://localhost:5173
```

测试账号见 [内部凭据.md](内部凭据.md)（gitignore 本地档）。

## 验证 + 部署

```bash
# 一键验证（lint:ids → check:invariants → check:conflict-guards → typecheck:test → 单测 535 项）
npm test

# 端到端（dev server 起后另开终端）
python tmp-test/test-p3b-nanoid-ids.py

# 部署到生产（v2 双 push + 客户端 deploy.ps1）
git push origin main && git push server main
powershell -File scripts/deploy.ps1
```

部署细节见 [.claude/skills/deploy/SKILL.md](.claude/skills/deploy/SKILL.md)。

## 文档地图

| 类别 | 入口 |
|---|---|
| **业务用户向操作手册** | [docs/使用手册.md](docs/使用手册.md)（v1.0 / 580 行 / 13 配图 / 顶栏📖入口直达） |
| 架构与约定 | [CLAUDE.md](CLAUDE.md)（项目语境 + 红线 + 命令速查，给 Claude/Codex 看） |
| 主方案 | [docs/规划/多人协作-方案.md](docs/规划/多人协作-方案.md)（阶段 0-6 实施计划） |
| 技术债 | [docs/规划/技术债务登记.md](docs/规划/技术债务登记.md) |
| 阶段决策归档 | [docs/规划/codex审查记录/](docs/规划/codex审查记录/) |
| 部署流程 | [.claude/skills/deploy/SKILL.md](.claude/skills/deploy/SKILL.md) |
| 历史/早期设计 | [docs/历史/](docs/历史/)（如存在） |

## 项目结构

```
e:\业务全景图\
├── src/                    前端（React Flow + hooks + components）
├── server/                 服务端（Express + better-sqlite3 + zod schemas）
├── scripts/                部署 + lint 工具脚本
├── server-hooks/           git post-receive hook（远端用）
├── tmp-test/               Playwright 端到端
├── docs/规划/              方案 + 债务台账 + codex 审查归档
├── .claude/skills/         项目级 skill（deploy / neat-freak）
└── ecosystem.config.cjs    PM2 配置
```

`ls src/hooks` / `ls server/routes` 即时查看模块详情，比这里写死的目录树更准。

## 许可

MIT
