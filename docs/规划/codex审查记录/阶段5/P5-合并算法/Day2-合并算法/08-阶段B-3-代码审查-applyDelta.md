# 08-阶段 B-3 代码审查 — applyDelta

## 元信息

- **审查日期**：2026-05-07
- **审查范围**：阶段 5 Day 2 阶段 B-3（applyDelta.ts ~250 行 + applyDelta.test.ts 18 case 6 段）
- **codex 模式**：ContextFiles 注入 4 文件 / 120KB MaxContextChars / contextFilesCount=4 实读 / confidence=high
- **codex 版本**：codex-cli 0.128.0
- **判定结论**：`canEnterB4: true`（codex 放行，0 critical / 0 high / 2 medium / 3 low 全非阻塞）
- **基于 codex 协作模式**："翻译报告（不下结论），分 severity 排列，不替用户做采纳/不采纳"

## Claude 拍板记录

| codex 意见 | severity | 真伪 | 处置 |
|---|---|---|---|
| **M1 E2 防御静默吞改动** | medium | **真** | ✅ 已修 — applyDelta.ts:227-241 改抛 DataIntegrityError 而非静默 continue；理由 detector 是单一信息源，到此分支说明 detector 漏判 / currentData 脏数据，不能让用户改动消失无痕；补 1 防御 case 锁定行为 |
| **M2 sheet meta 测试缺失** | medium | **真** | ✅ 已修 — 补 1 case "sheet.name 改动 + nodes/connectors 不被影响"，对齐测试顶部声明 |
| **L1 ok:false 时 warnings 丢失** | low | **真** | 🔄 登记 B-4 验收清单 — B-4 tryMerge 编排时显式注释"ok:false 路径不携带 warnings"语义，避免 mergeReport 设计歧义 |
| **L2 路径 c case 是脏 delta 防御** | low | **真** | ✅ 已修 — case 标题加"脏 delta 防御 / codex B-3 L2"前缀，case 内补注释明确"自相矛盾输入 by schema/computeDelta 应已拒绝，本 case 是 applyDelta 防御兜底，**不是**常规合并路径" |
| **L3 applyDelta 调用前提注释张力** | low | **真** | ✅ 已修 — applyDelta jsdoc 调用前提段补 2 段说明：① currentData 是 A 合并后**暂态**结果，activeSheetId 缺失由 step 6 显式映射 conflict；② applyDelta 不防御 incoming 自相矛盾脏 delta，schema + computeDelta 入口拒绝 |

**进 B-4 决策**：M1 + M2 + L2 + L3 已闭环；L1 登记 B-4 验收清单不阻塞 B-3。codex `canEnterB4: true` 判定加上以上修法后**正式进入 B-4 tryMerge 编排**。

**未跑 codex 复审 M1+M2+L2+L3 修法**：M1 是行为变化（静默 → throw）但已补防御 case 锁定；M2/L2/L3 是测试 + 注释补强无运行时改动；codex 已实读四文件给 confidence=high 判定，复审收益递减。

**单测进度**：348 → 367（B-3 18 case）→ 369（M1+M2 2 case），全过；tsc 三端 0 错；lint:ids 0 违规。

## B-4 验收清单（codex L1 必修登记）

进入 B-4 tryMerge 编排切片时**必须验收**以下两项（与 07 归档 active_sheet_missing 验收清单合并执行）：

1. **active_sheet_missing 错误映射**（已在 B-3 applyDelta 内部完成，B-4 仅需验证不被覆盖）：tryMerge 收到 applyDelta 返回 `{ok: false, conflicts}` 时直接传递，不再二次解释为 DataIntegrityError
2. **ok:false 时 warnings 不携带**：tryMerge 编排时显式注释"短路返冲突路径不带 warnings"语义，避免 mergeReport 设计假定 conflicts + warnings 可同时存在；前端弹窗只展示 conflicts，warnings 在 ok:true 时单独展示

---

## ⚠️ 后续修正：active_sheet_missing 路径 b 在 tryMerge 层不可达（2026-05-07 B-4 实施时）

### 发现

