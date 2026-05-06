# 04-阶段 A 代码审查 — helper 提取

## 元信息

- **审查日期**：2026-05-07
- **审查范围**：阶段 5 Day 2 阶段 A（saveCanvas 快速路径迁移到 Delta 形态 + 提取 3 helper + 清理 dead code）
- **codex 模式**：stdin 注入 + 前置代码完整可读（115KB prompt / 0 截断 / confidence 同[02-取舍审 v2 模式](02-取舍审-v2-实读后.md)）
- **基于 codex 协作模式**："翻译报告（不下结论），分 severity 排列，不替用户做采纳/不采纳"

## Claude 拍板记录

| codex 意见 | severity | 真伪 | 处置 |
|---|---|---|---|
| **routes/canvases.ts PUT catch 不区分 DataIntegrityError**（必修项 1） | high | **真** | ✅ 已修 — `routes/canvases.ts` 加 `instanceof DataIntegrityError` 显式映射 `data_integrity_error` 500 |
| **NODE_DIFF_FIELDS 字段白名单可能漏字段**（必修项 2） | high（codex 标）| **伪** | ❌ 不采纳 — types.ts:529 已有双向 AssertNever 真断言（Day 1 五审 H1 修法），任意字段不齐编译报 TS2344；codex 看到代码但未识别为真断言 |
| **白名单回归测试** | medium | 已挂账 | 🔄 维持挂账债务 #31（中期 schema/StorageNodeContentFields/DIFF_FIELDS 三者对表测试）|
| **canvases.ts 注释口径不一致** | low | **真** | ✅ 已修 — 明确"saveCanvas 不 catch，让 route 层统一映射" |
| **NodeMetaRow 类型统一** | low | 真但低优 | ❌ 不采纳 — 结构性等价 TS 兼容；统一会牵动 createCanvas/hydrate 路径，反工程艺术品 |

**未采纳必修项 2 的理由**：codex 完整读到 types.ts 但没识别 `AssertNever<T extends never> = T` 模式是真断言（无法重现工程史上 Day 1 五审反向验证）。重跑 codex 不值得（90-180s + 一轮翻译报告），更彻底根治路径是债务 #31（"删字段跑 tsc 报错"自动化）。详见拍板对话上下文。

**未跑 DataIntegrityError 路由映射回归测试**：阶段 A 已是纯重构闭环；端到端测试推到阶段 D 末尾审一并加（与全量端到端 Playwright 同事务）。

---

## 阶段 A 审查（codex 报告原文）

### 总体判断
阶段 A 的 helper 抽取方向正确，快速路径已基本迁移到 `Delta` 形态，且对 `alsoDeprecated`、sheet 增删的 meta 同步、annotations 清理这些 Day 2 风险点有覆盖。主要问题不是高并发或架构层面，而是纯重构语义上有几处需要明确：字段 diff 白名单与旧整节点 strip 比对不完全等价，以及 `DataIntegrityError` 的路由映射需确认实际存在。

### 1. 行为等价性
- ✓ added / removed 基本等价：`sheetsAdded`、`sheetsModified.nodes.added/removed` 覆盖了旧数组语义。
- ⚠ modified 不严格等价：旧逻辑若是 strip meta 后整节点 deep equal，则会比较所有非服务端字段；新 `computeDelta` 只比较 `NODE_DIFF_FIELDS` 白名单。若 schema 允许但白名单未列的持久化字段存在，新路径会忽略修改。severity: medium。
- ✓ deprecatedChanged 基本等价，并且 `alsoDeprecated` 路径更完整：内容变 + `is_deprecated false→true` 会进入 `modified.alsoDeprecated`，rewrite 和 meta sync 都会写 `deprecated_by/at`。
- ✓ removed annotations 删除时序安全：先写新快照，再删 annotations/meta，仍在同一事务内；回滚语义一致。
- ✓ sheet 顶层元变更：新 rewrite 保留 incoming sheet/project 形态，sync 不处理 project meta，与“旧代码完全不处理 nodes_meta 之外副作用”一致。

