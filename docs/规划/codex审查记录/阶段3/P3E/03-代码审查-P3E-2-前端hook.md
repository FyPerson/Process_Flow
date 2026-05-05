**第一层：非技术总结**

P3E-2 前端数据层 hook（useAnnotations）codex 一审。

codex 评价："当前 P3E-2 的整体方向正确，但状态代际和乐观回滚还有两个会造成旧画布/旧用户数据回灌的必修问题。修完这些后，数据层契约可以支撑 P3E-3。"

**4 条 high 必修 + 1 medium + 1 low**：

1. **High（security）**：enabled=false 分支没递增 seq。退登/切 canvas 时旧 GET 飞行会被遗漏拦截，回包后污染新状态。
2. **High（edge-case）**：canvasId/user 切换不立即清空 annotations。新请求失败时旧画布批注残留 —— 节点 id 跨画布复用时会显示错画布的徽章数。
3. **High（edge-case）**：mutator（create/resolve/reopen）异步回包不校验代际。旧画布 created 会被追加进当前画布；resolve/reopen 失败回滚会把旧画布完整快照覆盖新画布。
4. **High（edge-case）**：乐观回滚用整表快照。并发场景下"先发失败 → 回滚 → 覆盖后发成功结果"或"丢失飞行中的新建批注"。

**1 medium 建议**：与 P3D-2 canvasMetaState.kind === 'loading' 集成；元信息加载中不发 annotations 请求。

**1 low 建议**：DTO 类型重复声明（前端 Annotation vs 后端 AnnotationResponse），P3E-3 之后再考虑抽共享类型。

**通过项**：
- ✅ 派生层 useMemo 重算正确（5 人内网 + < 1000 条批注规模不需 useDeferredValue）
- ✅ create 不乐观（等服务端返回 id）合理
- ✅ mutator throw ApiError 契约合适（P3E-3 必须 try/catch）

**confidence: high**

**门禁判断**：**暂不建议进 P3E-3**；还差统一 fetch/mutation generation 保护、切换 key 清空策略、按 id/token 的乐观回滚。

