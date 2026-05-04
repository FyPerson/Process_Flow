**第一层：非技术总结**

**九审通过，可进 step 4**。codex 给了 1 个 medium + 2 个 low：

- **Medium（onNodeUpdate ghost nodeId）**：现有逻辑 `if (targetNode && !canApplyNodeUpdate(...)) return` 在 nodeId 找不到时不进 if，会落到下面的 setNodes 副作用路径。codex 建议作为"进 step 4 前的小补丁"修一下。**本轮收尾修**。
- **Low 1（saveHistory React 18 双调用幂等）**：codex 明确说"不阻塞 step 4，挂 step 9"。同意。
- **Low 2（updatedStyle `{}` JSDoc 锁约定）**：codex 明确说"不建议本轮放宽 helper，挂 step 9 回归 checklist 即可"。同意。

**关注 6 - 门禁判断**：codex 原话"九审通过，可进 step 4；附带一个非阻塞兜底修复建议"。修完 medium 后即可正式标 P3D-2 step 3 闭环。

**对照 step 3 → step 4 门禁定义**：step 3 目标"中心 mutation gate 全覆盖"。9 轮迭代后：
- ✅ 节点级 mutation 中心 gate（`filterNodeChangesByPermission`）覆盖 add/replace/position/dimensions/remove
- ✅ 数据完整性约束（id 非空、不重复、批内不重、parentId 指向 group）
- ✅ 攻击面穷举（伪造 creator_id / __localNew / item.id 错配 / data.id 错配 / 同批重 ID / ghost 目标）
- ✅ 调用图覆盖（wrappedOnNodesChange / onNodeUpdate / handleGroupChange / handleDelete / 4 个分组函数 / alignNodes / 节点组件双击 / NodeResizer）
- ✅ user 链路必传（FlowCanvas + useFlowHandlers）
- ⏳ 待修：onNodeUpdate ghost nodeId 早退（本轮收尾）
- 📌 step 9 接力：useFlowHistory undo/redo 权限 diff、saveHistory 幂等、NaN/Infinity 数值校验、`{}` updatedStyle 回归

**第二层：技术细节（codex 九审原话）**

