# 05-阶段 B-1 代码审查 — detector 节点段

## 元信息

- **审查日期**：2026-05-07
- **审查范围**：阶段 5 Day 2 阶段 B-1（detectNodeConflicts + 14 case 单测）
- **codex 模式**：ContextFiles 注入 3 文件（detector.ts + detector.test.ts + types.ts）/ 80KB MaxContextChars / contextFilesCount=3 实读 / confidence=high
- **codex 版本**：codex-cli 0.128.0
- **判定结论**：`canEnterB2: true`
- **基于 codex 协作模式**："翻译报告（不下结论），分 severity 排列，不替用户做采纳/不采纳"

## Claude 拍板记录

| codex 意见 | severity | 真伪 | 处置 |
|---|---|---|---|
| **M1 types.ts:120 + 154 DetectContext / N4 注释与 D3 修订漂移** | medium | **真** | ✅ 已修 — types.ts:120-148 DetectContext 段 + types.ts:154-159 N4 描述段同步改为"按 changedFields 字段交集精确判定，不依赖 ctx.userA/userB"；ctx 仅保留 visibility 用于展示语义 |
| **L1 单测未覆盖 alsoDeprecated=true 的 modified vs deprecated 场景** | low | **真** | 🔄 挂账 B-2 — alsoDeprecated 语义在边段 detector 写完后能更全面验证，B-2 切片时一并补；现补是孤立 case |
| **L2 单测未覆盖 sheetMetaChangedFields 与节点段隔离** | low | **真** | ✅ 已补 — detector.test.ts 加 1 case "仅 sheetMetaChangedFields 变化 + 节点无交集 → detectNodeConflicts 返回空"；防 B-2 切片误把 sheet meta 混入节点段 |
| **L3 detector.ts:73-74 注释"同 sheet 同节点最多产一条"与 N4 多条实现矛盾**（实际行号 line 38 + line 67） | low | **真** | ✅ 已修 — 函数头部 + detectNodeConflictsInSheet 函数体内注释同步改为"删/废弃类最多一条；N4 按每个重叠字段产一条" |

**进 B-2 决策**：M1 + L2 + L3 必修已闭环（codex 风险 1 "userA/userB 旧注释会误导后续切片"已根治）；L1 挂 B-2 不阻塞节点段语义。codex `canEnterB2: true` 判定加上以上修法后**正式进入 B-2 detectEdgeConflicts**。

**已跑 codex 复审 M1+L2+L3 修法**：用户要求复审。复审结果 confidence=high / 0 critical / 0 high / 0 medium / 3 low（全非阻塞）/ canEnterB2: true。复审报告见下方"修法复审"段。

**单测进度**：293 → 307（B-1 14 case）→ 308（L2 +1 case），全过；tsc 三端 0 错；lint:ids 0 违规。

---

## 审查任务（原始 brief 摘要）

请代码审 `detector.ts` + `detector.test.ts`，判定**是否满足进入 B-2（detectEdgeConflicts）的条件**。

**B-1 拍板边界**（D3 修订）：

1. detector 不读 nodes_meta；node_id_collision / node_meta_missing 由 saveCanvas 路径的 validateDeltaBPermissions 处理
2. N4 字段交集精确判定：按 changedFields.field 交集判，重叠 → 每个重叠字段产一条，不重叠 → auto-merge；不区分 ctx.userA/userB
3. B-1 切片范围仅节点段，边段/sheet 段/project 段不在本次范围

---

## codex 报告（原文）

### Summary

> B-1 节点段主逻辑基本满足进入 B-2 条件，N4/N6/N7/N8 与 node_removed_deprecated 的纯 delta 冲突判定已覆盖。主要剩余问题是注释/类型文档仍与拍板边界存在漂移，且测试少覆盖两个低成本边界；建议进入 B-2 前顺手补齐。

### Issues

#### medium × 1

**M1**（contradiction）— `server/services/merge/types.ts:131 与 server/services/merge/detector.ts 文件头`

