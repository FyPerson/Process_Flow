# 09-阶段 B-4 代码审查 — tryMerge 编排

## 元信息

- **审查日期**：2026-05-07
- **审查范围**：阶段 5 Day 2 阶段 B-4（tryMerge.ts ~150 行编排 + tryMerge.test.ts 11 case 5 段 + types.ts MergeResult 加 debugDelta）
- **codex 模式**：ContextFiles 注入 6 文件 / 180KB MaxContextChars / contextFilesCount=6 实读 / **confidence=medium**
- **codex 版本**：codex-cli 0.128.0
- **判定结论**：`canEnterC: false`（codex 拒判，1 high + 3 medium + 2 low）
- **codex 自我盲区声明**：未读取 saveCanvas / 迁移 / 导入 / DB 写入路径，因此路径 b 全局不可达性结论需 Claude Code 在阶段 C 进一步确认
- **基于 codex 协作模式**："翻译报告（不下结论），分 severity 排列，不替用户做采纳/不采纳"

## Claude 拍板记录

| codex 意见 | severity | 真伪 | 处置 |
|---|---|---|---|
| **H1 路径 b "不可达性"过乐观 — 历史脏数据/迁移/导入旁路仍可达** | high | **真**（codex 戳穿了我之前的乐观判断） | ✅ 已修文档 + 登记阶段 C 验收 — tryMerge.test.ts 路径 b case 注释限定为"正常新写入链路不可达"+ 阶段 C 验收清单加"DataIntegrityError 统一映射 500 + data_integrity_error，让运维介入"，不强行改造 tryMerge 兜底业务化（5 人内网下历史脏数据少见 + 修法简单） |
| **M1 applyDelta 兜底 DataIntegrityError 透传未测** | medium | **真但难构造** | ❌ 不补 case（与 codex 建议二选一一致）— schema + computeDelta 入口 assertProjectIntegrity 已锁死 incoming 不能含悬空引用，applyDelta 兜底分支由 applyDelta.test.ts R-Day2-2 段 2 case 单元层覆盖；tryMerge 透传契约由 "currentData duplicate node id" case 锁定 |
| **M2 active_sheet_missing 可达路径透传未测** | medium | **真** | ✅ 已补 — 1 case 锁定可达场景（A 删 s1 不动 activeSheetId / B 改 activeSheetId 到 s1 → applyDelta 产 active_sheet_missing → tryMerge 透传），并断言 ok:false 路径 'warnings' in result === false |
| **M3 mergeReport bucket 测试不足** | medium | **真** | ✅ 已补 — 1 跨 sheet 计数 case 锁定 sheetsRemoved 整 sheet 删除计数 / nodesDeprecated / edgesAdded / edgesModified 4 个 bucket（之前未覆盖） |
| **L1 detector 编排注释偏差** | low | **真** | ✅ 已修 — 注释改为"四段全部收集后判 conflicts.length > 0 → 短路 applyDelta"+ 设计权衡说明（前端一次展示多类冲突更优） |
| **L2 case 数描述过期** | low | **真** | ✅ 已修 — 09 归档元信息行从 "8 case" 改为 "11 case 5 段"（实际 380 → 382 后是 11 case） |

**进阶段 C 决策**：H1 / M2 / M3 / L1 / L2 已闭环；M1 按 codex 二选一建议承认 applyDelta 单测覆盖；H1 登记阶段 C 验收清单不阻塞 B-4。

**修法后单测进度**：380 → 382（M2 + M3 各 1 case），全过；tsc 三端 0 错；lint:ids 0 违规。

## 阶段 C 验收清单（codex H1 必修登记）

进入阶段 C（saveCanvas 接合并算法 + 端到端）切片时**必须验收**以下两项：

1. **DataIntegrityError 统一 500 映射**：tryMerge 抛出的 DataIntegrityError 由 saveCanvas catch + route 层映射 `500 + data_integrity_error`，**不试图业务化为 active_sheet_missing 等 conflict**。覆盖场景：
   - 历史脏 canvases.data（v1.x 之前快照可能没经过 P5 Day 1 才加的 assertProjectIntegrity 真校验）
   - 迁移脚本 / import / 手工修 DB 旁路写入的 currentData
