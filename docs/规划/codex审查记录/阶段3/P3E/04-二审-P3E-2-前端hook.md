**第一层：非技术总结**

P3E-2 一审反馈修复后 codex 二审。

**结论：仍未通过门禁，4 条新 high**。codex 明确指出"暂不建议进 P3E-3。还差 current key 依赖修正、render 层旧数据隔离、GET 与 mutation 并发顺序处理、同 id mutation 串行化/token 这四个门禁点。"

**这是连续两次镜子击穿**——一审 4 条 high 我以为修完了，二审又发现 4 条新 high 都是状态机边界。承认我自审虽然列出了相关场景，但**用"应该没问题"或"幂等兜底"逃避了真正穷举状态机路径的工作**。

**4 条新 high**：

1. **High 1（user 切换不触发清空/重拉）**：refetch deps 是 `[canvasId, enabled]` 不含 user.id。用户从 A 切到 B 时 canvasId 不变 + enabled 仍 true → refetch 不重建 → 旧批注保留。我修一审时只想着递增 generation，**没回头检查 useCallback deps 是不是真覆盖了所有 key**。

2. **High 2（passive useEffect 清空有渲染时机问题）**：`setAnnotations([])` 在 effect 里执行（commit 后），新 canvas/user 的第一次 render 仍能拿到旧 annotations。这是 React 渲染模型细节。

3. **High 3（GET 后回包覆盖 mutation 成功）**：loading=true 时 mutator 不被禁用。GET 飞行 + POST 飞行 + POST 先回包 append created + GET 后回包 setAnnotations(serverList) → **created 在本地消失**。

4. **High 4（同 id 并发缺 pending guard）**：B 方案只做了"按 id 局部回滚"但没有 per-id token。同 id 双发 resolve：第一次失败 + 第二次成功 → 第一次回滚 snapshot 覆盖第二次成功。我自审 #7 列了但用"服务端幂等"兜过去了。

**3 条 medium**：generationRef 应该只在 key 变化时递增（不被 refetch 自动作废 mutation）/ unmount cleanup 缺失 / readReady 应改必填。

**confidence: high**

**门禁判断**：暂不进 P3E-3，4 high + 3 medium 全采纳。

**Claude 独立判断**：4 high + 3 medium 全赞同，无反对。这次反思的盲点：(a) useCallback deps 覆盖检查；(b) React 渲染模型 passive effect 时序；(c) GET/mutation 共享 generation 的副作用；(d) "幂等兜底"不是真正的状态机修法。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / code-review / advice-only / confidence: high
> 实际耗时：约 4 分钟
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260505_141005.json`
> 上下文文件（3 份）：useAnnotations.ts / api/annotations.ts / 03-代码审查 归档

**High 1：user 切换不触发清空/重拉**

[src/hooks/useAnnotations.ts:93-120](E:/业务全景图/src/hooks/useAnnotations.ts) refetch 的依赖只有 canvasId 和 enabled，useEffect 又只依赖 refetch。当 user 从 A 直接切到 B、且 canvasId 相同、enabled 仍为 true 时，不会清空 annotations、不会递增 generation、也不会重新 GET；这与注释里的"canvasId / user / readReady 任一变化"矛盾。

**修法**：引入稳定 fetch key，例如 `const userId = user?.id ?? null`、`const annotationsKey = enabled ? \`${canvasId}:${userId}:${readReady}\` : 'disabled'`，让清空、generation key、自动 refetch 都依赖这个 key；至少把 user?.id 纳入触发依赖。

**High 2：passive useEffect 清空有渲染时机问题**

[src/hooks/useAnnotations.ts:116-120](E:/业务全景图/src/hooks/useAnnotations.ts) "切换 key 立即清空"实际发生在 passive useEffect 中。新 canvas/user 的一次 render 仍可能拿到旧 annotations；同时旧 mutation promise 若在 commit 后、effect 执行前回包，仍可能通过旧 generation 校验写入。

**修法**：不要只靠 effect 清空。更稳妥是把 state 与 key 绑定，返回时若 state.key !== currentKey 就暴露空列表；或在 layout 阶段 / 同步 key guard 中先失效旧 generation。核心是渲染输出必须按 current key 过滤，不能等待 effect 后再清。

**High 3：GET 后回包覆盖 mutation 成功**

[src/hooks/useAnnotations.ts:93-113, 142-163](E:/业务全景图/src/hooks/useAnnotations.ts) loading=true 时允许 create，会出现 GET 先发、POST 后发但先回包的顺序：POST 先 append created，随后旧 GET 用 setAnnotations(list) 覆盖，created 在本地消失。这个问题不限 create，手动 refetch 与 resolve/reopen 并发时也可能用旧列表覆盖同 key 的较新 mutation 结果。

**修法**：将"key generation"和"fetch seq"拆开：key 变化才让 mutation 过期；每次 GET 用独立 fetchSeq 只淘汰旧 GET。GET 落地前若检测到 fetch 发起后发生过 mutation，则跳过本次旧列表并补一次 refetch，或合并 preserve 当前本地较新 id。更简单的 P3E-2 方案是在首次 loading 期间禁用 mutator，并在 hook 内对 loading 抛 not_ready。

**High 4：同 id 并发缺 pending guard**

