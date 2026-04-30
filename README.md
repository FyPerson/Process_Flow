# 业务流程全景图 - React Flow

基于 React Flow 实现的业务流程全景图，支持：

- 🎯 不同类型节点（开始/结束、处理、判断）
- 🔗 节点连接线和分支
- 📋 节点详情展开（数据库表、截图等）
- 🖱️ 拖拽、缩放、平移
- 🎨 美观的深色主题

## 快速启动

### Windows 用户

双击运行 `启动.bat`

### 手动启动

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

## 技术栈

- React 19
- React Flow (@xyflow/react)
- Vite
- TypeScript

## 项目结构

```
business-flow-react/
├── public/
│   ├── data/                   # 流程定义 JSON
│   └── pages/                  # 节点详情中以 iframe 加载的静态页面
├── src/
│   ├── components/
│   │   ├── CanvasTabBar/       # 多画布底部标签栏
│   │   ├── FlowCanvas/         # 主画布
│   │   ├── CustomNode/ GroupNode/ ModuleNode/  # 节点
│   │   ├── DraggableEdge/ FloatingEdge/        # 连线
│   │   ├── NodeDetailPanel/    # 节点详情面板
│   │   ├── ScreenshotViewer/   # 截图查看
│   │   └── Navigation/ PageSelector/ ProjectInfoPage/
│   ├── hooks/
│   │   ├── useMultiCanvas.ts   # 多画布状态
│   │   ├── useAutoSave.ts      # 自动保存
│   │   ├── useFlowClipboard.ts # 剪贴板（跨画布）
│   │   ├── useFlowHistory.ts   # 撤销/重做
│   │   ├── useFlowOperations.ts
│   │   └── useNodeAlignment.ts
│   ├── pages/BusinessFlowVisualization/        # 主页面
│   ├── types/flow.ts           # 类型定义
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── 启动.bat                     # Windows 快速启动
└── package.json
```

## 文档说明

下列文档分两类：仓库内 / 本地。带"本地"标记的在 `.gitignore` 中，不入仓库。

- [README.md](README.md) — 入口（本文件）
- [开发记录.md](开发记录.md) — **当前进度的权威来源**（本地，不入仓库）
- [TODO.md](TODO.md) — 候选下一步（本地）
- [项目潜在风险清单.md](项目潜在风险清单.md) — 2026-04-24 审查报告（本地）
- [docs/历史/](docs/历史/) — 早期设计稿与功能说明（本地归档）
- [.claude/skills/deploy/SKILL.md](.claude/skills/deploy/SKILL.md) — `/deploy` 流程定义（提交 → 双 push → hook 校验 → 进程一致性）

## 部署

**v2 部署流程（2026-04-30 起）**：三步走，不可省（见 [.claude/skills/deploy/SKILL.md](.claude/skills/deploy/SKILL.md)）：

```bash
# 1. push 到 GitHub 备份
git push origin main

# 2. push 到生产 bare repo（hook 自动 fetch+reset 同步代码到 worktree）
git push server main

# 3. 在主 PowerShell（不是 git push 派生的）跑 deploy 脚本
#    脚本内部：ssh + npm install + build + pm2 restart + 强制验证 PM2/health
powershell -File scripts/deploy.ps1
# 仅 server/ 改动可加 -SkipBuild 跳过前端 build：
powershell -File scripts/deploy.ps1 -SkipBuild
```

**为什么要分两步**：v1 hook 自动 ssh 在 git push 派生 PowerShell 子进程里**会静默失败**（exit 0 但 PM2 没真重启，已踩坑 3 次）。v2 把 ssh 搬到客户端 deploy.ps1，主 PowerShell 跑确保可靠。仅改 docs/ / .claude/ / README.md **不需要** deploy.ps1。

或者用 `/deploy <提交信息>` 让 SKILL 自动管理版本号 + 双 push + 调 deploy.ps1。生产地址 http://172.16.0.138:3001/。

### 生产登录凭证（测试阶段，明文记录）

| 字段 | 值 |
|---|---|
| 用户名 | `admin` |
| 密码 | `nZoEOVOiWBQ` |
| 角色 | `admin` |

⚠️ **风险提示**：
- 当前处于阶段 2 测试期，账号仅在内部 5 并发用户中流转，明文记录可接受
- **暂未实现"修改密码"UI**（阶段 3 加权限管理时一并做）；后端 API `POST /api/auth/change-password` 已存在，可以走 curl 改
- 正式上线前必须：① 改密 ② 轮换 JWT_SECRET（清空 server 端 .env 重新生成）③ 把本节凭证从 README 移除

## 使用说明

1. 点击蓝色虚线边框节点可查看详情
2. 使用鼠标滚轮缩放
3. 拖拽空白区域平移画布
4. 拖拽节点可移动位置
5. 左下角控制面板可缩放和适应视图

## 许可证

MIT
