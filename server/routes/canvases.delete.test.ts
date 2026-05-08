// DELETE /api/canvases/:id 路由层契约测试
//
// 锁定权限规则：
// - admin 软删 public 画布 → 200（同 v1.16.0 + 之前行为）
// - admin 软删 private 画布 → 200
// - private owner 软删自己的 private 画布 → 200
// - 普通用户软删别人的 private 画布 → 403 forbidden（canWrite() 拦下）
// - 普通用户软删 public 画布 → 403 forbidden_delete_public_canvas（v1.16.1 新增收紧）

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
import { canvasesRouter } from './canvases.ts';
import { hashPassword } from '../utils/password.ts';
import type { UserPublic } from '../types/user.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin' };
const ALICE: UserPublic = { id: 2, username: 'alice', role: 'user' };
const BOB: UserPublic = { id: 3, username: 'bob', role: 'user' };

let db: DatabaseType;
let server: Server;
let baseUrl: string;

function makeMinProject(activeSheetId = 'sheet1'): unknown {
  return {
    version: 2,
    id: 'proj1',
    name: 'Test Canvas',
    activeSheetId,
    sheets: [
      {
        id: activeSheetId,
        name: 'Sheet 1',
        nodes: [],
        connectors: [],
      },
    ],
  };
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  setDbForTesting(db);

  const fixedHash = await hashPassword('test_password_8plus');
  const userStmt = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  for (const u of [ADMIN, ALICE, BOB]) {
    userStmt.run(u.id, u.username, fixedHash, u.role, now, now);
  }

  const app: Express = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(canvasesRouter);
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

async function createPrivateCanvas(owner: UserPublic, name: string): Promise<number> {
  const res = await fetch(`${baseUrl}/api/canvases`, {
    method: 'POST',
    headers: jsonHeader(owner),
    body: JSON.stringify({ name, visibility: 'private', data: makeMinProject() }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { id: number };
  return body.id;
}

async function publishCanvas(id: number): Promise<void> {
  const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
    method: 'POST',
    headers: jsonHeader(ADMIN),
    body: JSON.stringify({ published_note: 'test' }),
  });
  assert.equal(res.status, 200);
}

describe('DELETE /api/canvases/:id 路由层权限契约', () => {
  it('1. admin 软删 public 画布 → 200', async () => {
    const id = await createPrivateCanvas(ALICE, 'p1');
    await publishCanvas(id);
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'DELETE',
      headers: authHeader(ADMIN),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it('2. admin 软删 private 画布 → 200', async () => {
    const id = await createPrivateCanvas(ALICE, 'p2');
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'DELETE',
      headers: authHeader(ADMIN),
    });
    assert.equal(res.status, 200);
  });

  it('3. private owner 软删自己的 private 画布 → 200', async () => {
    const id = await createPrivateCanvas(ALICE, 'p3');
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'DELETE',
      headers: authHeader(ALICE),
    });
    assert.equal(res.status, 200);
  });

  it('4. 普通用户软删别人的 private 画布 → 403 forbidden（canWrite 拦）', async () => {
    const id = await createPrivateCanvas(ALICE, 'p4');
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'DELETE',
      headers: authHeader(BOB),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden');
  });

  it('5. 普通用户软删 public 画布 → 403 forbidden_delete_public_canvas（v1.16.1 收紧）', async () => {
    const id = await createPrivateCanvas(ALICE, 'p5');
    await publishCanvas(id);
    // 普通用户对 public 画布 canWrite() = true（line 256）但 v1.16.1 加了第二层拦截
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'DELETE',
      headers: authHeader(ALICE),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string; message: string };
    assert.equal(body.error, 'forbidden_delete_public_canvas');
    assert.match(body.message, /管理员/);
  });

  it('6. 普通用户软删别人发布的 public 画布 → 403 forbidden_delete_public_canvas', async () => {
    // alice 创建 + admin 发布；bob 尝试软删（canWrite = true 因为 public，但被 v1.16.1 拦）
    const id = await createPrivateCanvas(ALICE, 'p6');
    await publishCanvas(id);
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'DELETE',
      headers: authHeader(BOB),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden_delete_public_canvas');
  });

  it('7. 不带 token → 401', async () => {
    const id = await createPrivateCanvas(ALICE, 'p7');
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 401);
  });

  it('8. 不存在 id → 404', async () => {
    const res = await fetch(`${baseUrl}/api/canvases/99999`, {
      method: 'DELETE',
      headers: authHeader(ADMIN),
    });
    assert.equal(res.status, 404);
  });

  it('9. 非法 id → 400', async () => {
    const res = await fetch(`${baseUrl}/api/canvases/abc`, {
      method: 'DELETE',
      headers: authHeader(ADMIN),
    });
    assert.equal(res.status, 400);
  });
});