2. **route 层显式映射**：阶段 A 已在 routes/canvases.ts catch 块加 `instanceof DataIntegrityError` 显式返 500（commit 14e41c8），阶段 C 验证 saveCanvas 真合并分支抛出的 DataIntegrityError 也走同款映射，不被泛化为 save_failed

**与 07/08 验收清单合并**：active_sheet_missing 错误映射（B-2.5 M2）已在 B-3 applyDelta + B-4 tryMerge 完成，阶段 C 仅需端到端验证不被覆盖。

---

## 修法复审（codex 第 2 轮，2026-05-07 11:15）

**元信息**：confidence=high / 实读 5 文件 / contextFilesCount=5 / exitCode=0 / 用时 ~104 秒 / **`canEnterC: true`**

### Summary（复审）

> 本轮修法基本关闭 H1/M2/M3/L1/L2，M1 选择用 applyDelta 单测覆盖的取舍合理。canEnterC: true；前提是阶段 C 必须落实 DataIntegrityError 到 500 + data_integrity_error 的路由层映射。

### 6 项关闭判定

| 项 | 判定 |
|---|---|
| **H1** | **PASS** — 路径 b 注释把"正常新写入链路不可达"和"历史/迁移/导入旁路可达"区分清楚；tryMerge 继续透传 DataIntegrityError 更符合真损坏语义 |
| **M2** | **PASS** — active_sheet_missing case 锁定 applyDelta ok:false 被 tryMerge 原样传递；'warnings' in result 覆盖 B-3 L1 契约 |
| **M3** | **PASS** — 跨 sheet case 覆盖 sheetsRemoved 整 sheet 节点/边、nodes.deprecated、connectors.added、connectors.modified，关闭原缺口 |
| **M1** | **PASS** — 承认 applyDelta 兜底分支由 applyDelta.test.ts 覆盖合理；tryMerge 层通过 currentData duplicate id case 锁定透传契约 |
| **L1** | **PASS** — 注释与实现一致，权衡说明充分 |
| **L2** | **PASS** — 11 case 数准确 |
| **阶段 C 验收清单** | **PASS 带低风险** — 登记 DataIntegrityError 统一 500 映射充分，但阶段 C 必须用测试兑现 |

### 复审 Issues（1 low）

**L1'**（other）— 阶段 C 验收清单 / route 层接入：
- H1 根因没在 tryMerge 内业务化，登记到阶段 C 由 saveCanvas/route 层统一映射。变成阶段 C 硬门槛——若 saveCanvas 未显式 `instanceof DataIntegrityError`，历史脏数据仍可能退化成 `save_failed` / 未分类 500
- 建议：阶段 C 接入增加明确验收：catch DataIntegrityError → 500 + 'data_integrity_error'；覆盖 currentData 历史脏数据路径的 saveCanvas/route 层测试

### 复审 Claude 拍板

| codex 复审意见 | severity | 处置 |
|---|---|---|
| **L1' 阶段 C 必须测试兑现 DataIntegrityError 映射** | low | 🔄 已登记阶段 C 验收（本归档"阶段 C 验收清单"段已含此约束）— 阶段 C 实施时必修：catch + 测试覆盖历史脏数据路径 |

### 复审后最终判定

**正式进入阶段 C（saveCanvas 接合并算法 + 端到端）**。codex 两轮审 + 用户两轮拍板闭环：
- 首轮：1 high + 3 medium + 2 low → canEnterC: false
- 复审：0 critical / 0 high / 0 medium / 1 low（阶段 C 验收提醒）→ canEnterC: true

### 复审原始文件路径

- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_111538.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_111538.json`
- prompt 输入：`tmp-test/codex-b4-fix-prompt.txt`（含修法摘要 + 8 维审查重点）

---

## codex 报告（原文）

### Summary

> B-4 编排主体基本符合 D2，但测试覆盖与一个关键可达性结论仍有缺口。最终判定：canEnterC: false，建议补齐 applyDelta 兜底 DataIntegrityError 与 active_sheet_missing 可达路径测试后再接阶段 C。

### Issues

#### high × 1

**H1**（edge-case）— `tryMerge.test.ts / B-2.5 M2 路径 b 测试`：测试把"currentData 暂态 activeSheetId 缺失"判为 tryMerge 层不可达，但这个结论只在所有 currentData 都必经 saveCanvas+computeDelta 写入时成立。阶段 C 接入后还可能存在历史脏 canvases.data、手工修复、迁移脚本、导入接口或旧版本数据绕过当前 saveCanvas 的链路。**建议**：保留"正常 saveCanvas 链路不可达"的说明，阶段 C 前明确 currentData 来源是否已全量由 assertProjectIntegrity 守住；若不能保证，应在 saveCanvas 读取主表后做数据完整性映射策略，或接受此类历史脏数据统一 500，限定测试名为"正常新写入链路不可达"。

#### medium × 3

**M1**（missing-constraint）— DataIntegrityError 透传测试只覆盖 computeDelta 入口，没覆盖 applyDelta 兜底抛出的场景。建议补：deltaB 修改节点 parentId 指向 currentData 中非 group 节点 / 制造 applyDelta 后才出现的重复非法引用 → 断言 tryMerge 直接抛 DataIntegrityError。

**M2**（edge-case）— 测试没覆盖 applyDelta 返回 ok:false (active_sheet_missing) 被 tryMerge 原样透传。B-4 编排需证明 applyDelta 的 ok:false 分支被 tryMerge 正确透传。建议补可达 active_sheet_missing 场景。

**M3**（edge-case）— mergeReport 测试未覆盖 sheetsRemoved 整 sheet 计数 / nodesDeprecated / edgesAdded / edgesModified 三个 bucket。建议跨 sheet 计数用例。

#### low × 2

**L1**（readability）— `tryMerge.ts detector 编排`：注释"任一非空短路"实际是"四段全部收集后判 length"。codex 认为当前实现"更利于前端一次展示多类冲突"——建议改注释而非改实现。

**L2**（readability）— prompt 说"8 case"，实际超 8。归档数字与实现不一致。

### Recommendations（8 维判定）

| 维度 | 判定 |
|---|---|
| 1 编排顺序 | PASS — 收集所有 detector 冲突不丢失 |
| 2 mergeReport 计数源 | PASS — deltaB 计数 + sheetsAdded/Removed 整 sheet 纳入合理 |
| 3 debugDelta | PASS |
| 4 ok:false 不携带 warnings | PASS — TS 类型层 + 运行时 'warnings' in result 锁定 |
| 5 DataIntegrityError 透传 | 风险 — applyDelta 兜底未测 |
| 6 路径 b 不可达 | 风险 — 仅正常 saveCanvas 新写入链路成立，旁路待确认 |
| 7 测试覆盖度 | 风险 — mergeReport bucket + applyDelta ok:false 分支不足 |
| **8 进入阶段 C** | **FAIL — canEnterC: false** |

### Risks

1. 阶段 C 接入后，若 currentData 来源含历史/旁路写入数据，tryMerge 可能把本应业务化展示的状态统一变成 500
2. mergeReport 未覆盖的 bucket 可能在 UI toast / 审计日志出现错误统计
3. applyDelta ok:false 分支未在 tryMerge 层测试锁定，未来改动可能导致 active_sheet_missing 被错误包装或携带 warnings

### confidence

medium（codex 自我声明：未读取 saveCanvas、迁移、导入、DB 写入路径，路径 b 全局不可达性结论需 Claude 在阶段 C 进一步确认）

### notes_for_claude_code

> canEnterC: false。此结论基于提供的上下文文件静态审查；未读取 saveCanvas、迁移、导入或 DB 写入路径，因此路径 b 的全局不可达性需要 Claude Code 在阶段 C 文件中进一步确认。

---

## 原始文件路径

- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_110142.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_110142.json`
- prompt 输入：`tmp-test/codex-b4-prompt.txt`（含项目语境 + B-4 切片范围 + 路径 b 不可达发现 + 8 维审查重点）
