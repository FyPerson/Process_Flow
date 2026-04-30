**Findings**

- **Medium / staging mismatch:** `git status --short` 里 `src/hooks/useMultiCanvas.ts` 和 `src/pages/BusinessFlowVisualization/index.tsx` 仍是 `MM`。我按 `git diff HEAD` 审了工作树整体，所以新方案代码是闭环的；但如果现在直接 commit staged index，BFV 的 `__localNew` 派生在 unstaged diff 里，可能不会进提交。提交前需要重新 `git add` 这两个文件。

- **无阻断代码 Finding:** 按 `git diff HEAD` 当前工作树看，没有发现 `__localNew` 进入 storage 的路径，新方案可接受。

**双层核对**

1. **storage 永不存 `__localNew`：闭环。**  
   `duplicateSheet` 只 strip server-owned meta 和 `is_deprecated`，没有写 `__localNew`：[useMultiCanvas.ts](<E:/业务全景图/src/hooks/useMultiCanvas.ts:669>)。React Flow → storage 的 `convertNodesToStorage` 是显式白名单，普通/分组节点都没有 `__localNew` 字段：[useMultiCanvas.ts](<E:/业务全景图/src/hooks/useMultiCanvas.ts:233>)。`autoSaveFilter` 也排除 `__*`：[useMultiCanvas.ts](<E:/业务全景图/src/hooks/useMultiCanvas.ts:134>)。服务端 PUT 走 strict schema 校验：[server/schemas/canvas.ts](<E:/业务全景图/server/schemas/canvas.ts:290>)、[server/routes/canvases.ts](<E:/业务全景图/server/routes/canvases.ts:210>)。

2. **BFV 派生逻辑：在 P3D-1 前提下精确。**  
   分组和普通节点都用 `typeof node.creator_id !== 'number'` 派生 runtime-only `data.__localNew`：[index.tsx](<E:/业务全景图/src/pages/BusinessFlowVisualization/index.tsx:365>)、[index.tsx](<E:/业务全景图/src/pages/BusinessFlowVisualization/index.tsx:401>)。持久化节点由 `getCanvasFull` 从 `nodes_meta` hydrate `creator_id`：[canvases.ts](<E:/业务全景图/server/services/canvases.ts:153>)。`duplicateSheet` strip 后自然缺 `creator_id`，会被派生为本地新节点。

3. **meta 缺失 corner case：当前是“前端放行，服务端 fail-closed”。**  
   `getCanvasFull` meta 缺失时返回 strip 后节点：[canvases.ts](<E:/业务全景图/server/services/canvases.ts:177>)。BFV 会把它视为 `__localNew=true`。如果用户实际修改，`saveCanvas` 在 modified 校验时查不到 `nodes_meta` 会返回 `409 node_meta_missing`：[canvases.ts](<E:/业务全景图/server/services/canvases.ts:631>)。这个取舍可接受，但前提是 migration 0002 已在目标环境执行；否则客户端无法区分“duplicateSheet 新节点”和“损坏的持久化节点”。

4. **duplicateSheet → saveCanvas delta：OK。**  
   新 sheet id + 新 node id 进入服务端后按 `(sheet_id,node_id)` 不存在判定为 `added`：[canvases.ts](<E:/业务全景图/server/services/canvases.ts:580>)。rewrite 阶段给 added 节点写当前用户 creator：[canvases.ts](<E:/业务全景图/server/services/canvases.ts:713>)，随后 INSERT `nodes_meta`：[canvases.ts](<E:/业务全景图/server/services/canvases.ts:803>)。

5. **trailing whitespace：clean。**  
   `git diff HEAD --check` 没有报 whitespace 问题。命令输出里只有当前 PowerShell constrained mode 的编码设置警告和 git ignore 权限 warning，不是 diff check finding。