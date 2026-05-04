**第一层：非技术总结**

**离 step 4 门禁更近了，但还差九审兜底确认**。八审 codex 给 4 项（2 medium + 2 low），都不是新发现的真漏洞，而是把七审"修一半"或"留遗留"的部分收紧到极限：

- **M1**：onUpdateGroupLabel 的拒绝路径之前放在 setNodes updater 内（return nds 让 React 视为无变化），codex 认为还是有 React 调度副作用的隐患，要求改成 setNodes 之前就直接 return —— 与 handleGroupChange / onAddToGroup 等同模式。这条是真改善（消除 setNodes 调用本身的副作用风险），不是误报。
- **M2**：FlowCanvas user 七审改成必传 prop，codex 提醒"中间包装层（如 useFlowHandlers）也可能重新 optional 化"。grep 确认 `<FlowCanvas` 只 1 个调用点（BFV），但 useFlowHandlers.user 确实是 optional + default null 的状态。本轮也改成必传，与 FlowCanvas 同款约定，杜绝中间层退化。
- **L1**：admin add 的 parentId 之前完全不限制（"admin 有完整画布写权限"），codex 提醒"权限语义不等于结构完整性约束"。同 ID 唯一性是 admin 也执行的，parentId 必须指向现有 group 节点也应该 admin 执行 —— 防止挂到孤儿 ID 或非 group 节点。本轮加这条结构校验。
- **L2**（来自七审 L1）：updatedStyle 空对象问题已通过 JSDoc 锁约定。codex 八审建议在调用方也加注释/归一化 —— **本轮不做**，挂 step 9 回归 checklist。理由：现有调用点（grep 已确认）都用 undefined，没有 `{}`；列入回归 checklist 是为了未来若有调用方 bug 能在测试中发现。

**调用图扫描**：八审 codex 还要求 Claude 全局扫一遍 `addNodes` / `applyNodeChanges` / `deleteElements` / `parentId` 直写。本轮扫了 13 个文件，确认没新发现的直写口（其余 4 个文件如 useMultiCanvas / useAutoSave / BFV / NodeDetailPanel，要么是读 parentId、要么是 hydrate 拷贝、要么是 storage 序列化，都不是 mutation 漏洞）。useMultiCanvas.duplicateSheet 复制画布是画布级动作，不属于 P3D-2 step 3"节点级 mutation gate"范围。

**新发现的潜在风险（不在本轮修，挂九审讨论）**：useFlowHistory.saveHistory 在 React 18 严格模式 / 并发渲染下，setNodes updater 被双调用时**会被重复入栈**。七审 M2 / 八审 M1 都是把 saveHistory 放在 setNodes updater 内（之前 useNodeAlignment 是放入口、更幂等，七审 M2 让我移进闭包了，反而引入了风险）。修法选项：(1) saveHistory 内对比 top of stack 去重 (2) 用 useEffect 监听 (3) 接受风险（StrictMode 双调用只在开发环境）。本轮**不修**避免范围蔓延，挂九审/step 9 讨论。

**门禁判断**：本轮修完后，P3D-2 step 3 的"中心 mutation gate 全覆盖"目标基本达成（3 个 high + 4 个 medium + 2 个 low 都已闭环或明确挂遗留）。九审是兜底确认，**通过即可进 step 4（详情面板权限禁用）**。

---

**第二层：技术细节（codex 八审原话）**

