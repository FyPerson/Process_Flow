-- 0001_initial：初始 schema
-- 内容引用 ../schema.sql；migrate.ts 会按编号顺序读取此目录下所有 .sql 并执行
-- 后续 schema 变更新增 0002_xxx.sql、0003_xxx.sql，不要修改已应用过的迁移

-- 复制 schema.sql 完整内容，保持迁移文件可独立执行（不依赖外部文件路径）：

-- users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(id) WHERE deleted_at IS NULL;

-- canvases
CREATE TABLE IF NOT EXISTS canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private')),
  is_public_to_guest INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_canvases_visibility ON canvases(visibility);
CREATE INDEX IF NOT EXISTS idx_canvases_owner ON canvases(owner_id);
CREATE INDEX IF NOT EXISTS idx_canvases_guest ON canvases(is_public_to_guest) WHERE is_public_to_guest = 1;

-- canvas_versions
CREATE TABLE IF NOT EXISTS canvas_versions (
  canvas_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  saved_by INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (canvas_id, version),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
  FOREIGN KEY (saved_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_versions_saved_at ON canvas_versions(canvas_id, saved_at DESC);

-- annotations
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  sheet_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
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

-- nodes_meta
CREATE TABLE IF NOT EXISTS nodes_meta (
  canvas_id INTEGER NOT NULL,
  sheet_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  creator_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_deprecated INTEGER NOT NULL DEFAULT 0,
  deprecated_by INTEGER,
  deprecated_at INTEGER,
  PRIMARY KEY (canvas_id, sheet_id, node_id),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_id) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id),
  FOREIGN KEY (deprecated_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_nodes_meta_creator ON nodes_meta(creator_id);

-- heartbeats
CREATE TABLE IF NOT EXISTS heartbeats (
  user_id INTEGER NOT NULL,
  canvas_id INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, canvas_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_canvas ON heartbeats(canvas_id, last_seen_at);

-- drafts
CREATE TABLE IF NOT EXISTS drafts (
  user_id INTEGER NOT NULL,
  canvas_id INTEGER NOT NULL,
  data TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, canvas_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
);

-- conflict_logs
CREATE TABLE IF NOT EXISTS conflict_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  user_a_id INTEGER NOT NULL,
  user_b_id INTEGER NOT NULL,
  base_version INTEGER NOT NULL,
  current_version INTEGER NOT NULL,
  resolution TEXT NOT NULL CHECK(resolution IN ('auto_merged', 'conflict', 'overwrite', 'cancelled')),
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflict_logs_canvas ON conflict_logs(canvas_id);
CREATE INDEX IF NOT EXISTS idx_conflict_logs_created ON conflict_logs(created_at);
