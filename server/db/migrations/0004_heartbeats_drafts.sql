-- 0004_heartbeats_drafts：阶段 4 心跳 + auto-save 草稿（补索引）
--
-- 背景（[阶段 4 取舍审查](../../../docs/规划/codex审查记录/阶段4/P4-设计取舍/01-取舍审查-阶段4-6判断点设计取舍.md)）：
--
-- heartbeats / drafts 表本身已在 0001_initial.sql 阶段 0 时一并建好（提前规划，避免后续多次迁移）。
-- 0001 已建索引：idx_heartbeats_canvas (canvas_id, last_seen_at)
--
-- 阶段 4 真正实现 drafts CRUD 时，新增配额检查需要按 user_id+saved_at 排序的索引（FIFO 提示用）：
-- - 单画布草稿 ≤ 2MB（服务端 413）
-- - 用户草稿 ≤ 200 个（判断点 7 简化方案 X，超限返 429；本索引用于配额查询的 fallback 排序）
-- 主键 (user_id, canvas_id) 已覆盖大部分查询，但按 saved_at 排序时需要新索引。
--
-- 单一时钟源在服务端（判断点 6）：服务端按 now - last_seen_at <= 90s 过滤活跃编辑者；
-- saveCanvas 服务（services/canvases.ts）已实现 baseVersion 校验，drafts.base_version 字段
-- 仅承载客户端记录草稿基于哪个主版本（恢复后用此值做 PUT canvases 校验）。

CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, saved_at);