**Claude 独立判断**：4 条 high 全部赞同，无反对。这是 codex 镜子价值最强的一次审查 —— 我自审 13 项里讲了 seq 保护和乐观回滚细节，**但没把两者升华成"代际（generation）"统一概念**。codex 一句话点明：seq 只保护 GET，generation 应该保护 GET + 所有 mutation。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / code-review / advice-only / confidence: high
> 实际耗时：约 4 分钟
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260505_135852.json`
> 上下文文件（7 份）：annotations.ts (前端 api+hook) / canvases.ts api / auth/api.ts / useMultiCanvas.ts / 服务端 schemas/routes

**High 1：enabled=false 分支没递增 seq**

[src/hooks/useAnnotations.ts:70-88](E:/业务全景图/src/hooks/useAnnotations.ts) `refetch` 进入 `!enabled` 分支时直接 setAnnotations([]) 不递增 seq。已有 GET 在飞行时，用户退出登录或 canvasId 变为 null 后，旧请求返回仍会通过 seq 校验把已清空的批注重新写回游客/本地草稿状态。

**修法**：在 `!enabled` 分支先 `++requestSeqRef.current` 再清空。把"当前数据代际"抽成 generationRef，所有 fetch/mutation 共用。

**High 2：canvasId/user 切换不立即清空旧 annotations**

[src/hooks/useAnnotations.ts:93-99](E:/业务全景图/src/hooks/useAnnotations.ts) canvasId 或 user 从一个有效值切到另一个有效值时不会立即清空旧 annotations。如果新请求失败，旧用户/旧画布批注继续留在 state 中。节点 id 在不同画布复用时，P3E-3 徽章和详情面板可能短暂或持续显示错画布数据。

**修法**：按 fetch key（如 `${canvasId}:${user.id}`）检测变化，key 变化时立即递增 generation 并清空 annotations/error。保守做法：在 enabled refetch 开始时清空 annotations。

**High 3：mutator 不校验代际**

[src/hooks/useAnnotations.ts:125-161, 169-191](E:/业务全景图/src/hooks/useAnnotations.ts) create/resolve/reopen 的异步回包没有校验当前 canvas/user 代际。POST 返回后会把旧画布 created 追加进当前画布；resolve/reopen 失败时 setAnnotations(previous) 可能把旧画布完整快照回滚到新画布。

**修法**：每个 mutator 发起时捕获 generation/canvasId/userId，await 后只有当前 generation 仍匹配才允许写 state 或回滚；不匹配则直接丢弃本次结果。generation 应在 canvasId/user/enabled 变化时递增。

**High 4：乐观回滚用整表快照**

[src/hooks/useAnnotations.ts:147-160, 174-187](E:/业务全景图/src/hooks/useAnnotations.ts) 乐观回滚使用整个 annotations 闭包快照。并发 resolve/reopen 同一 id、或一个操作飞行时另一个 create/resolve 成功，较早失败会 setAnnotations(previous)，覆盖后续成功结果或丢失新建批注。

**修法**：不要用整表快照回滚。可选方案：
- (A) 禁用同一 annotation id 的重复操作直到回包；
- (B) 为每个 id 维护 operation token，仅最新 token 可以落地/回滚；回滚时只恢复目标 annotation，保留其他条目的后续变化；
- (C) 失败后 refetch 当前画布（多一次请求但简单）。

**Medium 1：与 canvasMetaState 集成**

[src/hooks/useAnnotations.ts:55-67](E:/业务全景图/src/hooks/useAnnotations.ts) hook 只用 canvasId 和 user 判定 enabled，未表达 P3D-2 的 canvasMetaState.kind === 'loading'。这不是服务端安全漏洞，但会在画布元信息尚未确认时提前请求批注，可能产生重复 403/404 或 UI 误报。

**修法**：给 useAnnotations 增加可选 enabled/readReady 入参，或要求 P3E-3 调用方在 canvasMetaState.kind !== 'server' 时传 canvasId=null。把这个门禁写进 hook 注释。

**Low 1：DTO 类型重复声明**

[src/api/annotations.ts:58-72 / server/schemas/annotation.ts:45-61](E:/业务全景图/src/api/annotations.ts) AnnotationResponse 与前端 Annotation 手动重复声明，短期与 canvases.ts 风格一致，但后续服务端字段增减时容易漏同步。

**修法**：当前阶段可接受；若 P3E-3 还会继续扩展字段，建议抽共享 DTO 类型文件。

**recommendations**：

- ✅【通过】unresolvedCountByNodeKey 和 annotationsByNodeKey 依赖 annotations 重算是正确的；在内网、少用户、单画布约千条批注规模下不需要 useDeferredValue。
- ✅【通过】create 等服务端返回真实 id 后再更新缓存是合理选择。
- 【建议】mutator 继续 throw ApiError 是适合 UI 表单/toast 的契约；P3E-3 必须逐个 try/catch，不要只依赖 hook.error。
- 【建议】fetch error 时是否清空旧列表需要按场景区分：同一画布手动 refetch 失败可以保留旧列表；canvas/user key 变化后的 fetch 失败必须保持空列表。

**risks**：

- 未修代际 → 退出登录/切账号/切画布/请求失败路径出现旧批注泄露或错画布显示
- 未修乐观回滚 → 快速点击或并发操作导致本地缓存与服务端分叉，P3E-3 UI 难解释
- P3E-3 不统一处理 mutator 抛错 → 未处理 Promise rejection / 用户操作失败无反馈

---

**Claude 修复方案**

| 严重度 | 项 | 修法 | 预计 |
|---|---|---|---|
| 🟠 high 1 | seq 改 generationRef，enabled=false 也递增 | 重构 ref 命名 + 加递增点 | 5 分钟 |
| 🟠 high 2 | canvas/user key 变化立即清空 annotations + error | 加 key 检测 + 切换时清空 | 8 分钟 |
| 🟠 high 3 | 所有 mutator 发起时捕获 generation，回包校验 | 改 createCb/resolveCb/reopenCb | 12 分钟 |
| 🟠 high 4 | 乐观回滚改"只恢复目标 id 字段"而非整表 | 用 map 替代 previous 快照 | 8 分钟 |
| 🟡 medium 1 | 加可选 readReady 入参 + hook 注释明确"caller 应在 canvasMetaState.kind!=='server' 时传 canvasId=null" | 改 hook 入参 | 5 分钟 |
| ⚪ low 1 | DTO 重复声明 P3E-3 之后再考虑（不在本轮修） | —— | 0 |

**预计总修时**：约 40 分钟。修完跑二审 —— 因为是**重构性修法**改变核心状态机，不是表面调整，应当 codex 验证。

**用户决策**：
[x] 4 条 high + 1 medium 全采纳，修完跑二审验证
[ ] 修哪条、跳哪条
