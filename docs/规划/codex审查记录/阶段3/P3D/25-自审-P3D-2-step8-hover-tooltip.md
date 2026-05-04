**第一层：非技术总结**

**自审通过，可进 step 9**。step 8 是 P3D-2 UI 友好层最后一步——节点 hover 显示创建者。**首次实战"自审够用、不跑 codex"模式**——纯展示组件 + 字符串 fallback，攻击面收敛到极限，10 场景穷举全部符合预期。

按 P3D-2 之前的 codex 审查节奏对比（step 3 9 轮 → step 4 2 轮 → step 5+6+7 2 轮 → step 8 0 轮）—— **审查频率随攻击面收敛而递减**，符合"codex 是查漏补缺不是 QA"的协作边界。

**第二层：技术细节（Claude 自审，无 codex）**

> 自审时间：2026-05-04 23:22
> 测试：npm test 74/74 全过；tsc 0 错误
> commit: `fce06e3` + deploy v1.4.0 PM2 5/5 验证全过

# 实现摘要

| 文件 | 改动 |
|---|---|
| [src/components/CustomNode/index.tsx](E:/业务全景图/src/components/CustomNode/index.tsx) | import formatCreatorName + 计算 `creatorTooltip = canEdit=false ? '由 X 创建' : undefined` + 三处主容器（decision/data/普通节点）加 `title={creatorTooltip}` |
| [src/components/GroupNode/index.tsx](E:/业务全景图/src/components/GroupNode/index.tsx) | import formatCreatorName + 容器 inline 计算 title 同款 |
| [package.json](E:/业务全景图/package.json) | bump 1.3.0 → 1.4.0 |

# 自审场景穷举（10 项）

| 场景 | 期望行为 | 验证结果 |
|---|---|---|
| 1. 自己创建的节点（canEdit=true）| 不显示 tooltip（不打扰）| ✅ creatorTooltip = undefined，title 不渲染 |
| 2. 别人节点 + 有 creator_username | "由 alice 创建" | ✅ formatCreatorName 第 1 分支 |
| 3. 别人节点 + 无 username 但有 creator_id | "由 用户 #N 创建" | ✅ formatCreatorName 第 3 分支 |
| 4. 全空（创建者信息丢失）+ canEdit=false | "由 未知创建者 创建" | ✅ formatCreatorName 第 4 分支 fallback |
| 5. 本地新建节点（__localNew=true）| canEdit=true → 不显示 tooltip | ✅ 派生 __canEdit=true，跳过 |
| 6. 已废弃节点 + 别人创建 | 节点容器 tooltip + deprecated-badge tooltip 共存 | ⚠️ 见下方"已知共存语境" |
| 7. 游客（user=null）| canEdit=false（游客不能编辑任何节点）→ tooltip 显示创建者 | ✅ |
| 8. CustomNode 三处主容器（decision/data/普通）| 全部都有 tooltip | ✅ 三处都加了 title |
| 9. GroupNode 容器 | hover 显示分组创建者 | ✅ |
| 10. 节点拖拽中 | title 不显示（hover 期间不在拖拽态）| ✅ HTML 原生行为 |

# 已知共存语境（场景 6）

已废弃 + 别人创建的节点同时有两个 tooltip：
- 节点容器 `title="由 alice 创建"`
- 内部红色 deprecated-badge chip `title="alice 在 ... 标废弃"`

**HTML 原生行为**：hover 红色 chip 时显示 chip 的 title（更深层的元素优先）；hover 节点其他位置时显示节点容器的 title。

**设计意图**：位置不同显示不同 tooltip，是合理行为。用户 hover 红色 chip 时看到废弃信息；hover 节点其他位置看到创建者。**不冲突，是 HTML 原生约定**。

P3C 公开权限下"标废弃 by X"和"由 Y 创建"通常是同一个人（creator 自己标）但也可能不同（任何登录用户都能标），用户对此心智模型清晰，不需要在一个 tooltip 里塞所有信息。

