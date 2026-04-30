## 二审结论

- 总体：未通过，2 条必修遗漏 / 1 条新暴露风险
- 验证限制：当前 sandbox 拒绝 `npm exec tsc ...`，所以这次只做静态审查；未能复跑类型检查/测试。

- 上次必修项的修复验证：
  1. save 期间编辑被吞：部分。普通单次 `save()` 的 `changeSeqRef` 逻辑 OK，但 `Save As New` 后写 URL 会触发 fetch，把 create 期间的新编辑覆盖掉；并发 save 仍可能自我 409。
  2. URL 双向同步：部分。删全局反向 effect 是对的；手动删 URL 和 A→B 切换基本 OK；但 create 后 URL 写入触发同 id refetch，仍有覆盖内存新编辑的风险。
  3. FlowCanvas 不 remount：OK。主要整体替换入口已 bump，`null/error` 分支不 bump 可以接受，因为没有 FlowCanvas 保持挂载。
  4. 409 confirm 取消后状态恢复：OK，按本轮约定保留 `autoSaveDisabled/conflict`，本地改动不会被清。
  5. fetch 失败回退默认：OK。错误页阻断默认数据回退；返回首页不会卡在错误页。
  6. updateSheetData UI-only dirty：OK，现实路径能过滤 selected/dragging 等 UI-only 变化；但 JSON stringify 方案有建议项。
  7. schema 字段：OK。

- 上次建议项的修复验证：
  - ApiError 网络错归一：OK，调用方可统一处理。
  - 冲突按钮误导：OK。
  - readOnly 拦 mutation：部分。已阻止写入父级 project/dirty/autosave，但 FlowCanvas 内部 UI 仍可被游客本地拖改。
  - createOnServer 同步 data.name：OK。

## 新发现的必修项

[E:/业务全景图/src/pages/BusinessFlowVisualization/index.tsx:103](E:/业务全景图/src/pages/BusinessFlowVisualization/index.tsx:103) + [E:/业务全景图/src/hooks/useMultiCanvas.ts:341](E:/业务全景图/src/hooks/useMultiCanvas.ts:341)

`handleSaveAsNew` 成功后写 `canvasId` 到 URL，会让 hook 的 `canvasIdProp` effect 立刻 `apiGetCanvas()`，然后无条件 `setProject(row.data)` / `setDirty(false)`。如果用户在 create 请求期间继续编辑，`createOnServer` 的 `changeSeqRef` 会正确保留 dirty，但随后这次 refetch 会把内存覆盖成“创建请求发出时”的旧数据。

具体修改：create 成功后的同 id URL 同步不应触发覆盖式 fetch。可在 hook 里加“当前已挂载同一 canvas 且已有 serverVersion/project”的短路，或加 `justCreatedCanvasIdRef` 跳过下一次同 id fetch；关键是不允许该 fetch `setProject(row.data)` / `setDirty(false)` 覆盖 create 期间的本地新编辑。

[E:/业务全景图/src/hooks/useMultiCanvas.ts:645](E:/业务全景图/src/hooks/useMultiCanvas.ts:645)

`save()` 没有同步 in-flight guard。UI 上 `saving` 会隐藏按钮，但函数本身仍可能被手动保存和已排队 autosave timer 同时调用，或被快速重复调用；两个 PUT 会带同一个 `serverVersion`，第一个成功后第二个自我 409。

具体修改：在 `save()` 内部加 `savingRef` / `saveInFlightRef`，进入函数同步置位；已有保存中时直接返回现有 promise 或 no-op。不要只依赖 React state/UI。

[E:/业务全景图/src/hooks/useMultiCanvas.ts:660](E:/业务全景图/src/hooks/useMultiCanvas.ts:660)

保存请求完成时没有校验“结果仍属于当前 canvas”。用户在保存 A 期间把 URL 切到 B，A 的 PUT 成功回包仍会写 `serverVersion` / `dirty` / `lastSavedAt` 到当前 hook 状态，可能污染 B 的下一次保存版本。

具体修改：保存/create/discard/load 这类 async 完成前，用 operation token 或 captured canvas id 校验当前 `canvasIdRef/canvasIdPropRef`；不匹配就丢弃结果，不更新状态。

## 新发现的建议项

[E:/业务全景图/src/hooks/useMultiCanvas.ts:589](E:/业务全景图/src/hooks/useMultiCanvas.ts:589)

`JSON.stringify` 比较对 key order 敏感。当前转换函数 key 顺序稳定，所以通常不会“永远 changed”，但老数据或外部导入数据 key 顺序不同会产生一次假 dirty/save。建议改成稳定 deepEqual；`lodash` 不是直接 dependency，别直接 import 传递依赖，要么加显式依赖，要么写局部 storage-shape deepEqual。

[E:/业务全景图/src/components/SaveStatus/index.tsx:119](E:/业务全景图/src/components/SaveStatus/index.tsx:119)

`network_error` / `invalid_response` 会原样展示给用户。建议映射成中文可行动文案，例如“网络连接失败，请检查网络后重试”“服务器返回异常，请稍后重试”。

## 不必修但要知道

`changeSeqRef` 不 reset 本身没问题，它只是单调序号；真正的问题是 async 结果没有按 canvas/request 身份隔离。

自动保存在 save 期间产生新改动后，dirty 保持 true，再开一个 5s timer 是预期行为，不是无限循环。只要第二次保存没有新改动，会清 dirty 停止。