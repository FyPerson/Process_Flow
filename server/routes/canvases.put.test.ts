// Day 4 F-15：PUT /api/canvases/:id 路由层 supertest 复测（#33 偿还）
//
// 偿还范围（详见 docs/规划/技术债务登记.md #33）：
// 1. DataIntegrityError → 500 + `data_integrity_error` JSON 序列化（catch 块第 312-314 行）
// 2. 真合并冲突 → 409 + conflicts 数组 JSON 序列化（第 283-290 行）
// 3. base_version_expired → 409 + currentVersion + message JSON 形状
// 4. 权限优先级 → 403 + forbidden_modify_others_node（403 先于 409）
//
// 当前可接受口径（详见 #33）：
// service 层 saveCanvas 端到端 7 case 已锁断言（canvases.merge.test.ts 阶段 C）；
// route 层 catch + JSON 序列化是"双重保险"——本测试直接复测 route 层 status code + body 形状。
// 切片设计审 M5 调整：F-16 服务层先于 F-15 路由层（依赖 F-16 错误形状已稳定）。

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
import type { MultiCanvasProjectInput } from '../schemas/canvas.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin', nickname: 'fixture_nick' };
const ALICE: UserPublic = { id: 2, username: 'alice', role: 'user', nickname: 'fixture_nick' };
const BOB: UserPublic = { id: 3, username: 'bob', role: 'user', nickname: 'fixture_nick' };

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

function jsonHeader(user: UserPublic): Record<string, string> {
  return {
    Authorization: `Bearer ${signToken(user)}`,
    'Content-Type': 'application/json',
  };
}

