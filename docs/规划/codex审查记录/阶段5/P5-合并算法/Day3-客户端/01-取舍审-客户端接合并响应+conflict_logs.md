# 01-Day 3 取舍审 — 客户端接合并响应 + conflict_logs 写入 + Delta 序列化

## 元信息

- **审查日期**：2026-05-07
- **审查范围**：阶段 5 Day 3（客户端接服务端合并响应 + conflict_logs 写入路径 + Delta 序列化 helper + 25+ 单测）
- **codex 模式**：stdin 注入 / 126KB / MaxContextChars=180000 / 实读 7 文件（canvases.ts service + tryMerge.ts + types.ts + 0001/0005 migration + routes/canvases.ts + src/api/canvases.ts + useMultiCanvas.ts save 段）+ 99-收尾归档
- **codex 版本**：codex-cli 0.128.0
- **判定结论**：`canEnterImpl: true`（confidence=high；3 风险必修 + 10 隐藏判断点全采纳）
- **codex 自我盲区声明**：实读全部 7 文件 + 99-收尾归档已嵌入 prompt
- **基于 codex 协作模式**："翻译报告（不下结论），分 severity 排列，不替用户做采纳/不采纳"

## Claude 拍板记录

### 10 项判断点逐条拍板

| ID | 判断点 | codex 推荐 | Claude 拍板 | 处置 |
|---|---|---|---|---|
| 1 | conflict_logs 写入位置 | A service 内同事务 | **A** | ✅ 采纳 — 日志是保存事务副作用，原子边界；B 主表成功但日志失败/丢；C 多层无收益 |
| 2 | conflict_logs.details 字段格式 | A 含 deltaA/deltaB 完整 | **A** | ✅ 采纳 — Day 3 目标明确要求可追溯；B 不能重放；C 成功路径丢 delta 削弱审计 |
| 3 | Day 3 是否覆盖 5 种 resolution | A 只覆盖 3 种 | **A** | ✅ 采纳 — auto_merged + conflict + base_version_expired；B 会牵出 overwrite/cancelled 端点 + 权限语义侵 Day 4 |
| 4 | Delta 序列化 helper 实现位置 | A merge/serialize.ts 同目录 | **A** | ✅ 采纳 — Delta 是 merge 子域类型；B 过早 codec 分层；C 编码耦合 conflict_logs 服务 |
| 5 | 客户端 merged=true 状态替换 | A loadProject 整体替换 | **A** | ✅ 采纳 — mergedData 已是服务端最终态；**B 会重复套 Bob 改动** —— Bob 提交时已把 dirty 数据当 incoming 进了 mergedData；C 阻断自动保存 |
| 6 | base_version_expired 处理 | A 强制 GET 重载 + drafts 保留 | **A** | ✅ 采纳 — 无 base 快照无法三方合并；B 让用户停在不可保存基线持续 409 |
| 7 | PUT response 类型化 | C 单独 src/api/canvases.types.ts 镜像 + 契约测试 | **C** | ✅ 采纳 — 客户端不能 import server；A 易漂移；B 破坏前后端边界 + Vite 打包；契约测试是关键 |
| 8 | 25+ 单测分布 | B 服务端 + 客户端 hooks 各分 | **B** | ✅ 采纳 — A 漏 useMultiCanvas.save 行为；C 把 Day 4 Playwright 提前超出 Day 3 |
| 9 | conflict_logs 写入限频/批量 | A 每次写一条 | **A** | ✅ 采纳 — 单实例小并发；B 对 <100 条/天无收益 + 引 flush/丢日志风险 |
| 10 | debugDelta 是否真触发 | A saveCanvas 改 includeDebugDelta=true | **A** | ✅ 采纳 — 与 conflict_logs.details 链路对齐；B 重算 + 与 tryMerge 内部 delta 漂移 |

### 3 项风险吸收（必修）

| 等级 | 风险 | 处置 |
|---|---|---|
| **high** | **ApiError 当前丢弃 conflicts** — `src/api/canvases.ts` 非 2xx 只提取 currentVersion/issues，409 conflict 的 conflicts 数组到不了 hook | ✅ 切片 D-3 必修：扩 ApiError + apiFetch 解析 409 body 的 `conflicts` 字段；useMultiCanvas conflict state 也扩字段 |
| **high** | **includeDebugDelta 仍为 false** — saveCanvas 合并路径当前 `includeDebugDelta:false`，Day 3 写 details 会缺 deltaA/deltaB | ✅ 切片 D-2 必修：saveCanvas 调 tryMerge 时改 `includeDebugDelta:true` |
| medium | **conflict_logs user_a_id 非空** — base_version_expired 分支当前在查询 currentVersionAuthor 前就 return | ✅ 切片 D-2 必修：base_version_expired 分支补查 currentVersionAuthor（用 baseVersion 拿 saved_by；缺失抛 DataIntegrityError） |

