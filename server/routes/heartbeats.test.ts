// P4A 路由层集成测试：心跳 API + 过期清理 + 活跃编辑者列表
//
// 测目标：锁定方案 §4.5 + 阶段 4 判断点 6 决策
// - 30s 上报 / 90s 过期 / 服务端单一时钟源 / 软删用户过滤 / canRead 权限 / 多 tab 去重
//
// 风格对齐 canvases.publish.test.ts（Express ephemeral port + ':memory:' DB + 复跑 migrations）
//
// 测试矩阵：
// 1. 未登录心跳 → 401
// 2. 心跳无效 cid（非整数）→ 400
// 3. 心跳不存在的画布 → 404
// 4. 没有 canRead 权限（private 非 owner / 非 admin）→ 403
// 5. owner 心跳自己 private 画布 → 200 + otherEditors=[]
// 6. admin 心跳任意画布 → 200
// 7. 多人同画布心跳 → otherEditors 列出除自己外的所有人
// 8. 90s 过期：last_seen_at < now-90s 不出现在 otherEditors（注入 db 直接造旧时间戳）
// 9. 心跳写入会顺手清理过期记录（DB 层面）
// 10. 同用户多次心跳：last_seen_at 被刷新（INSERT OR REPLACE）+ 不重复行
// 11. 软删用户的心跳不出现在 otherEditors（业务层 JOIN users 过滤）
// 12. 列出心跳排序：lastSeenAt DESC

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
import { heartbeatsRouter } from './heartbeats.ts';
import { hashPassword } from '../utils/password.ts';
import { HEARTBEAT_TTL_MS } from '../services/heartbeats.ts';
import type { UserPublic } from '../types/user.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin', nickname: 'fixture_nick' };
const ALICE: UserPublic = { id: 2, username: 'alice', role: 'user', nickname: 'fixture_nick' };
const BOB: UserPublic = { id: 3, username: 'bob', role: 'user', nickname: 'fixture_nick' };
const CAROL: UserPublic = { id: 4, username: 'carol', role: 'user', nickname: 'fixture_nick' };

let db: DatabaseType;
let server: Server;
let baseUrl: string;