- **problem**：types.ts 仍写着 N4 需要 DetectContext、并描述 userA/userB 会影响 node_modified_both 判定；但本次拍板明确 N4 不区分 ctx.userA/userB，detector.ts 也实际完全不使用 ctx。这会让后续 B-2/B-3 实现者误以为节点段还缺 user 判定。
- **suggestion**：把 types.ts 中 DetectContext 用法注释改成与 D3 修订一致：节点段 N4 仅按 changedFields 交集判定，userA/userB 不参与；保留 ctx 仅用于后续编排、展示或其他切片需要。

#### low × 3

**L1**（edge-case）— `server/services/merge/detector.test.ts`

- **problem**：单测未覆盖 alsoDeprecated=true 的 modified 场景。detector.ts 逻辑上会把"内容修改 + 同时标废弃"当作 modified 参与 N6/N7/N4，但当前测试只覆盖单纯 deprecated vs modified。
- **suggestion**：补一个用例：A nodes.deprecated.set(n1)，B nodes.modified.set(n1, makeNodeDelta(..., true))，断言产 node_deprecated_modified；反向如成本低也可补。

**L2**（edge-case）— `server/services/merge/detector.test.ts`

- **problem**：单测未覆盖 sheetMetaChangedFields 与节点冲突检测的隔离。B-1 范围内 detector 应忽略 sheet 元信息变化，但当前测试不能防止后续误把 sheet meta 混入节点段。
- **suggestion**：补一个用例：同一 sheet 仅双方 sheetMetaChangedFields 变化、节点无交集，detectNodeConflicts 应返回空；sheet_meta_conflict 留给后续 sheet 切片。

**L3**（readability）— `server/services/merge/detector.ts:73-74`

- **problem**：注释写"同 sheet 同节点最多产一条节点级冲突"，但 N4 当前设计是每个重叠字段产一条 node_modified_both，同一节点可产生多条同类型冲突。实现符合 brief，注释不准确。
- **suggestion**：将注释改为"删/废弃类同节点最多一条；N4 按每个重叠字段产一条"。

### Recommendations（逐项 PASS 判定）

1. 冲突类型覆盖完整性 **PASS**。B-1 节点段应由 detector 产出的类型是 node_modified_both、node_deprecated_modified、node_removed_modified、node_removed_deprecated；node_id_collision/node_meta_missing 明确在 saveCanvas 权限校验路径，sheet/edge/project 类型不属本切片。
2. N4 字段交集判定 **PASS**。以 A 字段 Set 匹配 B.changedFields，顺序变化不会漏判；非白名单字段被 includes 过滤，最多导致防御性忽略，不会过判。
3. N6/N7/N8 双向覆盖 **PASS**。A removed/deprecated 对 B modified/deprecated 与反向均覆盖；由于每个 removed 分支使用 if/else if，单侧不会 N7/N8 双判；前提是 computeDelta 确保 removed/modified/deprecated bucket 互斥。
4. 跨 sheet 隔离 **PASS**。只迭代 deltaA.sheetsModified 并取同 sheet 的 sheetB，能正确忽略 deltaB 单边动 sheet，因为单边变化没有纯 delta 冲突；后续 sheet removed/modified 冲突不属 B-1。
5. DetectContext 接入 **PASS 但文档需同步**。当前 _ctx 不参与节点段判定符合拍板；visibility 对 N7 的"可达性/展示语义"不应在本函数短路。
6. 单测覆盖度 **风险而非阻塞**。现有 14 case 覆盖主路径、双向、跨 sheet、auto-merge；建议补 alsoDeprecated=true 和 sheetMetaChangedFields 隔离两个回归用例。
7. **canEnterB2: true**；理由：实现没有发现会阻塞 B-2 的节点段语义缺陷，剩余为文档一致性和测试边界补强。

### Risks

