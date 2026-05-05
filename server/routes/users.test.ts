// P3F-1 路由层集成测试
//
// 测目标：锁定 GET/POST/PATCH/DELETE 的鉴权 + 4 条产品规则的契约
// 不引 supertest；用原生 http + fetch + Express app 在 ephemeral port 上启动
// 风格对齐 annotations.test.ts（codex 02-审 medium 3 模式）
//
// 覆盖：
// 1.  游客 GET=401（requireAuth）
// 2.  普通用户 GET=403（requireAdmin）
// 3.  admin GET=200（含软删用户）
// 4.  POST 创建成功 201
// 5.  POST username 重复（未软删）=409 username_taken
// 6.  POST username 重复（已软删）=409 username_taken_soft_deleted（产品规则 #2）
// 7.  POST username 含空格 / 特殊字符 → 400 invalid_input
// 8.  POST password < 8 → 400
// 9.  POST role 非 user/admin → 400
// 10. PATCH 改 role 成功
// 11. PATCH 改密码成功（实际 hash 写入，verify 通过）
// 12. PATCH self_demote（admin 把自己 role 改 user）=409 self_demote_forbidden（产品规则 #1）
// 13. PATCH 空 body → 400
// 14. PATCH 不存在的 id → 404
// 15. PATCH 已软删 → 410
// 16. DELETE 自己 → 409 self_delete_forbidden
// 17. DELETE 成功（deleted_at 写入）
// 18. DELETE 已软删 → 410
// 19. DELETE 不存在 → 404
// 20. 普通用户 POST/PATCH/DELETE → 403（requireAdmin）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { setDbForTesting } from '../db/index.ts';
import { signToken } from '../middleware/auth.ts';
import { usersRouter } from './users.ts';
import { hashPassword, verifyPassword } from '../utils/password.ts';
import type { UserPublic } from '../types/user.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin' };
const ADMIN2: UserPublic = { id: 2, username: 'admin2', role: 'admin' };
const ALICE: UserPublic = { id: 3, username: 'alice', role: 'user' };

let db: DatabaseType;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  setDbForTesting(db);

  // 种子用户：固定密码 hash 一次复用避免每个 test 都跑 bcrypt
  const fixedHash = await hashPassword('test_password_8plus');
  const userStmt = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  for (const u of [ADMIN, ADMIN2, ALICE]) {
    userStmt.run(u.id, u.username, fixedHash, u.role, now, now);
  }

  const app: Express = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(usersRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  setDbForTesting(null);
  db.close();
});

function authHeader(user: UserPublic): Record<string, string> {
  return { Authorization: `Bearer ${signToken(user)}` };
}

function jsonHeader(user: UserPublic): Record<string, string> {
  return { ...authHeader(user), 'Content-Type': 'application/json' };
}

