## 审查结论

- 总体：**6 条必修 / 4 条建议**，不建议直接发布到多人协作使用。
- 核心问题不是 409 契约本身，而是前端“加载/切换/保存中编辑”的状态机还会把非用户修改当成 dirty，甚至可能覆盖刚加载或刚创建的数据。

## 分项打分

1. 自动保存死循环：**必修**。无明显死循环，但 `save()` 成功后无条件 `setDirty(false)`，保存请求期间的新编辑会被静默标成已保存。
2. 闭包陈旧：**OK**。`projectRef` / `saveRef` 能拿到定时器触发时的最新闭包；保存中编辑的竞态另算第 1 条。
3. canvasId 切换：**必修**。URL 同步 effect 会把外部切到的新 `canvasId` 改回内部旧值，且同 sheetId 的画布不会 remount。
4. 409 状态机：**有风险**。取消 confirm 后保留本地且禁用 autosave 符合阶段 2，但“再次尝试保存”在旧 `baseVersion` 下基本必定再次 409。
5. beforeunload：**必修**。当前加载后/选中高亮后就可能被标 dirty，导致无编辑也拦截关闭。
6. createOnServer 后 URL 同步：**必修**。`setSearchParams` 会触发 fetch；若创建请求期间或随后有本地改动，可能被服务端旧快照覆盖。
7. ApiError 一致性：**有风险**。服务端 JSON 错误基本一致，但网络错误/JSON 解析错误不会被归一成 `{status,error,...}`。
8. 游客只读：**有风险**。后端会 401/403，数据写不进去；但前端编辑器仍可编辑并触发 dirty/autosave/离开拦截。
9. 初始化 effect vs project=null：**必修**。`canvasId` fetch 失败后会加载默认数据并 `loadProject()` 标 dirty，掩盖真实错误。
10. 其他遗漏：**必修**。后端 schema 不接受前端实际会保存的 `hidden/collapsed/expandedSize`，分组折叠后保存会 400。

## 必修项

1. `src/hooks/useMultiCanvas.ts:607`：给 `save()` / `createOnServer()` 加 dirty revision。
   - `markDirty()` 递增 `changeSeqRef`。
   - `save()` 发请求前捕获 `saveSeq`，成功后只有 `changeSeqRef.current === saveSeq` 才 `setDirty(false)`。
   - `createOnServer()` 同理；创建期间有新编辑时保留 dirty，让后续 PUT 保存最新内存版本。
   - 建议再加 `savingRef` 防止同 tab 双保存造成自我 409。

2. `src/pages/BusinessFlowVisualization/index.tsx:57`：不要用“内部 canvasId != URL canvasId”做通用反向同步。
   - 删除这个全局 effect，改成只在 `handleSaveAsNew()` 成功后用返回的 `id` 写 URL。
   - `useMultiCanvas.ts:317` 的 fetch effect 在 `canvasIdProp` 改变时应重置 `conflict/autoSaveDisabled/serverVersion/dirty`，并避免旧 canvas 的 autosave 定时器继续保存。

3. `src/pages/BusinessFlowVisualization/index.tsx:394` + `src/components/FlowCanvas/index.tsx:141`：
   - `FlowCanvas` 内部 state 只吃首次 `initialNodes/initialEdges`，同一个 `activeSheetId` 切换 canvas 或 `discardAndReload()` 后 UI 不会刷新。
   - 加一个 hook 返回的 `loadRevision/resetKey`，在服务端 fetch、discard reload、显式 loadProject 时递增，然后用 `key={`${canvasId ?? 'local'}:${activeSheetId}:${loadRevision}`}`。

4. `src/pages/BusinessFlowVisualization/index.tsx:313`：
   - `canvasIdFromUrl != null` 或 `serverError` 存在时，不要加载 `/data/complete-business-flow.json`。
   - 应显示错误状态和重试/返回入口；默认数据只用于无 URL canvas 的本地初始态。

5. `src/components/FlowCanvas/index.tsx:187` + `src/hooks/useMultiCanvas.ts:553`：
   - 首次 mount 的 `onDataChange` 不应标 dirty。
   - `updateSheetData()` 应比较序列化后的 `nodes/connectors` 与当前 sheet，完全相同就不更新 project、不 `markDirty()`；否则选中高亮这类 UI-only 变化也会触发保存。

6. `server/schemas/canvas.ts:85`：
   - `NodeSchema` 需要接受前端实际字段：`hidden?: boolean`、`collapsed?: boolean`、`expandedSize?: {width,height}`。
   - 对应前端来源在 `src/hooks/useMultiCanvas.ts:156`、`:159`、`:160`、`:184`。

## 建议项

- `src/api/canvases.ts:37`：把 `fetch()` 网络失败、JSON parse 失败也包装成 `ApiError`，例如 `status: 0, error: 'network_error'`。
- `src/components/SaveStatus/index.tsx:106`：冲突态下“再次尝试保存”容易误导；阶段 2 更适合只给“重载服务端”和“导出/保留本地副本”。
- `src/pages/BusinessFlowVisualization/index.tsx:384`：`readOnly` 只传给 SaveStatus 不够。至少 `handleDataChange` 在 readOnly 时 no-op，更完整是给 `FlowCanvas` 加 readOnly 禁用编辑 handlers。
- `src/hooks/useMultiCanvas.ts:680`：创建时最好同步 `data.name = input.name`，否则列表名和画布标题可能不一致。

## 不必修但要知道

`server/services/canvases.ts:8` 注释说保存前会用 `nodes_meta` 重写节点元信息，但当前实现只是 `JSON.stringify(data)` 直接存。阶段 2 可先不修，但这个注释和安全边界现在不一致。