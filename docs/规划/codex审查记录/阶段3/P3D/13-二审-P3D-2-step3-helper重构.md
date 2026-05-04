**第一层：非技术总结**

不建议进 step 4。前两项已经闭环，但中心 gate 还没有真正兜住所有正常 UI 路径，普通用户仍可能让“不可编辑节点”发生本地变更并触发保存失败或假成功体验。

核心问题不是详情面板 disabled 做不做，而是 step 3 的防漏层还漏。先补完中心 gate，再做 step 4 的面板禁用才有意义。

**第二层：技术细节**

**Blocker 1：分组双击改名仍绕过 gate**

[FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx:607) 的 `groupLabelChange` 事件只判 `readOnly`，然后调用 `onUpdateGroupLabel`；[useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts:500) 里直接 `setNodes` + `triggerAutoSave`，没有 `canEditNodeData`。

同时 [GroupNode/index.tsx](E:/业务全景图/src/components/GroupNode/index.tsx:31) 双击进入编辑也只判 `readOnly`，不判 `__canEdit`。所以普通用户在公共可写画布上仍能双击别人分组改名，本地成功，保存再 403。之前范围审查点名的 “label change 事件也是中心入口” 还没闭环。

**Blocker 2：useNodeAlignment 过滤后又把不可编辑节点一起移动**

[useNodeAlignment.ts](E:/业务全景图/src/hooks/useNodeAlignment.ts:22) 先过滤 `__canEdit === false`，但实际 left/right/center/top/bottom/middle 的 map 里仍用 `if (n.selected)`，例如 [useNodeAlignment.ts](E:/业务全景图/src/hooks/useNodeAlignment.ts:79)。结果是：只要过滤后还剩 2 个可编辑节点，所有选中节点，包括不可编辑节点，都会被移动。

这里建议 all-or-nothing，和创建分组保持一致；如果坚持 partial，也必须只按 `targetIds.has(n.id)` 改位置。

**Blocker 3：`replace/add` 被当成非 mutating，和 React Flow 12 实际语义不符**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts:146) 只把 `position/dimensions/remove` 当 mutating。但 React Flow 的 `NodeChange` 里 `add` 是新增节点，`replace` 是替换节点；本地源码也能看到 `setNodes` diff 会生成 `replace/add`：`node_modules/@xyflow/react/dist/esm/index.js:792`。

这不是纯理论问题。`CustomNode` / `GroupNode` 里 `useReactFlow().setNodes` 这类 direct setter 在受控模式下会转成 `replace` change；当前 filter 放行 `replace`，所以防漏层兜不住 data/style/hidden 这类直接替换。

**Blocker 4：CustomNode 的 resizeEnd 仍有未授权直写口**

[CustomNode/index.tsx](E:/业务全景图/src/components/CustomNode/index.tsx:365) 的 `onResize` 加了 `__canEdit` 判定，但 [CustomNode/index.tsx](E:/业务全景图/src/components/CustomNode/index.tsx:393) 的 `onResizeEnd` 仍直接 `setNodes` 写 style。React Flow 12 的 NodeResizer 内部确实会发 `dimensions` change，`wrappedOnNodesChange` 能拦这部分；但你这里额外手写的 `setNodes` 会走 `replace`，而当前 filter 又放行 `replace`。

**已闭环项**

必修 1 基本闭环：[useFlowHandlers.ts](E:/业务全景图/src/hooks/useFlowHandlers.ts:320) 已在 `setNodes/setSelectedElement/triggerAutoSave` 前早退，拒绝路径不再污染面板状态。

必修 2 闭环：[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts:77) 精确要求 `is_deprecated === true`、登录用户、无其他 data/style，语义对。

`__canEdit` 不入 storage 的不变量基本成立：[useMultiCanvas.ts](E:/业务全景图/src/hooks/useMultiCanvas.ts:167) 过滤 `__*`，storage 转换本身也偏白名单，服务端 strict schema 是第二层兜底。

**结论**

不能进 step 4。先补：分组 label 事件 gate、alignment 实际更新对象、`replace/add` 过滤语义、`onResizeEnd` guard。`npm test` 我这边没能复跑，当前环境策略拒绝执行 `npm test`；但这些 finding 是静态路径级问题，现有 helper 单测不会覆盖。