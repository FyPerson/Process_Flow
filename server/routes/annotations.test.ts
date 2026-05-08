// P3E-1 路由层集成测试（codex 02-审 medium 3）
//
// 测目标：锁定 GET/POST/PATCH 的鉴权 + 权限 + 错误码契约（service 单测覆盖不到）
// 不引 supertest；用原生 http + fetch + Express app 在 ephemeral port 上启动
//
// 覆盖（codex 推荐 4-6 项）：
// 1. 游客 GET=401（requireAuth）
// 2. 无权 GET=403 / POST=403（canRead）
// 3. POST content 空白=400（zod transform→trim 后 min 1）/ 超长=400（trim 前 max 2100 兜底）
// 4. POST 节点不存在=404
// 5. resolve 非作者非 creator=403
// 6. 跨私有画布 annotation id=403（防"知道 id 越权"）

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
import { annotationsRouter } from './annotations.ts';
import { createAnnotation } from '../services/annotations.ts';
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

beforeEach(async () => {
  // 内存 db + migration
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  setDbForTesting(db);

  // 用户
  const userStmt = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, '_test_hash_', ?, ?, ?)`,
  );
  const now = Date.now();
  for (const u of [ADMIN, ALICE, BOB, CAROL]) {
    userStmt.run(u.id, u.username, u.role, now, now);
  }

  // 启 Express app on ephemeral port
  const app: Express = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(annotationsRouter);
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

// =====================================================================
// fixture：建一个 public 画布 + 一个 private 画布（owner=ALICE，BOB 无权）
// =====================================================================
function seedCanvas(opts: {
  visibility: 'public' | 'private';
  ownerId: number | null;
  canvasCreatedBy: number;
  nodeCreatedBy: number;
  withN1?: boolean; // 默认 true；false 时只建空 sheet（用于测节点不存在）
}): number {
  const now = Date.now();
  const sheets = [
    {
      id: 's1',
      name: 'sheet 1',
      nodes: opts.withN1 === false
        ? []
        : [{
            id: 'n1', name: 'node 1', type: 'process',
            position: { x: 0, y: 0 }, size: { width: 100, height: 50 },
            expandable: false,
          }],
      connectors: [],
    },
  ];
  const data = {
    version: 2, id: 'p1', name: 'test', activeSheetId: 's1', sheets,
  };
  const result = db
    .prepare(
      `INSERT INTO canvases (name, description, visibility, is_public_to_guest, owner_id, data, version,
                              created_by, created_at, updated_by, updated_at, archived)
       VALUES ('test', NULL, ?, 0, ?, ?, 1, ?, ?, ?, ?, 0)`,
    )
    .run(opts.visibility, opts.ownerId, JSON.stringify(data), opts.canvasCreatedBy, now, opts.canvasCreatedBy, now);
  const canvasId = Number(result.lastInsertRowid);
  if (opts.withN1 !== false) {
    db.prepare(
      `INSERT INTO nodes_meta (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
                                is_deprecated, deprecated_by, deprecated_at)
       VALUES (?, 's1', 'n1', ?, ?, ?, ?, 0, NULL, NULL)`,
    ).run(canvasId, opts.nodeCreatedBy, now, opts.nodeCreatedBy, now);
  }
  return canvasId;
}

function authHeader(user: UserPublic): Record<string, string> {
  return { Authorization: `Bearer ${signToken(user)}` };
}

// =====================================================================
describe('P3E-1 路由层契约', () => {
  // -------- 1. 游客 GET=401 --------
  it('1. 游客 GET annotations → 401（取舍 4：游客不可见批注）', async () => {
    const canvasId = seedCanvas({
      visibility: 'public', ownerId: null,
      canvasCreatedBy: ADMIN.id, nodeCreatedBy: ADMIN.id,
    });
    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}/annotations`);
    assert.equal(res.status, 401);
  });

  // -------- 2a. 无权画布 GET=403 --------
  it('2a. BOB GET ALICE 的 private 画布 annotations → 403', async () => {
    const canvasId = seedCanvas({
      visibility: 'private', ownerId: ALICE.id,
      canvasCreatedBy: ALICE.id, nodeCreatedBy: ALICE.id,
    });
    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}/annotations`, {
      headers: authHeader(BOB),
    });
    assert.equal(res.status, 403);
  });

  // -------- 2b. 无权画布 POST=403 --------
  it('2b. BOB POST ALICE 的 private 画布 annotation → 403', async () => {
    const canvasId = seedCanvas({
      visibility: 'private', ownerId: ALICE.id,
      canvasCreatedBy: ALICE.id, nodeCreatedBy: ALICE.id,
    });
    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}/annotations`, {
      method: 'POST',
      headers: { ...authHeader(BOB), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId: 's1', nodeId: 'n1', content: 'hi' }),
    });
    assert.equal(res.status, 403);
  });

  // -------- 3a. POST content 仅空白=400 --------
  it('3a. POST content 仅空白 → 400 invalid_input（zod transform→trim 后 min 1）', async () => {
    const canvasId = seedCanvas({
      visibility: 'public', ownerId: null,
      canvasCreatedBy: ADMIN.id, nodeCreatedBy: ADMIN.id,
    });
    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}/annotations`, {
      method: 'POST',
      headers: { ...authHeader(ALICE), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId: 's1', nodeId: 'n1', content: '   \n\t  ' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'invalid_input');
  });

  // -------- 3b. POST 1999 字 + 前后空格（trim 后合法）=201（codex 02-审 medium 1 修法验证）--------
  it('3b. POST "  " + 1999 字 + "  " → 201（trim 后合法，medium 1 修法验证）', async () => {
    const canvasId = seedCanvas({
      visibility: 'public', ownerId: null,
      canvasCreatedBy: ADMIN.id, nodeCreatedBy: ADMIN.id,
    });
    const content = '  ' + 'x'.repeat(1999) + '  ';
    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}/annotations`, {
      method: 'POST',
      headers: { ...authHeader(ALICE), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId: 's1', nodeId: 'n1', content }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { annotation: { content: string } };
    // 服务端入库的 content 已经被 trim
    assert.equal(body.annotation.content.length, 1999);
    assert.equal(body.annotation.content.startsWith('x'), true);
  });

  // -------- 3c. POST content 超长（>2100 字符兜底）=400 --------
  it('3c. POST content 5000 字符 → 400（超过外层 max 兜底）', async () => {
    const canvasId = seedCanvas({
      visibility: 'public', ownerId: null,
      canvasCreatedBy: ADMIN.id, nodeCreatedBy: ADMIN.id,
    });
    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}/annotations`, {
      method: 'POST',
      headers: { ...authHeader(ALICE), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId: 's1', nodeId: 'n1', content: 'x'.repeat(5000) }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 4. POST 节点不存在=404 --------
  it('4. POST 节点不存在 → 404 node_not_found', async () => {
    const canvasId = seedCanvas({
      visibility: 'public', ownerId: null,
      canvasCreatedBy: ADMIN.id, nodeCreatedBy: ADMIN.id,
      withN1: false, // 空 sheet
    });
    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}/annotations`, {
      method: 'POST',
      headers: { ...authHeader(ALICE), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId: 's1', nodeId: 'ghost', content: 'hi' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'node_not_found');
  });

  // -------- 5. resolve 非作者非 creator=403 --------
  it('5. CAROL resolve 别人的批注（非作者非节点 creator 非 admin）→ 403', async () => {
    const canvasId = seedCanvas({
      visibility: 'public', ownerId: null,
      canvasCreatedBy: ADMIN.id, nodeCreatedBy: BOB.id, // node creator = BOB
    });
    const annotation = createAnnotation({
      canvasId, sheetId: 's1', nodeId: 'n1',
      authorId: ALICE.id, // author = ALICE
      content: 'discuss',
    });
    // CAROL 既不是作者也不是节点 creator 也不是 admin
    const res = await fetch(`${baseUrl}/api/annotations/${annotation.id}/resolve`, {
      method: 'PATCH',
      headers: authHeader(CAROL),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden_close_annotation');
  });

  // -------- 6. 跨私有画布 annotation id=403（防"知道 id 越权"）--------
  it('6. BOB 知道 ALICE 私有画布的 annotation id 也无法 resolve → 403', async () => {
    // ALICE 的 private 画布，节点 creator = ALICE，author = ALICE
    const canvasId = seedCanvas({
      visibility: 'private', ownerId: ALICE.id,
      canvasCreatedBy: ALICE.id, nodeCreatedBy: ALICE.id,
    });
    const annotation = createAnnotation({
      canvasId, sheetId: 's1', nodeId: 'n1',
      authorId: ALICE.id, content: 'private discussion',
    });
    // BOB 假设知道 annotation.id（比如从日志泄露）
    const res = await fetch(`${baseUrl}/api/annotations/${annotation.id}/resolve`, {
      method: 'PATCH',
      headers: authHeader(BOB),
    });
    // canRead 复核失败 → 403（不到 canCloseAnnotation 那一步）
    assert.equal(res.status, 403);
  });

  // -------- 路径参数攻击：非数字 id --------
  it('7. PATCH /api/annotations/abc/resolve → 400 invalid_id（PositiveIntegerIdSchema 兜底）', async () => {
    const res = await fetch(`${baseUrl}/api/annotations/abc/resolve`, {
      method: 'PATCH',
      headers: authHeader(ALICE),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'invalid_id');
  });
});