> codex-cli 0.128.0 / advice-only / confidence: medium
> 调用耗时：实际 41 秒（预估 2-4 分钟，下次同规模 70KB context 估 30-90 秒）
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260504_211005.json`
> 上下文文件（3 份）：本轮 patch v3 + 19-八审 + 18-七审 — 均成功载入

**Medium：onNodeUpdate ghost nodeId 没有 fail-closed 早退**

[useFlowHandlers.ts](E:/业务全景图/src/hooks/useFlowHandlers.ts) onNodeUpdate 前置 gate：当前逻辑只有在 targetNode 存在且 canApplyNodeUpdate=false 时才 return；如果 nodeId 在闭包 nodes 中找不到，会继续进入 setNodes。多数情况下不会改到节点，但仍可能触发后续 saveHistory/triggerAutoSave/setSelectedElement 这类副作用，和 step 3 "拒绝路径必须在所有 setState/save/autosave 之前" 的口径不完全一致。

**修法**：把前置判断改成 fail-closed：`const targetNode = nodes.find(...); if (!targetNode) return; 然后再执行 canApplyNodeUpdate`。若担心闭包 nodes 陈旧，可改用 `getNodes()` 获取最新节点，或在 setNodes updater 内只做最终一致性校验，**但副作用必须只在确认命中且允许后执行**。

**Low 1：saveHistory React 18 双调用幂等性**

[useNodeAlignment.ts](E:/业务全景图/src/hooks/useNodeAlignment.ts) 与 [useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts) 在 setNodes updater 内 saveHistory：saveHistory 放在 setNodes updater 内会受 React 18 StrictMode/并发渲染中 updater 可能重复调用的影响，导致开发环境或特定调度下历史栈重复入栈。**该问题影响 undo 体验和历史记录质量，但不是权限 gate fail-open，也不会使无权 mutation 被应用。**

**修法**：不阻塞 step 4；挂 step 9 处理更合适。建议优先在 useFlowHistory.saveHistory 内做幂等去重：比较 history 栈顶 snapshot 与新 snapshot，完全相同则不 push。这样能覆盖所有调用点，成本低于逐个迁移副作用位置。

**Low 2：isPublicDeprecateUpdate JSDoc / 调用方约定**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) isPublicDeprecateUpdate JSDoc / 调用方约定：将 `updatedStyle={}` 视为有样式改动并拒绝公开标废弃路径，是当前约定下合理的 fail-closed 行为，但它依赖未来调用方知道"无 style 必须传 undefined"。只写在 helper JSDoc 中，调用边界仍容易被新代码误用。

**修法**：不建议在本轮放宽 helper。把"调用方传 `{}` 表无 style 改动应被拒"写入 step 9 回归 checklist 是合理的；同时建议在 NodeUpdateParams 或 onNodeUpdate 调用封装处补同样约定说明。

**Codex 对 6 个关注点的回应（原话）**

1. **关注 1（M1 setNodes 副作用风险）**：M1 修法成立，未看到该路径还有明显隐性触发点。
2. **关注 2（user 全链路必传）**：BFV → FlowCanvas → useFlowHandlers/useFlowOperations/useNodeAlignment 都在 patch 中体现为必传；未看到新的 optional 化中间层。
3. **关注 3（L1 误伤 React Flow？）**：不应误伤 —— 自动布局只是 position/dimensions，不会受影响。"add 带 parentId" 是结构性插入，要求 parentId 存在且为 group 是合理不变量。
4. **关注 4（调用图扫描完整性）**：useMultiCanvas/useAutoSave 按 brief 不应纳入 step 3 阻塞项；但本轮未读取文件，依赖 brief 中的扫描结论。
5. **关注 5（saveHistory 幂等阻塞 step 4？）**：不阻塞，挂 step 9。
6. **关注 6（能进 step 4？）**：**九审通过，可进 step 4；附带 1 个非阻塞兜底修复建议**（onNodeUpdate ghost nodeId 早退）。

**Risks（codex 原话）**

- 本审查只基于提供的 patch 和审查记录，没有读取完整文件，因此对 BFV 调用点、useMultiCanvas/useAutoSave 的判断依赖 brief 中的扫描结论。
- 前端 mutation gate 是防漏层，仍需服务端权限校验兜底；若服务端允许未授权节点更新，前端门禁不能构成最终安全边界。
- saveHistory 幂等问题若长期不处理，可能让开发环境或并发场景下 undo 栈出现重复快照，但它不改变本轮是否能进入 step 4 的判断。

**Notes for Claude Code（codex 原话）**

> 建议将 onNodeUpdate 的 ghost nodeId 早退作为进入 step 4 前的小补丁处理；其余讨论项可归档到 step 9。最终门禁表述建议写为：**九审通过，可进 step 4；附带一个非阻塞兜底修复建议**。

---

**Claude 判断**

| # | codex 意见 | Claude 判断 | 理由 |
|---|---|---|---|
| Medium ghost nodeId 早退 | **修，5 行成本** | codex 指对了 —— targetNode === undefined 时**不进 if**，会落到下面的 setNodes 路径。修法是把 `targetNode &&` 拿出来：`if (!targetNode) return; if (!canApplyNodeUpdate(...)) return;`。10 秒 + 1 个测试用例。codex 自己也说"作为进入 step 4 前的小补丁"——本轮做完更干净。|
| saveHistory 幂等 | **挂 step 9 (与 codex 同)** | step 9 时和 useFlowHistory undo/redo 整体重构一起处理，连带 React StrictMode 兼容。现在不是 blocker。|
| L2 调用方约定 | **挂 step 9 回归 (已记录)** | 八审已挂、九审再次确认，本轮不做。|

**用户决策**

按 Claude 判断全部采纳（用户原话："按你的建议执行"）。同时插入需求：盘点全局预存在问题 → Claude 建议建独立的 `docs/规划/技术债务登记.md` → 用户接受。

**修复结果**

| 修复 | 位置 | 状态 |
|---|---|---|
| Medium ghost nodeId 早退 | [useFlowHandlers.ts](E:/业务全景图/src/hooks/useFlowHandlers.ts) onNodeUpdate 前置 gate | ✅ 已修：`if (!targetNode) return` 提前到 canApplyNodeUpdate 之前；ghost 路径直接早退 |
| RTL 集成测占位（不在 helper 单测层） | [canEditNode.test.ts](E:/业务全景图/src/auth/canEditNode.test.ts) 末尾追加"step 9 待补 RTL 集成测"注释清单（4 项：ghost nodeId / onUpdateGroupLabel 拒绝不调副作用 / `{}` updatedStyle 行为锁 / saveHistory 幂等） | ✅ 已写占位 |
| step 9 回归 checklist 更新 | [docs/规划/技术债务登记.md](../../技术债务登记.md)（新建） | ✅ 已建并归档 8 项 step 9 项 |
| 测试 | npm test 68/68 全过 + tsc 0 错误 | ✅ |

**门禁结论**

- **九审 codex 判定：通过，可进 step 4**
- **Claude 收尾承诺**：补 medium ghost nodeId 早退后，正式标 P3D-2 step 3 闭环
- **下一阶段**：P3D-2 step 4（详情面板权限禁用）

**P3D-2 step 3 历程（9 轮 codex 审查）**

| 审次 | 主题 | 关键发现 | 文件 |
|---|---|---|---|
| 一审 | 中心 gate 起点 | 防漏层未成型 | 12-代码审查 |
| 二审 | helper 重构 | 抽 3 个纯函数 | 13-二审 |
| 三审 | replace 伪造 | item.data 信任 | 14-三审 |
| 四审 | ID 边界 | item.id===change.id | 15-四审 |
| 五审 | 同批 add 重复 | 批级预扫描 | 16-五审 |
| 六审 | 调用图绕过 | high1 分组操作 + high2 alignment | 17-六审 |
| 七审 | 旧父分组 + user 接线 | H1 旧父 / H2 user 必传 / M1 parentId 拒变更 / M2 saveHistory 顺序 | 18-七审 |
| 八审 | 前置 gate + 全链路核对 | M1 onUpdateGroupLabel 前置 / M2 useFlowHandlers user 必传 / L1 admin add 结构校验 | 19-八审 |
| 九审 | 门禁兜底 | Medium ghost nodeId 早退 / Low saveHistory + L2 挂 step 9 | 20-九审（本文档）|

总计 9 轮迭代、4 个 high + 多项 medium/low、test 从初始 ~10 增至 68。
