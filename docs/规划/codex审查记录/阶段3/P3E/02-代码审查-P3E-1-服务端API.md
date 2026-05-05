**第一层：非技术总结**

P3E-1 服务端批注 API + schema + 权限规则 + 单测 codex 一审。

codex 评价："权限链路对'知道 annotation.id 跨画布越权'的主要路径已经堵住，SQL 注入面也基本干净。"——核心安全语义通过。

**4 条 issue（无 critical / 无 high）**：

1. **Medium 必修（content 长度契约 bug）**：`z.string().min(1).max(2000) + .refine(s => s.trim().length >= 1)` 校验的是**原始字符串长度** ≤ 2000，但产品规则是**trim 后** 1-2000 字符。1999 字 + 前后空格 → 服务端拒绝但 trim 后合法。**修法**：`z.string().transform(s => s.trim()).pipe(z.string().min(1).max(2000))`。**真镜子**：自审时只想"min 1 + refine 兜底"，没想"max 2000 也应作用在 trim 后"。
2. **Medium 建议（fail-closed 不彻底）**：`nodeExistsInCanvas` 只 catch JSON.parse 错；data 合法 JSON 但缺 sheets / nodes 不是数组会抛 500。修法：访问前加结构守卫。
3. **Medium 建议（路由层测试缺失）**：service 26 项测覆盖逻辑，但 GET/POST/PATCH 的 requireAuth + validateBody + canRead + 错误码契约没被锁住。修法：补 4-6 个轻量路由 handler 测（不引 supertest）。
4. **Low 建议（schema 数量描述不准）**：实际只有 1 个 Zod schema；id/cid 在 route 手写解析。修法：补齐 `CanvasIdParamSchema` / `AnnotationIdParamSchema` 复用。

**recommendations 通过项**：
- ✅ resolve/reopen 权限顺序正确（id → canvas_id → canRead → canCloseAnnotation）
- ✅ SQL 注入面干净
- ✅ 容量竞态在 5 人并发场景下不是门禁问题
- ✅ archived 画布"只 admin 能 read 因此只 admin 能 POST"自洽，建议加注释明确

**confidence: medium**（因为没看 migration 文件）。

**门禁判断**：可以**有条件**进入 P3E-2；门禁前至少修 content trim 长度 schema + 补最小路由契约测试。

**Claude 独立判断**：4 条全部赞同采纳，无反对。修法节奏 → 修完 + tsc + npm test 全过即可进 P3E-2，**不跑二审**（攻击面收敛已被一审验证，4 条都是工程化质量问题不涉及权限/安全语义）。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / code-review / advice-only / confidence: medium
> 实际耗时：约 3 分钟
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260505_111328.json`
> 上下文文件（8 份）：annotation.ts schema+service+routes+test / index.ts / canvases.ts / middleware/auth.ts + validate.ts

**Medium 1：content 长度契约 trim 后该作用 max**

[server/schemas/annotation.ts:21](E:/业务全景图/server/schemas/annotation.ts) 产品规则是"content trim 后 1-2000 字符"，但当前 `.max(2000)` 校验的是原始字符串长度；例如 1999 个有效字符加前后空格，trim 后合法，却会被 400 拒绝。

**修法**：把 schema 改成基于 trim 后字符串校验并输出 trim 后值，例如 `z.string().transform(s => s.trim()).pipe(z.string().min(1).max(2000))`；这样 route 层可以直接使用已清洗的 `body.content`。

**Medium 2：nodeExistsInCanvas 结构损坏防御**

[server/services/annotations.ts:72](E:/业务全景图/server/services/annotations.ts) `nodeExistsInCanvas` 只捕获 JSON.parse 失败；如果 `canvases.data` 是合法 JSON 但结构损坏，例如缺少 `sheets` 或 `nodes` 不是数组，会抛 500，而不是按注释所说 fail-closed。

**修法**：在访问前加结构守卫：确认 `project.sheets` 是数组、目标 sheet 的 `nodes` 是数组；结构不符合时返回 false，并由 route 继续返回 `node_not_found` 或单独记录数据损坏日志。

**Medium 3：路由层测试缺失**

[server/routes/annotations.ts:39 / :63 / :116](E:/业务全景图/server/routes/annotations.ts) P3E-1 的范围包含路由、schema、鉴权和权限状态码，但现有测试主要覆盖 service；GET/POST/PATCH 的 `requireAuth`、`validateBody`、`canRead`、错误码和响应体契约没有被测试锁住。

**修法**：不一定要大规模引入 supertest；至少补 4-6 个轻量路由集成测或 handler 级测试：游客 GET=401、无权 GET/POST=403、空白/超长 content=400、节点不存在=404、非作者非 creator resolve=403、跨私有画布 annotation id=403。

**Low 1：schema 数量描述不准**

[server/schemas/annotation.ts:1](E:/业务全景图/server/schemas/annotation.ts) 任务简述写的是 "Zod 4 个 schema"，但当前实际只有 `CreateAnnotationRequestSchema` 一个导出的请求 schema，参数 id/cid 仍在 route 中手写解析。

**修法**：如果验收标准确实要求多个 schema，补齐 `CanvasIdParamSchema`、`AnnotationIdParamSchema` 等并复用；如果只是表述问题，修正文档/审查简述，避免后续 Claude Code 或前端同事误判契约。

**risks（codex 自承不确定）**：

- 不修 trim 长度 → 前端按"trim 后 1-2000"实现计数时会出现服务端拒绝看似合法内容的体验差异
- 缺路由层测试 → 后续改 middleware 顺序、错误码或 req.body 清洗逻辑，service 单测不一定能发现契约回归
- migration 未提供，FK / ON DELETE CASCADE / status CHECK / NOT NULL 和索引未深度验

---

**Claude 修复方案**

| 严重度 | 项 | 是否修 | 预计 |
|---|---|---|---|
| 🟡 medium 1 | content schema 改 transform → trim → pipe min/max | ✅ 修 | 5 分钟 |
| 🟡 medium 2 | nodeExistsInCanvas 加结构守卫（Array.isArray sheets/nodes） | ✅ 修 | 5 分钟 |
| 🟡 medium 3 | 补 4-6 个路由 handler 测（不引 supertest） | ✅ 修 | 25 分钟 |
| ⚪ low 1 | 补 CanvasIdParamSchema + AnnotationIdParamSchema 复用 | ✅ 修（选 A） | 10 分钟 |

**预计总修时**：45 分钟。修完跑 tsc + npm test 全过即合入主干进 P3E-2，不跑二审。

**用户决策**：
[x] 4 条全采纳，修完直接进 P3E-2（同意 Claude 节奏判断）
[ ] 修哪条、跳哪条
