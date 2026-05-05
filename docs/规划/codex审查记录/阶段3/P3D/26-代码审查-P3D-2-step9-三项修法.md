**第一层：非技术总结**

P3D-2 step 9 三项修法（undo/redo 权限 gate / saveHistory 幂等 / NaN 校验）一审。

codex 给出 1 critical + 1 high + 2 medium + 1 low：
- **Critical（真错，Claude 一开始误判为误报）**：`Edge` 类型未导入，编译错误。我用 `npx tsc --noEmit` 验证时走的是 root tsconfig.json（references 模式不会触发子项目编译），导致编译错误被静默掩盖。改用 `npx tsc --noEmit -p tsconfig.client.json` 才暴露。**这是工程基建上的盲点**——以后 tsc 验证必须显式指定子项目配置。
- **High（必修）**：mergeSnapshotByPermission 没归一化 parentId —— 自己有权恢复的子节点可能指向已被删的他人 group，合并后产生孤儿 parentId。**这是真镜子**：自审时穷举了节点级权限和边的对偶情况，但漏了 parentId 这个跨节点关系字段。
- **Medium 1（命名/注释）**：mergeEdgesForMergedNodes 里 `currentOnlyKeptIds` 注释和实际语义不一致，建议改名 `protectedCurrentNodeIds` + 更新注释。接受。
- **Medium 2（必修）**：onNodeUpdate 的 `style.width / style.height` 没数值校验。攻击者可通过详情面板传 NaN 绕过 NodeChange gate。**真镜子**：修任务 3 时没跳出 NodeChange 路径看其他 mutation 入口。
- **Low（注释陈旧）**：useFlowHistory.ts 注释还写"边整份回滚"但实际已合并。顺手改。

**门禁判断**：修复 parentId 归一化 + style 数值校验 + 注释/命名后可进 P3E，前提是接受"RTL 7 项降级为 checklist 归档"作为明确回归风险。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / advice-only / confidence: medium
> 实际耗时：约 3 分钟（预估 3-5 分钟，命中）
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260505_000101.json`
> 上下文文件（4 份）：canEditNode.ts / canEditNode.test.ts / useFlowHistory.ts / FlowCanvas/index.tsx — 均成功载入

**Critical：Edge 类型未导入**（codex 准确发现，Claude 一开始误判为误报）

[src/auth/canEditNode.ts:25 / 438](E:/业务全景图/src/auth/canEditNode.ts) `mergeEdgesForMergedNodes` 签名使用 `Edge[]` 但文件只从 `@xyflow/react` 导入了 `NodeChange, Node`。

**修法**：改为 `import type { NodeChange, Node, Edge } from '@xyflow/react'`。

**Claude 反思**：第一次自验时跑了 `npx tsc --noEmit` 显示 0 错就以为没问题，但项目用 references 模式（root tsconfig.json 只有 `references` 没有 `include`），不会触发子项目编译，编译错误被静默掩盖。改跑 `npx tsc --noEmit -p tsconfig.client.json` 立即报 4 处 `Cannot find name 'Edge'`。**记忆固化**：tsc 验证必须显式指定子项目配置。

**High：mergeSnapshotByPermission 不归一化 parentId**

[src/auth/canEditNode.ts:~318-376](E:/业务全景图/src/auth/canEditNode.ts) `mergeSnapshotByPermission` 只按节点权限合并，没在最终结果上校验 parentId。如果 snapshot 中用户有权恢复的子节点指向一个未被恢复的他人 group（被合并丢弃的 ghost-group），或 current 中该 parent 已不存在，合并结果会出现孤儿 parentId。`FlowCanvas.safeNodes` 只是渲染层清洗，`onDataChange` 仍可能先同步非法 state。

**修法**：在 `mergeSnapshotByPermission` 返回前做一次结构归一化：建立 `mergedNodeIds` 和 group 节点集合，若 `parentId` 不存在或目标不是 `type==='group'`，清除该节点的 `parentId/extent`。

**Medium 1：currentOnlyKeptIds 注释与语义不符**

[src/auth/canEditNode.ts:~421-429](E:/业务全景图/src/auth/canEditNode.ts) 实现实际包含所有 current 中用户无权编辑且仍在 merged 内的节点，并不只是注释里的"current-only 保留节点"。结果：用户自己新增的一条连接到他人节点的边，如果 snapshot 没有，也会因为端点涉及他人节点而被补回，undo 无法精确撤销这类边。

**修法**：作为刻意的 fail-closed 策略，把变量改成 `protectedCurrentNodeIds`，注释明确"凡涉及受保护节点的 current 边都保留"。

**Medium 2：onNodeUpdate style 几何字段未校验 NaN**

[src/components/FlowCanvas/index.tsx:~455 + src/auth/canEditNode.ts:~100-132](E:/业务全景图/src/components/FlowCanvas/index.tsx) 任务 3 的 NaN/Infinity 校验只覆盖 `filterNodeChangesByPermission` 的 NodeChange 路径；但 `handleNodeDetailChange` 会把 `updates.style` 传给 `onNodeUpdate`，`canApplyNodeUpdate` 只做权限判断，不做 style 数值校验。若详情面板或恶意调用传入 `style.width = NaN/Infinity`，可能绕过本次几何 payload gate。

**修法**：在 `onNodeUpdate` 的中心合并点补 style 几何字段校验，至少覆盖 width/height 的有限数和非负约束。

**Low：useFlowHistory undo 注释陈旧**

[src/hooks/useFlowHistory.ts:~82-85](E:/业务全景图/src/hooks/useFlowHistory.ts) 注释仍写"边没有 creator → 整份回滚"，但实际代码已调用 `mergeEdgesForMergedNodes` 做合并。

**修法**：更新为"边按 mergedNodes 过滤 snapshot 边，并补回涉及受保护 current 节点的 current 边"。

**recommendations 通过项**

- 节点合并主干语义自洽（核心攻击场景覆盖：他人节点不被覆盖 / ghost 不还魂 / 不能借 undo 删他人）
- position undefined 放行 / dimensions 0 放行合理
- JSON.stringify 幂等去重在内网场景可接受

**risks（codex 自承不确定）**

- 未拿到 git diff，只看完整文件
- 未看 useFlowHandlers.ts / useFlowOperations.ts / NodeDetailPanel / 服务端 saveCanvas
- 前端 helper 不能构成安全边界，仍需服务端兜底（这条与项目原则一致）

---

**Claude 修复方案**

| 严重度 | 项 | 是否修 | 预计 |
|---|---|---|---|
| 🔴 critical | Edge 类型未导入（真错）| ✅ 修 | 1 分钟 |
| 🟠 high | mergeSnapshotByPermission parentId 归一化 | ✅ 修 | 15 分钟 |
| 🟡 medium 1 | currentOnlyKeptIds 改名 + 注释 | ✅ 修 | 5 分钟 |
| 🟡 medium 2 | onNodeUpdate style 几何字段校验 | ✅ 修 | 15 分钟 |
| ⚪ low | useFlowHistory undo 注释更新 | ✅ 修 | 2 分钟 |

新增测试：
- mergeSnapshotByPermission：snapshot 子节点 parent group 被合并丢弃 → 子节点 parentId/extent 被清
- mergeSnapshotByPermission：snapshot 节点 parentId 指向非 group 节点 → 同上清除
- canApplyNodeUpdate：style.width = NaN → false

**用户决策**：
[ ] 等修完二审  [ ] 直接合入主干  [ ] 修哪条、跳哪条
