-- 0003_canvas_publish_fields：P3G 公共画布发布有摩擦治理
--
-- 背景（[P3G 取舍审查](../../../docs/规划/codex审查记录/阶段3/P3G/01-取舍审查-P3G-公共画布发布治理.md)
--      + [P3G-1+2 代码审查](../../../docs/规划/codex审查记录/阶段3/P3G/02-代码审查-P3G-1+2-服务端落地.md)）：
-- public 画布的产生路径要求"经过明确的发布动作 + 谁/何时/为什么可观察 + 可撤回"。
-- 5 条产品规则（codex 审后）：publish/unpublish 都不动 owner_id；保留发布前归属；
-- 历史 public 回填 published_at/by/note；published_note 单字段"最近一次发布"语义不做完整审计链。
--
-- 字段（全部 nullable，留 NULL 标记"未发布过的 private 画布"）：
-- - published_at INTEGER：最近一次发布时间（首次或重复发布会覆盖）
-- - published_by INTEGER：最近一次发布操作者 user.id
-- - published_note TEXT：最近一次发布说明（trim 后 1-500 字符）
-- - unpublished_at INTEGER：最近一次撤回时间
-- - unpublished_by INTEGER：最近一次撤回操作者 user.id
--
-- 状态机不变量（codex 02-审 #4 注释统一）：
-- - publish 时**不动** unpublished_at / unpublished_by（保留上一次撤回历史，与 publishCanvas 实现一致）
-- - unpublish 时**不动** published_at / published_by / published_note（"最近一次发布"语义保留）
-- - 这是有意保留的"轻量审计"——admin 列表能看到画布最近一次进出 public 状态的人/时间
--
-- 外键 ON DELETE 行为（codex 02-审 #3）：
-- 显式不加 ON DELETE 子句，依赖现有项目约定"用户永不物理删，只软删（users.deleted_at = now）"
-- （详见 server/routes/users.ts 4 端点 + P3F-1 产品规则 #2"软删 username 不可重用"）。
-- 若未来加物理删用户入口，需要同步：
--  1) 把 published_by / unpublished_by FK 改 ON DELETE SET NULL（同时 created_by/updated_by 也要审）
--  2) 前端展示对 NULL by 字段 fallback 到"用户 #id"或"已删除用户"
--
-- 索引：published_at 列表按"发布时间倒序"排序时用得到（暂不加，admin 视角实测 < 50 条）

ALTER TABLE canvases ADD COLUMN published_at INTEGER;
ALTER TABLE canvases ADD COLUMN published_by INTEGER REFERENCES users(id);
ALTER TABLE canvases ADD COLUMN published_note TEXT;
ALTER TABLE canvases ADD COLUMN unpublished_at INTEGER;
ALTER TABLE canvases ADD COLUMN unpublished_by INTEGER REFERENCES users(id);

-- 历史 public 画布回填（codex 02-审 #2 修正）：
-- 当前生产已存在的 visibility='public' 画布没有发布元信息。回填规则：
--   published_at = COALESCE(原 published_at, created_at)
--   published_by = COALESCE(原 published_by, created_by)
--   published_note = COALESCE(原 published_note, '历史 public 画布迁移回填')
-- 触发条件：visibility='public' AND archived=0 AND
--   (published_at IS NULL OR published_by IS NULL OR published_note IS NULL)
-- 即 3 个字段任一缺失就走回填，分字段 COALESCE 防止覆盖已有合法值。
-- 这比"只看 published_at IS NULL"更稳——防御未来 SQL 直接改库塞进部分字段的情况。
UPDATE canvases
SET published_at = COALESCE(published_at, created_at),
    published_by = COALESCE(published_by, created_by),
    published_note = COALESCE(published_note, '历史 public 画布迁移回填')
WHERE visibility = 'public'
  AND archived = 0
  AND (published_at IS NULL OR published_by IS NULL OR published_note IS NULL);
