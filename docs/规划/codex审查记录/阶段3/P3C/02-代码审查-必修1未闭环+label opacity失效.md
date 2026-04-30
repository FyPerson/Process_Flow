**Findings**
1. **Blocker:** 必修 1 还没真闭环。`DraggableEdge` 在渲染时用 `getNode(source/target)` 读取废弃状态，但 `getNode()` 不是响应式订阅。[DraggableEdge/index.tsx](E:/业务全景图/src/components/DraggableEdge/index.tsx:42)  
   React Flow 的 `EdgeWrapper` 订阅的是 edge 本身和端点几何计算结果，不订阅 `node.data`；节点只改 `data.is_deprecated` 时，edge 不保证重渲染。[node_modules/@xyflow/react/dist/esm/index.js](E:/业务全景图/node_modules/@xyflow/react/dist/esm/index.js:2809)  
   结果是：标废弃后，边可能要等 hover、选中、拖动、remount 才变淡。建议改成 `useStore` 订阅 `source/target` 的 `nodeLookup.get(id)?.data.is_deprecated`，selector 返回 boolean。

2. **Minor:** label 降透明度的 CSS 很可能不生效。`EdgeLabelRenderer` 是 portal，label DOM 不在 `<g class="edge-has-deprecated-endpoint">` 下面，所以 `.edge-has-deprecated-endpoint .edge-label` 匹配不到。[styles.css](E:/业务全景图/src/components/DraggableEdge/styles.css:91)  
   线条 `0.4 / hover-selected 0.75` 本身可接受；如果要求 label 也降级，需要把 opacity 放到 label inline style 或给 portaled label 自己加状态 class。

**结论**
暂不建议进入 commit + 部署。原因是必修 1 仍是功能闭环问题，不只是实现风格问题。

**闭环状态**
- 必修 1：否。方案方向对，但需要响应式订阅，不能只靠 `getNode()`。
- 必修 2：是。`hasDeprecatedEndpoint` 没再进入 `edge.data`；grep 只剩本地变量/注释。
- 必修 3：是。`createCanvas` 对 added 节点按 `user.id + now` 重写，deprecated 节点同步写 `nodes_meta`，GET hydrate 路径完整。
- 必修 4：是。两个新增文件已 `git add`。
- 建议 1：是。`getCanvasFull` hydrate 前 strip by/at/username，再以 meta 注入。
- 建议 3：是。三处已改用 `formatDeprecatedAt/Tooltip`。

**回归判断**
`createCanvas` rewrite 未看到新回归；导入含 `is_deprecated=true` 的 JSON 会被服务端改写为当前创建用户和当前时间，这是和 saveCanvas added 语义一致的。  
`DraggableEdge getNode` 改动有回归/未闭环风险，需要修。

推后的建议 2/4/5 合理；建议 6 线条层面已做，但 label 可见度还没完全覆盖。另当前 `git status` 显示既有文件修改未 staged，修完后提交前还需要 `git add` 这些修改文件。