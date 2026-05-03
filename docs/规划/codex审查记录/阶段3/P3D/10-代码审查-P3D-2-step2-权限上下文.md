**非技术总结**
整体方向是对的：`canWriteCanvas` 和服务端 `canWrite()` 在真实服务端画布上等价，`createOnServer` 的 owner 推导也没有破坏现有调用方。
但我不建议直接放行 step 3：现在 `canvasMeta=null` 同时代表“本地草稿”和“服务端画布加载中/失败”，而 `canWriteCanvas(null, user)` 会放行登录用户。当前 BFV 的 loading/error 页面大多挡住了用户操作，但这个状态契约对后续 10 个 mutation gate 不安全，必须先收紧。

**技术细节**
**必修 1：拆开 `canvasMeta=null` 的两种语义。**
位置：[useMultiCanvas.ts](<E:/业务全景图/src/hooks/useMultiCanvas.ts:103>)、[useMultiCanvas.ts](<E:/业务全景图/src/hooks/useMultiCanvas.ts:432>)、[canWriteCanvas.ts](<E:/业务全景图/src/auth/canWriteCanvas.ts:46>)。
`UseMultiCanvasReturn.canvasMeta` 注释写了 null 可能是 `canvasId=null` 本地草稿，也可能是 fetch 中/失败；但纯函数把 null 当成本地草稿可写。推荐改成显式三态，例如 `local | loading/error | serverMeta`，或最小修正为：有 URL/server canvasId 且 `canvasMeta == null` 时 fail-closed，只有真正未挂服务端的本地草稿才允许 `null -> writable`。

**必修 2：加载/切换服务端画布时不要沿用旧画布权限。**
位置：[useMultiCanvas.ts](<E:/业务全景图/src/hooks/useMultiCanvas.ts:491>)。
effect 开始 fetch 新 `canvasIdProp` 时没有把权限态切到“unknown/loading”。目前 UI 下一帧进入 loading，实际可操作窗口很小，但作为 step 3 gate 的基础状态不够硬。和必修 1 一起修：server canvas 未拿到 meta 前，`canvasWritable` 必须是 false。

**等价性结论**
前端 `canWriteCanvas` 对非 null meta 与服务端等价：guest false；admin 对 archived/public/private 都 true；普通用户 archived false；public true；private 只 owner true。admin 提前判定与服务端 archived 分支后的 admin 判定结果一致。

**建议项**
`AuthContext.readOnly` 保留是合理的，它表达“身份维度是否游客”，不应替代画布写权限。
暂时不把 `user/canvasWritable` 传给 `FlowCanvas` 我同意，step 2 已经用派生 `readOnly` 接住现有消费者；step 3 真接节点级 gate 时再加 `user + canvasWritable`，避免无消费者 prop。
`SaveStatus` 的 title 仍写“游客只读模式”，现在只读也可能来自 archived/private 非 owner，后续顺手改成“当前画布只读”更准确：[SaveStatus](<E:/业务全景图/src/components/SaveStatus/index.tsx:106>)。

验证：`git diff --check HEAD` 通过；`npm test` 和 lint 被当前执行策略拦截，未能重跑。我的最终推荐是：修完 `canvasMeta` 三态/加载 fail-closed 后进 step 3。