### 10 项隐藏判断点（全采纳）

1. ✅ **baseVersion > currentVersion 异常 409 不写 conflict_logs**（或单独标 malformed_base_version）— Day 3 实施时只对 baseVersion < currentVersion 路径写日志
2. ✅ **base_version_expired 也得查 currentVersionAuthor 填 user_a_id**；缺失仍抛 DataIntegrityError（与 medium 风险吸收同源）
3. ✅ **details 字段 schemaVersion 设计**：`{ schemaVersion: 1, baseVersion, currentVersion, resolution, report?: MergeReport, conflicts?: Conflict[], debugDelta?: { deltaA, deltaB }, truncated?: boolean }`
4. ✅ **Delta serialize 测试覆盖 JSON.stringify→parse 结构**，不要求反序列化回 Map（除非未来要重放）—— 切片 D-1 测试范围
5. ✅ **details 软上限或截断策略**：超限至少保留 conflicts/report，delta 可截断并写 `truncated=true` —— 切片 D-1 序列化层实现
6. ✅ **conflict_logs 插入失败让 saveCanvas 事务回滚**（不用 try/catch 静默吞）— 与判断点 1 同事务原则一致
7. ✅ **客户端 ApiError 扩 conflicts 字段**；useMultiCanvas conflict state 也保存 conflicts —— 与 high 风险 1 同源
8. ✅ **merged=true 后删除草稿前确认 canvasId 一致**；用户保存期间继续编辑不应 setDirty(false) 但仍更新 serverVersion/mergedData 的策略要单测覆盖 —— 切片 D-4 hook 测试
9. ✅ **base_version_expired 重载最新画布时保留本地草稿**，不调 deleteDraft —— 切片 D-4 实施
10. ✅ **overwrite/cancelled 若 Day 4 才做**，migration 0005 已允许枚举，但不应写不可达日志 — 切片 D-2 INSERT 路径只对 3 种 resolution

---

## Day 3 实施流程定稿

### 前置修风险（在切片之前先把已知风险修掉）

```
P-1（修 high 风险 2 + 判断点 10）：
  saveCanvas 合并路径 includeDebugDelta:false → true
  位置：server/services/canvases.ts 合并分支调 tryMerge 处

P-2（修 high 风险 1 + 隐藏判断 #7）：
  扩 ApiError + apiFetch 解析 409 body 的 conflicts 字段
  位置：src/api/api-fetch.ts（或同款文件）+ src/types/api-error.ts

P-3（修 medium 风险 + 隐藏判断 #2）：
  base_version_expired 分支补查 currentVersionAuthor
  位置：server/services/canvases.ts 合并分支 baseSnapshot 缺失返 base_version_expired 之前先查 saved_by
```

### 4 个切片

```
D-1 Delta 序列化（前置：P-1/P-2/P-3 修完）：
  新建 server/services/merge/serialize.ts
  - serializeDelta(delta: Delta): JsonValue —— Map<K,V> 转 entries 数组
  - 4 bucket（projectMetaChangedFields / sheetsAdded / sheetsRemoved / sheetsModified）全覆盖
  - 截断策略：details 超过 X KB（待定阈值）→ delta 截断 + truncated=true 标志
  - 不要求反序列化回 Map（隐藏判断 #4）
  测试：~5 case（4 bucket + JSON round-trip 结构断言 + 截断 + truncated 标志）

D-2 conflict_logs service（依赖 D-1）：
  新建 server/services/conflict_logs.ts
  - logConflictResolution(db, { canvasId, userAId, userBId, baseVersion, currentVersion, resolution, details })
  - 在 saveCanvas 事务内 INSERT（与主表 + canvas_versions 同事务）
  - 3 种 resolution：auto_merged（merged=true 路径）/ conflict（合并冲突）/ base_version_expired
  - details 字段：{ schemaVersion: 1, ...判断 #3 字段 + serializeDelta(deltaA/deltaB) }
  - 隐藏判断 #6：插入失败不 catch，让事务回滚
  - 隐藏判断 #1：baseVersion > currentVersion 不写日志
  改动 server/services/canvases.ts saveCanvas 合并分支：3 个返回点前调 logConflictResolution
  测试：~5 case（3 种 resolution + 失败回滚 + details 截断 + baseVersion>currentVersion 不写）

D-3 客户端类型镜像 + ApiError 扩展（依赖 D-1）：
  新建 src/api/canvases.types.ts
  - 镜像 SaveCanvasResult / Conflict / MergeReport（手工镜像但有契约测试守住）
  - 不依赖 server/ 任何 import
  扩展 ApiError + apiFetch + useMultiCanvas conflict state（含 conflicts 数组）
  契约测试：types 镜像与 server 类型 shape 比对（~3 case）
  测试：~3 case（apiFetch 409 携 conflicts + ApiError 解析 + 契约测试）

D-4 useMultiCanvas.save() 处理 merged=true / base_version_expired（依赖 D-3）：
  改 useMultiCanvas.ts save() 函数：
  - merged=true → loadProject(mergedData) + setDirty(false 但需 changeSeq 检查) + serverVersion 更新 + 删除草稿 + canvasId 身份校验（隐藏判断 #8）
  - base_version_expired → loadFromServer 重载 + 不删草稿（隐藏判断 #9）
  - 409 conflict → conflict state 含 conflicts 数组（高风险 1 闭环）
  hook 测试：~5 case（merged=true / base_version_expired / 409 conflict / saving 期间继续编辑 / canvasId 切换）

测试覆盖目标 25+ case：
  - D-1 ~5 case + D-2 ~5 case + D-3 ~3 case + D-4 ~5 case = ~18 case
  - + saveCanvas.merge.test.ts 补 ~10 case 覆盖 5.4 N1-N10 + 5.5 E1-E7 + sheet 增删 + 端点校验 + nodes_meta 越权
  - = 28+ case
```

