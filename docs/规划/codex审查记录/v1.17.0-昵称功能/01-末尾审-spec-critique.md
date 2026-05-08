# 01-末尾审 — v1.17.0 昵称功能 + CanvasSwitcher 前缀（spec-critique）

- 日期：2026-05-08
- 类型：spec-critique / advice-only
- codex version：codex-cli 0.128.0
- 用户拍板：4 项推荐全采纳（H1 顺手补 / M3 加 regex / M1+M2 不动可接受 / L1+L2 顺手修）

## 第一层：非技术总结

v1.17.0 昵称功能 6 个 commits 后调 codex 末尾审。codex confidence=medium，**canEnterBump=true**。

报告 6 issues：1 high (schema.sql 漏 0003 字段，与昵称无关但顺手) / 3 medium (req.user.nickname 占位 / 软删非 auth 路由 / nickname 字符集) / 2 low (trim 判空 / mapApiError 文案)。

5 项采纳 + 1 项不动（M1+M2 软删/req.user 严谨性接受 — 5 人内网 JWT TTL 可接受）。修法补 schema.sql 5 字段 + NicknameSchema regex `^[\p{L}\p{N}\p{Mark}_ -]+$` + displayNickname helper trim 判空 + mapApiError 文案补 nickname。+2 regex 单测 case (520 → 522)。

## 第二层：codex 原话技术细节

### Summary

> 昵称功能本身没有看到明确的数据丢失或越权阻塞；CanvasSwitcher 三态规则与拍板规则基本一致。主要风险集中在 schema 全量建库一致性、`req.user.nickname` 类型语义被占位值削弱、以及昵称字符集约束与注释/展示场景不一致。

### Issues

#### high (1)

**H1 — `server/db/schema.sql` / `server/services/canvases.ts`**（contradiction）

> problem：`schema.sql` 的 `canvases` 表没有包含代码中已使用的 `published_at`、`published_by`、`published_note`、`unpublished_at`、`unpublished_by` 字段，但 `CanvasRow`、`toListItem`、`publishCanvas`、`unpublishCanvas` 都依赖这些字段。这不是昵称改动本身的问题，但它直接破坏"新建库与迁移库一致性"。
>
> suggestion：bump 前补上 0003 字段。

#### medium (3)

**M1 — `server/middleware/auth.ts` / `server/types/user.ts`**（ambiguity）

> problem：`UserPublic.nickname` required 但 `tryDecode` 返回 `nickname: decoded.username` 占位。req.user 类型可信但实际可能不准确。已提供文件中 me/refresh/requireFreshAdmin 已补救，但未提供的路由若使用 `req.user.nickname` 会显示旧值或 username。
>
> suggestion：拆开鉴权返回类型与对外显示类型；或全库搜索 req.user.nickname 用法。

**M2 — 软删非 auth 路由**（security）

> problem：D4 对 me/refresh/PATCH me 软删兜底完整；普通 `requireAuth` 不回查 DB，软删用户旧 JWT 仍可能访问画布保存、批注写接口。
>
> suggestion：要么加 `requireActiveAuth`，要么 release notes 明确"软删不等于即时吊销 token"。

**M3 — `NicknameSchema` 字符集约束缺失**（missing-constraint）

> problem：注释允许中文/字母/数字/下划线/中划线/空格，实现只 trim+1-30。允许换行、控制字符、括号、RTL、emoji。**昵称会被拼进 `[creator_nickname的]`**，可能伪装系统前缀或破坏布局。
>
> suggestion：(a) 加 regex `^[\p{L}\p{N}_ -]+$`；(b) 展示层兜底单行省略。**5 人内网推荐 (a)**。

#### low (2)

**L1 — fallback 用 `length > 0` 而非 `trim().length > 0`**（edge-case）
> problem：DB 出现空白 nickname 时 UI 显示 `[   的]` 不可见昵称。
> suggestion：抽 `displayNickname(nickname, username)` helper 统一。

**L2 — `mapApiError` 文案未含 nickname**（readability）
> problem：UsersTab 对 patch invalid_input 返回"role 或 password 至少传一个"，没 nickname。
> suggestion：补"role / password / nickname 至少一项"。

### Recommendations

1. canEnterBump: true（前提：v1.16.4 既有库走迁移到 v1.17.0；不把 fresh schema 作为发布门禁）
2. UserPublic.nickname required 合理，不建议改 optional
3. JWT 不存 nickname 设计合理，但 req.user 类型语义应收窄
4. 三态规则覆盖完整
5. B 方案合并不变量未被破坏

### Risks

1. 未提供 routes/users.ts / AuthContext.tsx 等，无法完全确认 AuthContext 初始化是否走 /api/auth/me
2. 昵称任意短文本 → CanvasSwitcher 标签难读
3. 软删旧 token 非 auth 路由访问能力
4. schema.sql 与迁移路径不一致

### confidence: medium

### Notes for Claude Code

> bump 前 3 项核对：(1) 全库搜 req.user.nickname；(2) 确认 AuthContext 走 /api/auth/me；(3) 确认 schema.sql 是否需补 0003。

---

## 原始文件路径

- prompt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\prompt-nickname.txt`
- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_spec-critique_20260508_145503.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_spec-critique_20260508_145503.json`

---

## 用户决策（2026-05-08）

| Issue | 决策 | 理由 |
|---|---|---|
| H1 schema.sql 补 0003 | 采纳 — 顺手补 | 历史遗漏顺手起在 v1.17.0 完完 |
| M1 req.user.nickname 占位 | 不动 — 接受 | 5 人内网 / me/refresh/requireFreshAdmin 已修是足够；canvas/annotation 写接口不依赖 nickname 准确 |
| M2 软删非 auth 路由 | 不动 — 接受 | JWT TTL 语义在项目语境已被接受；release notes 提一句 |
| M3 NicknameSchema regex | 采纳 — `^[\p{L}\p{N}\p{Mark}_ -]+$` | 5 人内网下 regex 比展示层兜底更稳；与 username 严格风格一致 |
| L1 displayNickname helper | 采纳 | 抽 helper toPublic/toAdminResponse/toListItem/requireFreshAdmin 共用 |
| L2 mapApiError 文案 | 采纳 | 顺手 |

## Claude 落地动作

### 代码改动

1. `server/db/schema.sql` — canvases 表加 5 个 publish 字段
2. `server/schemas/user.ts` — NicknameSchema 加 regex `^[\p{L}\p{N}\p{Mark}_ -]+$/u` + 错误消息
3. `server/types/user.ts` — 新增 `displayNickname(nickname, username)` helper / toPublic 用 helper
4. `server/services/users.ts` — toAdminResponse 用 displayNickname
5. `server/services/canvases.ts` — toListItem trim 判空 + 注释（不直接用 helper 因 LEFT JOIN username 可 null）
6. `server/middleware/auth.ts` — requireFreshAdmin 用 displayNickname
7. `src/pages/Admin/UsersTab.tsx` — mapApiError 文案补 nickname

### 验证

- npm test 520 → **522** 全过 (+2 case：26b regex 拒非法字符 / 26c regex 接受合法字符集)
- tsc 三端 0 错

### 不动的项

- M1 req.user.nickname：5 人内网 / 写接口不依赖
- M2 软删非 auth 路由：JWT TTL 语义接受 / release notes 提
