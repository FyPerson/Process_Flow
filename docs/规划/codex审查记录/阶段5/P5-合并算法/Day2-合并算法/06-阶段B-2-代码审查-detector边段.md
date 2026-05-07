# 06-阶段 B-2 代码审查 — detector 边段

## 元信息

- **审查日期**：2026-05-07
- **审查范围**：阶段 5 Day 2 阶段 B-2（detectEdgeConflicts ~210 行 + 14 case 边段单测 + 节点段补 N4-4 / N6-3 / L2 共 3 case）
- **codex 模式**：ContextFiles 注入 4 文件（detector.ts + detector.test.ts + types.ts + computeDelta.ts）/ 120KB MaxContextChars / contextFilesCount=4 实读 / confidence=high
- **codex 版本**：codex-cli 0.128.0
- **首轮判定**：`canEnterB25: false`（codex 拒判，3 条非低优问题需先解决）
- **基于 codex 协作模式**："翻译报告（不下结论），分 severity 排列，不替用户做采纳/不采纳"

## Claude 拍板记录

| codex 意见 | severity | 真伪 | 处置 |
|---|---|---|---|
| **H1 modified 路径 sem-key 分歧判定过宽** | high | **真** | ✅ 已修 — types.ts 加 SEMANTIC_CONNECTOR_FIELDS 常量；detector.ts modified 路径改为"双方都触及语义字段且 sem-key 分歧"才产 semantic conflict 短路；其他场景按字段交集判 E4 |
| **M1 shallowEqualJsonShape 用 JSON.stringify key 顺序敏感** | medium | **真** | ✅ 已修 — 删 shallowEqualJsonShape，改用 computeDelta.ts 已 export 的 deepEqualJsonShape；NON_SEMANTIC_CONNECTOR_FIELDS 移到 types.ts 单一信息源 |
| **M2 types.ts ConflictType 注释 + detector 优先级注释与实现矛盾** | medium | **真** | ✅ 已修 — types.ts:207-216 ConflictType 注释扩为 3 子场景（含 c) modified 双方都触及语义字段）；detector.ts 文件头优先级注释改写"修改路径：semantic 分歧（双方都触及语义字段时）短路于 edge_modified_both" |
| **L1 NON_SEMANTIC_CONNECTOR_FIELDS 硬编码无静态断言保护** | low | **真** | ✅ 已修 — types.ts 末尾加 3 组双向 AssertNever：① SEMANTIC_CONNECTOR_FIELDS ⊂ CONNECTOR_DIFF_FIELDS；② SEMANTIC_CONNECTOR_FIELDS 与 connectorSemanticKey 编码 4 字段双向相等；NON_SEMANTIC = CONNECTOR_DIFF - SEMANTIC 用类型谓词派生。**反向验证**：临时删 'sourceID' 跑 tsc 报 2 处 TS2344 + 1 处 TS2367 |
| **L2 N9 双端点缺失只产 1 条 conflict** | low | **真** | 🔄 挂账债务 #32 — 5 人内网阻断合并层面 1 条足够；B-4 conflict_logs 实施时改为 details 字段携带完整端点信息 |
| **L3 AddedConn 类型推导可读性低** | low | **真** | ✅ 已修 — 删 ReturnType 反推，改 `Map<string, { id: string; conn: StorageConnector }>` 显式 import StorageConnector |

**回归测试**：detector.test.ts 新增 5 case：
- E4-4 / E4-5：仅一方触及语义 + 另一方改 label → 无冲突（H1 双向）
- E4-6：双方都触及语义但同改成相同端点（sem-key 不分歧）→ 字段交集判 E4
- M1-1 / M1-2：同 ID / 不同 ID 两路径 + style/data 对象 key 顺序不同 → 无冲突（deepEqual key 顺序无关）

**单测进度**：326 → 331（5 个回归 case 全过）；tsc 三端 0 错；lint:ids 0 违规。

**进 B-2.5 决策**：H1 + M1 + M2 + L1 + L3 必修已闭环；L2 挂账 #32 不阻塞。codex 复审 confidence=high / 0 critical / 0 high / 0 medium / 3 low（全非阻塞）/ **canEnterB25: true**。

---

## codex 报告（原文）

### Summary

> B-2 主干覆盖基本到位，但当前不建议直接进入 B-2.5；canEnterB25: false。主要原因是 modified 路径的 semanticKey 分歧判定可能过宽，且非语义字段对象比较会因 key 顺序误报冲突。

### Issues

#### high × 1

**H1**（ambiguity）— `server/services/merge/detector.ts:258`