## 阶段 D 验收清单（必修）

继承阶段 D 末尾审 4 项 test_gaps（gap 1/2/4 已挂 #33/#34）+ 本次取舍审：

1. **conflict_logs 三种 resolution 都被真实写入**：测试覆盖 saveCanvas 三个返回路径的 INSERT
2. **conflict_logs 事务回滚**：插入失败 → saveCanvas 整事务回滚（DB v 不变）
3. **details 序列化 round-trip**：serializeDelta(delta) → JSON.stringify → JSON.parse → 结构与原 delta entries 数组一致
4. **details 截断策略**：超限 delta 截断 + truncated=true + 至少保留 conflicts/report
5. **客户端 conflict state 携 conflicts 数组**：apiFetch 409 解析 conflicts → ApiError → useMultiCanvas conflict state
6. **客户端契约测试**：src/api/canvases.types.ts 镜像与 server SaveCanvasResult shape 一致
7. **merged=true 状态替换**：loadProject(mergedData) + 用户保存期间继续编辑路径的 dirty/serverVersion 同步
8. **base_version_expired 不删草稿**：loadFromServer 重载 + drafts 保留

## 与既往判断的衔接

- **D5 helper 提取**（阶段 A）+ **deltaB 单一信息源**（阶段 C high 风险吸收）：D-2 conflict_logs 写入路径仍用 saveCanvas 持有的 deltaB（不读 tryMerge 内部）；details 字段用 tryMerge 返回的 debugDelta（同事务取过来的 deltaA/deltaB）
- **canvas_versions.saved_by**（阶段 C codex 修订 #2 #3）：base_version_expired 分支也得查 currentVersionAuthor（隐藏判断 #2 + medium 风险）—— 不能用 canvases.updated_by
- **DataIntegrityError 透传**（阶段 C）：conflict_logs 插入失败也不 catch（隐藏判断 #6）—— 让事务回滚 + route 层映射 500

## codex 原始报告

完整 JSON 报告（实读 confidence=high）：

