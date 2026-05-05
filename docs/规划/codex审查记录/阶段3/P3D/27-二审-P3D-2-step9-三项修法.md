**第一层：非技术总结**

P3D-2 step 9 三项修法 codex 二审 —— **通过门禁，可进 P3E**。

一审 5 条修复全部通过验证（critical Edge import / high parentId 归一化 / medium 1 命名 / medium 2 style NaN / low 注释）。

新挖出 3 条建议级（不是必修，不阻塞门禁）：
- **Medium（admin 归一化口径不一致）**：admin undo 直接返 snapshot 没走 parentId 归一化。**真镜子**：设计 admin 短路时只想"admin 全画布写权限"，没想"admin 也应享受数据完整性归一化"。
- **Low（style 非 object 放行过宽）**：`isValidStyleGeometry` 对 string/number/array 异常入参返 true。不影响公开标废弃但理论上让脏数据进合并。
- **Low（注释措辞）**：mergeEdgesForMergedNodes "自己有权操作的边"容易被误读。

codex 明确认可：destructuring 安全 / isValidStyleGeometry 前置不破坏标废弃语义 / RTL 7 项 checklist 归档合理 / **建议判定为通过 step 9 门禁**。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / advice-only / confidence: medium
> 实际耗时：约 3 分钟
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260505_101845.json`
> 上下文文件（4 份）：canEditNode.ts / canEditNode.test.ts / useFlowHistory.ts / FlowCanvas/index.tsx — 均成功载入

**Medium：admin 分支不归一化 parentId**

[src/auth/canEditNode.ts:438](E:/业务全景图/src/auth/canEditNode.ts) `mergeSnapshotByPermission` 在 admin 分支直接 `return snapshot`，不会经过第 3 步 parentId/extent 归一化。若历史 snapshot 本身含孤儿 parentId 或 parent 指向非 group，admin undo/redo 会把脏结构整份恢复；这与后面对普通用户执行的数据完整性归一化口径不一致。

**修法**：将归一化抽成 `normalizeNodeParents(nodes)`，admin 分支返回 `normalizeNodeParents(snapshot)`。如果确实要允许 admin 原样恢复，需要在注释中明确这是有意保留历史脏结构，并补一个单测锁定行为。

**Low 1：isValidStyleGeometry 非 object 放行过宽**

[src/auth/canEditNode.ts:99](E:/业务全景图/src/auth/canEditNode.ts) `isValidStyleGeometry` 对非 object 的 `updatedStyle` 返回 true。这样不会放行公开标废弃路径，但会允许 creator/admin 的普通更新携带字符串、数字等异常 style 值进入后续合并逻辑，取决于 `onNodeUpdate` 的实现，可能导致样式字段异常或运行时行为不一致。

**修法**：建议改为 `style === null || style === undefined` 放行，`typeof style !== 'object' || Array.isArray(style)` 拒绝。

**Low 2：mergeEdgesForMergedNodes 注释措辞**

[src/auth/canEditNode.ts:524](E:/业务全景图/src/auth/canEditNode.ts) 注释写的是"取 snapshot.edges 里两端都在 mergedNodeIds 内的边 → 保留（正常回滚自己有权操作的边）"，但代码并不校验 edge 本身是否由当前用户有权操作，只按端点存在保留。由于边没有 creator 字段，这是可接受的 fail-closed 取舍，但注释里的"自己有权操作的边"容易被误读为有额外权限判断。

**修法**：把该句改成"取 snapshot.edges 里两端都在 mergedNodeIds 内的边 → 保留；边无 creator 字段，权限语义按节点合并结果近似处理"。

**recommendations 通过项**

- 必修：未发现阻塞 P3D-2 step 9 的新问题；一审 critical/high/medium/low 修复方向均成立
- 通过：destructuring 写法 `const { parentId: _drop, extent: _drop2, ...rest } = n; return rest` 在当前用途上安全，浅拷贝清除顶层 React Flow 字段，不会改写原 snapshot/current 节点对象
- 通过：isValidStyleGeometry 放在 canApplyNodeUpdate 最前不破坏 isPublicDeprecateUpdate 语义边界（带 style 的标废弃仍不走公开权限）
- 通过：剩余 RTL 集成测作为 checklist 归档合理，前提是 P3E 不继续扩大 FlowCanvas/useFlowHandlers 权限面

**risks（codex 自承不确定）**

- 未看 useFlowHandlers.ts / useFlowOperations.ts / 完整 FlowCanvas/index.tsx，无法确认所有调用点把"无 style 改动"归一化为 undefined
- 边没有 creator_id，undo/redo 对边只能按端点保护近似（已知产品取舍）
- admin 原样恢复 snapshot 若遇历史脏数据，会把孤儿 parentId 带回状态树（影响数据一致性，不是越权）

---

**Claude 修复方案**

| 严重度 | 项 | 是否修 | 预计 |
|---|---|---|---|
| 🟡 medium | admin 分支也走 parentId 归一化 | ✅ 修 | 10 分钟 |
| ⚪ low 1 | isValidStyleGeometry 收紧非 object 入参 | ✅ 修 | 5 分钟 |
| ⚪ low 2 | mergeEdgesForMergedNodes 注释措辞 | ✅ 修 | 1 分钟 |

新增测试：
- mergeSnapshotByPermission：admin + snapshot 含脏 parentId → 归一化清除
- canApplyNodeUpdate：style 是 string/array → false（fail-closed）

**用户决策**：
[ ] 修完三条直接合入主干进 P3E  [ ] 不修建议级，直接合入  [ ] 修哪条、跳哪条
