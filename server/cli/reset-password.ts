// CLI 工具：重置某个用户的密码（管理员忘密码 / 用户被锁）
// 用法（在 E:\business-flow 目录下）：
//   tsx server/cli/reset-password.ts <username> [<newPassword>]
//
// 不传 newPassword 时会生成随机 16 字符强密码并打印（用完请尽快改）
// 这是 server 端工具，不走 HTTP，绕过限流和登录态

import crypto from 'node:crypto';
import { closeDb, initDb } from '../db/index.ts';
import type { UserRow } from '../types/user.ts';
import { hashPassword, PASSWORD_MIN_LENGTH } from '../utils/password.ts';

function randomPassword(): string {
  // 16 字符 base64url（去掉容易看错的 + / =）
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

async function main() {
  const [username, providedPassword] = process.argv.slice(2);
  if (!username) {
    console.error('Usage: tsx server/cli/reset-password.ts <username> [<newPassword>]');
    process.exit(2);
  }

  const password = providedPassword ?? randomPassword();
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    process.exit(2);
  }

  const db = initDb();
  try {
    const row = db
      .prepare(
        `SELECT id, username, password_hash, role, created_at, updated_at, deleted_at
         FROM users WHERE username = ?`
      )
      .get(username) as UserRow | undefined;

    if (!row) {
      console.error(`user "${username}" not found`);
      process.exit(1);
    }

    const hash = await hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hash,
      Date.now(),
      row.id
    );

    console.log(`password reset for user "${username}"`);
    if (!providedPassword) {
      console.log(`new password: ${password}`);
      console.log('(please change after first login)');
    }
  } finally {
    closeDb();
  }
}

main().catch((err) => {
  console.error('reset-password failed:', err);
  closeDb();
  process.exit(1);
});
