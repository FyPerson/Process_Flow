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

- [README.md](README.md) — 入口（本文件）
- [开发记录.md](开发记录.md) — **当前进度的权威来源**（本地，不入仓库）
- [TODO.md](TODO.md) — 候选下一步（本地）
- [项目潜在风险清单.md](项目潜在风险清单.md) — 2026-04-24 审查报告（本地）
- [docs/历史/](docs/历史/) — 早期设计稿与功能说明（本地归档）
- [.claude/skills/deploy/SKILL.md](.claude/skills/deploy/SKILL.md) — `/deploy` 流程定义（提交 → 双 push → hook 校验 → 进程一致性）

## 使用说明

1. 点击蓝色虚线边框节点可查看详情
2. 使用鼠标滚轮缩放
3. 拖拽空白区域平移画布
4. 拖拽节点可移动位置
5. 左下角控制面板可缩放和适应视图

## 许可证

MIT
