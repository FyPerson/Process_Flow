// CLI 工具：批量创建种子用户（调研窗口期 / 启动初期 / P3F admin UI 落地前临时入口）
// 用法（在 E:\business-flow 目录下）：
//   tsx server/cli/seed-users.ts <username1> <username2> ...
//   tsx server/cli/seed-users.ts <username1>:admin <username2>:user ...
//
// - 用户名后缀 `:admin` 指定角色为 admin；不带后缀 / `:user` 默认 user
// - 每个用户生成 16 字符 base64url 强密码，stdout 打印明文一次，自行复制到内部凭据档
// - 已存在的用户名会被跳过（不覆盖现有 hash）
// - 这是 server 端工具，不走 HTTP，绕过限流和登录态

import crypto from 'node:crypto';
import { closeDb, initDb } from '../db/index.ts';
import { hashPassword } from '../utils/password.ts';

type Role = 'user' | 'admin';

interface SeedSpec {
  username: string;
  role: Role;
}

function randomPassword(): string {
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

function parseSpec(arg: string): SeedSpec {
  const [username, roleRaw] = arg.split(':');
  if (!username) {
    throw new Error(`invalid spec "${arg}": empty username`);
  }
  const role: Role = roleRaw === 'admin' ? 'admin' : 'user';
  return { username, role };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: tsx server/cli/seed-users.ts <username>[:role] [...]');
    console.error('  role: "user" (default) or "admin"');
    console.error('Example: tsx server/cli/seed-users.ts user01 user02:admin user03');
    process.exit(2);
  }

  const specs = args.map(parseSpec);

  const db = initDb();
  const now = Date.now();
  const created: Array<{ username: string; role: Role; password: string }> = [];
  const skipped: string[] = [];

  try {
    const checkStmt = db.prepare('SELECT id FROM users WHERE username = ?');
    const insertStmt = db.prepare(
      `INSERT INTO users (username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const spec of specs) {
      const existing = checkStmt.get(spec.username);
      if (existing) {
        skipped.push(spec.username);
        continue;
      }
      const password = randomPassword();
      const hash = await hashPassword(password);
      insertStmt.run(spec.username, hash, spec.role, now, now);
      created.push({ username: spec.username, role: spec.role, password });
    }
  } finally {
    closeDb();
  }

  console.log('');
  console.log('=== seed-users result ===');
  console.log(`created: ${created.length} / skipped: ${skipped.length}`);
  console.log('');

  if (created.length > 0) {
    console.log('| username | role  | password         |');
    console.log('|----------|-------|------------------|');
    for (const u of created) {
      console.log(`| ${u.username.padEnd(8)} | ${u.role.padEnd(5)} | ${u.password} |`);
    }
    console.log('');
    console.log('(copy the table above into 内部凭据.md; passwords printed only once)');
  }

  if (skipped.length > 0) {
    console.log(`skipped (username already exists): ${skipped.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('seed-users failed:', err);
  closeDb();
  process.exit(1);
});
