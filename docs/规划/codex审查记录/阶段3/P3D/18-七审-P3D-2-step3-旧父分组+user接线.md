**第一层：非技术总结**

**还不能进 step 4。** 我（Claude）按六审 17 的反思约定先自审一轮把 high1/high2/medium1/medium2 修了，npm test 62/62 全过、tsc 0 错误。codex 七审读完 patch 没推翻方向（确认主干修法对、`__data.id` 兼容放行合理、`reset` 类型不漏），但**跳出来又抓到 2 条**真漏洞：

- **High 1（旧父分组权限）**：onCreateGroup / onAddToGroup 把节点从一个分组挪到另一个分组时，只校验了"子节点 + 新父分组"，没校验"旧父分组"。普通用户可以把自己的节点（在别人的旧分组里）挪到自己的新分组里 —— 等于绕过 onRemoveFromGroup 已有的"父分组也必须可编辑"语义。要把分组关系变更定义为 oldParent / newParent / child **三方权限**。

- **High 2（user prop 静默退化）**：FlowCanvas 把 `user` 做成可选 + 默认 null。如果某个调用点忘了传 user，TypeScript 不会报错、测试也覆盖不到，结果是登录用户被当游客处理 —— 自己的节点改不了、标废弃也废弃不掉。codex 建议要么"可写模式下 user 必传"，要么"FlowCanvas 内部直接从 AuthContext 取"，避免静默失败点。

