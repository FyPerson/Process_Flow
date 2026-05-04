**第一层：非技术总结**

**还不能进 step 4。** 这次 codex 跳出 helper 内部，查了**整张调用图**——发现 helper 自己写得没问题（5 轮迭代 + 我自主穷举攻击场景后），但 P3D-2 step 3 的目标"中心 mutation gate 全覆盖"还有几条**直接 setNodes 写口绕过 helper**：

- **High 1**：分组操作（Ctrl+G 创建分组 / Ctrl+Shift+G 解散 / 从分组移出节点）—— `useFlowOperations.ts` 里 `onCreateGroup` / `onUngroup` / `onRemoveFromGroup` 直接 `setNodes`，没过 filterNodeChangesByPermission。普通用户可以 Ctrl+G 把别人节点拖进自己的新分组，或 Ctrl+Shift+G 解散别人的分组。
- **High 2**：对齐工具 —— useNodeAlignment 虽然加了 `__canEdit` 全过滤，但**没传 user / canvasWritable**，万一 `__canEdit` 派生丢了就漏。codex 建议改成同源用 canEditNodeData。

另外 3 个 medium：
- helper 内部 `parentId` / `data.id` 应用级不变量没校验（攻击者可把自己节点挂到别人分组下）
- 未知 NodeChange 类型当前是 fail-**open**（React Flow 升级新增类型就漏）
- position/dimensions 没校验数值合法性（NaN / Infinity 不拦）

这是我作为开发主力的失职——之前 5 轮 codex 都聚焦在 helper 内部，我跟着 codex 节奏看 helper，**没主动跳出来审整张调用图**。Ctrl+G 把别人节点抓进分组绝对是绕过，这条本来在我自己穷举攻击场景时就该想到。

**第二层：技术细节（codex 原话）**

**High 1：分组操作直接 setNodes 绕过 helper**

[useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts) `onCreateGroup` / `onUngroup` / `onRemoveFromGroup`；[FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) 快捷键和详情面板回调：这些路径直接调用 `setNodes` 修改节点结构，只依赖 `readOnly` 或上层 UI 显示控制，没有在写状态前用 `canEditNodeData` 做节点级判权。普通用户在可写画布中可能通过 Ctrl+G 修改他人节点的 `parentId`，通过 Ctrl+Shift+G 解散他人分组，或通过详情面板入口移出分组；这些修改不会经过 `filterNodeChangesByPermission`。

**修法**：在每个直接写入口的所有 `setNodes/saveHistory/triggerAutoSave` 之前增加 all-or-nothing gate——`onCreateGroup` 要求所有被分组节点可编辑；`onUngroup` 至少要求目标分组可编辑，若会改子节点也要求子节点可编辑；`onRemoveFromGroup` 要求目标节点和必要时父分组可编辑。失败时直接 return，并同步禁用对应按钮和快捷键。

**High 2：对齐工具调用签名缺权限上下文**

[FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) AlignmentToolbar / [useNodeAlignment.ts](E:/业务全景图/src/hooks/useNodeAlignment.ts)：对齐工具只用 `!readOnly && showAlignmentToolbar` 控制可见性，`useNodeAlignment({ setNodes, saveHistory })` 的调用签名没有传入 `user`、`canvasWritable` 或权威判权函数。若 `alignNodes` 直接移动选中节点，就会成为移动他人节点的绕过口。

**修法**：将 `user`、`canvasWritable` 和当前节点快照传入 `useNodeAlignment`，在对齐前对所有选中节点执行 `canEditNodeData`；建议混合选择中只要存在不可编辑节点就整体拒绝，并在工具栏层禁用或隐藏。

**Medium 1：helper 内部应用级不变量未校验**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) `filterNodeChangesByPermission` add/replace 分支：当前结构校验只覆盖 `item.id`、重复 ID、目标存在和 `replace item.id === change.id`，没有校验应用级不变量，例如 `item.data.id === item.id`、`replace` 是否保持原 `node.type`、以及 `parentId` 是否指向合法且可编辑的分组。攻击者可构造 `add` 或 `replace` 让自己的节点挂到他人分组下，或制造 `node.id` 与 `data.id` 不一致的状态。

