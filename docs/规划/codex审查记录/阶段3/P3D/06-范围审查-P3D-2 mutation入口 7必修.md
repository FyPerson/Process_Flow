**第一层：非技术总结**

P3D-2 方向对，但当前清单还漏了几个会直接影响数据安全和用户体验的入口，尤其是撤销/重做、分组折叠对子节点 `hidden` 的写入、以及详情面板里“标记废弃”不能被 canEdit 误拦。建议不要按原清单直接开工，先把这些范围补进去，否则普通用户仍可能触发 403，或者 UI 看起来能改但实际保存失败。

需要产品拍板的只有两点：物理删除是否坚持 admin-only；创建分组是否采用 all-or-nothing。我建议两者都走保守方案：物理删除仅管理员，普通用户用“标记废弃”；创建分组必须所有选中节点可编辑，否则整体拒绝并提示哪些节点不可编辑。

**第二层：技术细节**

**必修项**

1. **补漏：撤销/重做必须纳入 P3D-2**
   [useFlowHistory.ts](<E:/业务全景图/src/hooks/useFlowHistory.ts:70>) 会整张图快照恢复，FlowCanvas 的 Ctrl+Z/Ctrl+Y 入口在 [FlowCanvas/index.tsx](<E:/业务全景图/src/components/FlowCanvas/index.tsx:740>)。这会绕过节点级 canEdit。需要对 history transition 做 diff，非可编辑节点保持 current，不要从 history 覆盖。

2. **A7 判断有误：折叠分组不只是改 group 自己**
   [GroupNode/index.tsx](<E:/业务全景图/src/components/GroupNode/index.tsx:99>) 改 group data/style，随后 [GroupNode/index.tsx](<E:/业务全景图/src/components/GroupNode/index.tsx:171>) 改所有子节点 `hidden`。服务端 schema 会存 `hidden`，且 modified 校验会算内容变化。所以只判 group canEdit 不够。要么改成 child hidden 纯派生不入 storage，要么折叠要求 group 和所有子节点都可编辑。

3. **不能只在 UI 控件拦，中心 mutation 回调也要拦**
   关键中心点包括 [useFlowHandlers.ts](<E:/业务全景图/src/hooks/useFlowHandlers.ts:297>) 的 `onNodeUpdate`、[FlowCanvas/index.tsx](<E:/业务全景图/src/components/FlowCanvas/index.tsx:641>) 的 `handleGroupChange`、[FlowCanvas/index.tsx](<E:/业务全景图/src/components/FlowCanvas/index.tsx:598>) 的 label change 事件。详情面板 disabled 是友好层，中心 gate 是防漏层。

4. **详情面板 gate 要拆开“普通编辑”和“标记废弃”**
   现在 `DeprecateNodeSection` 通过同一个 `safeOnNodeChange` 写 `is_deprecated`，见 [NodeDetailPanel/index.tsx](<E:/业务全景图/src/components/NodeDetailPanel/index.tsx:258>)。P3C 约定标废弃是任何登录用户可做，不能被 canEdit=false 误拦。建议传两个回调：普通编辑用 `canEdit`，标废弃只用 `canvasWritable`。

5. **拖动建议双层防御**
   React Flow 当前是受控模式，`wrappedOnNodesChange` 先调用 `onNodesChange(changes)`，见 [useFlowHandlers.ts](<E:/业务全景图/src/hooks/useFlowHandlers.ts:57>)。所以如果过滤 changes，必须在调用前过滤，不需要 rollback。更直接的主方案是给每个 node 设置 top-level `draggable: canEdit`，React Flow 12 支持节点级 `draggable`；同时在 `wrappedOnNodesChange` 防御性过滤 `position/dimensions/remove/replace`。

6. **删除 admin-only 合理，但 handler 不能无条件拦边删除**
   服务端已经只允许 admin 物理删除节点。普通用户确实连自己创建的节点也不能物理删除，这是产品决策，不是前端问题。建议：非 admin 选中节点时提示“请使用标记废弃”；如果同时选中了边，只删除边并跳过节点，避免破坏“边操作放开”的规则。

7. **创建分组用 all-or-nothing**
   当前 [useFlowOperations.ts](<E:/业务全景图/src/hooks/useFlowOperations.ts:305>) 先按所有 selected 算 bounds 再改 parentId。过滤一部分节点会导致“选了 5 个只分组 3 个”的困惑，也容易让 bounds 不符合预期。建议所有选中子节点都 canEdit 才创建，否则拒绝并列出不可编辑节点数量/名称。

**逐项答复**

- React Flow 额外入口：连接拖到一半放手不会改节点；当前没有 node right-click mutation；`onAddToGroup` 目前没找到实际 caller，但 hook 里仍应加 gate。
- `useAuth()` 可以在 React 组件和自定义 hook 顶层用；但我建议在 `FlowCanvasContent` 取一次 `user/status/readOnly`，把 `user + canvasWritable` 显式传给 hooks 和面板，低层组件只吃 `data.__canEdit` 或 top-level `draggable`。
- 单测：项目没有 Vitest/Jest。对 `canEditNodeData` 这种纯函数，优先不加新框架，用现有 `tsx` 加 Node test runner：`"test": "tsx --test"`，覆盖你列的 6 个分支。
- 创建者显示：不要复用 `formatDeprecatedTooltip`，语义不对。单独做 `formatCreatorName`：`creator_username` 优先，其次 `用户 #N`，`__localNew` 显示“本地新建，保存后归属为你”，最后 fallback “未知创建者”。
- NodeDetailPanel 物理删除按钮：当前没看到普通节点详情里的物理删除入口；真正危险的是 group 面板里的“解散分组”，见 [GroupPropertiesPanel.tsx](<E:/业务全景图/src/components/NodeDetailPanel/GroupPropertiesPanel.tsx:260>)，它应按 admin-only 处理。

建议调整实施顺序：先补测试和权限上下文传递，再做中心 gate，然后做详情面板 disabled/横幅，接着做节点级 draggable/resizer/双击，最后处理分组、删除、hover tooltip。当前审查是静态代码审查，没有修改文件，也没有跑测试。