function makeMinProject(activeSheetId = 'sheet1'): unknown {
  return {
    version: 2,
    id: 'proj1',
    name: 'Test Canvas',
    activeSheetId,
    sheets: [{ id: activeSheetId, name: 'Sheet 1', nodes: [], connectors: [] }],
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
  for (const u of [ADMIN, ALICE, BOB, CAROL]) {
    userStmt.run(u.id, u.username, fixedHash, u.role, now, now);
  }

  const app: Express = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(canvasesRouter);
  app.use(heartbeatsRouter);
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

async function createPrivateCanvas(owner: UserPublic = ALICE, name = 'p1'): Promise<number> {
  const res = await fetch(`${baseUrl}/api/canvases`, {
    method: 'POST',
    headers: jsonHeader(owner),
    body: JSON.stringify({ name, visibility: 'private', data: makeMinProject() }),
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { id: number }).id;
}

function postHeartbeat(user: UserPublic, cid: number): Promise<Response> {
  return fetch(`${baseUrl}/api/canvases/${cid}/heartbeat`, {
    method: 'POST',
    headers: jsonHeader(user),
    body: JSON.stringify({}),
  });
}

describe('P4A heartbeat 路由契约', () => {
  it('1. 未登录心跳 → 401', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });

  it('2. 无效 cid → 400', async () => {
    const res = await fetch(`${baseUrl}/api/canvases/abc/heartbeat`, {
      method: 'POST',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'invalid_id');
  });

  it('3. 不存在的画布 → 404', async () => {
    const res = await postHeartbeat(ALICE, 99999);
    assert.equal(res.status, 404);
  });

  it('4. 没有 canRead 权限（private 非 owner / 非 admin）→ 403', async () => {
    const cid = await createPrivateCanvas(ALICE);
    const res = await postHeartbeat(BOB, cid);
    assert.equal(res.status, 403);
  });

  it('5. owner 心跳自己 private 画布 → 200 + otherEditors=[]', async () => {
    const cid = await createPrivateCanvas(ALICE);
    const res = await postHeartbeat(ALICE, cid);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { otherEditors: unknown[] };
    assert.deepEqual(body.otherEditors, []);
  });

  it('6. admin 心跳任意 private 画布 → 200', async () => {
    const cid = await createPrivateCanvas(ALICE);
    const res = await postHeartbeat(ADMIN, cid);
    assert.equal(res.status, 200);
  });

  it('7. 多人心跳 → otherEditors 列出除自己外的所有人', async () => {
    // 给 ALICE owner private 画布加 BOB / CAROL 的 read 权限：直接 owner_id 改 admin 共享
    // 这里简化：用 admin 的画布（visibility=public 让所有登录都能 read）
    // 但 P3G 限制 POST 只能 private，admin 也不行。改方案：直接在 db 里建 public 画布
    const now = Date.now();
    const insertCanvas = db.prepare(
      `INSERT INTO canvases (id, name, visibility, is_public_to_guest, owner_id, data, version,
        created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const cid = 100;
    insertCanvas.run(cid, 'shared', 'public', 0, ADMIN.id, JSON.stringify(makeMinProject()), 1,
      ADMIN.id, now, ADMIN.id, now);

    // ADMIN 先心跳，再 ALICE 心跳：ALICE 应看到 ADMIN
    await postHeartbeat(ADMIN, cid);
    const res = await postHeartbeat(ALICE, cid);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { otherEditors: { userId: number; username: string }[] };
    assert.equal(body.otherEditors.length, 1);
    assert.equal(body.otherEditors[0].userId, ADMIN.id);
    assert.equal(body.otherEditors[0].username, 'admin');

    // BOB 心跳，应看到 ADMIN + ALICE
    const res2 = await postHeartbeat(BOB, cid);
    const body2 = (await res2.json()) as { otherEditors: { userId: number }[] };
    assert.equal(body2.otherEditors.length, 2);
    const ids = body2.otherEditors.map((e) => e.userId).sort();
    assert.deepEqual(ids, [ADMIN.id, ALICE.id]);
  });

  it('8. 90s 过期：last_seen_at < now-90s 不出现在 otherEditors', async () => {
    const cid = await createPrivateCanvas(ALICE);
    const tooOld = Date.now() - HEARTBEAT_TTL_MS - 1000;
    db.prepare(
      `INSERT INTO heartbeats (user_id, canvas_id, last_seen_at) VALUES (?, ?, ?)`,
    ).run(ADMIN.id, cid, tooOld);

    const res = await postHeartbeat(ALICE, cid);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { otherEditors: unknown[] };
    assert.deepEqual(body.otherEditors, [], '过期心跳不应出现在 otherEditors');
  });

  it('9. 心跳写入顺手清理过期记录（DB 层面）', async () => {
    const cid = await createPrivateCanvas(ALICE);
    const tooOld = Date.now() - HEARTBEAT_TTL_MS - 1000;
    db.prepare(
      `INSERT INTO heartbeats (user_id, canvas_id, last_seen_at) VALUES (?, ?, ?)`,
    ).run(ADMIN.id, cid, tooOld);

    await postHeartbeat(ALICE, cid);

    const stale = db
      .prepare(`SELECT COUNT(*) AS cnt FROM heartbeats WHERE last_seen_at < ?`)
      .get(Date.now() - HEARTBEAT_TTL_MS) as { cnt: number };
    assert.equal(stale.cnt, 0, '过期记录应被物理清理');

    const live = db
      .prepare(`SELECT COUNT(*) AS cnt FROM heartbeats`)
      .get() as { cnt: number };
    assert.equal(live.cnt, 1, '只剩 ALICE 当前心跳');
  });

  it('10. 同用户多次心跳：last_seen_at 刷新 + 主键不重复', async () => {
    const cid = await createPrivateCanvas(ALICE);
    await postHeartbeat(ALICE, cid);
    const before = db
      .prepare(`SELECT last_seen_at FROM heartbeats WHERE user_id=? AND canvas_id=?`)
      .get(ALICE.id, cid) as { last_seen_at: number };

    // 等几毫秒以确保时间戳能拉开
    await new Promise((r) => setTimeout(r, 10));
    await postHeartbeat(ALICE, cid);

    const rows = db
      .prepare(`SELECT last_seen_at FROM heartbeats WHERE user_id=? AND canvas_id=?`)
      .all(ALICE.id, cid) as { last_seen_at: number }[];
    assert.equal(rows.length, 1, '同用户同画布只有一条记录');
    assert.ok(rows[0].last_seen_at >= before.last_seen_at, 'last_seen_at 应被刷新');
  });

  it('11. 软删用户的心跳不出现在 otherEditors', async () => {
    const now = Date.now();
    const insertCanvas = db.prepare(
      `INSERT INTO canvases (id, name, visibility, is_public_to_guest, owner_id, data, version,
        created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const cid = 101;
    insertCanvas.run(cid, 'shared', 'public', 0, ADMIN.id, JSON.stringify(makeMinProject()), 1,
      ADMIN.id, now, ADMIN.id, now);

    await postHeartbeat(BOB, cid);
    // 软删 BOB
    db.prepare(`UPDATE users SET deleted_at=? WHERE id=?`).run(now, BOB.id);

    const res = await postHeartbeat(ALICE, cid);
    const body = (await res.json()) as { otherEditors: unknown[] };
    assert.deepEqual(body.otherEditors, [], '软删用户的心跳应被 JOIN 过滤');
  });

  it('12. otherEditors 排序：lastSeenAt DESC', async () => {
    const now = Date.now();
    const insertCanvas = db.prepare(
      `INSERT INTO canvases (id, name, visibility, is_public_to_guest, owner_id, data, version,
        created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const cid = 102;
    insertCanvas.run(cid, 'shared', 'public', 0, ADMIN.id, JSON.stringify(makeMinProject()), 1,
      ADMIN.id, now, ADMIN.id, now);

    // 直接造时间戳：ADMIN 比 BOB 旧，CAROL 最新
    db.prepare(`INSERT INTO heartbeats (user_id, canvas_id, last_seen_at) VALUES (?, ?, ?)`)
      .run(ADMIN.id, cid, now - 60_000);
    db.prepare(`INSERT INTO heartbeats (user_id, canvas_id, last_seen_at) VALUES (?, ?, ?)`)
      .run(BOB.id, cid, now - 30_000);
    db.prepare(`INSERT INTO heartbeats (user_id, canvas_id, last_seen_at) VALUES (?, ?, ?)`)
      .run(CAROL.id, cid, now - 5_000);

    const res = await postHeartbeat(ALICE, cid);
    const body = (await res.json()) as { otherEditors: { userId: number }[] };
    assert.deepEqual(
      body.otherEditors.map((e) => e.userId),
      [CAROL.id, BOB.id, ADMIN.id],
      '应按 lastSeenAt DESC 排序',
    );
  });
});
