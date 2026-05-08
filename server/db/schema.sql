-- 业务全景图 - 多人协作功能数据库 schema
-- 对应方案 docs/规划/多人协作-方案.md §3.1（v4.1）
-- 8 张表：users / canvases / canvas_versions / annotations
--        / nodes_meta / heartbeats / drafts / conflict_logs
-- 时间戳统一用 INTEGER（Unix ms），布尔统一用 INTEGER 0/1

-- ================================================
-- users：用户与角色
-- ================================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
  nickname TEXT NOT NULL DEFAULT '',  -- 昵称（migration 0006）；service 层 createUser 同步为 username
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER  -- 软删时间戳，NULL = 在岗（v3 §3.1 / §9.3）
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(id) WHERE deleted_at IS NULL;

-- ================================================
-- canvases：画布主表（最新版本快照存 data 字段）
-- ================================================
CREATE TABLE IF NOT EXISTS canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private')),
  is_public_to_guest INTEGER NOT NULL DEFAULT 0,   -- 0/1
  owner_id INTEGER,                                -- private 必填，public 可空
  data TEXT NOT NULL,                              -- JSON: MultiCanvasProject 序列化
  version INTEGER NOT NULL DEFAULT 1,              -- 乐观锁
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,             -- 0/1，归档软删
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_canvases_visibility ON canvases(visibility);
CREATE INDEX IF NOT EXISTS idx_canvases_owner ON canvases(owner_id);
CREATE INDEX IF NOT EXISTS idx_canvases_guest ON canvases(is_public_to_guest) WHERE is_public_to_guest = 1;

-- ================================================
-- canvas_versions：版本快照（合并算法必需，v3 新增）
-- POST /api/canvases 与 import 接口必须在同事务插入 v=1 初始快照
-- ================================================
CREATE TABLE IF NOT EXISTS canvas_versions (
  canvas_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,                              -- 该版本完整快照
  saved_by INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (canvas_id, version),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
  FOREIGN KEY (saved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_canvas_versions_saved_at ON canvas_versions(canvas_id, saved_at DESC);

-- ================================================
-- annotations：节点批注（独立表，v3 加 sheet_id 复合定位）
-- ================================================
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  sheet_id TEXT NOT NULL,                          -- 节点所在 sheet
  node_id TEXT NOT NULL,                           -- 节点客户端字符串 ID
  author_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('unresolved', 'resolved')),
  resolved_by INTEGER,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_annotations_canvas_sheet_node ON annotations(canvas_id, sheet_id, node_id);
CREATE INDEX IF NOT EXISTS idx_annotations_status ON annotations(status);

-- ================================================
-- nodes_meta：节点创作元信息（v3 新增，防客户端篡改）
-- 服务端唯一可信源；POST/import 时必须为初始 data 中所有节点写入记录（v4 §3.1）
-- ================================================
CREATE TABLE IF NOT EXISTS nodes_meta (
  canvas_id INTEGER NOT NULL,
  sheet_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  creator_id INTEGER NOT NULL,                     -- 第一次保存时的用户，永久不变
  created_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_deprecated INTEGER NOT NULL DEFAULT 0,        -- 0/1，软删标记
  deprecated_by INTEGER,
  deprecated_at INTEGER,
  PRIMARY KEY (canvas_id, sheet_id, node_id),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_id) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id),
  FOREIGN KEY (deprecated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_meta_creator ON nodes_meta(creator_id);

-- ================================================
-- heartbeats：编辑中状态（"还有谁在编辑此画布"）
-- 判断在线：last_seen_at > now - 90s
-- ================================================
CREATE TABLE IF NOT EXISTS heartbeats (
  user_id INTEGER NOT NULL,
  canvas_id INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, canvas_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_canvas ON heartbeats(canvas_id, last_seen_at);

-- ================================================
-- drafts：auto-save 草稿（每用户每画布最多 1 份）
-- ================================================
CREATE TABLE IF NOT EXISTS drafts (
  user_id INTEGER NOT NULL,
  canvas_id INTEGER NOT NULL,
  data TEXT NOT NULL,                              -- JSON 草稿
  base_version INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, canvas_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
);

-- ================================================
-- conflict_logs：合并冲突可观测性（每周看一次决定是否升级算法）
-- ================================================
CREATE TABLE IF NOT EXISTS conflict_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  user_a_id INTEGER NOT NULL,                      -- 先保存的人（保存了 v_new）
  user_b_id INTEGER NOT NULL,                      -- 后保存的人（基于 v_old）
  base_version INTEGER NOT NULL,
  current_version INTEGER NOT NULL,
  resolution TEXT NOT NULL CHECK(resolution IN ('auto_merged', 'conflict', 'overwrite', 'cancelled', 'base_version_expired')),
  details TEXT,                                    -- JSON：冲突的具体节点/边 ID
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conflict_logs_canvas ON conflict_logs(canvas_id);
CREATE INDEX IF NOT EXISTS idx_conflict_logs_created ON conflict_logs(created_at);
