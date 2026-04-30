// SQLite 单例 + 启动时迁移
//
// 关键约束（方案 §3.3 / §3.1）：
// - 数据目录在仓库工作区**外**：E:\business-flow-data\app.db
// - WAL 模式（备份用 sqlite3 .backup，禁止 cp）
// - foreign_keys ON（CASCADE 删除 + 引用完整性）
// - 启动时自动跑未应用的 migration

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { config } from '../config.ts';
import { logger } from '../middleware/logger.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const DB_FILENAME = 'app.db';

let dbInstance: DatabaseType | null = null;

/** 元表：记录已应用的 migration（自维护，不在 schema.sql 里） */
const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`;

/**
 * 启动时初始化：建目录 → 打开 DB → WAL/FK → 跑迁移
 * 失败抛异常（让 server/index.ts 在路由注册前 fail-fast）
 */
export function initDb(): DatabaseType {
  if (dbInstance) return dbInstance;

  // 确保数据目录存在
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    logger.info({ dataDir: config.dataDir }, '[db] created data dir');
  }

  const dbPath = path.join(config.dataDir, DB_FILENAME);
  const db = new Database(dbPath);

  // PRAGMA：WAL 提供并发读写、foreign_keys 确保引用完整性
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL'); // WAL 下 NORMAL 是推荐值，比 FULL 快很多

  // 建元表 + 跑迁移
  db.exec(SCHEMA_MIGRATIONS_DDL);
  runMigrations(db);

  logger.info(
    {
      dbPath,
      journalMode: db.pragma('journal_mode', { simple: true }),
      foreignKeys: db.pragma('foreign_keys', { simple: true }),
    },
    '[db] ready'
  );

  dbInstance = db;
  return db;
}

/**
 * 跑 migrations/ 目录下未应用的 .sql 文件，按文件名升序
 * 每个 migration 在事务内执行；失败回滚并抛异常
 */
function runMigrations(db: DatabaseType): void {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn({ migrationsDir: MIGRATIONS_DIR }, '[db] no migrations dir, skip');
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    logger.warn('[db] no migration files');
    return;
  }

  const applied = new Set(
    db
      .prepare('SELECT filename FROM schema_migrations')
      .all()
      .map((row) => (row as { filename: string }).filename)
  );

  const recordStmt = db.prepare(
    'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)'
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const tx = db.transaction(() => {
      db.exec(sql);
      recordStmt.run(file, Date.now());
    });

    try {
      tx();
      logger.info({ file }, '[db] applied migration');
    } catch (err) {
      throw new Error(`[db] migration ${file} failed: ${(err as Error).message}`);
    }
  }
}

/** 拿单例。必须先调用过 initDb() */
export function getDb(): DatabaseType {
  if (!dbInstance) {
    throw new Error('[db] initDb() must be called before getDb()');
  }
  return dbInstance;
}

/** 优雅关闭（进程退出时调用）
 * 关闭前强制 wal_checkpoint(TRUNCATE)：把 wal 内容合并回主库 + 清空 wal 文件
 *
 * 不这么做的代价：进程被 kill -9 / Ctrl+C 等不优雅关闭时，wal 越积越大。
 * 之前踩过：dev 反复 kill 重启后，wal 778KB / 主库 4KB（200 倍），
 * 下次启动时 better-sqlite3 需要重放 wal 才能 ready，可能在某些情况下让首次 query
 * 慢到肉眼可见。
 */
export function closeDb(): void {
  if (dbInstance) {
    try {
      // TRUNCATE 模式比 PASSIVE/FULL 更彻底，物理截断 wal
      // 失败不阻塞进程退出（最差情况只是 wal 暂时大）
      dbInstance.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[db] wal_checkpoint on close failed');
    }
    dbInstance.close();
    dbInstance = null;
  }
}