```json
{
  "decisions": [
    { "id": 1, "recommend": "A", "reason": "日志是保存事务副作用，应与版本判断、主表写入同一原子边界。", "rejected_options_reason": "B 会让主表成功但日志失败/丢失；C 多一层但仍需事务注入，复杂度无收益。" },
    { "id": 2, "recommend": "A", "reason": "Day 3 目标明确要求 deltaA/deltaB 可追溯，量小可接受。", "rejected_options_reason": "B 不能重放/复核合并输入；C 成功路径也丢 delta，削弱审计价值。" },
    { "id": 3, "recommend": "A", "reason": "Day 3 没有真冲突 UI/端点，先落当前 saveCanvas 可达三类。", "rejected_options_reason": "B 会牵出 overwrite/cancelled 端点和权限语义，侵入 Day 4 范围。" },
    { "id": 4, "recommend": "A", "reason": "Delta 是 merge 子域类型，序列化 helper 放同目录最清晰。", "rejected_options_reason": "B 过早 codec 分层；C 把 merge 类型编码耦合进 conflict_logs 服务。" },
    { "id": 5, "recommend": "A", "reason": "mergedData 已是服务端最终态，整体替换避免重复合并。", "rejected_options_reason": "B 会重复套用 Bob 改动；C 多一步确认会阻断自动保存路径。" },
    { "id": 6, "recommend": "A", "reason": "无 base 快照无法三方合并，强制重载最新态最确定。", "rejected_options_reason": "B 会让用户停在不可保存基线，后续仍持续 409。" },
    { "id": 7, "recommend": "C", "reason": "客户端不能 import server，独立镜像类型加契约测试最稳。", "rejected_options_reason": "A 只有手工同步，易漂移；B 破坏前后端边界/Vite 打包边界。" },
    { "id": 8, "recommend": "B", "reason": "服务端测合并与日志，hook 测 merged/conflict/reload 状态副作用。", "rejected_options_reason": "A 漏 useMultiCanvas.save 行为；C 把 Day 4 Playwright 提前，超出 Day 3。" },
    { "id": 9, "recommend": "A", "reason": "单实例小并发，逐次写日志简单、可审计、成本极低。", "rejected_options_reason": "B 对 <100 条/天无收益，还引入 flush/丢日志风险。" },
    { "id": 10, "recommend": "A", "reason": "tryMerge 已能产 debugDelta，直接开启避免重复 computeDelta 漂移。", "rejected_options_reason": "B 重算浪费且可能与 tryMerge 内部 delta 产生实现漂移。" }
  ],
  "hidden_decisions": [
    "conflict_logs 只记录 baseVersion < currentVersion 的合并相关路径；baseVersion > currentVersion 建议视为异常 409，不写 conflict_logs 或单独标 malformed_base_version。",
    "base_version_expired 也应先查 currentVersionAuthor，用 canvas_versions.saved_by 填 user_a_id；缺失仍抛 DataIntegrityError。",
    "details 建议带 schemaVersion、baseVersion、currentVersion、resolution、report/conflicts、debugDelta，便于后续迁移。",
    "Delta serialize 必须把所有 Map 转 entries；测试覆盖 JSON.stringify 后 parse 的结构，不要求反序列化回 Map 除非后续要重放。",
    "details 需设置软上限或截断策略；超限至少保留 conflicts/report，delta 可截断并写 truncated=true。",
    "conflict 日志插入失败应让 saveCanvas 事务失败回滚；否则审计链不可信。",
    "客户端 ApiError 必须扩展 conflicts 字段；useMultiCanvas conflict state 也要保存 conflicts，不能只存 currentVersion。",
    "merged=true 后删除草稿前应确认 canvasId 仍一致；若用户保存期间继续编辑，不应 setDirty(false)，但仍应更新 serverVersion/mergedData 的策略要单测覆盖。",
    "base_version_expired 重载最新画布时应保留本地草稿，不调用 deleteDraft。",
    "overwrite/cancelled 若 Day 4 才做，migration 可先允许枚举，但不应写不可达日志。"
  ],
  "risks": [
    {
      "severity": "high",
      "title": "ApiError 当前丢弃 conflicts",
      "detail": "src/api/canvases.ts 非 2xx 只提取 currentVersion/issues，409 conflict 的 conflicts 数组到不了 hook。"
    },
    {
      "severity": "high",
      "title": "includeDebugDelta 仍为 false",
      "detail": "saveCanvas 合并路径当前 tryMerge includeDebugDelta=false，Day 3 若直接写 details 会缺 deltaA/deltaB。"
    },
    {
      "severity": "medium",
      "title": "conflict_logs user_a_id 非空",
      "detail": "base_version_expired 分支目前在查询 currentVersionAuthor 前返回，写日志前必须补 author 查询。"
    }
  ],
  "confidence": "high",
  "notes_for_claude_code": "重点审 saveCanvas 事务内日志写入、Delta Map 序列化、ApiError/conflicts 类型链路、useMultiCanvas merged=true/base_version_expired 状态副作用；不要把 overwrite/cancelled 端点提前进 Day 3。"
}
```

## 调用细节

- **prompt 大小**：126441 字节（含 7 文件源码 + 10 判断点 brief + 99-收尾归档 + 项目语境）
- **stdin 注入**：`codex exec --skip-git-repo-check --sandbox read-only -c MaxContextChars=180000 -o /tmp/codex-p5day3-result.md - < /tmp/codex-p5day3-prompt.txt`
- **exit code**：0
- **后台模式**：是（运行时间 ~270s）
- **Windows 双坑根治**：stdin 注入避开 ARG_MAX 32KB；不让 codex 子进程 spawn 读文件避开 sandbox 1326

## 进入实施

`canEnterImpl: true`。Day 3 实施按"前置修风险 P-1/P-2/P-3 → D-1 序列化 → D-2 conflict_logs → D-3 客户端类型镜像 → D-4 useMultiCanvas hook"流程执行，验收清单 8 项全过后进 Day 4（真冲突 UI + Playwright + 部署）。

## 后续审查链

- 末尾审首轮（codex bash id baa9m2md4，2026-05-07）→ [02-末尾审-首轮.md](02-末尾审-首轮.md)（canEnterImpl: false / 2 high）
- 末尾审复审（codex bash id byp49oslq，2026-05-07）→ [03-末尾审-复审.md](03-末尾审-复审.md)（canEnterBump: false / 1 high A 方案错）
- 选项 b 修法 + 三审 → 04-末尾审-三审.md（待）

