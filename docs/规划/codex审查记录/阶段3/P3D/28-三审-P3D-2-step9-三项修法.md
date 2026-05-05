**第一层：非技术总结**

P3D-2 step 9 codex 三审 —— **修完 1 条新发现 medium 后通过门禁**。

二审 3 条修复全部通过验证（admin 归一化 / style 非 object / 边注释）。

新挖出 1 条 medium 候选必修：
- **normalizeNodeParents 不处理 group 嵌套 / 自引用**：codex 把决策权抛回来"业务允许 group 嵌套吗？"

Claude 通过查代码（`useFlowOperations.ts:317` 创建分组时筛选 `n.type !== 'group' && !n.parentId`）确认**业务约定 group 不允许嵌套**——所有 mutation 入口都过滤了 group 类型。这条 codex 是真镜子：normalizeNodeParents 没兜底业务约束，历史脏 snapshot 仍可恢复嵌套 group。

**已修法**：normalizeNodeParents 加两条规则：
1. group 节点本身不能有 parentId（无论指向何处一律清）
2. 普通节点 parentId 自引用 → 清

加 3 个新测试：group 嵌套清 / group 自引用清 / 普通节点自引用清。

测试：120/120 全过（三审时 117，新增 3 项）。tsc -p tsconfig.client.json 0 错。

**最终结论**：step 9 通过门禁，可进 P3E（批注 CRUD + 气泡 UI）。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / advice-only / confidence: high
> 实际耗时：约 2 分钟
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260505_102533.json`
> 上下文文件（3 份）：canEditNode.ts / canEditNode.test.ts / useFlowHistory.ts

**Medium：normalizeNodeParents 不处理 group 嵌套 / 自引用**

[src/auth/canEditNode.ts:normalizeNodeParents](E:/业务全景图/src/auth/canEditNode.ts) 当前归一化规则会保留 `type === 'group'` 且 `parentId` 指向另一个 group 的节点，也会保留自引用场景如 group.parentId 等于自身 id。若项目语义是"group 节点自身不能有 parentId"，这会让历史脏 snapshot 在 admin 或普通用户 undo/redo 后继续携带非法分组结构。

**修法（codex 建议）**：如果 group 不允许嵌套，直接在 helper 中先处理 `n.type === 'group' && n.parentId !== undefined`，清除 `parentId` 和 `extent`；同时加两个单测：group.parentId 指向现有 group 应清除，group.parentId 自引用应清除。

**Claude 决策**：业务全景图当前实际行为 = group 不能嵌套（`useFlowOperations.ts:317` 创建分组时过滤 `n.type !== 'group'`）。修法采纳并扩展：
1. group.parentId 一律清（无论指向 group / 非 group / 自引用）
2. 普通节点 parentId 自引用也清
3. 加 3 个测试覆盖

**recommendations 通过项**

- 二审 medium 修复（admin 归一化）完整 —— admin 路径对 snapshot 做归一化足够，current 不参与合并结果
- 普通用户路径复用 helper 与原内联逻辑等价
- isValidStyleGeometry 判定顺序无冲突
- `Object.create(null)` 被接受为普通对象在当前规则下可以接受（只读取 width/height + 有限数 + 非负），不必收紧
- mergeEdgesForMergedNodes 注释修改无矛盾
- 若确认 group 嵌套清理已加，**step 9 通过门禁可进 P3E**

**risks**

- 边没有 creator_id 的设计仍会让"涉及他人节点的边"采用保守保留策略（已知产品语义限制）
- RTL 集成测仍是占位（ghost onNodeUpdate / 副作用拒绝路径 / StrictMode 幂等 / 公开标废弃端到端等 React 层行为待 P3F 或独立轮次）

---

**Claude 修复方案**

| 严重度 | 项 | 是否修 | 预计 |
|---|---|---|---|
| 🟡 medium | normalizeNodeParents 加 group 嵌套 / 自引用清理 | ✅ 已修 | 5 分钟 |

新增测试：3 个（group 嵌套清 / group 自引用清 / 普通节点自引用清）

**用户决策**：
[x] 修完接进 P3E
[ ] 还有别的考虑

---

**P3D-2 step 9 完整审查链路总结**

| 轮次 | 时间 | 主题 | 结果 |
|---|---|---|---|
| 26-代码审查 一审 | 三项修法初版 | 1 critical + 1 high + 2 medium + 1 low | 修 |
| 27-二审 | 一审反馈修复后 | 0 critical + 1 medium + 2 low | 修 |
| 28-三审 | 二审反馈修复后 | 0 critical + 1 medium（产品决策） | 修后通过 |

**门禁结论**：P3D-2 step 9 完成，可进 P3E。
