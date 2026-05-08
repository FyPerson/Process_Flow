// P4B 路由层集成测试：草稿 GET/PUT/DELETE + 配额 + 大小限制 + canRead 权限
//
// 测目标：判断点 7（配额 200 / 拒写 / 错误码）+ 隐含约束 A（2MB / 413）
//
// 测试矩阵：
// 1. 未登录 GET → 401
// 2. 未登录 PUT → 401
// 3. 未登录 DELETE → 401
// 4. GET 不存在画布 → 404 (canvas not found)
// 5. GET 没权限的画布 → 403
// 6. PUT 没权限的画布 → 403
// 7. GET 没草稿 → 404 (no_draft)
// 8. PUT 新建草稿 → 200 + savedAt + GET 返回
// 9. PUT 覆盖草稿 → 同 user_id+canvas_id 只 1 行 + base_version/saved_at 更新
// 10. PUT data 不是字符串 → 400
// 11. PUT 缺 baseVersion → 400
// 12. PUT data 超过 2MB → 413 + error="draft_too_large"
// 13. 用户已有 200 草稿 → PUT 第 201 个画布草稿返 429（覆盖现有不计入）
// 14. PUT 覆盖现有草稿不受配额限制（即使 cnt >= 200，覆盖第 200 个仍 ok）
// 15. DELETE 草稿存在 → ok=true + 后续 GET 404
// 16. DELETE 不存在草稿 → 幂等返回 ok=true
// 17. 草稿大小恰好 2MB（边界 = 限制） → 413（严格 > 拒，等于也拒）
//      实际方案是 > 上限拒；2MB 整 = 不拒。本测试改成 2MB+1 字节验证拒
// 18. 不同用户 GET 同画布 → 各自独立草稿（不串号）

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
import { draftsRouter } from './drafts.ts';
import { hashPassword } from '../utils/password.ts';
import { DRAFT_QUOTA_PER_USER } from '../services/drafts.ts';
import type { UserPublic } from '../types/user.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin', nickname: 'fixture_nick' };
const ALICE: UserPublic = { id: 2, username: 'alice', role: 'user', nickname: 'fixture_nick' };
const BOB: UserPublic = { id: 3, username: 'bob', role: 'user', nickname: 'fixture_nick' };

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
  for (const u of [ADMIN, ALICE, BOB]) {
    userStmt.run(u.id, u.username, fixedHash, u.role, now, now);
  }

  const app: Express = express();
  // 测试用 4MB limit 让"2MB 超限"测试能跑（service 层会拒，express.json 不能先拦）
  app.use(express.json({ limit: '4mb' }));
  app.use(canvasesRouter);
  app.use(draftsRouter);
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

const SAMPLE_DRAFT_DATA = JSON.stringify({ sheets: [{ id: 's1', nodes: [], connectors: [] }] });

