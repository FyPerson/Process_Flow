**结论：不建议进 step 4。**
这版把三个目标回调接上了 gate，但还没形成“中心防漏层”。尤其是 `onNodeUpdate` 的拒绝路径会污染面板状态，且 `wrappedOnNodesChange` 并没有覆盖多条现有直接 `setNodes` 路径。

**必修问题**

1. [useFlowHandlers.ts](<E:/业务全景图/src/hooks/useFlowHandlers.ts:345>)：`onNodeUpdate` 拒绝后仍会执行下面的 `setSelectedElement`。
`setNodes` 里 `return nds` 只阻止画布 nodes 更新，但 [410-423](<E:/业务全景图/src/hooks/useFlowHandlers.ts:410>) 会把未授权的 `dataUpdates` 合进详情面板状态。由于同步 effect 只按 id/type 判断，不会把 data 拉回真实 nodes，用户会看到“改成功了”的假状态。拒绝路径需要让 `selectedElement` 也不更新，最好把权限判定提前成一个明确的 `allowed` 结果，或者让 `setSelectedElement` 复用同一 gate。

2. [useFlowHandlers.ts](<E:/业务全景图/src/hooks/useFlowHandlers.ts:340>)：`isDeprecateOnly` 过宽。
现在 `{ is_deprecated: false }` / `{ is_deprecated: undefined }` 都会走公开权限例外。这里应该精确为 `dataUpdates.is_deprecated === true`，并建议同时要求 `user !== null`，因为语义是“任何登录用户可标废弃”，不是 anonymous/public。不能只依赖服务端 save 再拦，前端本地状态和 autosave/dirty 体验已经被污染了。

3. 中心 gate 覆盖不足：多条 mutation 不经过这三个回调。
`CustomNode` 的 `NodeResizer` 在 [CustomNode/index.tsx](<E:/业务全景图/src/components/CustomNode/index.tsx:352>) 直接 `setNodes` 改 style；`GroupNode` 折叠/展开在 [GroupNode/index.tsx](<E:/业务全景图/src/components/GroupNode/index.tsx:87>) 直接改 `collapsed/expandedSize/hidden`；undo/redo 在 [useFlowHistory.ts](<E:/业务全景图/src/hooks/useFlowHistory.ts:70>) 直接恢复整份 snapshot；对齐工具也在 [useNodeAlignment.ts](<E:/业务全景图/src/hooks/useNodeAlignment.ts:23>) 直接改 position。
所以当前 `wrappedOnNodesChange` 不能兜住“NodeResizer / undo redo / 一些快捷操作”这类路径。要么把这些路径收敛到受控回调，要么在这些 direct setters 旁边也接同一权限 helper。

4. [useFlowHandlers.ts](<E:/业务全景图/src/hooks/useFlowHandlers.ts:83>)：`canvasWritable=false` 时直接放行 `onNodesChange`，和“防漏层”目标冲突。
UI 层确实有 `nodesDraggable={!readOnly}`、`deleteKeyCode={null}`、`handleDelete` 短路，但中心层如果收到外部/异常 `position`、`dimensions`、`remove` change，仍会先本地应用。至少 mutating change 在 `!canvasWritable` 下应 fail closed，或明确把这条降级为“UI 防护，不是中心防护”。

**针对你的审查点**

`handleGroupChange` 不给 `is_deprecated` 例外，当前不变量成立：`DeprecateNodeSection` 对 group 也是走 `onNodeChange -> onNodeUpdate`。但这个约束比较脆，后续如果把 group 面板里的废弃动作并进 `onGroupChange`，会立刻破。

deps 方面没有 correctness 问题。`onNodeUpdate` 多依赖 `user/canvasWritable` 合理；`wrappedOnNodesChange` 依赖 `nodes` 会导致每次 nodes 变化重建 wrapper，但一般不会破坏 React Flow，只是性能/引用稳定性成本。相比之下，覆盖漏洞更要紧。

测试建议：不要等 step 9 才测全部。可以先抽纯 helper 单测：`isPublicDeprecateUpdate`、`filterNodeChangesByPermission`、`canApplyNodeUpdate`。RTL/undo redo 集成测试可以留到 step 9，但 step 3 的 gate 逻辑本身需要有低成本单测兜住这些边界。

边操作划分基本可以接受，前提是“边没有 creator，按 canvas 写权限控制”。`handleDelete` admin-only 放 step 8 也可以，但当前 step 3 不能声称删除/undo/redo 已被中心 gate 覆盖。