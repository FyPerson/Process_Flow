**第一层：非技术总结**

**二审通过，可进 step 5**。codex confidence=high，明确结论"未发现新的阻塞漏洞"。一审给的 2 个 high + 2 个 medium + 1 个 low 全部闭环：

- H1（标废弃公开权限被吞）✅ 修：DeprecateNodeSection 改走 safeOnDeprecateChange（仅 canvasWritable gate），不走 safeOnNodeChange（canEdit gate）
- H2（onUngroup 数据层缺 admin-only）✅ 修：useFlowOperations.onUngroup 顶部加 `if (!canvasWritable) return; if (!user || user.role !== 'admin') return;` 必须早于所有 setNodes/saveHistory
- M1（fieldset 边界）✅ 已核实 + 注释锁定：DeprecateNodeSection 是 NodePropertiesPanel/GroupPropertiesPanel 的兄弟节点，不在 fieldset 内
- M2（边 canEdit fallback）✅ useMemo 加注释明确边走 canvasWritable
- L1（user=null 必伴 readOnly=true）✅ user prop JSDoc 加约定声明 + 确认 BFV 通过 canWriteCanvas 派生满足

二审 codex 还给了 2 个 low（不阻塞）：
1. step 9 RTL 占位清单只是注释，不防回归 → **挂 step 9 RTL 集成测时优先做 H1/H2 两个用例**（已加入清单第 5 / 6 项）
2. safeOnUngroup 只查 isAdmin 不查 canvasWritable —— 数据层 useFlowOperations.onUngroup 已有 canvasWritable 兜底，UI 层冗余可不加。**Claude 倾向加注释明确即可**，不改代码（避免再轮回归）

**门禁判断**：step 4 中心防漏层 + UI 友好层都已覆盖 codex 一审 + 二审所有 high/medium 项；step 9 占位清单的 RTL 集成测属于"延后验证"非"阻塞门禁"。**正式可进 step 5**（节点级 draggable / resizer / 双击 UI 提示）。

**第二层：技术细节（codex 二审原话）**