[src/hooks/useAnnotations.ts:175-212](E:/业务全景图/src/hooks/useAnnotations.ts) high 4 的 B 方案目前只做了"按 id 局部回滚"，但没有 per-id operation token 或 pending guard。同一 id 快速双发 resolve/reopen 时，较早请求失败仍可能把较晚请求的成功结果回滚掉；即使当前服务端 resolve 幂等，网络失败 + 后发成功的本地状态仍会错。

**修法**：对每个 annotation id 串行化 mutation：pendingIdsRef 中已有 id 时直接 no-op/throw `annotation_mutation_pending`，并让 P3E-3 禁用按钮；或实现 per-id token，只有当前 token 可以 commit/rollback。若未来 resolve 会刷新 resolved_at，必须使用 token/串行化，不能只依赖服务端幂等。

**Medium 1：generationRef 在 refetch 入口递增过激**

[src/hooks/useAnnotations.ts:93-113, 142-212](E:/业务全景图/src/hooks/useAnnotations.ts) generationRef 在每次 refetch 入口递增，会让同一 canvas/user 下已经发出的 mutation 过期。手动 refetch 若发生在 PATCH/POST 飞行期间，mutation 成功结果会被丢弃，而 refetch 返回的列表未必包含该 mutation。

**修法**：把"key 代际"限制为 canvasId/user/readReady/enabled 变化；同 key 的 GET 使用单独 fetchSeqRef。mutation 只校验 key 代际，不应被同 key refetch 自动作废。

**Medium 2：unmount cleanup 缺失**

[src/hooks/useAnnotations.ts:142-212](E:/业务全景图/src/hooks/useAnnotations.ts) 组件 unmount 时没有 cleanup 递增 generation。若 fetch/mutation 在 unmount 后回包，当前代码仍可能尝试 setState；mutator 的 rejection 也需要由调用方持有的 promise 自己处理。

**修法**：在 effect cleanup 中失效当前 key generation，或维护 mountedRef。同时在 P3E-3 调用方强制所有 mutator 用 try/catch 或 toast promise 包裹，不要 fire-and-forget。

**Medium 3：readReady 应改必填**

[src/hooks/useAnnotations.ts:76-82](E:/业务全景图/src/hooks/useAnnotations.ts) readReady 默认 true 能兼容旧调用，但会削弱 P3D-2 集成约束；P3E-3 调用方一旦忘传，loading 阶段仍会提前 GET。

**修法**：把 readReady 改为必填，或提供更高层 hook 从 canvasMetaState.kind === 'server' 派生，避免靠注释约束。

**Low 1：annotationKey 冒号拼接**

[src/hooks/useAnnotations.ts:37-39](E:/业务全景图/src/hooks/useAnnotations.ts) 若 sheetId/nodeId 未来允许包含冒号，存在 key 碰撞风险。

**修法**：业务上 ShortIdSchema 限制为字母数字下划线短横线（不含冒号），可保留；本轮不修。

**Low 2（通过）**：enabled false→true 主路径正确

mutator 的 `const gen = generationRef.current` 是在调用时捕获，不是 hook 创建时捕获，这一点语义正确。

**Low 3（通过）**：annotation_not_in_cache fail-closed 合理

UI 正常只能对缓存里的批注操作，缓存缺失时本地直接失败比盲目改空状态更安全。

**recommendations**：

- 优先补三件事：用 current key 驱动清空/返回值、拆分 key generation 与 fetch seq、为同一 annotation id 加 pending/token
- P3E-3 调用方在 loading 或 per-id pending 时禁用 resolve/reopen/create 控件，并对所有 mutator 做 try/catch
- readReady 若能在本阶段统一接入，建议改成必填

**risks**：

- 直接进入 P3E-3 后：切账号 / 初始加载中创建 / 快速双击 resolve 这些交互会暴露错画布数据或本地缓存与服务端分叉
- 当前 common generation 会把同 key 的 refetch 和 mutation 互相作废，后续 UI 加"刷新"按钮或自动 refetch 后更容易出现难解释的状态回退

---

**Claude 修复方案（重构 hook 状态机第 2 次）**

| 严重度 | 项 | 修法 | 预计 |
|---|---|---|---|
| 🟠 high 1 | refetch deps 加 user.id；引入 stable annotationsKey | useMemo annotationsKey + useEffect 依赖 | 8 分钟 |
| 🟠 high 2 | state 与 key 绑定；返回值按 currentKey 过滤旧数据 | useState({ key, annotations })，return 时 key 不匹配返 [] | 10 分钟 |
| 🟠 high 3 | 拆 fetchSeqRef（淘汰旧 GET）vs keyGenerationRef（淘汰跨 key mutation）| 两个 ref 拆开 + GET 用 fetchSeq + mutation 用 keyGen | 12 分钟 |
| 🟠 high 4 | pendingIdsRef Set 串行化同 id mutation；id 已飞行 throw annotation_mutation_pending | Set 在 mutator 起手 add，回包 finally 清 | 8 分钟 |
| 🟡 medium 2 | unmount cleanup 失效 keyGen | useEffect cleanup 递增 keyGen | 3 分钟 |
| 🟡 medium 3 | readReady 改必填 | 改类型 + 调用方都没用上的话默认就报错 | 2 分钟 |

**预计总修时**：约 45 分钟。修完跑三审 —— 因为这是 P3E-2 hook 第二次重构，必须 codex 验证。

**用户决策**：
[x] 4 high + 3 medium 全采纳，重构 + 跑三审
[ ] 修哪条、跳哪条 / 改回 C 方案 refetch