/** 与 canvases.merge.test.ts seedBaseCanvas 同款：1 sheet / 2 节点 / Alice 创建 */
function seedBaseCanvas(): { canvasId: number; baseData: MultiCanvasProjectInput } {
  const now = Date.now();
  const baseData: MultiCanvasProjectInput = {
    version: 2,
    id: 'p1',
    name: 'test',
    activeSheetId: 's1',
    sheets: [
      {
        id: 's1',
        name: 'sheet 1',
        nodes: [
          {
            id: 'n1',
            name: 'node 1',
            type: 'process',
            position: { x: 0, y: 0 },
            size: { width: 100, height: 50 },
            expandable: false,
          },
          {
            id: 'n2',
            name: 'node 2',
            type: 'process',
            position: { x: 200, y: 0 },
            size: { width: 100, height: 50 },
            expandable: false,
          },
        ],
        connectors: [],
      },
    ],
  };

  const result = db.prepare(
    `INSERT INTO canvases
       (name, description, visibility, is_public_to_guest, owner_id, data, version,
        created_by, created_at, updated_by, updated_at, archived)
     VALUES (?, ?, 'public', 0, NULL, ?, 1, ?, ?, ?, ?, 0)`,
  ).run('test', null, JSON.stringify(baseData), ALICE.id, now, ALICE.id, now);
  const canvasId = Number(result.lastInsertRowid);

  const insertMeta = db.prepare(
    `INSERT INTO nodes_meta
       (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
        is_deprecated, deprecated_by, deprecated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
  );
  insertMeta.run(canvasId, 's1', 'n1', ALICE.id, now, ALICE.id, now);
  insertMeta.run(canvasId, 's1', 'n2', ALICE.id, now, ALICE.id, now);

  db.prepare(
    `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
     VALUES (?, 1, ?, ?, ?)`,
  ).run(canvasId, JSON.stringify(baseData), ALICE.id, now);

  return { canvasId, baseData };
}

/** Alice 推 v=1 → v=2：改 n1.name */
async function aliceAdvanceToV2(canvasId: number, baseData: MultiCanvasProjectInput) {
  const aliceData: MultiCanvasProjectInput = {
    ...baseData,
    sheets: [
      {
        ...baseData.sheets[0],
        nodes: baseData.sheets[0].nodes.map((n) =>
          n.id === 'n1' ? { ...n, name: 'node 1 by alice' } : n,
        ),
      },
    ],
  };
  const res = await fetch(`${baseUrl}/api/canvases/${canvasId}`, {
    method: 'PUT',
    headers: jsonHeader(ALICE),
    body: JSON.stringify({ baseVersion: 1, data: aliceData }),
  });
  assert.equal(res.status, 200);
}

// =====================================================================
// F-15 case 1：DataIntegrityError → 500 + data_integrity_error
// =====================================================================

describe('F-15 case 1 — DataIntegrityError 500 + data_integrity_error JSON 序列化（#33 偿还）', () => {
  it('canvas_versions(currentVersion) 缺失 → PUT 返回 500 + body.error=data_integrity_error', async () => {
    const { canvasId, baseData } = seedBaseCanvas();
    await aliceAdvanceToV2(canvasId, baseData); // 推到 v=2

    // 制造脏数据：删 canvas_versions(v=2) → tryMerge 内 currentVersion 缺失抛 DataIntegrityError
    db.prepare('DELETE FROM canvas_versions WHERE canvas_id=? AND version=?').run(canvasId, 2);

    // Bob 基于 v=1 加新节点触发合并 → service 抛 → route catch 映射 500
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: [
            ...baseData.sheets[0].nodes,
            {
              id: 'n3',
              name: 'n3',
              type: 'process',
              position: { x: 400, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}`, {
      method: 'PUT',
      headers: jsonHeader(BOB),
      body: JSON.stringify({ baseVersion: 1, data: bobData }),
    });

    // 关键断言：route catch 块映射 500 + data_integrity_error（不是 save_failed）
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'data_integrity_error');
    assert.equal(typeof body.message, 'string');
    assert.ok(body.message.length > 0, 'message should be non-empty');
  });

  it('currentData 含 duplicate node id → 同款 500 + data_integrity_error', async () => {
    const { canvasId, baseData } = seedBaseCanvas();
    await aliceAdvanceToV2(canvasId, baseData);

    // 制造 currentData 损坏：直接 UPDATE canvases.data 注入 duplicate node id
    const dirtyData = {
      version: 2 as const,
      id: 'p1',
      name: 'test',
      activeSheetId: 's1',
      sheets: [
        {
          id: 's1',
          name: 'sheet 1',
          nodes: [
            { id: 'n1', name: 'a', type: 'process', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, expandable: false },
            { id: 'n1', name: 'b', type: 'process', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, expandable: false },
          ],
          connectors: [],
        },
      ],
    };
    db.prepare('UPDATE canvases SET data=? WHERE id=?').run(JSON.stringify(dirtyData), canvasId);

    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: [
            ...baseData.sheets[0].nodes,
            {
              id: 'n3',
              name: 'n3',
              type: 'process',
              position: { x: 400, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}`, {
      method: 'PUT',
      headers: jsonHeader(BOB),
      body: JSON.stringify({ baseVersion: 1, data: bobData }),
    });

    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'data_integrity_error');
  });
});

// =====================================================================
// F-15 case 2：真合并冲突 → 409 + conflicts JSON 序列化
// =====================================================================

describe('F-15 case 2 — 真合并冲突 409 + conflicts 数组 JSON 序列化（#33 偿还）', () => {
  it('Alice 改 n1.name + ADMIN 改 n1.name → 409 + body.conflicts 含 node_modified_both', async () => {
    const { canvasId, baseData } = seedBaseCanvas();
    await aliceAdvanceToV2(canvasId, baseData); // Alice 改 n1.name 推到 v=2

    // ADMIN 基于 v=1 也改 n1.name 不同值（admin 可改任意节点 → 进合并冲突）
    const adminData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: baseData.sheets[0].nodes.map((n) =>
            n.id === 'n1' ? { ...n, name: 'node 1 by admin' } : n,
          ),
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}`, {
      method: 'PUT',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ baseVersion: 1, data: adminData }),
    });

    // route 层映射：409 + error/currentVersion/message/conflicts
    assert.equal(res.status, 409);
    const body = (await res.json()) as {
      error: string;
      currentVersion: number;
      message: string;
      conflicts: Array<{ type: string; sheetId?: string; targetId?: string; field?: string; message?: string }>;
    };
    assert.equal(body.error, 'conflict');
    assert.equal(body.currentVersion, 2);
    assert.equal(typeof body.message, 'string');

    // 关键断言：conflicts 数组 JSON 序列化完整携带
    assert.ok(Array.isArray(body.conflicts), 'conflicts should be a JSON array');
    assert.ok(body.conflicts.length > 0, 'conflicts should be non-empty');
    const c = body.conflicts.find((x) => x.type === 'node_modified_both');
    assert.ok(c, `expected node_modified_both, got: ${JSON.stringify(body.conflicts)}`);
    assert.equal(c.sheetId, 's1');
    assert.equal(c.targetId, 'n1');
    assert.equal(c.field, 'name');
  });
});

// =====================================================================
// F-15 case 3：base_version_expired → 409 JSON 形状
// =====================================================================

