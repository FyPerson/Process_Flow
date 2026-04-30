**Findings**

未发现新的 blocker 或行为回归。可以进入 commit + 部署。残余验证缺口：当前执行策略拦截了 `npx tsc`/`node ...tsc`，我只跑到了 `git diff --check`，结果通过。

必修 1 真闭环：是。`DraggableEdge` 现在在 [DraggableEdge/index.tsx](E:/业务全景图/src/components/DraggableEdge/index.tsx:42) 用 `useStore` 订阅 `nodeLookup`，不再依赖非响应式 `getNode()`。其他节点变化会让 selector 有机会重新执行，但返回值是 primitive boolean，值不变时不会触发 React re-render；而且 selector 只有两个 `Map.get`，成本很低。注意 React Flow 这里的 `nodeLookup` Map 可能是原地 mutation，关键不是 Map 引用变化，而是 store `set()` 通知后 selector 读取到最新内容。

minor 真闭环：是。label opacity 已放进 portaled label 自己的 inline style，[DraggableEdge/index.tsx](E:/业务全景图/src/components/DraggableEdge/index.tsx:415) 不再依赖 `.edge-has-deprecated-endpoint .edge-label` 这种匹配不到 portal DOM 的选择器。`edge-has-deprecated-endpoint` 在源码里只剩注释引用，没有 CSS 规则依赖它。

逐项确认：
1. 其他节点变化：selector 可能重跑，但 boolean 不变不 re-render。
2. source/target 删除瞬间：`state.nodeLookup.get(...)` 为 `undefined` 时 optional chaining 安全，返回 false，不抛错。
3. label `0.45/0.85` 高于线条 `0.4/0.75` 可接受，读作“同节奏但保留 label 可读性”。代码注释“与边线一致”略不精确，但不阻塞。
4. 删除 `edge-has-deprecated-endpoint` class 不影响现有 CSS，grep 已确认。
5. `CustomNode`/`GroupNode` 不需要额外 `useStore`：React Flow `NodeWrapper` 本身订阅 `nodeLookup.get(id)` 并把 `node.data` 作为 prop 传入；当前 `onNodeUpdate` 也会创建新的 node/data 对象。

非阻塞清理建议：`BusinessFlowVisualization/index.tsx` 的注释还写着 `useReactFlow().getNode()`，现在实际已改成 `useStore`，提交前顺手改一下能避免下一轮误读。