- **problem**：同 ID modified 路径只要 `edgeA.semanticKey !== edgeB.semanticKey` 就产 `edge_semantic_conflict`，这不只覆盖 brief 里的"双方都改端点/handle"，还会覆盖"一方改端点，另一方只改 label/style"等字段不重叠场景，可能与 E3"改同边不同字段自动合并"的边界冲突。
- **suggestion**：先拍板该场景：若严格按 brief，则增加 SEMANTIC_CONNECTOR_FIELDS，只有 A/B 双方 changedFields 都触及语义字段且 semanticKey 分歧时才产 semantic conflict；否则把保守策略写入 types.ts/detector 注释，并补 endpoint+label 的回归测试。

#### medium × 2

**M1**（edge-case）— `server/services/merge/detector.ts:397`

- **problem**：shallowEqualJsonShape 用 JSON.stringify 比对象，key 顺序不同但语义相同的对象会被判不等，例如 style/data 中 `{a:1,b:2}` 与 `{b:2,a:1}`，会误报 edge_semantic_conflict。computeDelta.ts 的 deepEqualJsonShape 已经实现了 key 顺序无关比较。
- **suggestion**：复用 computeDelta.ts 的 deepEqualJsonShape，或抽到共享 util 后 detector/computeDelta 共用；补一个同语义 added edge、style/data key 顺序不同但不应冲突的测试。

**M2**（contradiction）— `server/services/merge/types.ts:201 和 server/services/merge/detector.ts:258`

- **problem**：types.ts 对 edge_semantic_conflict 的注释只描述"semanticKey 相同但非语义字段不同"，但 detector.ts 还把同 ID modified 后 semanticKey 分歧归为 edge_semantic_conflict；另外 detector 顶部优先级写的是 edge_modified_both > edge_semantic_conflict，而 line 266 实际让 semantic conflict 短路优先。
- **suggestion**：把 modified 路径 semanticKey 分歧作为 edge_semantic_conflict 的明确子场景登记，并把优先级注释改为"语义分歧优先于字段交集"；line 266 只产 1 条 semantic conflict 是合理的，前提是文档和测试显式承认该策略。

#### low × 3

**L1**（missing-constraint）— `server/services/merge/detector.ts:382`

- **problem**：NON_SEMANTIC_CONNECTOR_FIELDS 硬编码排除 sourceID/targetID/sourceHandle/targetHandle，未来 connectorSemanticKey 若增加语义字段，这里没有静态断言保护，容易漏同步。
- **suggestion**：在 types.ts 导出 SEMANTIC_CONNECTOR_FIELDS，并让 connectorSemanticKey 与 NON_SEMANTIC_CONNECTOR_FIELDS 共用该常量；可加 Exclude/AssertNever 断言确保语义字段属于 CONNECTOR_DIFF_FIELDS。

**L2**（edge-case）— `server/services/merge/detector.ts:346`

- **problem**：N9 检测 source 命中后 continue，因此一条新增边的 source 和 target 都被 deltaA 删除时只记录 source 缺失。若 conflict_logs 需要完整端点详情，这会丢掉 target 信息。
- **suggestion**：若产品只需要阻断合并，1 条 conflict 可接受；若日志/弹窗要完整，改为收集两个缺失端点后在一条 message/details 中列出，或按端点产两条 conflict。

**L3**（readability）— `server/services/merge/detector.ts:320`

- **problem**：AddedConn 用 `ReturnType<typeof sheetB.connectors.added.get>` 反推类型，可读性偏低，后续维护者需要理解 Map.get 的类型技巧。
- **suggestion**：直接 import type StorageConnector 并写成 `Map<string, { id: string; conn: StorageConnector }>`，更直白且与文件其他类型风格一致。

### Recommendations（逐项 PASS / 风险 / FAIL）

| 维度 | 判定 |
|---|---|
| 1 覆盖完整性 | **风险**——modified semanticKey 分歧边界需澄清 |
| 2 short-circuit | **PASS**——但注释和测试应补齐 |
| 3 分类一致性 | **风险**——types.ts 需登记 modified 端点分歧子场景 |
| 4 对象比较 | **FAIL**——JSON.stringify key 顺序敏感是实际误报风险 |
| 5 语义字段同步 | **风险**——抽常量或加断言降低漂移 |
| 6 N9 双端点 | **PASS/低风险**——阻断层面 1 条足够 |
| 7 AddedConn 类型 | **PASS/低风险**——能工作，建议改显式 |
| **8 最终判定** | **canEnterB25: false** |

### Risks