// =====================================================================
describe('P3F-1 用户管理路由契约', () => {
  // -------- 1. 游客 GET=401 --------
  it('1. 游客 GET /api/users → 401', async () => {
    const res = await fetch(`${baseUrl}/api/users`);
    assert.equal(res.status, 401);
  });

  // -------- 2. 普通用户 GET=403 --------
  it('2. 普通用户 GET /api/users → 403（requireAdmin）', async () => {
    const res = await fetch(`${baseUrl}/api/users`, { headers: authHeader(ALICE) });
    assert.equal(res.status, 403);
  });

  // -------- 3. admin GET=200 + 含软删 --------
  it('3. admin GET /api/users → 200，含软删用户', async () => {
    // 软删 ALICE
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), ALICE.id);
    const res = await fetch(`${baseUrl}/api/users`, { headers: authHeader(ADMIN) });
    assert.equal(res.status, 200);
    const body = await res.json() as { users: Array<{ id: number; deleted_at: number | null }> };
    assert.equal(body.users.length, 3);
    const alice = body.users.find((u) => u.id === ALICE.id);
    assert.ok(alice?.deleted_at !== null, 'soft-deleted alice should have deleted_at set');
  });

  // -------- 4. POST 创建成功 --------
  it('4. admin POST /api/users → 201', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ username: 'newuser', password: 'pwd_at_least_8', role: 'user' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { user: { id: number; username: string; role: string } };
    assert.equal(body.user.username, 'newuser');
    assert.equal(body.user.role, 'user');
  });

  // -------- 5. POST 重复 username（未软删） --------
  it('5. admin POST 已存在 username → 409 username_taken', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ username: 'alice', password: 'pwd_at_least_8', role: 'user' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string; message: string };
    assert.equal(body.error, 'conflict');
    assert.match(body.message, /already exists/);
  });

  // -------- 6. POST 重复 username（已软删，产品规则 #2 软删 username 不可重用） --------
  it('6. admin POST 已软删 username → 409 username_taken_soft_deleted（产品规则 #2）', async () => {
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), ALICE.id);
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ username: 'alice', password: 'pwd_at_least_8', role: 'user' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string; message: string };
    assert.match(body.message, /soft-deleted/);
  });

  // -------- 7. POST username 非法字符 --------
  it('7. POST username 含空格 → 400', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ username: 'has space', password: 'pwd_at_least_8', role: 'user' }),
    });
    assert.equal(res.status, 400);
  });

  it('7b. POST username 含 `:` → 400', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ username: 'a:b', password: 'pwd_at_least_8', role: 'user' }),
    });
    assert.equal(res.status, 400);
  });

  it('7c. POST username 含中文 → 201（应允许）', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ username: '张三', password: 'pwd_at_least_8', role: 'user' }),
    });
    assert.equal(res.status, 201);
  });

  // -------- 8. POST password < 8 --------
  it('8. POST password 7 字符 → 400', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ username: 'newuser', password: '1234567', role: 'user' }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 9. POST role 非法 --------
  it('9. POST role=superadmin → 400', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ username: 'newuser', password: 'pwd_at_least_8', role: 'superadmin' }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 10. PATCH 改 role --------
  it('10. PATCH 改 role user→admin → 200', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ALICE.id}`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { user: { role: string } };
    assert.equal(body.user.role, 'admin');
  });

  // -------- 11. PATCH 改密码（验证真 hash 写入） --------
  it('11. PATCH 改密码 → 200，verify 新密码通过', async () => {
    const newPassword = 'brand_new_pwd_xyz';
    const res = await fetch(`${baseUrl}/api/users/${ALICE.id}`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ password: newPassword }),
    });
    assert.equal(res.status, 200);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ALICE.id) as { password_hash: string };
    const ok = await verifyPassword(newPassword, row.password_hash);
    assert.ok(ok, 'new password should verify against stored hash');
  });

  // -------- 12. PATCH self_demote（产品规则 #1） --------
  it('12. admin PATCH 自己 role=user → 409 self_demote_forbidden（产品规则 #1）', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ADMIN.id}`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'self_demote_forbidden');
  });

  // -------- 12b. admin PATCH 自己 role=admin（noop）应允许（不命中 self_demote） --------
  it('12b. admin PATCH 自己 role=admin → 200（不是 demote 不拦）', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ADMIN.id}`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(res.status, 200);
  });

  // -------- 12c. ADMIN2 PATCH ADMIN role=user 应允许（不是自己） --------
  it('12c. admin PATCH 别的 admin role=user → 200（不是 self_demote）', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ADMIN.id}`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN2),
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(res.status, 200);
  });

  // -------- 13. PATCH 空 body --------
  it('13. PATCH 空 body → 400（refine：至少一字段）', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ALICE.id}`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  // -------- 14. PATCH 不存在 id --------
  it('14. PATCH 不存在 id → 404', async () => {
    const res = await fetch(`${baseUrl}/api/users/99999`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(res.status, 404);
  });

  // -------- 15. PATCH 已软删 → 410 --------
  it('15. PATCH 已软删用户 → 410', async () => {
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), ALICE.id);
    const res = await fetch(`${baseUrl}/api/users/${ALICE.id}`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(res.status, 410);
  });

  // -------- 16. DELETE 自己 --------
  it('16. admin DELETE 自己 → 409 self_delete_forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ADMIN.id}`, {
      method: 'DELETE',
      headers: authHeader(ADMIN),
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'self_delete_forbidden');
  });

  // -------- 17. DELETE 成功 --------
  it('17. admin DELETE 别人 → 200，deleted_at 写入', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ALICE.id}`, {
      method: 'DELETE',
      headers: authHeader(ADMIN),
    });
    assert.equal(res.status, 200);
    const row = db.prepare('SELECT deleted_at FROM users WHERE id = ?').get(ALICE.id) as { deleted_at: number | null };
    assert.ok(row.deleted_at !== null && row.deleted_at > 0, 'deleted_at should be set to a timestamp');
  });

  // -------- 18. DELETE 已软删 → 410 --------
  it('18. DELETE 已软删用户 → 410', async () => {
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), ALICE.id);
    const res = await fetch(`${baseUrl}/api/users/${ALICE.id}`, {
      method: 'DELETE',
      headers: authHeader(ADMIN),
    });
    assert.equal(res.status, 410);
  });

  // -------- 19. DELETE 不存在 --------
  it('19. DELETE 不存在 id → 404', async () => {
    const res = await fetch(`${baseUrl}/api/users/99999`, {
      method: 'DELETE',
      headers: authHeader(ADMIN),
    });
    assert.equal(res.status, 404);
  });

  // -------- 20. 普通用户 POST/PATCH/DELETE → 403 --------
  it('20a. 普通用户 POST → 403', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ username: 'x', password: 'pwd_at_least_8', role: 'user' }),
    });
    assert.equal(res.status, 403);
  });

  it('20b. 普通用户 PATCH → 403', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ADMIN.id}`, {
      method: 'PATCH',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(res.status, 403);
  });

  it('20c. 普通用户 DELETE → 403', async () => {
    const res = await fetch(`${baseUrl}/api/users/${ADMIN.id}`, {
      method: 'DELETE',
      headers: authHeader(ALICE),
    });
    assert.equal(res.status, 403);
  });

  // -------- 21. requireFreshAdmin：旧 admin token 被降权后访问 → 401 --------
  // codex P3F-1 一审 high 1 修法验证：JWT 内 role 是签发时快照，DB 实际降权后旧 token 必须失效
  it('21a. ADMIN 被降为 user 后，旧 admin token GET → 401（DB 当前态拒）', async () => {
    // 先签 ADMIN 的 token（此时 DB role=admin）
    const oldToken = signToken(ADMIN);
    // ADMIN2 把 ADMIN 降为 user（直接写 DB 模拟另一 admin 操作）
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('user', ADMIN.id);
    // 旧 token 仍是 role=admin payload，但 DB 已 role=user
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${oldToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden');
  });

  it('21b. ADMIN 被软删后，旧 admin token GET → 401', async () => {
    const oldToken = signToken(ADMIN);
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), ADMIN.id);
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${oldToken}` },
    });
    assert.equal(res.status, 401);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'unauthorized');
  });

  it('21c. ADMIN 被软删后，旧 admin token PATCH/DELETE 也都拒（4 端点统一）', async () => {
    const oldToken = signToken(ADMIN);
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), ADMIN.id);
    // PATCH
    const r1 = await fetch(`${baseUrl}/api/users/${ALICE.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${oldToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(r1.status, 401);
    // DELETE
    const r2 = await fetch(`${baseUrl}/api/users/${ALICE.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${oldToken}` },
    });
    assert.equal(r2.status, 401);
    // POST
    const r3 = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${oldToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newone', password: 'pwd_at_least_8', role: 'user' }),
    });
    assert.equal(r3.status, 401);
  });

  // -------- 22. createUser 并发竞态：catch SqliteError UNIQUE 分支 --------
  // codex P3F-1 一审 medium 2 修法验证：findUserByUsername + INSERT 之间无原子事务，
  // 极端并发下 INSERT 可能抛 SqliteError UNIQUE，service 层用 try/catch 兜底回查映射 409。
  //
  // 不写运行时测试的原因：
  // 1. ESM 导出是只读绑定，无法 monkey-patch findUserByUsername 让它"漏检"
  // 2. better-sqlite3 是同步 API，单进程内无法真并发
  // 3. 多 sqlite 连接也只能模拟 BUSY，不能稳定模拟 UNIQUE race
  //
  // 修法的正确性靠 code review：services/users.ts:90-112 显式 catch SQLITE_CONSTRAINT_UNIQUE
  // 后回查 findUserByUsername 区分软删状态返 409。本路径在内部 5 人项目场景下几乎无触发概率，
  // 留此注释以记录"为什么这条 medium 修了但没单测"。
});