详见 07 归档 [§ 后续修正](07-阶段B-2.5-代码审查-detector-sheet-project段.md#️-后续修正路径-b-不可达性发现2026-05-07-b-4-实施时)。简述：

- A 删 base.activeSheetId 指向的 sheet 但不改 activeSheetId → A 的 saveCanvas 调 computeDelta 入口 assertProjectIntegrity 立即抛 DataIntegrityError，A 永远写不入
- 因此 tryMerge 层看不到"currentData 暂态 activeSheetId 缺失"

### 对 B-3 applyDelta.test.ts 路径 b case 的影响

applyDelta 单元测试层面**仍保留路径 b case** — 调用方可以直接构造该 currentData（绕开 computeDelta 入口）测试 applyDelta 的兜底行为。
- 但 case 注释需补："本 case 在 tryMerge 层不可达；保留作为 applyDelta 单元层面的防御覆盖"
- 已在 applyDelta.test.ts 路径 b case 加注释

### 对 B-4 验收清单的修正

原"必修测试覆盖路径 b"在 tryMerge.test.ts 层面**改为锁定不可达性**：构造该状态 → 断言 computeDelta 立即抛 DataIntegrityError。已在 tryMerge.test.ts 实现。

### 复盘

接受 codex M2 论证未反向验证 = "修法描述 ≠ 修法实现"反复第 6 次。codex 论证 ≠ 实际可达，必须反向验证（写 case 后跑通才算）。

---

## 任务摘要（原始 brief）

B-3 切片范围（用户拍板）：

1. **纯函数 + 不接 db**（D5 拍板）：服务端归属字段 rewrite 由 saveCanvas 路径的阶段 A helper 处理
2. **active_sheet_missing 内部映射**（B-2.5 M2 必修）：applyDelta 返回 `{ ok, mergedData, warnings } | { ok: false, conflicts }`
3. **不提取 D5 helper**：内联节点/边字段补丁逻辑（applyDelta ~250 行不需要拆）

覆盖功能：字段补丁（4 类）/ 增删（5 类）/ alsoDeprecated / E2 自动去重 / E7 dangling endpoint warning / R-Day2-2 兜底 / active_sheet_missing 3 路径

---

## codex 报告（原文）

### Summary

> 整体看，applyDelta.ts 的核心合并路径满足 B-3 切片目标，未发现阻塞进入 B-4 的 critical/high 问题。最终判定：canEnterB4=true。主要风险集中在防御路径静默跳过语义重复边、测试覆盖声明与实际用例不完全一致，以及 active_sheet_missing 的 conflicts 结果不会携带已生成 warnings。

### Issues

#### medium × 2

**M1**（edge-case）— `applyDelta.ts:applyConnectorChanges`：E2 防御分支在发现"同 semanticKey 但非语义字段不等"时直接 continue，静默丢弃 deltaB 新边且不返回 conflict/warning。建议至少补测试固定行为；更稳妥是抛 DataIntegrityError。

**M2**（missing-constraint）— `applyDelta.test.ts`：测试顶部声称覆盖 sheet meta 字段补丁，18 case 中没有实际验证 sheet.name 修改。建议补 sheet meta 修改用例。

#### low × 3

**L1**（edge-case）— E7 warnings 在 active_sheet_missing 短路返回 conflicts 时会被丢弃。建议 B-4 tryMerge 中明确 ok:false 不展示 warnings 的语义。

**L2**（edge-case）— active_sheet_missing 路径 c 构造了 deltaB 自相矛盾输入（改 activeSheetId 到 s2 又删 s2）。正常 computeDelta 前 assertProjectIntegrity 应已拒绝。建议补注释明确这是脏 delta 兜底防御测试。

**L3**（missing-constraint）— 路径 b 的 currentData 本身违反 assertProjectIntegrity 前置条件，与 applyDelta 注释"调用前提已校验"存在轻微张力。建议在注释里补充说明：currentData 可能是 A 合并后暂态结果。

### Recommendations（8 维判定）

| 维度 | 判定 |
|---|---|
| 1 字段补丁正确性 | PASS — applyFieldPatches 严格按 changedFields.after + 白名单防御，归属字段不被覆盖 |
| 2 E2 去重逻辑 | 风险 — 静默吞改动，建议补防御测试或显式异常 |
| 3 E7 扫描时机 | PASS — 先丢悬空边再查 activeSheetId 和 assertProjectIntegrity 顺序正确 |
| 4 active_sheet_missing 覆盖 | PASS — 路径 b 由 applyDelta 内部检测覆盖，避免 DataIntegrityError 泄漏 500 |
| 5 assertProjectIntegrity 兜底 | PASS — E7 和 activeSheetId 先处理后复跑，覆盖 duplicate id / null handle / dangling parentId |
| 6 JSON 深拷贝 | PASS — 当前数据 JSON 安全，5 人内网小规模数据量无性能问题 |
| 7 测试覆盖度 | 风险 — 缺 sheet meta / project description / E2 防御分支 |
| **8 进入 B-4 判定** | **canEnterB4: true** |

### Risks

1. 静默跳过防御分支会隐藏 detector 漏判或历史脏数据导致的用户改动丢失
2. 测试覆盖清单与实际 case 不完全一致，后续审查可能误判 sheet meta 已被验证
3. B-4 若没有明确 ok:false 不携带 warnings 的约定，前端提示或 mergeReport 设计可能产生歧义

### confidence

high

### notes_for_claude_code

> 建议进入 B-4，布尔判定为 canEnterB4=true。合入 B-4 前优先补 sheet meta 测试；E2 语义重复脏数据是否要显式失败，可由 Claude Code 按阶段边界决定是否现在处理。

---

## 原始文件路径

- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_102703.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_code-review_20260507_102703.json`
- prompt 输入：`tmp-test/codex-b3-prompt.txt`（含项目语境 + B-3 切片范围 + 8 维审查重点）