1. 当前实现可能把本应自动合并的 endpoint+非语义字段不重叠场景误判为 409
2. 同语义新增边的 style/data/labelStyle 等对象只因 key 顺序不同就可能误报 edge_semantic_conflict
3. 文档定义、优先级注释和实现不完全一致，后续 B-3 applyDelta 对冲突类型语义的理解可能漂移

### confidence

high

### notes_for_claude_code

> 本审查仅基于提供的上下文文本，未执行命令或测试。建议 Claude Code 优先处理 high 与 medium 项：先拍板 modified semanticKey 分歧策略，再复用 deepEqualJsonShape，并补对应单测；其余 low 项可随同清理。

---

## 原始文件路径

- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_090514.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_090514.json`
- prompt 输入：`tmp-test/codex-b2-prompt.txt`（含项目语境 + B-2 切片范围 + 8 维审查重点）

---

## 修法复审（codex 第 2 轮，2026-05-07 09:24）

**元信息**：confidence=high / 实读 4 文件 / contextFilesCount=4 / exitCode=0 / 用时 ~104 秒 / **`canEnterB25: true`**

### Summary（复审）

> canEnterB25: true。基于提供的四个文件，H1/M1/M2/L1/L3 的修法基本闭环，未看到阻塞进入 B-2.5 的问题；剩余问题均为低风险文档或可维护性风险。

### 5 项关闭判定

| 项 | 判定 |
|---|---|
| **H1** | **PASS** — modified 路径以 changedFields 判断双方是否都触及语义字段，只有 bothTouchedSemantic 且 semanticKey 分歧才产 edge_semantic_conflict；A 改端点 + B 只改 label 落到字段交集逻辑，不会误报 |
| **M1** | **PASS** — deepEqualJsonShape 对普通对象按 key 集合递归比较，key 顺序无关；M1-1/M1-2 对同 ID 与不同 ID 两条 added 路径都有覆盖 |
| **M2** | **PASS（带低风险注释偏差）** — 核心 modified semanticKey 分歧子场景已登记；建议顺手修正 E2 "仅不同 ID" 那句（见 L1' issue） |
| **L1** | **PASS** — SEMANTIC_CONNECTOR_FIELDS 子集断言 + 预期四字段双向 AssertNever + NON_SEMANTIC 派生方式足以关闭硬编码漂移；反向验证证据与代码结构一致 |
| **L3** | **PASS** — semanticIndexB 显式使用 StorageConnector 后类型语义清楚 |

### 复审 Issues（3 low，全非阻塞）

**L1'**（low contradiction）— `types.ts edge_semantic_conflict 注释`：注释 "E2 幂等去重仅在不同 ID..."，但 detector 和测试同时允许"同 ID + 同 sem-key + 非语义字段也相同"不产冲突。建议改成两种无冲突路径：a) 同 ID 完全等价幂等保留一份；b) 不同 ID 同语义且非语义字段相同 → E2 去重。

**L2'**（low readability）— `types.ts SEMANTIC_CONNECTOR_FIELDS 断言区`：当前 AssertNever 不能自动感知 connectorSemanticKey **函数体**未来被改动后的真实字段集合。保留当前断言可进入下一阶段。

**L3'**（low edge-case）— `types.ts NON_SEMANTIC_CONNECTOR_FIELDS`：filter 派生数组运行时仍可变。可收窄为 readonly 或 Object.freeze。

### 复审 Claude 拍板

| codex 复审意见 | severity | 处置 |
|---|---|---|
| **L1' E2 注释精度** | low | ✅ 顺手修 — 与 H1 拍板的"M2 同步文档"同源；改写覆盖 2 条无冲突路径，避免后续 applyDelta 误读 |
| **L2' AssertNever 不约束函数体** | low | ❌ 不修 — codex 自己说"保留当前断言即可进入下一阶段"；与 #31 同款（编译期断言不约束函数体的本质限制）。挂账 #31 已覆盖 |
| **L3' NON_SEMANTIC readonly** | low | ❌ 不修 — `as const` 在类型层已是 `readonly`；运行时 freeze 是过度防御（业务全景图 5 人内网，没有第三方消费者会误改） |

### 复审后最终判定

**正式进入 B-2.5 sheet/project 段**。codex 两轮审 + 用户两轮拍板闭环：
- 首轮：H1 / M1 / M2 / L1 / L3 必修闭环；L2 挂账 #32
- 复审：H1+M1+M2+L1+L3 全 PASS；L1' 顺手修；L2' / L3' 不修

### 复审原始文件路径

- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_092448.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_092448.json`
- prompt 输入：`tmp-test/codex-b2-fix-prompt.txt`（含修法摘要 + 7 维审查重点）
