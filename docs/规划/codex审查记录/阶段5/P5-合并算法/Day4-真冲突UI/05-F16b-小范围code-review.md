# P5 Day 4 F-16b 小范围 code-review — saveErrorDispatcher + useMultiCanvas catch 块

- **日期**：2026-05-08
- **触发**：F-16b 抽 save 副作用 dispatcher 改 useMultiCanvas catch 块——动了 Day 3 客户端核心代码（B 方案不变量守门链路），用户拍板"现在跑一次小范围审"锁住"重构没破语义"
- **codex 调用**：
  - mode：code-review / advice-only
  - sandbox：read-only
  - prompt：[E:/tmp/codex-day4-f16b-code-review.md](file:///E:/tmp/codex-day4-f16b-code-review.md)（~9KB）
  - 同步阻塞跑 ~37s 返回
  - codex-cli 0.128.0
  - 输出 wrapper：[codex_code-review_20260508_002534.json](file:///C:/Users/FY/AppData/Local/Temp/codex-bridge-workspace/runs/codex_code-review_20260508_002534.json)
- **整体判定**：**0 critical / 0 high / 0 medium / 2 low** — F-16b 重构没破语义；confidence=high
- **结论**：codex 推荐"按无阻断问题处理"

## 第一层 — 非技术总结

F-16b 把 save() catch 块的决策从 if 链抽成纯函数 dispatcher（saveErrorDispatcher.ts），(h) 用类型层 `shouldDeleteDraft: false` 字面常量守门。codex 5 个审查点（行为等价性 / B 方案不变量 / narrowing / returnValue 匹配 / 测试覆盖）**全过**，未发现真 bug。两条 low 都是"加强守门可选项"（不阻塞）+ 一条建议补 currentVersion 非 number 测试。

## 第二层 — codex 2 项 low 原话技术细节

### Low — 2 条

**L1 — missing-constraint / useMultiCanvas.ts catch 块**
- problem：注释称"类型层守门：plan.shouldDeleteDraft 是字面 false，不调 apiDeleteDraft"，但当前 hook 实际没有读取或断言 `errorPlan.shouldDeleteDraft`。这不影响本次行为等价性，因为代码确实没有调用 apiDeleteDraft；但这个类型守门只覆盖 dispatcher 返回值形状，不能在 hook 层编译期阻止未来维护者在 base_version_expired 或 conflict 分支里直接调用 apiDeleteDraft。
- suggestion：若只要求 F-16b 小范围，当前可接受；如要让守门更实，可以在两条非 rethrow 分支内保留一个轻量编译期断言，例如将 `errorPlan.shouldDeleteDraft` 赋给 `const shouldDeleteDraft: false`，并继续不执行删除逻辑。**不要因此扩大到 hook 单测或大重构**。

**L2 — readability / useMultiCanvas.ts catch 块**
- problem：最后兜底 `throw err` 在运行时与旧实现完全等价，也能覆盖 action: 'rethrow' 路径；但代码没有显式检查 `errorPlan.action === 'rethrow'`，未来如果 SaveErrorPlan 新增 action，TypeScript 未必在这里强制 exhaustiveness，新增分支可能被静默重抛。
- suggestion：本次不必改行为。若希望增强类型守门，可把两段 if 改成 `switch (errorPlan.action)` 并在 rethrow 分支 throw err，末尾加 never 穷尽检查；保持 throw err 而不是 throw errorPlan.error，以维持旧语义。

### recommendations / risks / notes_for_claude_code

- **R1**：行为等价性成立。非 409 / 409 缺 currentVersion 都会先设 serverError + autoSaveDisabled 后重抛原始 err
- **R2**：B 方案核心不变量在这段改造中保持
- **R3**：discriminated union narrowing 正确（throw err 与旧 catch 末尾一致比 throw errorPlan.error 更贴近原语义）
- **R4**：returnValue 字段与 SaveResult 分支匹配
- **R5**：建议补一个低成本测试用例：currentVersion 非 number 必须 rethrow（避免只测"缺字段"没测"类型非法"）
- risks：审查只基于 brief 代码片段；NaN 情况与旧实现等价非新增问题；类型层 false 是局部约束非全局证明
- notes_for_claude_code：可按"无阻断问题"处理；若要收紧只做很小类型穷尽检查或补 1 个 dispatcher 单测，不要扩大到 RTL/jsdom/e2e/监控/架构重构

详见 [wrapper JSON 第 23 行 finalMessage 字段](file:///C:/Users/FY/AppData/Local/Temp/codex-bridge-workspace/runs/codex_code-review_20260508_002534.json)。

## 第三层 — Claude 判断 / 用户决策 / 落地动作

### 用户拍板（2026-05-08）

| # | codex 意见 | 严重度 | 用户拍板 | Claude 落地 |
|---|---|---|---|---|
| L1 | hook 内加 `const _: false = errorPlan.shouldDeleteDraft` 重复编译期断言 | low | ❌ **不采纳** | 维持原样：dispatcher 类型层守门已足够；hook 注释 + check:invariants grep 双层覆盖未来维护者风险；避开 auto memory feedback_explicit_conventions "类型守门生效时不要绕过它做运行期防御"反 pattern |
| L2 | switch + never 穷尽检查替代 if 链 | low | ✅ **采纳** | useMultiCanvas.ts catch 块改为 `switch (errorPlan.action)` + `default: { const _exhaustive: never = errorPlan; ... }` 真 never 守门；保留 `throw err` 而非 `throw errorPlan.error` 维持旧语义（codex R3 原话）|
| R5 | 补 currentVersion 非 number 必须 rethrow 测试 | low | ✅ **采纳** | saveErrorDispatcher.test.ts 加 case 9 (string 类型) + case 10 (null 类型)；用 `satisfies ApiError` + cast 模拟服务端契约违反场景 |

### 反向验证（防"修法描述 ≠ 修法实现"踩坑第 5 次）

L2 修法的 `default: never` 守门是否真生效？

**反向验证步骤**：
1. 在 SaveErrorPlan 临时加 `| { action: 'temp_test_never_check' }`
2. 跑 `npx tsc --noEmit -p tsconfig.client.json`
3. 期望：tsc 报 TS2322 `Type '{ action: "temp_test_never_check"; }' is not assignable to type 'never'`

**实测结果**：✅ tsc 报错位置 [useMultiCanvas.ts:1110:17](../../../../../src/hooks/useMultiCanvas.ts) — never 守门真生效。回滚反向验证 → tsc 0 错。

### 验收命令链

- `npm test`：433 → **435** 全过（+2 R5 case）
- `npx tsc --noEmit -p tsconfig.client.json`：0 错
- `npx tsc --noEmit -p tsconfig.server.json`：0 错
- lint:ids + check:invariants + check:conflict-guards：0 违规

### 风险吸收

- L1 不采纳风险：未来维护者可能在 base_version_expired/conflict 分支直接调 apiDeleteDraft → 接受这个风险，理由：(1) hook 注释 + dispatcher 类型层 false 字面常量已两层提示；(2) check:invariants grep 守门可在维护时发现新增 apiDeleteDraft 调用；(3) F-14b e2e 会跑真画布 base_version_expired 路径，能拦下"草稿被误删"的真行为
- L2 + R5 采纳零风险（增强守门 + 补盲点测试）

### Day 4 进度更新

切片 16/22 → 17/22（F-16 完工 + L2/R5 修法落地）。下次 next = F-15（PUT route 层 supertest #33）。