describe('P4B drafts 路由契约', () => {
  it('1. 未登录 GET → 401', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`);
    assert.equal(res.status, 401);
  });

  it('2. 未登录 PUT → 401', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: SAMPLE_DRAFT_DATA, baseVersion: 1 }),
    });
    assert.equal(res.status, 401);
  });

  it('3. 未登录 DELETE → 401', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, { method: 'DELETE' });
    assert.equal(res.status, 401);
  });

  it('4. GET 不存在画布 → 404', async () => {
    const res = await fetch(`${baseUrl}/api/canvases/99999/draft`, {
      headers: authHeader(ALICE),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'not_found');
  });

  it('5. GET 没权限的画布 → 403', async () => {
    const cid = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      headers: authHeader(BOB),
    });
    assert.equal(res.status, 403);
  });

  it('6. PUT 没权限的画布 → 403', async () => {
    const cid = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(BOB),
      body: JSON.stringify({ data: SAMPLE_DRAFT_DATA, baseVersion: 1 }),
    });
    assert.equal(res.status, 403);
  });

  it('7. GET 没草稿 → 404 (no_draft)', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      headers: authHeader(ALICE),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'no_draft');
  });

  it('8. PUT 新建草稿 → 200 + GET 返回', async () => {
    const cid = await createPrivateCanvas();
    const putRes = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: SAMPLE_DRAFT_DATA, baseVersion: 1 }),
    });
    assert.equal(putRes.status, 200);
    const putBody = (await putRes.json()) as { ok: boolean; savedAt: number };
    assert.ok(putBody.ok);
    assert.ok(typeof putBody.savedAt === 'number');

    const getRes = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      headers: authHeader(ALICE),
    });
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as { draft: { data: string; baseVersion: number; savedAt: number } };
    assert.equal(getBody.draft.data, SAMPLE_DRAFT_DATA);
    assert.equal(getBody.draft.baseVersion, 1);
  });

  it('9. PUT 覆盖草稿 → 同主键只 1 行 + 字段更新', async () => {
    const cid = await createPrivateCanvas();
    await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: SAMPLE_DRAFT_DATA, baseVersion: 1 }),
    });
    await new Promise((r) => setTimeout(r, 5));
    const newData = JSON.stringify({ sheets: [{ id: 's2' }] });
    await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: newData, baseVersion: 2 }),
    });

    const cnt = db.prepare(`SELECT COUNT(*) AS cnt FROM drafts`).get() as { cnt: number };
    assert.equal(cnt.cnt, 1, '同主键 upsert 应只有 1 行');

    const getRes = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      headers: authHeader(ALICE),
    });
    const getBody = (await getRes.json()) as { draft: { data: string; baseVersion: number } };
    assert.equal(getBody.draft.data, newData);
    assert.equal(getBody.draft.baseVersion, 2);
  });

  it('10. PUT data 不是字符串 → 400', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: { foo: 'bar' }, baseVersion: 1 }),
    });
    assert.equal(res.status, 400);
  });

  it('11. PUT 缺 baseVersion → 400', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: SAMPLE_DRAFT_DATA }),
    });
    assert.equal(res.status, 400);
  });

  it('12. PUT data 超过 2MB → 413 + error="draft_too_large"', async () => {
    const cid = await createPrivateCanvas();
    // 2MB + 1 字节 ASCII；service 层 Buffer.byteLength = 字符长度
    const overLimit = 'a'.repeat(2 * 1024 * 1024 + 1);
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: overLimit, baseVersion: 1 }),
    });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'draft_too_large');
  });

  it('13. 用户 200 个草稿 → 第 201 个 PUT 返 429', async () => {
    // 直接 INSERT 200 个画布 + 200 个 ALICE 草稿
    const insertCanvas = db.prepare(
      `INSERT INTO canvases (id, name, visibility, is_public_to_guest, owner_id, data, version,
        created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertDraft = db.prepare(
      `INSERT INTO drafts (user_id, canvas_id, data, base_version, saved_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (let i = 1; i <= DRAFT_QUOTA_PER_USER; i++) {
      insertCanvas.run(
        i + 100,
        `c${i}`,
        'private',
        0,
        ALICE.id,
        JSON.stringify(makeMinProject()),
        1,
        ALICE.id,
        now,
        ALICE.id,
        now,
      );
      insertDraft.run(ALICE.id, i + 100, SAMPLE_DRAFT_DATA, 1, now + i);
    }
    // 第 201 个画布
    const newCid = await createPrivateCanvas(ALICE, 'overflow');
    const res = await fetch(`${baseUrl}/api/canvases/${newCid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: SAMPLE_DRAFT_DATA, baseVersion: 1 }),
    });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'draft_quota_exceeded');
  });

  it('14. PUT 覆盖现有草稿不受配额限制', async () => {
    // 200 个草稿 + 覆盖第 1 个
    const insertCanvas = db.prepare(
      `INSERT INTO canvases (id, name, visibility, is_public_to_guest, owner_id, data, version,
        created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertDraft = db.prepare(
      `INSERT INTO drafts (user_id, canvas_id, data, base_version, saved_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (let i = 1; i <= DRAFT_QUOTA_PER_USER; i++) {
      insertCanvas.run(
        i + 200,
        `c${i}`,
        'private',
        0,
        ALICE.id,
        JSON.stringify(makeMinProject()),
        1,
        ALICE.id,
        now,
        ALICE.id,
        now,
      );
      insertDraft.run(ALICE.id, i + 200, SAMPLE_DRAFT_DATA, 1, now + i);
    }
    // 覆盖第一个画布的草稿（同主键）
    const res = await fetch(`${baseUrl}/api/canvases/201/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: JSON.stringify({ updated: true }), baseVersion: 2 }),
    });
    assert.equal(res.status, 200);
  });

  it('15. DELETE 草稿存在 → ok + 后续 GET 404', async () => {
    const cid = await createPrivateCanvas();
    await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: SAMPLE_DRAFT_DATA, baseVersion: 1 }),
    });
    const delRes = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'DELETE',
      headers: authHeader(ALICE),
    });
    assert.equal(delRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      headers: authHeader(ALICE),
    });
    assert.equal(getRes.status, 404);
  });

  it('16. DELETE 不存在草稿 → 幂等 ok', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'DELETE',
      headers: authHeader(ALICE),
    });
    assert.equal(res.status, 200);
  });

  it('17b. PUT data 非合法 JSON → 400 draft_corrupted（codex P4 二审 #8）', async () => {
    const cid = await createPrivateCanvas();
    const res = await fetch(`${baseUrl}/api/canvases/${cid}/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: 'not-a-json-{', baseVersion: 1 }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'draft_corrupted');
  });

  it('17. 不同用户对同画布草稿独立', async () => {
    // ALICE 和 admin 都对 ADMIN 的 public 画布存草稿（ADMIN canRead 通过 admin / ALICE 通过 public）
    // 但 POST visibility=public 被拒，所以直接 db 造一个 public 画布
    const now = Date.now();
    db.prepare(
      `INSERT INTO canvases (id, name, visibility, is_public_to_guest, owner_id, data, version,
        created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(500, 'shared', 'public', 0, ADMIN.id, JSON.stringify(makeMinProject()), 1,
      ADMIN.id, now, ADMIN.id, now);

    const aliceData = JSON.stringify({ owner: 'alice' });
    const adminData = JSON.stringify({ owner: 'admin' });
    await fetch(`${baseUrl}/api/canvases/500/draft`, {
      method: 'PUT',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ data: aliceData, baseVersion: 1 }),
    });
    await fetch(`${baseUrl}/api/canvases/500/draft`, {
      method: 'PUT',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ data: adminData, baseVersion: 1 }),
    });

    const aliceRes = await fetch(`${baseUrl}/api/canvases/500/draft`, {
      headers: authHeader(ALICE),
    });
    const adminRes = await fetch(`${baseUrl}/api/canvases/500/draft`, {
      headers: authHeader(ADMIN),
    });
    const aliceBody = (await aliceRes.json()) as { draft: { data: string } };
    const adminBody = (await adminRes.json()) as { draft: { data: string } };
    assert.equal(aliceBody.draft.data, aliceData);
    assert.equal(adminBody.draft.data, adminData);
  });
});
