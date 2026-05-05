# 01 代码审查 P3F-1 用户管理 API

**时间**：2026-05-05 18:27
**Codex 版本**：codex-cli 0.128.0
**TaskType**：code-review / advice-only
**Confidence**：high
**审查文件**：4 个新增 + 4 个上下文（schema/service/route/test + auth.ts/middleware/auth.ts/password.ts/types/user.ts）
**结果文件**：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260505_182654.{json,final.txt}`

---

## 第一层（非技术总结，给产品负责人看）

P3F-1 的服务端 API 整体方向对，4 个端点和测试都基本符合方案。codex 抓出**1 个 high 安全问题** + **2 个 medium 边界 case** + **2 个 low 代码质量**，总共 5 条。

**最关键的 1 条 high**：`requireAuth` 中间件只看 JWT 签名 + token 里的 role，**不回查数据库**。这意味着：

- 张三是 admin → 拿到 admin token
- 李四（另一 admin）把张三降为 user 或软删张三
- **张三的 token 在过期前仍然能继续访问 /api/users 的所有 admin 端点**——继续创建/删除/改其他用户

**实际影响（内部 5 人项目场景下）**：
- token 默认有效期是几小时；只要被降权/软删用户主动刷新 token（重登录失败）才彻底失效
- 但内部场景下真发生"恶意已被降权 admin 主动用旧 token 搞破坏"的概率**很低**
- 对系统正确性的影响是**降权语义不是即时生效**——admin UI 显示"降权成功"但被操作人浏览器还能用

**两个 medium**：
1. **"至少保留一个 admin"未保证**：现在的实现只防"admin 改自己 / 删自己"，不防"admin1 把唯一另一个 admin admin2 降权"。如果系统只剩一个 admin 然后被另一 admin 降权 → 系统锁死。codex 让产品方明确"是只防自己 vs 至少保留一个"
2. **createUser 并发竞态**：findUserByUsername 检查 + INSERT 之间不是事务，并发同名 → DB UNIQUE 错抛 500 而非 409。内部 5 人极少触发但契约缺口

**两个 low**：
- UsernameSchema 比 LoginSchema 严格（管理端禁空格 / 登录仍允许）—— 同概念两套约束
- 400 错误直接返回 zod.error.message —— 前端展示不稳定

**门禁判断（codex 原话）**：P3F-2 门禁**有条件通过**——high 1 这条是唯一会直接影响 admin 后台安全语义的缺口。

---

## 第二层（codex 原话技术细节）

### Issues

#### high - security
- **location**：`server\middleware\auth.ts:42, server\routes\users.ts:33, 54, 91, 132`
- **problem**：requireAuth 只校验 JWT 签名并信任 token 内的 role，没有回查 users 表确认用户仍存在、未软删、role 仍为 admin。这样 admin 被另一个 admin 降为 user 或软删后，旧 token 在过期前仍可能继续通过 admin 鉴权。
- **suggestion**：在 requireAuth 中按 decoded.sub 回查 users 表，若不存在或 deleted_at 非 null 则 401；req.user 使用数据库当前 role/username。这样 requireAdmin 基于当前数据库状态判断。若担心影响所有路由，至少为 admin 管理路由增加一个 requireFreshAdmin 中间件并覆盖 4 个端点。补测试：已软删 admin 的旧 token 访问 GET/POST/PATCH/DELETE 应失败；被降为 user 的旧 admin token 应失败。

#### medium - edge-case (self_demote/self_delete 范围)
- **location**：`server\services\users.ts:92, 174`
- **problem**：self_demote/self_delete 只阻止"自己降权/删除自己"，允许 admin2 将最后一个其他 admin 降为 user 或软删。代码注释说明内部 5 人项目不必过度设计，但产品规则的理由是防锁死系统。
- **suggestion**：请 Claude Code 与产品确认门禁语义：如果只锁定"不能操作自己"，保留现状即可；如果目标是"至少保留一个可用 admin"，则在 patchUser/deleteUser 中当目标是 admin 且会变为非 admin/软删时，检查是否存在其他未软删 admin，否则返回 409。至少把该取舍写进方案和测试名。

#### medium - edge-case (createUser 并发竞态)
- **location**：`server\services\users.ts:76-100`
- **problem**：createUser 先 findUserByUsername 再 INSERT，若并发创建同一 username，第二个请求可能绕过 service 层预检查并在 DB UNIQUE 处抛异常，路由层不会映射为 409。
- **suggestion**：在 createUser 的 INSERT 周围捕获 better-sqlite3 的 UNIQUE 约束错误，回查 username 后返回 username_taken 或 username_taken_soft_deleted。补一个 service 层单测或路由层模拟重复插入异常的测试。

#### low - missing-constraint (UsernameSchema 不一致)
- **location**：`server\schemas\user.ts:18-21, server\routes\auth.ts:19-22`
- **problem**：用户管理的 UsernameSchema 比 LoginSchema 更严格，但登录仍允许任意 1-20 字符 username。同一概念在两个 schema 中约束不一致。
- **suggestion**：如果迁移数据已确认都符合新规则，可接受现状；否则建议抽出共享 UsernameSchema 给 auth login 或在注释里明确 LoginSchema 保持宽松是为了兼容历史用户。

#### low - readability (Zod 错误暴露)
- **location**：`server\routes\users.ts:61, 99`
- **problem**：400 invalid_input 直接返回 parsed.error.message。Zod message 可能包含较长 JSON 化错误细节，API 契约和前端展示会不稳定。
- **suggestion**：保留 error: invalid_input，但 message 改成稳定短语；详细 Zod 错误仅在服务端日志或测试断言中使用。

### Recommendations

1. P3F-2 门禁建议为"有条件通过"：先修复或明确接受 JWT 旧 role/软删用户仍可用的问题；这是唯一会直接影响 admin 后台安全语义的缺口。
2. 补齐撤权相关测试：被软删用户的 token、被降权 admin 的旧 token、已软删 admin 调用 PATCH/DELETE 的行为。
3. 如果不实现"至少保留一个 admin"的全局约束，请在方案和 UI 文案中明确后端只禁止自我降权/自我删除，不防止其他 admin 误操作。

### Risks

1. 旧 JWT 不回查数据库会让用户管理里的降权和软删不是即时生效。
2. 并发创建同名用户时可能出现未捕获 DB 异常，表现为 500 而不是约定的 409 conflict。
3. 直接暴露 Zod 原始错误文本会增加前后端契约波动。

### notes_for_claude_code

本次仅基于提供的文件做静态审查，未读取 migrations 实际 UNIQUE 约束，也未执行测试。若要最终判定 DB 唯一约束未变，需要再看 server\db\migrations 下 users 表定义。除 JWT 当前态回查问题外，4 个 /api/users 端点的 requireAuth + requireAdmin 顺序、密码 hash 写入路径、软删用户名不可复用的 service 层逻辑和主要路由测试覆盖都符合本轮 brief。

---

## Claude 判断 / 用户决策 / 落地动作

**用户决策**：按 Claude 推荐处理 — high 1 + medium 2 + low 2 修，medium 1 + low 1 文档/注释锁定。

### 落地清单

| 级别 | 主题 | 处理 | 修法 |
|---|---|---|---|
| high 1 | JWT 不回查 DB | ✅ 修 | 新建 `requireFreshAdmin` 中间件 + 4 端点切换；新增 3 项测试（21a/21b/21c）覆盖降权 + 软删两类撤权场景 |
| medium 1 | 至少保留一个 admin | ✅ 文档锁定 | [docs/规划/多人协作-方案.md](../../多人协作-方案.md) P3F 4 条产品规则 #1 补"仅防自己 + 多 admin 互相误操作不在范围"段；P3F-2 UI 文案需诚实展示"另一 admin 仍可降你权限" |
| medium 2 | createUser 并发竞态 | ✅ 修代码 + 注释解释为何无运行时单测 | services/users.ts:90-112 catch `SQLITE_CONSTRAINT_UNIQUE` 后回查映射 409；测试段保留注释说明 ESM 只读绑定 + better-sqlite3 同步 API 双重原因无法构造运行时 case |
| low 1 | UsernameSchema 不一致 | ✅ 注释锁定 | schemas/user.ts UsernameSchema 上方写明"故意比 LoginSchema 严，理由 + 现存数据兼容性" |
| low 2 | Zod 错误暴露 | ✅ 修 | routes/users.ts POST/PATCH 两处 400 改稳定短语 |

### 验证

- 测试：182 → 185（新增 3 项 21a/21b/21c），全过
- tsc：server + client 两端 0 错
- 不跑 codex 二审（攻击面已收敛 + 修法都是工程化质量问题，符合 0504 SKILL "何时跳过 codex 跑自审" 4 条触发条件全满足）

### 进 P3F-2 门禁判断

**通过** — codex 一审 high 1 修法 + medium 2 修法已落地，medium 1 文档/UI 文案锁定。P3F-2 admin 后台 UI 可启动。

