## 四审结论
- 总体：**1 条必修新风险**
- 三审 4 必修里：`deepEqualStorage`、`loadFromServer`、fetch ref-first 基本修住；但 `saving` 的 finally 身份校验引入了实质回归。
- 结论：**修完 saving 卡死后，可以进 P2I**。

## 三审必修项的修复验证
1. `deepEqualStorage` 跳过 undefined：**OK，带边界说明**
   - 嵌套对象 OK，递归会继续过滤 undefined key。
   - `convertNodesToStorage` 正常不会主动生成数组里的 undefined 元素；但如果用户数据里真有 `[a, undefined, b]`，当前比较会把 `undefined` 和服务端 JSON 回来的 `null` 判不等。
   - Date / Map / Set 没保护，会被当成无 key 对象比较；按当前 storage 契约不是必修。
   - `NaN/Infinity` 仍不等价于 JSON.stringify 语义，会和 `null` 不等。

2. `createOnServer` capturedCanvasId 校验：**部分，且引入新问题**
   - discarded success 路径本身完整，caller 会跳过 `setSearchParams`。
   - 但正常成功路径也会卡住 `saving=true`，见必修项。

3. `loadFromServer` 入口同步 state：**OK**
   - `ref` 和 `state` 同步切到 `id`，能避免 GET 回包自丢弃。
   - 没看到新的隐蔽 race。

4. 所有 finally 加身份校验：**部分**
   - `isLoading` 的身份校验方向是对的。
   - `saving` 不应该按 canvas 身份关，因为它是这个 save/create 操作自己打开的全局 UI 状态。

## 三审建议项的修复验证
- save 成功先写 `serverVersionRef.current`：**OK**
- fetch effect `.then` 先写 `serverVersionRef.current`：**OK**
- create 后 URL effect 短路链路：**OK**
- save 返回 `{ skipped/discarded }` 分支：**OK**
- `skipped` 静默：**建议项**，当前 SaveStatus 会显示保存中，双击/并发静默可接受；以后有 toast 再提示“已有保存进行中”。

## 新发现的必修项
[src/hooks/useMultiCanvas.ts](<E:\业务全景图\src\hooks\useMultiCanvas.ts:876>) / [src/hooks/useMultiCanvas.ts](<E:\业务全景图\src\hooks\useMultiCanvas.ts:898>)

`createOnServer` 成功后先把 `canvasIdRef.current` 改成 `result.id`，finally 再判断：

```ts
if (canvasIdRef.current === capturedCanvasId || canvasIdRef.current === null) {
  setSaving(false);
}
```

首次保存时 `capturedCanvasId === null`，成功后 `canvasIdRef.current === result.id`，条件为 false，所以 `saving` 永久不关。已有 canvas “另存为”也一样：captured 是旧 id，成功后 ref 是新 id，也不关。

具体修改：`saving` 用 operation token 或直接在 save/create 的 finally 里无条件 `setSaving(false)`。当前有 `saveInFlightRef` 全局互斥，直接无条件关是安全的；更严谨是加 `savingOpRef`，按操作 token 关，而不是按 canvas id 关。`save` 的 finally 也建议同样处理，否则保存中切 canvas 后也可能留下 `saving=true`。

## 新发现的建议项
- `createOnServer` catch 里用户已切走仍 `throw err`，页面会在新 canvas 上弹“创建失败”。建议以后把旧操作错误也返回/标记 `discarded`，避免 stale alert。
- `deepEqualStorage` 如果要严格等价 JSON.stringify，需要处理数组 undefined、非有限 number、非 plain object。按当前数据模型不是 P2I 前必修。

## 不必修但要知道
- `Date/Map/Set` 当前 storage 契约里不该出现；如果未来 detailConfig 扩展到这些类型，需要先做 normalize。
- `NaN/Infinity` 进入 position/size/style 时会造成 false dirty 或服务端回读差异。

## 阶段 2 hook 状态机评级
- 当前：**P2H+++ 接近 production-ready，但 saving 卡死必须先修。**
- 修完上面的 `saving` finally 后：**可以进入 P2I 导出/导入 UI**。
- 文档里建议记：storage 只支持 JSON-safe plain data；discarded 是“旧异步结果已丢弃”，caller 不应写 URL 或弹旧操作成功提示。