另外 3 条 medium/low：
- **Medium 1**：helper 还没约束 add/replace 的 parentId 字段。即使 UI 分组函数都加了 gate，只要将来谁构造一个带 parentId 的 add/replace change，权限就漏。要么 helper 拒绝 parentId 变更，要么明确把这条标"遗留风险，挂 step 9"。
- **Medium 2**：useNodeAlignment 的 saveHistory 在闭包内最终校验**之前**调用，竞态失败时会写一条无效历史快照。修法是把"最终权限校验 → hasChanges 判断 → saveHistory → 节点更新"放到同一份 currentNodes 语义下。
- **Low 1**：isPublicDeprecateUpdate 对 `updatedStyle` 用 `!= null` 判定，意味着空对象 `{}` 也算"有 style 改动"。如果某个调用方默认传 `{}` 表 "无 style 更新"，非 creator 用户就会被误拒标废弃。需要确认调用约定，或改成"空对象视为无 style"。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / advice-only / confidence: medium
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260504_203523.json`
> 原文 final：同目录 `.final.txt`
> 上下文文件（3 份）：本轮 patch、17-六审、12-代码审查 — 均成功载入（`contextFilesCount: 3`）

**High 1：旧父分组未参与权限校验**

[useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts) onCreateGroup（约 321 行）/ onAddToGroup（约 469 行）：当前校验覆盖"被操作子节点 + 新 group"，但没有覆盖子节点已有 parentId 指向的旧父分组。若用户可编辑自己的子节点，但旧父分组不可编辑，onCreateGroup 或 onAddToGroup 仍可能把该节点改挂到新分组，相当于绕过 onRemoveFromGroup 对父分组也必须可编辑的语义。

**修法**：把 parentId 变更定义为需要 oldParent、newParent、child 三方权限。onCreateGroup/onAddToGroup 在 setNodes/saveHistory 前收集 targetNodes 的旧 parentId；旧父存在且不同于目标 group 时必须找到对应 group 且 canEditNodeData 为 true，否则整体 return。补"自己的节点在别人分组内，重新分组/加入新分组应拒"的用例。

**High 2：FlowCanvas user 可选 + 默认 null 是静默失败点**

[FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) FlowCanvasProps user / 所有 `<FlowCanvas>` 调用点：补丁把 user 做成可选并默认 null，但没有提供上游调用点内容。若任一 writable 画布调用点未传当前登录用户，权限 gate 会把登录用户当游客；TypeScript 不会报错，测试也可能覆盖不到，结果是正常用户无法编辑已拥有节点或标废弃。

**修法**：七审前读取并确认所有 FlowCanvas 调用点都传入当前 UserPublic；更稳的是让 user 在可写模式下成为必传 prop，或在 FlowCanvas 内部直接从 AuthContext 获取，避免 optional default null 静默退化。

**Medium 1：filterNodeChangesByPermission 不约束 parentId**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) filterNodeChangesByPermission add/replace 分支（约 112-156 行）：helper 仍不约束 add/replace 的 parentId。即使 UI 分组函数补了 gate，只要有任何 React Flow 或内部调用路径把 parentId 放进 add/replace change，普通用户仍可用 __localNew add 或可编辑节点 replace 把节点挂到不可编辑分组下。

**修法**：如果 step 3 要继续宣称中心 mutation gate 覆盖结构性写入，建议在 helper 中至少拒绝 parentId 变更，或要求新父分组存在且可编辑；replace 还应比较原节点 parentId 与 item.parentId，发生变化时同时校验旧父和新父。若决定不在本步修，必须把这条从"已覆盖"改成明确遗留风险。

**Medium 2：useNodeAlignment 的 saveHistory 顺序不对**

[useNodeAlignment.ts](E:/业务全景图/src/hooks/useNodeAlignment.ts) alignNodes（约 25-45 行）：入口和 setNodes 闭包的二次 canEditNodeData 校验方向是对的，但 saveHistory(allNodes, allEdges) 已经在闭包内最终校验之前执行。若二次校验因竞态失败，虽然不会移动节点，仍可能写入一条无效历史快照；如果选区变化，历史快照也可能与实际被对齐的 currentNodes 不一致。

**修法**：把最终权限校验、hasChanges 判断、saveHistory 和节点更新放到同一份 currentNodes 语义下；可保留入口早退作为体验优化，但最终副作用门应在同一个 currentNodes 校验之后。

**Low 1：isPublicDeprecateUpdate 对空对象 updatedStyle 误拒**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) isPublicDeprecateUpdate（约 75 行）：`updatedStyle != null` 的判定让空对象 `{}` 也使"仅标废弃"公开路径失效。如果某个调用方默认传 {} 表示无样式更新，非 creator 登录用户标废弃会被误拒。

**修法**：确认 onNodeUpdate 调用约定确实用 undefined/null 表示无 style；若存在空对象默认值，则把空对象视为无 style，或在调用方规范化成 undefined，并加一个空 style 用例。

**已闭环 / codex 已确认无问题**

- **关注 1（group + 子节点双方都要可编辑是否过严？）**：codex 确认不算过严，分组成员关系同时影响容器和子节点，保守 all-or-nothing 是合理语义。**真正缺口是旧父分组也应纳入同一语义**（→ High 1）。
- **关注 3（itemDataId === undefined 放行兼容性？）**：codex 确认放行**是合理的兼容选择**。React Flow 的 Node.data 是应用自定义数据，官方 NodeChange 文档没有保证 data.id 一定存在。若业务要强制 data.id，应在节点创建/导入归一化层做。
- **关注 4（NON_MUTATING_TYPES 是否漏 'reset'？）**：codex 查了官方文档确认 NodeChange union 是 dimensions / position / select / remove / add / replace，**未列 reset**；v12 reset 已被 replace 取代。当前 NON_MUTATING_TYPES 只放 select **是合理的**。来源：https://reactflow.dev/api-reference/types/node-change

**Codex 没做的**

- 没有执行本地 src 全量扫描。Claude 自己搜了 8 个 setNodes 直写文件并核对（其中 useFlowHistory 挂 step 9，useFlowClipboard 自审通过），codex 建议复核 useFlowHandlers / CustomNode / GroupNode / FlowCanvas 调用方未完整展开的直写入口。
- 没有改文件、没有运行测试、没有执行本地命令；只审了 patch + 背景文件 + 查了 React Flow 官方文档回应 reset 类型问题。

**Claude 判断**

| # | codex 意见 | Claude 判断 | 理由 |
|---|---|---|---|
| H1 | onCreateGroup / onAddToGroup 加旧父分组 gate | **修一半（仅 onAddToGroup 修）** | onCreateGroup 已经在 line 317 用 `!n.parentId` 过滤掉所有带父节点 → codex 这条对 onCreateGroup 是误报。onAddToGroup 真漏，加"oldParentId 三方权限"。|
| H2 | FlowCanvas user 不应 default null | **全修** | 调用点只 1 处（BFV）已经在传 user，改成必传 prop（去掉 `?` 和 default null）零回归成本，但杜绝未来新增调用点忘传。|
| M1 | helper 拒绝 add/replace 改 parentId | **修简化版** | 不引入跨分组权限判断，只断"通过 NodeChange 偷改 parentId"这一条路。replace 必须 `item.parentId === target.parentId`（含 admin）；普通用户的 add 必须 `parentId === undefined`（走 onAddToGroup 才能进分组）。10 行+ 4 个测试用例。与 H1 双层兜底，未来谁加新路径也漏不了。|
| M2 | alignNodes saveHistory 移到闭包最终校验后 | **全修** | 入口 `saveHistory` 改到 setNodes 闭包内最终校验后；同时 `getEdges()` 也挪到闭包内取最新值，确保"权限校验 + 副作用 + 历史快照"在同一份 currentNodes/edges 语义下。|
| L1 | isPublicDeprecateUpdate 空对象误拒 | **不修代码，加注释锁约定** | grep 确认所有 onNodeUpdate 调用点（FlowCanvas/index.tsx:627 / 646）都用 `undefined` 表"无 style"，没有传 `{}` 的。在 isPublicDeprecateUpdate JSDoc 注明此约定 —— 未来若有调用方传 `{}` 是调用方 bug，应在调用方归一化，不在中心 gate 放宽。|

**用户决策**

按 Claude 判断全部采纳（用户原话："按你的建议，继续"）。

**修复结果**

| 修复 | 位置 | 状态 |
|---|---|---|
| H1 onAddToGroup 旧父分组 gate | [useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts) `onAddToGroup` | ✅ |
| H2 FlowCanvas user 改必传 | [FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) FlowCanvasProps + FlowCanvasContent + FlowCanvas 三处去掉 `?` 和 default null | ✅ |
| M1 helper 拒 parentId 变更 | [canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) `filterNodeChangesByPermission` add/replace 分支 | ✅ |
| M2 alignNodes 副作用顺序 | [useNodeAlignment.ts](E:/业务全景图/src/hooks/useNodeAlignment.ts) `alignNodes` | ✅ |
| L1 注释锁定 onNodeUpdate 约定 | [canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) `isPublicDeprecateUpdate` JSDoc | ✅ |
| 测试：4 个新用例（replace parentId mismatch admin/user / add user with parentId / add admin with parentId） | [canEditNode.test.ts](E:/业务全景图/src/auth/canEditNode.test.ts) | ✅ 66/66 全过 |
| tsc | — | ✅ 0 错误 |

**SKILL 改进（顺手做的）**

七审记录之前差点没归档 —— [codex-cli-bridge SKILL.md](C:/Users/FY/.claude/skills/codex-cli-bridge/SKILL.md) 加了第 8 步"检查项目归档约定 + 落一份持久化"+ 第 10 步"回写决策"，避免下次再漏。同时把 `-ContextFiles` 必须用 `@(...)` 数组语法的坑写进示例（第一次跑时踩了，contextFilesCount 是 1 而不是 3，codex 实际只看到 brief 没看到附件）。

**结论**

进入八审。

