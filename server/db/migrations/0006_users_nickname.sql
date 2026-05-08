-- 0006_users_nickname：users 表加 nickname（昵称）字段
--
-- 背景（2026-05-08 用户需求）：
-- - CanvasSwitcher 下拉项中已发布画布前缀显示「[公共画布]」，未发布画布前缀显示「[个人]」（自己的）
--   或「[创建者昵称的]」（admin 看别人的 private）
-- - admin 后台 UsersTab 加「昵称」列；用户自己可在顶栏头像下拉里改自己的昵称
--
-- 设计：
-- - NOT NULL DEFAULT '' —— 表级约束防脱缰
-- - 已存量用户回填 nickname = username（保持现状显示稳定）
-- - 新建用户由 service 层在 INSERT 时同步把 nickname 默认为 username（route 层 zod 不强制传 nickname）
-- - 业务层规则：nickname 1-30 字符；空 nickname 在响应序列化时 fallback 到 username
--
-- 5 人内网 SQLite 单事务，better-sqlite3 同步执行；执行失败回滚整次 push 部署链路（v1.16.4 → v1.17.0）

ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
UPDATE users SET nickname = username WHERE nickname = '';