describe('F-15 case 3 — base_version_expired 409 JSON 形状（#33 偿还）', () => {
  it('canvas_versions(baseVersion) 缺失 + Bob 推 v=1 → 409 + error=base_version_expired + currentVersion + message', async () => {
    const { canvasId, baseData } = seedBaseCanvas();
    await aliceAdvanceToV2(canvasId, baseData); // 推到 v=2

    // 删 canvas_versions(v=1) → 进合并路径但 base 快照缺失
    db.prepare('DELETE FROM canvas_versions WHERE canvas_id=? AND version=?').run(canvasId, 1);

    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: [
            ...baseData.sheets[0].nodes,
            {
              id: 'n3',
              name: 'n3',
              type: 'process',
              position: { x: 400, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}`, {
      method: 'PUT',
      headers: jsonHeader(BOB),
      body: JSON.stringify({ baseVersion: 1, data: bobData }),
    });

    assert.equal(res.status, 409);
    const body = (await res.json()) as {
      error: string;
      currentVersion: number;
      message: string;
      conflicts?: unknown;
    };
    assert.equal(body.error, 'base_version_expired');
    assert.equal(body.currentVersion, 2);
    assert.ok(body.message.includes('base version snapshot expired'));
    // base_version_expired 路径不携 conflicts（service 层不产）
    assert.equal(body.conflicts, undefined);
  });
});

// =====================================================================
// F-15 case 4：权限优先级 → 403 forbidden_modify_others_node 先于 409 conflict
// =====================================================================

describe('F-15 case 4 — 权限优先级 403 先于 409（#33 偿还）', () => {
  it('Bob 改 Alice 的 n1.name + Alice 也改 n1.name → 403 + forbidden_modify_others_node', async () => {
    const { canvasId, baseData } = seedBaseCanvas();
    await aliceAdvanceToV2(canvasId, baseData); // Alice 改 n1.name 推到 v=2

    // Bob 基于 v=1 改 Alice 创建的节点 n1.name → 403 不是 409
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: baseData.sheets[0].nodes.map((n) =>
            n.id === 'n1' ? { ...n, name: 'node 1 by bob' } : n,
          ),
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}`, {
      method: 'PUT',
      headers: jsonHeader(BOB),
      body: JSON.stringify({ baseVersion: 1, data: bobData }),
    });

    assert.equal(res.status, 403, 'permission check should run before merge conflict');
    const body = (await res.json()) as {
      error: string;
      message: string;
      currentVersion: number;
    };
    assert.equal(body.error, 'forbidden_modify_others_node');
    assert.equal(body.currentVersion, 2);
    assert.equal(typeof body.message, 'string');
  });
});

// =====================================================================
// F-15 case 5：merged=true 成功路径 → 200 + mergedData JSON 形状
// =====================================================================

describe('F-15 case 5 — merged=true 成功路径 200 JSON 形状', () => {
  it('Alice 改 n1.name + Bob 加 n3 → 200 + body.merged=true + mergedData/mergedFromVersion/report', async () => {
    const { canvasId, baseData } = seedBaseCanvas();
    await aliceAdvanceToV2(canvasId, baseData); // Alice 推 v=2

    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: [
            ...baseData.sheets[0].nodes,
            {
              id: 'n3',
              name: 'node 3 by bob',
              type: 'process',
              position: { x: 400, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/canvases/${canvasId}`, {
      method: 'PUT',
      headers: jsonHeader(BOB),
      body: JSON.stringify({ baseVersion: 1, data: bobData }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      version: number;
      merged: boolean;
      mergedData: { sheets: Array<{ id: string; nodes: Array<{ id: string }> }> };
      mergedFromVersion: number;
      report: { mergedFromUserId: number; mergedFromUsername: string; nodesAddedCount: number };
    };
    assert.equal(body.ok, true);
    assert.equal(body.merged, true);
    assert.equal(body.version, 3);
    assert.equal(body.mergedFromVersion, 2);

    // mergedData 含双方
    assert.ok(body.mergedData);
    const nodes = body.mergedData.sheets[0].nodes;
    assert.ok(nodes.find((n) => n.id === 'n1'));
    assert.ok(nodes.find((n) => n.id === 'n3'));

    // report 字段完整
    assert.equal(body.report.mergedFromUserId, ALICE.id);
    assert.equal(body.report.mergedFromUsername, ALICE.username);
    assert.equal(body.report.nodesAddedCount, 1);
  });
});