**修法**：为 add/replace 增加应用级结构校验：`item.data.id` 必须等于 `item.id`；`parentId` 若存在必须指向现有 group；如果 parent 变化涉及分组权限边界，则要求旧父分组和新父分组也可编辑，或直接拒绝通过 NodeChange 改 parent；`replace` 默认应保持原 `type`，除非有明确白名单场景。

**Medium 2：未知 NodeChange type fail-open**

`if (!MUTATING_TYPES.has(change.type)) return true` 对未知 NodeChange 类型是 fail-open。React Flow 12 当前主要是 `select/position/dimensions/remove/add/replace`，但一旦库新增 mutating 类型，或调用方构造未知类型，中心 gate 会直接放行。

**修法**：改成显式 allow-list——只有 `select` 作为非 mutating 放行；已知 mutating 类型进入现有校验；未知类型默认拒绝，并补一个 unknown type 测试。

**Medium 3：position/dimensions 数值未校验**

position/dimensions 只校验 id，不校验 payload 数值。构造 `NaN`、`Infinity`、负尺寸或极大尺寸可能污染前端布局状态，admin 路径也会通过。

**修法**：对 `position.position`、`position.positionAbsolute`、`dimensions.dimensions` 增加有限数值校验；尺寸应限制为非负且最好有合理上限。

**修复方案（待修）**

| 严重度 | 修复 | 是否修 | 预计 |
|---|---|---|---|
| 🔴 high 1 | useFlowOperations onCreateGroup/onUngroup/onRemoveFromGroup all-or-nothing gate | ✅ 修 | 20 分钟 |
| 🔴 high 2 | useNodeAlignment 改接 user/canvasWritable，调 canEditNodeData | ✅ 修 | 10 分钟 |
| 🟡 medium 1 | filterNodeChangesByPermission 加 `item.data.id===item.id` 校验 | ✅ 修一半 | 5 分钟 |
| 🟡 medium 1 | parentId 跨分组权限 | ❌ 不在 helper 修 | —— |
| 🟡 medium 2 | 未知 type allow-list | ✅ 修 | 5 分钟 |
| 🟡 medium 3 | position/dimensions NaN/Infinity 校验 | ❌ 不修 | —— |
| 测试 | 分组他人 / 解散他人 / 移出他人 / 对齐含他人 / 未知 type / data.id 不一致 | ✅ | 20 分钟 |

**Claude 判断**

- **High 1+2 必修**——是真漏洞，且符合 step 3 "中心 mutation gate 全覆盖"目标。我之前疏忽没主动审 useFlowOperations.ts，本轮承诺先全文读再改。
- **Medium 1 修一半**——`item.data.id === item.id` 在 helper 加 5 行就能覆盖；`parentId` 跨分组权限属于"应用层关系语义"，不应该混进通用 NodeChange filter，应该在 high 1 修分组操作时同步覆盖（哪个节点的 parent 被改 → 看新旧 parent 都要可编辑）。
- **Medium 2 修**——未知 type allow-list 改成 fail-closed，5 行成本，防御深度，未来 React Flow 升级也安全。
- **Medium 3 不修**——这是渲染崩溃风险不是权限漏洞，React Flow 内部应有数值规范化；如果出问题应该在 step 9 集成测发现，P3D-2 step 3 不背这个责任。

**结论**

不能进 step 4。补完上述修复后进入七审。

**自我反思（重要）**

之前 5 轮 codex 评审 + 我修复的循环，我**主动权完全让出去了**——每轮等 codex 指漏，被动修。这次 codex 跳出来看调用图能挖到我没想到的真漏洞，证明我作为开发主力没尽到"主动穷举攻击面"的责任。

从七审开始：
1. **先打开 useFlowOperations.ts / useNodeAlignment.ts / useFlowHandlers.ts 全文读一遍**，主动找直接 `setNodes` 写口
2. **写完自测一轮**：自己列攻击场景，自己写防御 + 测试，到我满意为止
3. **再交 codex 兜底**——这次 codex 是查漏补缺，不是替我排错