> codex-cli 0.128.0 / advice-only / confidence: medium
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260504_205753.json`
> 上下文文件（3 份）：本轮 patch v2 + 18-七审 + 17-六审 — 均成功载入

**M1：onUpdateGroupLabel 副作用前置 gate**

[useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts) onUpdateGroupLabel：当前 gate 放在 setNodes updater 内部，若无权或目标不存在会 return nds，但外层仍会继续执行 saveHistory/triggerAutoSave 一类副作用的风险仍存在；这与 step 3 "拒绝路径必须在所有 setState/save/autosave 之前" 的口径不一致。

**修法**：把 onUpdateGroupLabel 改成与 handleGroupChange 一样的前置 gate：先用 getNodes 或当前 nodes 找 group，再 canEditNodeData 判权；拒绝时在 setNodes、saveHistory、triggerAutoSave 前直接 return。补一个"普通用户改别人 group label 不应调用 saveHistory/triggerAutoSave"的单测或 spy 测试。

**M2：FlowCanvas user 必传只能拦组件直接调用**

[FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) FlowCanvasProps / 调用点：把 `user` 改为必传 prop 能拦住直接使用 `FlowCanvas` 且走 TypeScript 检查的调用点，但不能保证所有中间包装组件不会把自己的 props 重新声明成 `user?: UserPublic | null` 再传下去；也不能拦 `any`、JS 文件、测试 mock、动态 props spread。

**修法**：Claude 应全局核对 `<FlowCanvas` 调用点和任何包装层 props 类型：顶层来源应是 AuthContext 或等价必有状态；中间层不要重新 optional 化。更稳的方案是 FlowCanvas 内部直接消费 AuthContext，或者在可写模式下运行时断言 `readOnly === false && user === null` 必须是明确游客/未登录状态而非漏传。

**L1：admin add 不校验 parentId 目标存在和类型**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) filterNodeChangesByPermission add 分支：M1 简化版允许 admin 的 add 携带任意 parentId，但结构校验没有要求 parentId 指向现有 group。虽然 admin 有权限，但这仍可能造成孤儿 parentId 或挂到非 group 节点的数据完整性问题；七审说明"admin 不限制"是权限语义，不等于可以放宽结构不变量。

**修法**：若要保持 admin 可直接 add 到 group，建议至少校验 `item.parentId` 为 undefined 或存在于 nodes 且目标节点 type 为 group。普通用户仍保持 parentId undefined，由 onAddToGroup 路径处理。

**L2：isPublicDeprecateUpdate JSDoc 不能阻止未来调用方传 `{}`**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) isPublicDeprecateUpdate JSDoc：L1（七审 L1）只用 JSDoc 锁定 `updatedStyle === undefined` 表无样式更新，能解释当前约定，但不能自动防止未来调用方传 `{}` 导致误拒。

**修法**：在 onNodeUpdate 类型或调用封装处补一句注释，或在调用边界把空对象归一化为 undefined；如果不想改代码，至少把"传 `{}` 会被拒"列入 step 9 回归用例。

---

**Claude 判断**

| # | codex 意见 | Claude 判断 | 理由 |
|---|---|---|---|
| M1 onUpdateGroupLabel 前置 gate | **全修** | 真改善 —— 之前 return nds 依赖 React 视"无变化"语义吞副作用，但 setNodes 调用本身仍触发 React 调度。前置 gate 直接 return，零副作用风险。与 handleGroupChange/onAddToGroup 同模式，一致性也好。|
| M2 user 全链路核对 | **修 + 全链路核对** | grep 确认 `<FlowCanvas` 只 1 个调用点（BFV），但 useFlowHandlers.user 是 optional + default null —— codex 担心的"中间层重新 optional 化"现实存在。本轮把 useFlowHandlers.user 也改必传，与 FlowCanvas 同款。|
| L1 admin add parentId 结构校验 | **全修** | 5 行成本，admin 也执行结构完整性约束（同 ID 唯一性同思路）。把"权限语义"和"结构约束"分开 —— admin 跳过权限不代表跳过结构。|
| L2 调用方归一化空对象 | **不改代码 + 列入 step 9 回归** | grep 确认现有调用点都用 undefined，没有 `{}`。本轮不补充测试 —— 因为现有约定下这条用例的目的是"测调用方约定"不是"测 helper 行为"，跨边界。列入 step 9 回归 checklist。|
| 调用图全局扫描 | **完成，无新发现** | 13 个 setNodes/parentId 写入文件已扫，剩余 4 个（useMultiCanvas / useAutoSave / BFV / NodeDetailPanel）都是读取/hydrate/序列化，不是 mutation 漏洞。useMultiCanvas.duplicateSheet 不属于本 step 范围。|
| saveHistory React 18 双调用幂等 | **不修，挂九审讨论** | 真问题但属于范围蔓延 —— useFlowHistory.saveHistory 不幂等，七审 M2 / 八审 M1 把它放在 updater 内确实增加了双调用风险。但修法（去重保护 / useEffect 监听 / 接受风险）需要单独评估，不在 step 3 收尾。|

**用户决策**

按 Claude 判断全部采纳（用户原话："我都采纳，然后插入一个需求..."）。同时插入两条工作流改进：

1. 调 codex 前必须报预估返回时间
2. 每次修改和 codex 审核都明确"是否为下一阶段开发做好准备"

两条都已写入 `feedback_ai_collaboration.md` 永久生效。

**修复结果**

| 修复 | 位置 | 状态 |
|---|---|---|
| M1 onUpdateGroupLabel 前置 gate | [useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts) `onUpdateGroupLabel` | ✅ |
| M2 useFlowHandlers.user 改必传 | [useFlowHandlers.ts](E:/业务全景图/src/hooks/useFlowHandlers.ts) UseFlowHandlersProps + 函数签名 | ✅ |
| L1 admin add parentId 结构校验 | [canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) filterNodeChangesByPermission add 分支 | ✅ |
| 调用图全局扫描 | 13 个 setNodes/parentId 写入文件 | ✅ 无新发现 |
| 测试：3 个新用例（admin add 三态：ghost / 非 group / 现 group），1 个旧用例语义反转更新 | [canEditNode.test.ts](E:/业务全景图/src/auth/canEditNode.test.ts) | ✅ 68/68 全过 |
| tsc | — | ✅ 0 错误 |

**九审讨论项（不在本轮修但要交 codex 看）**

- saveHistory React 18 双调用幂等性：是否需要在 saveHistory 内加去重保护？还是接受 StrictMode 开发环境的双重入栈？
- step 9 回归 checklist 加一条："调用方传 `{}` 表无 style 改动应被拒（行为锁约定）"

**门禁结论**

P3D-2 step 3 中心 mutation gate 8 轮迭代后基本闭环。九审兜底确认通过即可进 step 4（详情面板权限禁用）。
