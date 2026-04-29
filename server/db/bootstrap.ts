// 启动时数据 bootstrap：与 schema migration 不同，这里处理"首次启动该有的初始数据"
// 当前只做：users 表为空时根据 .env 创建初始管理员

import type { Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config.ts';
import { logger } from '../middleware/logger.ts';
import { hashPassword, PASSWORD_MIN_LENGTH } from '../utils/password.ts';

export async function bootstrapInitialAdmin(db: DatabaseType): Promise<void> {
  const count = (
    db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
  ).c;

  if (count > 0) return; // 已有用户，不再 bootstrap

  const username = config.initialAdminUser;
  const password = config.initialAdminPassword;

  if (!username || !password) {
    logger.warn(
      '[bootstrap] users table is empty but INITIAL_ADMIN_USER / INITIAL_ADMIN_PASSWORD ' +
        'not set in .env — login will be impossible. ' +
        'Set them and restart, or use server/cli/reset-password.js.'
    );
    return;
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    logger.error(
      { minLength: PASSWORD_MIN_LENGTH },
      `[bootstrap] INITIAL_ADMIN_PASSWORD too short (must be >= ${PASSWORD_MIN_LENGTH})`
    );
    throw new Error('INITIAL_ADMIN_PASSWORD too short');
  }

  const hash = await hashPassword(password);
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, 'admin', ?, ?)`
  ).run(username, hash, now, now);

  logger.info(
    { username },
    '[bootstrap] initial admin created (please change password on first login)'
  );
}