> codex-cli 0.128.0 / advice-only / **confidence: high**
> 实际耗时：35 秒（预估 30-90 秒，命中）
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260504_221747.json`
> 上下文文件（2 份）：本轮 patch v2 + 21-一审 — 均成功载入

**Low 1：step 9 占位清单不防当前回归**

[canEditNode.test.ts 末尾](E:/业务全景图/src/auth/canEditNode.test.ts) 占位清单：新增的两项只是注释清单，不是当前可执行测试；它们不能防止本轮 H1/H2 以后回归。考虑到 brief 声明 npm test 已全过，这不阻塞 step 5，但门禁语义上仍属于延后验证。

**修法**：step 9 中优先补两个 RTL/Hook 集成测——非作者可写画布点击标废弃应调用 onNodeChange 且 dataUpdates.is_deprecated=true；非 admin 的 group creator 调 onUngroup 不触发 setNodes/saveHistory/triggerAutoSave，admin 路径仍可执行。

**Low 2：safeOnUngroup 只查 isAdmin 不查 canvasWritable**

[NodeDetailPanel/index.tsx](E:/业务全景图/src/components/NodeDetailPanel/index.tsx) safeOnUngroup：safeOnUngroup 只按 isAdmin 决定是否透传，不直接检查 canvasWritable；虽然 useFlowOperations.onUngroup 已有 canvasWritable 数据层兜底，且 readOnly 下 fieldset 会禁用 UI，但这一层注释说"safe 回调按可写性分三层"时容易让维护者误以为 UI 回调本身也包含归档画布 gate。

**修法**：不要求阻塞；可把 safeOnUngroup 改为 `isAdmin && canvasWritable ? onUngroup : (() => undefined)`，或在注释中明确归档画布由 canEdit/fieldset 与 useFlowOperations 双重兜底。

---

**Codex 对 6 个关注点的回应（原话）**

1. **H1 公开权限 + 普通编辑权限拆开是否彻底？**：H1 修法方向正确：DeprecateNodeSection 使用 `safeOnDeprecateChange = canvasWritable ? onNodeChange : no-op`，不再走 canEdit；游客不会因此误放行，因为中心层 `isPublicDeprecateUpdate` 仍要求 user 存在。
2. **H2 admin-only 是否过严？**：H2 admin-only 合理偏保守，符合"内部 5 人并发 + 分组影响全局结构"的项目语境；**不建议**给 group creator 增加 confirm 绕过，因为 confirm 只能防误点，不能解决权限边界。
3. **canvasWritable=false 时 admin 也不能解散是否合理？**：合理。归档/只读画布语义应高于管理员编辑能力，否则只读状态会失去一致性。
4. **fieldset 边界确认？**：从 diff 看是正确的：NodePropertiesPanel 内部只包 tab-content，DeprecateNodeSection 在 NodeDetailPanel 顶层、位于 NodePropertiesPanel/GroupPropertiesPanel 之后，是兄弟节点而不是 fieldset 子节点。
5. **step 9 RTL 占位清单是否合理？**：合理，但更便宜的纯函数测试不足以覆盖回调被 UI 层 no-op 吞掉的问题，H1/H2 仍建议用 RTL/Hook 集成测。
6. **二审通过判定？**：**未发现新的阻塞漏洞，二审通过，可进 step 5**。

---

**Claude 判断**

| # | codex 意见 | Claude 判断 | 理由 |
|---|---|---|---|
| Low 1 占位清单不防回归 | **挂 step 9 RTL 时优先做 H1/H2 用例** | 已加入清单第 5/6 项，step 9 启动时按优先级做 |
| Low 2 safeOnUngroup 加 canvasWritable | **加注释不改代码** | 数据层已兜底（useFlowOperations.onUngroup 二审 H2 已加 `if (!canvasWritable) return`）；UI 层 readOnly → fieldset disabled 也禁用按钮；改代码反而增加测试面，注释明确即可 |

---

**用户决策**

> 留待与用户过完采纳意见后追加。

**修复结果**

| 修复 | 位置 | 状态 |
|---|---|---|
| H1 DeprecateNodeSection 走 canvasWritable | [NodeDetailPanel/index.tsx](E:/业务全景图/src/components/NodeDetailPanel/index.tsx) safeOnDeprecateChange | ✅ |
| H2 useFlowOperations.onUngroup admin-only 数据层 gate | [useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts) onUngroup 顶部 | ✅ |
| M1 fieldset 边界注释 | NodeDetailPanel.tsx DeprecateNodeSection 渲染处 | ✅ |
| M2 边 canEdit fallback 注释 | NodeDetailPanel.tsx canEdit useMemo | ✅ |
| L1 user=null 必伴 readOnly=true 约定 | NodeDetailPanel user prop JSDoc | ✅ |
| step 9 RTL 集成测占位（2 项） | canEditNode.test.ts 末尾清单 | ✅ |
| 测试 npm test 74/74 + tsc 0 错 | — | ✅ |

**门禁结论**

✅ **二审通过，可进 step 5（节点级 draggable / resizer / 双击 UI 提示）**。

**P3D-2 step 4 历程（2 轮 codex 审查）**

| 审次 | 主题 | 关键发现 | 文件 |
|---|---|---|---|
| 一审 | 详情面板权限禁用 | H1 公开权限被吞 / H2 admin-only 数据层缺 / M1 fieldset 边界 / M2 边 fallback / L1 user 约定 | 21-一审 |
| 二审 | 公开权限 + admin-only 闭环 | confidence=high 通过；2 个 low 不阻塞 | 22-二审（本文档） |

step 4 拆 1 轮工作量 + 2 轮 codex 审查 + 1 轮修复，对比 step 3 的 9 轮收敛得很快——印证"5 人内部 + 项目语境前置"让 codex 意见聚焦了。