# 设计取舍（已拍板）

| 取舍 | 选项 | 理由 |
|---|---|---|
| 1 实现方式 | A（HTML title=）| 项目语境硬约束"仅桌面端"，title= 移动端不显示反对失效；与 deprecated-badge 同款模式 |
| 2 显示位置 | A（节点容器 hover）| 最简单 + 与 deprecated-badge 同 |
| 3 哪些节点 | B（仅 canEdit=false）| 不打扰自己节点 + 明确"别人节点归属" |
| 4 文案 | A（"由 X 创建"）| 简洁；详情面板蓝色横幅已含其他信息 |
| 5 角标 | B（不加）| 最小可行 + 避免视觉冲突 |

# 不跑 codex 的判断依据

按记忆固化的"codex 是查漏补缺不是 QA"协作边界：

- **攻击面**：纯展示组件 + 字符串 fallback，无 mutation、无副作用
- **新增逻辑量**：~10 行（CustomNode 三处 title 属性 + GroupNode 一处 title 属性 + 一个 useMemo 派生）
- **依赖的底层**：formatCreatorName helper 已在 step 4 codex 审查通过 + 6 单测覆盖
- **风险点**：场景 6（废弃 + 不可编辑共存）已自审、设计意图清晰
- **边界场景**：10 场景穷举全部符合预期

**结论**：tsc + npm test + 自审 10 场景 ≥ codex 审查在此场景下能给的价值。**首次实战"自审够用"**，对比 step 3 一审引入 4 必修的高发现率，step 8 的攻击面已经收敛到 codex 不会有新发现。

# Claude 判断 / 用户决策

| # | 项 | 判断 | 用户决策 |
|---|---|---|---|
| 自审 vs codex | 不跑 codex，自审够用 | 与"step 3 9 轮 / step 4 2 轮 / step 5+6+7 2 轮 / step 8 0 轮"递减节奏一致 | ✅ 用户接受（step 8 取舍讨论时同意） |
| 项目语境固化 | 加"终端定位（硬约束）"段到 project_business_flow_scope.md | 用户原话"该项目不做移动端适配。只专注于桌面端" | ✅ 已固化 |
| 场景 6 共存语境 | 不修代码，加注释说明设计意图 | HTML 原生行为合理 | ✅ |

**修复结果**

| 项 | 状态 |
|---|---|
| CustomNode 三处主容器 title | ✅ |
| GroupNode 容器 title | ✅ |
| import formatCreatorName | ✅ |
| 注释说明与 deprecated-badge 共存 | ✅ |
| 测试 npm test 74/74 + tsc 0 错 | ✅ |
| commit `fce06e3` + bump v1.4.0 + deploy 5/5 验证 | ✅ |
| 项目语境记忆固化"终端定位" | ✅ |
| 开发记录.md 更新 | ✅ |

**门禁结论**

✅ **自审通过，可进 step 9（测试 + 重构 + 回归）**。

**P3D-2 进度从 7/9 → 8/9**。下一步 step 9 是 P3D-2 最后一步，预估 1.5-2 天 + 1-2 轮 codex 审查（重构性质值得审）。

**P3D-2 step 8 历程（0 轮 codex 审查 + 1 轮自审）**

| 审次 | 主题 | 关键发现 | 文件 |
|---|---|---|---|
| 自审 | 节点创建者 hover tooltip | 10 场景穷举通过 | 25-自审（本文档）|

**审查频率递减验证**

| step | codex 轮次 | confidence | 工作量 |
|---|---|---|---|
| 3 | 9 轮 | medium 居多 | 3 天 |
| 4 | 2 轮 | high | 半天 |
| 5+6+7 | 2 轮 | medium → 通过 | 半天 |
| **8** | **0 轮（首次自审）** | — | **30 分钟** |

step 8 不是"忽略审查"，是"攻击面收敛到 codex 没有新发现的程度"。
