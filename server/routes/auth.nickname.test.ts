// 用户自助改昵称 + GET/me 实时取 nickname 测试 — 2026-05-08 用户需求
//
// 覆盖：
// 1.  GET /api/auth/me 返回 nickname（无 nickname 时 fallback 到 username）
// 2.  GET /api/auth/me 反映 DB 最新 nickname（不依赖 JWT 缓存）
// 3.  PATCH /api/auth/me 自助改 nickname → 200 + DB 写入
// 4.  PATCH /api/auth/me 改完后 GET /me 反映新值
// 5.  PATCH /api/auth/me 不传 nickname → 400
// 6.  PATCH /api/auth/me trim 后空字符串 → 400
// 7.  PATCH /api/auth/me > 30 字符 → 400
// 8.  PATCH /api/auth/me 软删用户用旧 token → 401
// 9.  PATCH /api/auth/me 无 token → 401
// 10. PATCH /api/auth/me 不允许改 role / password（strict schema）

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
import { authRouter } from './auth.ts';
import { hashPassword } from '../utils/password.ts';
import type { UserPublic } from '../types/user.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin', nickname: 'fixture_nick' };
const ALICE: UserPublic = { id: 2, username: 'alice', role: 'user', nickname: 'fixture_nick' };

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

  // 种子 ADMIN（无 nickname → 默认 ''） + ALICE（nickname='艾莉丝'）
  const fixedHash = await hashPassword('test_password_8plus');
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, nickname, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(ADMIN.id, ADMIN.username, fixedHash, ADMIN.role, '', now, now);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, nickname, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(ALICE.id, ALICE.username, fixedHash, ALICE.role, '艾莉丝', now, now);

  const app: Express = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(authRouter);
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

describe('用户自助改昵称 + me 实时 nickname', () => {
  // -------- 1. GET /me 空 nickname fallback to username --------
  it('1. GET /api/auth/me 空 nickname fallback 到 username', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(ADMIN) });
    assert.equal(res.status, 200);
    const body = await res.json() as { user: { nickname: string } };
    assert.equal(body.user.nickname, 'admin');
  });

  // -------- 2. GET /me 反映 DB 最新 nickname（不依赖 JWT 内 fallback）--------
  it('2. GET /api/auth/me 实时查库取 nickname', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(ALICE) });
    assert.equal(res.status, 200);
    const body = await res.json() as { user: { nickname: string } };
    assert.equal(body.user.nickname, '艾莉丝');
  });

  // -------- 3. PATCH /me 自助改 nickname → 200 + DB 写入 --------
  it('3. PATCH /api/auth/me 改 nickname → 200', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ nickname: '管理员' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { user: { id: number; nickname: string } };
    assert.equal(body.user.nickname, '管理员');
    const row = db.prepare('SELECT nickname FROM users WHERE id = ?').get(ADMIN.id) as { nickname: string };
    assert.equal(row.nickname, '管理员');
  });

  // -------- 4. PATCH 后 GET /me 反映新值 --------
  it('4. PATCH /me 后 GET /me 反映新 nickname', async () => {
    await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ nickname: 'New Alice' }),
    });
    const res = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(ALICE) });
    const body = await res.json() as { user: { nickname: string } };
    assert.equal(body.user.nickname, 'New Alice');
  });

  // -------- 5. PATCH 不传 nickname → 400 --------
  it('5. PATCH /me 不传任何字段 → 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  // -------- 6. PATCH nickname trim 后空 → 400 --------
  it('6. PATCH /me nickname 全空格 → 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ nickname: '   ' }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 7. PATCH nickname > 30 字符 → 400 --------
  it('7. PATCH /me nickname > 30 字符 → 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ nickname: '昵'.repeat(31) }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 8. 软删用户旧 token → 401 --------
  it('8. PATCH /me 软删用户旧 token → 401', async () => {
    const oldToken = signToken(ALICE);
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), ALICE.id);
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${oldToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '过期' }),
    });
    assert.equal(res.status, 401);
  });

  // -------- 9. 无 token → 401 --------
  it('9. PATCH /me 无 token → 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '匿名' }),
    });
    assert.equal(res.status, 401);
  });

  // -------- 10. strict schema 拒绝 role / password --------
  it('10. PATCH /me 传 role / password 字段 → 400（strict schema 拒绝）', async () => {
    // 传 role
    const r1 = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ nickname: 'ok', role: 'admin' }),
    });
    assert.equal(r1.status, 400);
    // 传 password
    const r2 = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ nickname: 'ok', password: 'try_to_change_pwd' }),
    });
    assert.equal(r2.status, 400);
    // DB role 没变
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(ALICE.id) as { role: string };
    assert.equal(row.role, 'user');
  });
});
