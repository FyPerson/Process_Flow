**第一层：非技术总结**

P3E-2 useAnnotations hook 二审重构后 codex 三审。

**结论：通过门禁前最后 3 条收尾**。codex confidence=high 明确"二审 4 high + 3 medium 的核心修复基本成立，状态机主路径可以进入 P3E-3"。

**2 medium 必修 + 1 low 文档 + 4 low 通过**：

1. **Medium 必修（loading 悬挂）**：performFetch 在 disabled 分支直接 return，不清 loading=true → 旧 GET 飞行中切游客/本地草稿/readReady=false 时 loading 永久卡住。**真 bug**，我自审场景表漏了。
2. **Medium 必修（mutator 内部 key guard）**：resolve/reopen 起手读 state.annotations 找 snapshot 没校验 state.key === currentKey；render 输出已隔离旧数据但 mutator 内部仍可能读到陈旧缓存。
3. **Low 文档**：createAnnotation 注释抄了 resolve 模板写"同 id 已 pending throw"，但 create 没有 id —— 误导 P3E-3 调用方。

**4 条 low 通过**：
- ✅ mutationsCounter 递归 refetch 业务规模可接受
- ✅ pendingIdsRef finally 路径正确（add/throw/delete 顺序无误删风险）
- ✅ commitMutation 双重 key 校验非过度防御
- ✅ currentKey 派生 + disabled 折叠语义正确

**confidence: high**

**门禁判断**：修 2 medium + 1 low 文档后即可进 P3E-3；不必再跑四审。

**Claude 独立判断**：3 条全赞同。Medium 1 是真镜子（loading 悬挂场景我自审漏了）。这次 codex 没有 high，状态机重构成功。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / code-review / advice-only / confidence: high
> 实际耗时：约 4 分钟
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260505_142042.json`
> 上下文文件（3 份）：useAnnotations.ts / api/annotations.ts / 04-二审 归档

**Medium 1 必修：loading 悬挂**

[src/hooks/useAnnotations.ts:139-141, 179-184](E:/业务全景图/src/hooks/useAnnotations.ts) `performFetch(DISABLED_KEY, ...)` 会先递增 fetchSeqRef，但直接 return，不会把已有 loading 置回 false。若旧 GET 飞行中切到游客、本地草稿或 readReady=false，旧 GET 的 finally 又会因 seq 过期不再清 loading，最终可能永久 loading=true。

**修法**：在 disabled 分支显式执行 setLoading(false)；保持递增 fetchSeq 以作废旧 GET 的 finally。

**Medium 2 必修：mutator 内部缺 key guard**

[src/hooks/useAnnotations.ts:270, 326](E:/业务全景图/src/hooks/useAnnotations.ts) resolveAnnotationCb / reopenAnnotationCb 查找 snapshot 时直接读 state.annotations，没有先确认 state.key === currentKey。render 输出已用 visibleAnnotations 隔离旧数据，但 mutator 内部仍可能在 key 切换后的短暂窗口或陈旧回调路径中读到隐藏的旧缓存。

**修法**：mutator 起手加显式保护：若 state.key !== currentKey，直接 throw not_ready；或基于 visibleAnnotations 查找 snapshot。两者语义等价但 visibleAnnotations 更显式。

**Low 1：createAnnotation 注释错**

[src/hooks/useAnnotations.ts:81, 238-253](E:/业务全景图/src/hooks/useAnnotations.ts) createAnnotation 的接口注释写了"同 id 已 pending throw annotation_mutation_pending"，但 create input 没有 id，当前实现也没有 create 级 pending guard。注释会误导 P3E-3 调用方以为 hook 已防重复提交。

**修法**：注释改为"create 不做 hook 内串行化；调用方需在提交中禁用创建按钮；服务端容量限制负责上限"。

**Low 通过项**：

- ✅ mutationsCounterRef 递归 refetch 不会无限递归；按当前内网 5 人规模可接受
- ✅ pendingIdsRef.add(id) 后的成功/失败/throw 路径都会进 finally 并 delete；起手的 not_ready/pending/not_in_cache 在 add 之前，无误删
- ✅ commitMutation 外层 keyGen + 内层 prev.key 双重校验能覆盖 React 批处理和陈旧闭包，非过度防御
- ✅ currentKey 已覆盖所有触发清空/重拉的 dimension；disabled 状态内部维度变化折叠成 disabled，与"禁用时空状态、不请求"语义一致

**recommendations**：

- 先修 loading 悬挂 —— 进 P3E-3 前最值得补的实际 bug
- 给 resolve/reopen 增加 state.key === currentKey 的 mutator 内部 guard
- P3E-3 调用契约写清楚：readReady 必传 / 所有 mutator try/catch / resolve/reopen 用 isAnnotationPending(id) 禁用 / create 提交期间 UI 自己禁用按钮

**risks**：

- 不修 loading 悬挂 → 用户切到本地草稿/游客/元信息未 ready 时，批注面板可能一直显示加载
- 不加 mutator key guard → 若 P3E-3 把 mutator 传给 effect/快捷键/命令面板（不只是当前可见列表按钮），陈旧缓存风险放大
- 并发 create 当前允许重复提交（hook 不防），UI 未禁用提交按钮可能重复批注

---

**Claude 修复方案**

| 严重度 | 项 | 修法 | 预计 |
|---|---|---|---|
| 🟡 medium 1 | performFetch disabled 分支 setLoading(false) | 加 1 行 | 1 分钟 |
| 🟡 medium 2 | resolve/reopen 起手 state.key !== currentKey 直接 throw | 加 2 处 guard | 5 分钟 |
| ⚪ low 1 | createAnnotation 注释纠正 | 改字符串 | 1 分钟 |

**预计总修时**：约 10 分钟。修完跑 tsc + npm test 全过即合入 P3E-2 完成；**不必跑四审**（codex 明确"修完即可进 P3E-3"）。

**用户决策**：
[x] 3 条全采纳，修完合入主干进 P3E-3
[ ] 修哪条、跳哪条
