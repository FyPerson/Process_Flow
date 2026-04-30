# P2H 阶段 codex 审查记录

阶段 2 P2H 系列（保存 UI + 自动保存 + 冲突状态机 + readOnly 全入口禁写）期间，
共经历 **8 轮 codex 审查 + 7 个 P2H commit + 2 个 CSP 修复**。

## 时间线

| 轮次 | commit | 主题 | 评级演化 |
|---|---|---|---|
| 一审 | `bd93d1a` | P2H 保存 UI 首次审查 | 6 必修 + 4 建议 |
| 二审 | `f95b2b0` | async 竞态修复 | 引入 ref-state 双轨设计 |
| 三审 | `9782684` | 真正 ref-first | 4 必修 + 1 deepEqual 回归 |
| 四审 | `a3d1122` | saving 卡死回归 | 1 必修（finally 误关 saving）|
| 整体审 | `28ac652` | 阶段 2 整体评级 | **78%** production-ready |
| 六审 | `e70b7ad` | P2I 前置整改 | 失败：readOnly 漏 8+ 入口 |
| 七审 | `0135fc5` | readOnly 路径 A 全入口禁写 | 3 必修（污染数据 + 分组面板回归 + 对齐工具栏）|
| 终审 | `2e0c7fa` | 能进 P2I | **90%** production-ready ✅ |

## 关键经验沉淀

1. **async 竞态需要 ref-first 模式**：state 异步更新挡不住同帧并发。所有 async 操作进函数捕获 capturedId，await 后比对 ref，不一致就丢弃结果（详见 [03-三审](./03-三审-9782684-ref-first%20双轨方案.md)）

2. **finally 身份校验有边界**：global UI state（如 `saving`）必须无条件释放，不能按 canvas id 关；per-canvas state（如 `isLoading`）才需要按身份校验（详见 [04-四审](./04-四审-a3d1122-saving%20卡死回归.md)）

3. **readOnly 必须穿透到所有 mutation 入口**：仅在 ReactFlow 顶层拦 nodesDraggable 不够 —— 还有 8+ 入口（快捷键 / NodeDetailPanel / NodeResizer / 双击改名 / 折叠 / DraggableEdge offset / 对齐工具栏 / sheet 增删改）（详见 [07-七审](./07-七审-0135fc5-readOnly路径A%20全入口禁写.md)）

4. **运行时 UI 标记不能进 storage**：caller 注入 `data.readOnly` 让子组件感知，但 `safeDeepCopy(edge.data, autoSaveFilter)` 会把它写进数据库，污染他人画布。`autoSaveFilter` 必须显式排除（详见 [07-七审](./07-七审-0135fc5-readOnly路径A%20全入口禁写.md)）

5. **discriminated union 强制处理所有分支**：`switch(result.status) + default { const _: never = result }` 让新增分支时 TS 编译期报错，避免漏处理（七审引入）

## 残留风险（codex 终审记录，留给阶段 3 接手）

1. **部署 hook ssh 静默失败**（Gotcha #12）—— PM2 可能"假重启"，每次部署后必须 `ssh + pm2 list` 验 uptime
2. **CSP 是按纯 HTTP 部署策略写的** —— 未来上 HTTPS 要重新验 `upgradeInsecureRequests` 等指令
3. **readOnly 面板的本地 no-op 交互** —— 子组件 input 仍能输入但保存被吞，体验不佳，留给阶段 3 权限系统一并做（节点级 canEditNode 重写整个权限层）
