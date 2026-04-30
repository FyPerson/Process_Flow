**Findings**

1. **High: 打开可写服务端画布会假 dirty，并可能触发空保存涨版本。**
[getCanvasFull](<E:/业务全景图/server/services/canvases.ts:184>) 现在 hydrate `created_at/updated_by/updated_at`，但 [BusinessFlowVisualization](<E:/业务全景图/src/pages/BusinessFlowVisualization/index.tsx:357>) 和 [convertNodesToStorage](<E:/业务全景图/src/hooks/useMultiCanvas.ts:222>) 只反向保留 `creator_id/creator_username/is_deprecated`。同时 [FlowCanvas mount effect](<E:/业务全景图/src/components/FlowCanvas/index.tsx:195>) 会立刻 `onDataChange`，`deepEqualStorage` 看到 meta 字段丢失后 mark dirty。结果是：加载可写画布即 dirty，5 秒 autosave 后 `saveCanvas` 虽然判定内容没变，但仍会写新 version/canvas_versions。
建议：要么前端完整 roundtrip `created_at/updated_by/updated_at/deprecated_by/deprecated_at/deprecated_by_username`，要么在 `updateSheetData` 的 dirty 比较里 strip 服务端 meta。后者更符合“meta 不参与内容 dirty”的模型。

2. **Medium: duplicate sheet 是漏掉的第四个“本地新增节点”路径。**
[duplicateSheet](<E:/业务全景图/src/hooks/useMultiCanvas.ts:628>) 现在深拷贝 storage node 并只改 id，会继承源节点 `creator_id/creator_username/is_deprecated/deprecated_*`，也不会打 `__localNew`。服务端保存时会重写 creator，所以数据安全没破；但 P3D-2 一旦调用 `canEditNodeData`，复制别人节点生成的新 sheet 会在首次保存前被判成“别人创建”。建议 P3D-2 接 UI gate 前补：复制 sheet 时 strip creator/update/deprecated attribution，并给新节点本地可编辑标记，或明确把 duplicateSheet 排除出本期权限体验。

3. **Low: clipboard 里有一个很可能变成 lint failure 的无效 eslint-disable。**
[useFlowClipboard.ts](<E:/业务全景图/src/hooks/useFlowClipboard.ts:79>) 里 destructure 后已经用 `void` 消耗变量，`eslint-disable-next-line @typescript-eslint/no-unused-vars` 基本是 unused directive；项目 lint 脚本带 `--report-unused-disable-directives --max-warnings 0`。我这里受策略限制没法跑 `npx tsc`/lint，但建议删掉这行 disable。

**5 必修状态**

必修 1 基本闭环：两个 strip helper 语义拆对了，`stripServerAttributionForSaveInput` 保留 `is_deprecated`，`false -> true` 标废弃仍能进 `deprecatedChanged`。

必修 2 migration 逻辑 OK：`updated_by/updated_at` 填齐，SQLite `json_extract(...is_deprecated)` 对 boolean/missing 配 `COALESCE(...,0)` 是对的。空 `nodes` 数组不会抛错，只是 0 行。低风险点是若未来要补的旧 storage 带无效 `deprecated_by`，FK 可能让 migration 失败；生产实测零增量则无实际影响。

必修 3/4/5 主路径 OK，但被上面的假 dirty 问题拖住：反向通路只补了 `creator_id/creator_username/is_deprecated`，不足以匹配本轮后端 hydrate 出来的完整 meta。

`getCanvasFull` meta 缺失 fallback 我建议保持 fail-closed，不要临时填 `canvases.created_by`。否则前端会放行、服务端保存仍可能 409，体验更割裂。更好的补救是 migration/健康检查保证 meta 完整。

`canEditNode` 没单测我不认为阻塞 P3D-1，因为还没接调用点；但 P3D-2 接 mutation gate 时应一起补 6 分支单测。