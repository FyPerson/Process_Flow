**结论**

有条件进入实施。4 个方向整体成立，但原实施范围还不够，不能只做详情面板、双击改名和 NodeResizer。否则拖动、对齐、分组、解散分组、Backspace 删除这些入口仍会让用户“能操作，保存才 403”。

**必修项**

1. 取舍 4 要改口径：`creator_id` 缺失不能一概视为本地新增。  
   安全上没问题：服务端 `saveCanvas` 按 `(sheet_id,node_id)` 和 `nodes_meta` 判断 added/modified，不信客户端 `creator_id`；删掉别人的 `creator_id` 不会抢走 creator。见 [server/services/canvases.ts](<E:/业务全景图/server/services/canvases.ts:456>)、[added 校验](<E:/业务全景图/server/services/canvases.ts:561>)、[modified 校验](<E:/业务全景图/server/services/canvases.ts:575>)。  
   但 UX 上有问题：历史节点如果缺 `nodes_meta`，前端会放行，服务端会回 `node_meta_missing`。建议本地新增节点在创建/粘贴/建组时直接注入当前用户的运行时 creator 信息，或加 `__localNew` 运行时标记；持久化节点缺 meta 则显示“创建者未知/历史节点需管理员修复”，不要当作可编辑。

2. 必须处理历史数据。  
   当前创建/导入会写 `nodes_meta`，但没看到针对 P3A 前旧画布的 backfill。`getCanvasFull` meta 缺失时会透传节点，保存修改时会 409。建议做一次性 backfill：把现有画布节点初始化到 `nodes_meta`，归属策略建议用 `canvases.created_by`，必要时记录为迁移归属。

3. `getCanvasFull` 的 X 方案要做成“权威 hydrate”。  
   现在只 JOIN `deprecated_by_username`，见 [server/services/canvases.ts](<E:/业务全景图/server/services/canvases.ts:128>)。加 `creator_username` 时，应同时从 `nodes_meta` hydrate `creator_id/created_at/updated_by/updated_at`，不要依赖 JSON 旧字段。`creator_username` 还要在 save/create rewrite 和 `nodeContentEquals` 的 strip 里剔除，避免显示字段入库或影响 delta。

4. 前端数据通路漏了。  
   当前 `BusinessFlowVisualization` 转 React Flow 节点时只透传废弃字段和 `readOnly`，没有透传 `creator_id/creator_username`，见 [src/pages/BusinessFlowVisualization/index.tsx](<E:/业务全景图/src/pages/BusinessFlowVisualization/index.tsx:348>) 和 [普通节点 data](<E:/业务全景图/src/pages/BusinessFlowVisualization/index.tsx:376>)。P3D 必须补这里，否则节点组件和详情面板拿不到权限依据。

5. canEdit 必须组合“画布可写 + 节点归属”。  
   服务端 `canWrite` 已兜底 public/private/archived，见 [server/services/canvases.ts](<E:/业务全景图/server/services/canvases.ts:208>)。前端 helper 应是：游客/画布只读 false，admin true，本地新节点 true，creator true。`DeprecateNodeSection` 仍只受画布写权限控制，不受 creator 控制。

6. 必须覆盖非详情入口。  
   包括：节点拖动、对齐、双击改名、NodeResizer、详情输入、创建分组、解散分组、从分组移除、分组折叠、粘贴节点、Backspace/侧栏删除。当前删除和拖动入口在 [FlowCanvas](<E:/业务全景图/src/components/FlowCanvas/index.tsx:688>)、[nodesDraggable](<E:/业务全景图/src/components/FlowCanvas/index.tsx:984>)；分组会修改子节点甚至删除 group，见 [useFlowOperations.ts](<E:/业务全景图/src/hooks/useFlowOperations.ts:300>)、[解散分组](<E:/业务全景图/src/hooks/useFlowOperations.ts:390>)。

**取舍最终意见**

1. Hover 形式：选 C，可以。面板常驻 creator 不是冗余，因为它是点开后的上下文；hover tooltip 是点之前的反馈。不要做永久 chip，和“已废弃”角标会抢空间。

2. creator username 来源：选 X，而且是必修。用服务端 JOIN，前端不要用 `用户 #id` 作为主方案，只作为用户缺失/历史缺失 fallback。

3. 删除按钮：选 B，但要细分。非 admin 选中节点时禁用并提示“仅管理员可物理删除，请使用标废弃”；只选中边时仍可删除。解散分组本质上会删除 group 节点，也应按 admin-only 处理，除非服务端规则另改。

4. 本地新增节点：原安全判断成立，但产品判断要修正。不要用“缺 creator_id”判断本地新增；改为运行时 local 标记或创建时注入当前用户 creator 信息。

**建议项**

canEditNode 不建议直接塞进 `AuthContext` 作为唯一实现。更稳的是纯函数/小 hook：`canEditNodeData(nodeData, user, canvasWritable)`，`AuthContext` 只提供 `user/status/readOnly`。这样 `FlowCanvas`、节点组件、详情面板和测试都能复用，且不会把 flow 领域模型强耦合进 auth。

最后补一组最小回归测试：伪造/删除 `creator_id` 不能越权、旧节点缺 meta 的行为、本地新增可编辑、非 creator 拖动/改名/详情输入被禁、非 admin 删除节点禁用但删除边可用、group/ungroup/remove-from-group 权限一致。