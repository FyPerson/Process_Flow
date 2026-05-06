-- 0005_conflict_logs_extend_resolution：阶段 5 合并算法 — 扩 conflict_logs.resolution CHECK
--
-- 背景（[阶段 5 取舍审 02-拍板](../../../docs/规划/codex审查记录/阶段5/P5-合并算法/02-拍板记录-阶段5-11项决策.md)）：
--
-- conflict_logs 表本身已在 0001_initial.sql 阶段 0 时一并建好；阶段 5 进入合并算法后，需要新增
-- 一种 resolution 类型 `base_version_expired` —— 客户端 baseVersion 太旧（canvas_versions 已被
-- 清理），服务端无法取出 baseData 做合并，统一返此码让前端 GET 重载并保留草稿。
--
-- SQLite 不支持直接修改 CHECK 约束，需要走"建临时表 → 复制数据 → 删旧表 → 重命名"流程。
-- 现有 conflict_logs 的索引（idx_conflict_logs_canvas / idx_conflict_logs_created）也要重建。
-- 用 IF EXISTS / IF NOT EXISTS 兜底，幂等（重跑 migration 不破坏现有数据）。

-- 0001 时 CHECK：('auto_merged', 'conflict', 'overwrite', 'cancelled')
-- 0005 扩为：    ('auto_merged', 'conflict', 'overwrite', 'cancelled', 'base_version_expired')

CREATE TABLE IF NOT EXISTS conflict_logs_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  user_a_id INTEGER NOT NULL,
  user_b_id INTEGER NOT NULL,
  base_version INTEGER NOT NULL,
  current_version INTEGER NOT NULL,
  resolution TEXT NOT NULL CHECK(resolution IN ('auto_merged', 'conflict', 'overwrite', 'cancelled', 'base_version_expired')),
  details TEXT,
  created_at INTEGER NOT NULL
);

INSERT INTO conflict_logs_v2 (id, canvas_id, user_a_id, user_b_id, base_version, current_version, resolution, details, created_at)
SELECT id, canvas_id, user_a_id, user_b_id, base_version, current_version, resolution, details, created_at
FROM conflict_logs;

DROP TABLE conflict_logs;
ALTER TABLE conflict_logs_v2 RENAME TO conflict_logs;

CREATE INDEX IF NOT EXISTS idx_conflict_logs_canvas ON conflict_logs(canvas_id);
CREATE INDEX IF NOT EXISTS idx_conflict_logs_created ON conflict_logs(created_at);
