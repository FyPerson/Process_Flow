## 七审结论

- 总体：**不通过**。有 **1 条 mutation 入口遗漏**，**2 条新风险**。
- P2I：**暂时不能进**。先修对齐工具栏和 `edge.data.readOnly` 入库问题；建议顺手修掉只读分组详情面板消失。

9 处评级：

1. caller switch exhaustiveness：**OK**
2. FlowCanvas 快捷键：**OK**，但只读时 return 前未 `preventDefault`，有浏览器默认行为小风险
3. 左侧“操作/节点/分组”隐藏：**OK**
4. NodeDetailPanel：**部分，引入新问题**。node/edge 写入被吞；但 group 面板在只读下直接不渲染
5. useFlowHandlers：**部分**。connect/update/delete 已拦；`wrappedOnNodesChange/wrappedOnEdgesChange` 仍会跑
6. CustomNode：**OK**，但依赖 `node.data.readOnly`
7. GroupNode：**OK**，但 collapse guard 建议先 `stopPropagation`
8. DraggableEdge：**OK/有副作用**。offset 拖动被拦；但依赖 `edge.data.readOnly`，触发了入库风险
9. CanvasTabBar：**OK**

## 必修项

1. 对齐工具栏仍可改节点位置  
   [src/components/FlowCanvas/index.tsx](<E:/业务全景图/src/components/FlowCanvas/index.tsx:923>) 仍然 `visible={showAlignmentToolbar}`，只读时多选节点后会显示工具栏。  
   [src/hooks/useNodeAlignment.ts](<E:/业务全景图/src/hooks/useNodeAlignment.ts:15>) 的 `alignNodes` 会 `setNodes` 改位置，并 `saveHistory`。  
   具体改法：`visible={!readOnly && showAlignmentToolbar}`，并最好让 `alignNodes` 本身也接 `readOnly` 或在调用处包一层 no-op。

2. `edge.data.readOnly` 会进入 storage，造成假 dirty / 污染服务端数据  
   [src/pages/BusinessFlowVisualization/index.tsx](<E:/业务全景图/src/pages/BusinessFlowVisualization/index.tsx:310>) 把 `readOnly` 注入 `edge.data`。  
   [src/hooks/useMultiCanvas.ts](<E:/业务全景图/src/hooks/useMultiCanvas.ts:269>) `convertEdgesToStorage` 会 `safeDeepCopy(edge.data, autoSaveFilter)`，当前 filter 不排除 `readOnly`。  
   [src/hooks/useAutoSave.ts](<E:/业务全景图/src/hooks/useAutoSave.ts:120>) 旧 export/getFlowData 路径同样会带出去。  
   具体改法：两处 `autoSaveFilter` 都加 `key !== 'readOnly'`，或在 edge storage 转换时显式剔除。节点侧目前不会 forward `node.data.readOnly`，边会。

3. 只读下分组详情面板被隐藏，不是 no-op  
   [src/components/NodeDetailPanel/index.tsx](<E:/业务全景图/src/components/NodeDetailPanel/index.tsx:47>) 把 group callbacks 设成 `undefined`。  
   [src/components/NodeDetailPanel/index.tsx](<E:/业务全景图/src/components/NodeDetailPanel/index.tsx:205>) 渲染条件又要求这些 callback 存在，导致只读时分组属性整个不显示。  
   具体改法：按原清单改成 no-op 函数，或给 `GroupPropertiesPanel` 加 `readOnly` 后禁用修改控件，但仍允许查看。

## 建议项

- `NodeDetailPanel` 的 input、截图上传/删除、PageSelector、DatabaseTableEditor 现在会改本地 state，但 `safeOnNodeChange` 会吞掉写回。数据安全上可接受，UX 上会让用户以为改成功了。严格只读建议传 `readOnly` 到子面板并禁用/隐藏修改控件。
- `wrappedOnNodesChange` / `wrappedOnEdgesChange` 只读时仍会执行，选中态和尺寸测量可以保留，但建议只读下过滤为 `select/dimensions` 这类 UI-only change，并跳过 `triggerAutoSave`。
- `GroupNode` 的 collapse guard 建议先 `e.stopPropagation()` 再 return，避免只读点击折叠按钮冒泡成其它点击行为。
- 快捷键只读分支最好 `preventDefault()` 后 return，避免 Ctrl+G、Ctrl+Shift+D、Backspace 等触发浏览器默认行为。

## 不必修但要知道

- `convertNodesToStorage` 不会保存 `node.data.readOnly`；问题主要在 edge data。
- ReactFlow 没看到内置 undo 入口；当前 undo/redo 是自定义 history，快捷键和左侧按钮已拦。
- exhaustive switch 用 `throw` 比 `return` 好：新增 `SaveResult` 分支时 TS 会在 `_exhaustive: never = result` 报错，运行期也 fail loud。
- 我没能跑 `tsc --noEmit`，当前工具策略拒绝执行 `npx/tsc`；`git diff --check 0135fc5^ 0135fc5` 通过。