### 2. helper 边界正确性
- `validateDeltaBPermissions`：覆盖 `sheetsAdded` 内节点、`sheetsModified` 的 added/modified/deprecated/removed、`sheetsRemoved` 内节点删除权限。没有明显漏路径。
- `rewriteNodesFromMeta`：按 delta 判定 modified / deprecated / alsoDeprecated，且先 strip 服务端归属再补丁，符合“禁止 spread incoming 整对象”的要求。注意它仍保留 incoming 的所有非归属字段，等价性依赖 `NODE_DIFF_FIELDS` 覆盖所有可持久化内容字段。
- `syncNodesMetaFromDeltaB`：INSERT/UPDATE/DELETE 顺序合理；sheet 删除用 sheet 级 DELETE，能覆盖 annotations + nodes_meta 清理。未见重复处理风险，因为 `computeDelta` 中 sheetAdded/sheetRemoved 不会同时进入 sheetsModified。

### 3. 行为收紧的兜底
4 处 integrity 收紧在当前项目语境下可以接受：schema 已补、生产审计 9 canvases + 27 versions 全过，规模小且数据面已扫过，误伤风险低。

但 `DataIntegrityError` 捕获路径需要补确认。代码注释说 caller route 映射 `500 + data_integrity_error`，而 `saveCanvas` 本身只 catch `PermissionError`。如果 `routes/canvases.ts PUT` 已有 `instanceof DataIntegrityError` 显式映射，这是故意边界；如果没有，就是 high 漏改，会落入普通 `save_failed` 或未分类 500，违背 D5 决策。

### 4. 类型与命名
`NodeMetaRow` 在 `canvases.ts` 和 helper 中结构等价，但已经重复定义。建议统一从 `canvases-merge-helpers.ts` 导出复用，降低后续字段漂移风险。severity: low。

`asProjectShape(data)` 运行时安全性可以接受：schema input 和 merge shape 都是 plain object，helper 只是 TS 适配。但它不是校验器，安全性依赖 route 层 schema parse 与 `computeDelta` integrity 扫描。

### 5. 性能 / 副作用
事务内 `computeDelta` 两次全量 integrity 扫描在 `<100 用户 / 5 并发 / ~1000 节点` 语境下可接受，预期开销不是问题。

每次 helper 内 `prepare` statement 不构成泄漏；better-sqlite3 statement 生命周期跟 DB handle/GC 走，事务提交不会留下业务副作用。这里没有必要引入 statement cache。

### 6. 阶段 B/C 衔接
机会：阶段 A helper 形态适合阶段 C 复用，尤其是合并成功后统一走 `rewriteNodesFromMeta` + `syncNodesMetaFromDeltaB`，能避免快速路径和合并路径副作用漂移。

风险：阶段 B 的 `applyDelta` 必须复用同一字段白名单语义，并且合并成功后要用 `deltaB` 做权限和 meta 同步，而不是从 `mergedData` 反推。另一个风险是 project/sheet meta 冲突检测必须和快速路径的“允许直接保存”区分清楚：快速路径可以保存 project meta，合并路径双方都改时应 409。

### 必修项（high）
- 确认并补齐 `routes/canvases.ts PUT` 对 `DataIntegrityError` 的显式映射：返回 `500 + data_integrity_error`，不要混入普通 `save_failed`。
- 若旧逻辑确实是“strip meta 后整节点比较”，需要确认 schema 所有持久化节点字段均已进入 `NODE_DIFF_FIELDS`；否则新快速路径会静默忽略白名单外字段修改。

### 建议项（medium / low）
- medium：为“白名单外字段不应持久化 / 不应触发 modified”补一条回归测试或 schema 对照测试。
- low：统一 `NodeMetaRow` 类型定义。
- low：注释里“saveCanvas catch DataIntegrityError”与实际代码边界不一致，建议改成“route 层 catch”，避免后续误读。

### 项目语境合规性
已按内网单实例、小并发、小用户量评审，未提出 Redis/Postgres/OT/CRDT/rate limit/CDN/SLO 等不适用建议。