1. 如果不修正 types.ts 中关于 userA/userB 的旧注释，后续实现可能重新引入与 D3 拍板相反的用户维度判定。
2. 如果未来 computeDelta 互斥约束被破坏，同一节点可能在 removed/modified/deprecated 多 bucket 出现并产生重复或优先级不符合预期的冲突；当前 detector 依赖该上游契约。

### confidence

high

### notes_for_claude_code

> 建议允许进入 B-2，同时在进入前或 B-2 开始时补两条低成本测试并修正文档漂移。按本审查结论，布尔判定为 canEnterB2=true。

---

## 原始文件路径

- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_083643.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_083643.json`
- prompt 输入：`tmp-test/codex-b1-prompt.txt`（含项目语境 + B-1 拍板边界 + 7 维审查重点）

---

## 修法复审（codex 第 2 轮，2026-05-07 08:49）

**元信息**：confidence=high / 实读 3 文件 / contextFilesCount=3 / exitCode=0 / 用时 ~85 秒 / **canEnterB2: true**

### Summary

> M1 / L2 / L3 本次修法基本关闭，可以进入 B-2。剩余只有低风险的测试补强和注释清理建议，不构成阻塞。

### M1 / L2 / L3 关闭判定（codex 给）

| 维度 | 判定 |
|---|---|
| **M1** | **PASS** — types.ts 与 detector.ts 当前都明确 N4 按 changedFields 字段交集判定 |
| **L2** | **PASS** — sheetMetaChangedFields 隔离 case 能防回归，断言 length === 0 已足够 |
| **L3** | **PASS** — detector.ts 现在准确区分"删/废弃类最多一条、N4 按重叠字段每字段一条" |
| **N4 多重叠字段** | **实现 PASS，测试覆盖不足** — 循环逻辑可产多条但现有测试没显式验证 ≥2 个重叠字段 |
| **DetectContext.visibility** | **建议保留** — 后续展示语义或编排上下文保留可以接受 |

### 复审 Issues（3 low，全非阻塞）

**L1'**（low edge-case）— `detector.test.ts N4 测试段`：N4-3 只覆盖 1 个重叠字段；建议补 case "A+B 都改 name+position → length=2"。
**L2'**（low readability）— `types.ts DetectContext 注释段`：历史背景段仍含 `userA !== userB` / `userA === userB` 旧关键词，grep 可能误读。
**L3'**（low readability）— `detector.ts 函数头部`：覆盖清单仍列 N10，建议移到"不覆盖"清单。

### 复审 Claude 拍板记录

| codex 复审意见 | severity | 处置 |
|---|---|---|
| **L1' N4 多重叠字段测试不足** | low | 🔄 挂账 B-2 — 与 L1 一并补（同属 detector 测试边界补强，B-2 编辑 detector.test.ts 时一并加 case） |
| **L2' types.ts 历史背景旧关键词** | low | ❌ 不修 — 历史段已显式标注"D3 修订前"且不构成行为矛盾；保留历史背景方便未来溯源 codex 四审 M3 决策史 |
| **L3' detector.ts 覆盖清单 N10 标注** | low | ✅ 已修（见下） — 把 N10 从"覆盖"段移到"不覆盖"段，与 L2 sheetMetaChangedFields 隔离测试一致 |

### notes_for_claude_code（复审）

> 建议允许进入 B-2。上述 3 个 low 都是非阻塞项；若本轮顺手清理，优先补 N4 多重叠字段测试，其次把 N10 移到"不覆盖"段，最后按需净化 DetectContext 历史注释中的旧关键词。

### 复审后最终判定

**正式进入 B-2 detectEdgeConflicts**。codex 两轮审 + 用户两轮拍板闭环：
- 首轮：M1 / L2 / L3 必修闭环；L1 挂账 B-2
- 复审：M1+L2+L3 关闭确认；L1' 挂账 B-2；L2' 不修；L3' 已修

### 复审原始文件路径

- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_084919.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_084919.json`
- prompt 输入：`tmp-test/codex-b1-fix-prompt.txt`（含修法摘要 + 6 维审查重点）
