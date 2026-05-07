// 阶段 5 Day 2 阶段 C：saveCanvas 接合并算法端到端验收测试
//
// 验收清单（codex 阶段 C 取舍审 10-阶段C-取舍审-saveCanvas接合并.md "阶段 C 验收清单" 段）：
// 1. DataIntegrityError 端到端映射验证（route 层 500 + 'data_integrity_error' 不退化为 save_failed）
// 2. 三种合并结果端到端：真合并成功 / 真冲突 / active_sheet_missing 透传
// 3. 权限优先级：403 越权先于 409 合并冲突（codex medium 风险吸收）
// 4. mergedFromUserId/Username 取自 canvas_versions.saved_by 不是 canvases.updated_by（codex 修订 #2 #3）
//
// 测试结构沿用 canvases.removed.test.ts：内存 db + migration + setDbForTesting

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

import { setDbForTesting } from '../db/index.ts';
import { saveCanvas, patchCanvasMeta } from './canvases.ts';
import type { UserPublic } from '../types/user.ts';
import type { MultiCanvasProjectInput } from '../schemas/canvas.ts';
import { DataIntegrityError } from './merge/computeDelta.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

let db: DatabaseType;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
  setDbForTesting(db);
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

// =====================================================================
// Fixtures
// =====================================================================

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin' };
const ALICE: UserPublic = { id: 2, username: 'alice', role: 'user' };
const BOB: UserPublic = { id: 3, username: 'bob', role: 'user' };

function seedUsers() {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, '_test_hash_', ?, ?, ?)`,
  );
  stmt.run(ADMIN.id, ADMIN.username, ADMIN.role, now, now);
  stmt.run(ALICE.id, ALICE.username, ALICE.role, now, now);
  stmt.run(BOB.id, BOB.username, BOB.role, now, now);
}

/** 构造 base 画布：1 sheet / 2 节点 / Alice 创建 + 创建节点
 *
 *  返回 v=1 的 baseData；测试随后用 saveCanvas 推到 v=2 模拟"A 已保存"
 *  阶段 C 合并路径需要 baseVersion=1 + 当前 version=2
 */
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

  // 写 nodes_meta（Alice 创建两个节点）
  const insertMeta = db.prepare(
    `INSERT INTO nodes_meta
       (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
        is_deprecated, deprecated_by, deprecated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
  );
  insertMeta.run(canvasId, 's1', 'n1', ALICE.id, now, ALICE.id, now);
  insertMeta.run(canvasId, 's1', 'n2', ALICE.id, now, ALICE.id, now);

  // canvas_versions v=1 saved_by=Alice
  db.prepare(
    `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
     VALUES (?, 1, ?, ?, ?)`,
  ).run(canvasId, JSON.stringify(baseData), ALICE.id, now);

  return { canvasId, baseData };
}

/** Alice 把 v=1 推到 v=2：改 n1.name → 'node 1 by alice' */
function aliceAdvanceToV2(
  canvasId: number,
  baseData: MultiCanvasProjectInput,
): MultiCanvasProjectInput {
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
  const r = saveCanvas({
    id: canvasId,
    baseVersion: 1,
    data: aliceData,
    user: ALICE,
  });
  assert.equal(r.ok, true, `alice v1→v2 should succeed: ${JSON.stringify(r)}`);
  return aliceData;
}

// =====================================================================
// 阶段 C 验收清单
// =====================================================================

describe('阶段 C - 真合并成功（Alice 改自己 n1 + Bob 加自己新节点 n3）', () => {
  it('Alice 推到 v=2 改 n1.name；Bob 基于 v=1 加 n3 → ok:true / merged:true / mergedData 含双方', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas();
    aliceAdvanceToV2(canvasId, baseData); // Alice 推到 v=2

    // Bob 基于 v=1 添加新节点 n3（自己创建，不触发 forbidden_modify_others_node）
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

    const result = saveCanvas({
      id: canvasId,
      baseVersion: 1,
      data: bobData,
      user: BOB,
    });

    assert.equal(result.ok, true);
    if (result.ok === true && result.merged) {
      assert.equal(result.version, 3);
      assert.equal(result.mergedFromVersion, 2);
      // mergedData 应同时含 Alice 改的 n1.name 和 Bob 加的 n3
      const mergedSheets = result.mergedData.sheets;
      const n1 = mergedSheets[0].nodes.find((n) => (n as { id: string }).id === 'n1');
      const n3 = mergedSheets[0].nodes.find((n) => (n as { id: string }).id === 'n3');
      assert.equal((n1 as { name: string }).name, 'node 1 by alice');
      assert.ok(n3, 'expected n3 in merged');
      assert.equal((n3 as { name: string }).name, 'node 3 by bob');
      // mergedFromUserId 必须是 Alice（v=2 的 saved_by）
      assert.equal(result.report.mergedFromUserId, ALICE.id);
      assert.equal(result.report.mergedFromUsername, ALICE.username);
      assert.equal(result.report.mergedFromVersion, 2);
      // report 计数：Bob 加了 1 个节点
      assert.equal(result.report.nodesAddedCount, 1);
      assert.equal(result.report.nodesModifiedCount, 0);
    } else {
      assert.fail(`expected merged ok, got: ${JSON.stringify(result)}`);
    }

    // 主表持久化与返回的 mergedData 一致
    const dbRow = db.prepare('SELECT data, version FROM canvases WHERE id=?').get(canvasId) as
      | { data: string; version: number }
      | undefined;
    assert.ok(dbRow);
    assert.equal(dbRow.version, 3);
    const persistedSheets = (JSON.parse(dbRow.data) as { sheets: { nodes: { id: string; name: string }[] }[] }).sheets;
    const persN1 = persistedSheets[0].nodes.find((n) => n.id === 'n1');
    const persN3 = persistedSheets[0].nodes.find((n) => n.id === 'n3');
    assert.equal(persN1?.name, 'node 1 by alice');
    assert.equal(persN3?.name, 'node 3 by bob');

    // n3 应被写入 nodes_meta（creator_id=Bob）
    const meta = db.prepare(
      `SELECT creator_id FROM nodes_meta WHERE canvas_id=? AND sheet_id='s1' AND node_id='n3'`
    ).get(canvasId) as { creator_id: number } | undefined;
    assert.ok(meta);
    assert.equal(meta.creator_id, BOB.id);

    // codex 阶段 D 末尾审 gap 3 强化：canvas_versions(v=3) 持久化断言
    // 1) saved_by = Bob（B 触发保存，codex 判断点 11）
    // 2) data 等于 rewrittenData（与主表持久化完全一致，codex 隐藏判断点 5）
    const v3 = db
      .prepare(`SELECT data, saved_by FROM canvas_versions WHERE canvas_id=? AND version=3`)
      .get(canvasId) as { data: string; saved_by: number } | undefined;
    assert.ok(v3, 'canvas_versions(v=3) should exist');
    assert.equal(v3.saved_by, BOB.id, 'canvas_versions.saved_by should be Bob (B)');
    assert.equal(
      v3.data,
      dbRow.data,
      'canvas_versions.data should equal canvases.data (both are rewrittenData)',
    );

    // Day 3 D-2：conflict_logs 写入 auto_merged 一条（含 report + debugDelta）
    const log = db
      .prepare(`SELECT * FROM conflict_logs WHERE canvas_id=? ORDER BY id DESC LIMIT 1`)
      .get(canvasId) as
      | { user_a_id: number; user_b_id: number; base_version: number; current_version: number; resolution: string; details: string }
      | undefined;
    assert.ok(log, 'conflict_logs should have one entry');
    assert.equal(log.resolution, 'auto_merged');
    assert.equal(log.user_a_id, ALICE.id, 'user_a_id 应是 v=2 saved_by Alice');
    assert.equal(log.user_b_id, BOB.id);
    assert.equal(log.base_version, 1);
    assert.equal(log.current_version, 2);
    const logDetails = JSON.parse(log.details);
    assert.equal(logDetails.schemaVersion, 1);
    assert.equal(logDetails.resolution, 'auto_merged');
    assert.ok(logDetails.report, 'auto_merged details should contain report');
    assert.ok(logDetails.debugDelta, 'auto_merged details should contain debugDelta');
    assert.ok(Array.isArray(logDetails.debugDelta.deltaA.sheetsAdded));
    assert.ok(Array.isArray(logDetails.debugDelta.deltaB.sheetsAdded));
  });
});

describe('阶段 C - 真冲突（admin 双方改同节点同字段）', () => {
  // Alice / Bob 改 n1（Alice 创建）会被权限拦；用 ADMIN 充当 B 绕过权限检查测合并冲突
  it('Alice 改 n1.name + admin 也改 n1.name → ok:false / status:409 / conflicts 含 node_modified_both', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas();
    aliceAdvanceToV2(canvasId, baseData); // Alice 改 n1.name

    // admin 基于 v=1 也改 n1.name 不同值（admin 可改任意节点 → 进入合并冲突路径）
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

    const result = saveCanvas({
      id: canvasId,
      baseVersion: 1,
      data: adminData,
      user: ADMIN,
    });

    assert.equal(result.ok, false);
    if (result.ok === false && result.error === 'conflict') {
      assert.equal(result.status, 409);
      assert.equal(result.currentVersion, 2);
      assert.ok(result.conflicts);
      const c = result.conflicts!.find((x) => x.type === 'node_modified_both');
      assert.ok(c, `expected node_modified_both, got: ${JSON.stringify(result.conflicts)}`);
      assert.equal(c.targetId, 'n1');
      assert.equal(c.field, 'name');
    } else {
      assert.fail(`expected conflict, got: ${JSON.stringify(result)}`);
    }

    // DB 不应被改 — 仍 v=2
    const dbRow = db.prepare('SELECT version FROM canvases WHERE id=?').get(canvasId) as { version: number };
    assert.equal(dbRow.version, 2);

    // Day 3 D-2：conflict_logs 写入 conflict 一条（含 conflicts + debugDelta，无 report）
    const log = db
      .prepare(`SELECT * FROM conflict_logs WHERE canvas_id=? ORDER BY id DESC LIMIT 1`)
      .get(canvasId) as
      | { user_a_id: number; user_b_id: number; resolution: string; details: string }
      | undefined;
    assert.ok(log);
    assert.equal(log.resolution, 'conflict');
    assert.equal(log.user_a_id, ALICE.id);
    assert.equal(log.user_b_id, ADMIN.id);
    const logDetails = JSON.parse(log.details);
    assert.equal(logDetails.resolution, 'conflict');
    assert.ok(Array.isArray(logDetails.conflicts));
    assert.ok(logDetails.debugDelta);
    assert.equal(logDetails.report, undefined, 'conflict 路径不应含 report');
  });
});

describe('阶段 C - active_sheet_missing 透传（applyDelta 短路）', () => {
  it('Alice 删 sheet s2 + Bob 改 activeSheetId 指向 s2 → ok:false / conflict / active_sheet_missing', () => {
    seedUsers();

    // 构造 2 sheet 的 base 数据
    const now = Date.now();
    const baseData: MultiCanvasProjectInput = {
      version: 2,
      id: 'p1',
      name: 'test',
      activeSheetId: 's1',
      sheets: [
        { id: 's1', name: 'sheet 1', nodes: [], connectors: [] },
        { id: 's2', name: 'sheet 2', nodes: [], connectors: [] },
      ],
    };
    const ins = db.prepare(
      `INSERT INTO canvases
         (name, description, visibility, is_public_to_guest, owner_id, data, version,
          created_by, created_at, updated_by, updated_at, archived)
       VALUES (?, ?, 'public', 0, NULL, ?, 1, ?, ?, ?, ?, 0)`,
    ).run('test', null, JSON.stringify(baseData), ALICE.id, now, ALICE.id, now);
    const canvasId = Number(ins.lastInsertRowid);
    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, 1, ?, ?, ?)`,
    ).run(canvasId, JSON.stringify(baseData), ALICE.id, now);

    // Alice 删 s2 推到 v=2（admin 才能删 sheet 里有节点的，但这里 sheet 空所以谁都行；用 ADMIN 避免节点权限干扰）
    const aliceData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [baseData.sheets[0]],
    };
    const aliceR = saveCanvas({
      id: canvasId,
      baseVersion: 1,
      data: aliceData,
      user: ADMIN,
    });
    assert.equal(aliceR.ok, true);

    // Bob 基于 v=1 把 activeSheetId 改成 s2
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      activeSheetId: 's2',
    };
    const result = saveCanvas({
      id: canvasId,
      baseVersion: 1,
      data: bobData,
      user: BOB,
    });

    assert.equal(result.ok, false);
    if (result.ok === false && result.error === 'conflict') {
      assert.ok(result.conflicts);
      const c = result.conflicts!.find((x) => x.type === 'active_sheet_missing');
      assert.ok(c, `expected active_sheet_missing, got: ${JSON.stringify(result.conflicts)}`);
    } else {
      assert.fail(`expected active_sheet_missing conflict, got: ${JSON.stringify(result)}`);
    }
  });
});

describe('阶段 C - 权限优先级（403 越权先于 409 合并冲突）', () => {
  it('Bob 改 Alice 的 n1.name + Alice 也改 n1.name → 403 forbidden_modify_others_node（非 409 conflict）', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas(); // 节点 creator = Alice
    aliceAdvanceToV2(canvasId, baseData); // Alice 改 n1.name 推到 v=2

    // Bob（普通用户）基于 v=1 改 Alice 创建的节点 n1.name
    // 与 Alice v=2 改的字段冲突，但权限校验应先于合并冲突返回
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

    const result = saveCanvas({
      id: canvasId,
      baseVersion: 1,
      data: bobData,
      user: BOB,
    });

    assert.equal(result.ok, false);
    if (result.ok === false && result.error === 'forbidden_modify_others_node') {
      assert.equal(result.status, 403);
      assert.equal(result.currentVersion, 2);
    } else {
      assert.fail(`expected 403 forbidden_modify_others_node, got: ${JSON.stringify(result)}`);
    }
  });
});

describe('阶段 C - mergedFromUserId 取自 canvas_versions.saved_by 不是 canvases.updated_by', () => {
  it('Alice 推到 v=2 → admin 改画布元信息（patchCanvasMeta，会改 canvases.updated_by 但不写 canvas_versions） → Bob 触发合并 → mergedFromUserId 必须是 Alice 不是 admin', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas();
    aliceAdvanceToV2(canvasId, baseData); // canvases.updated_by=Alice / canvas_versions(v=2).saved_by=Alice

    // admin 改元信息（patchCanvasMeta 会写 canvases.updated_by=admin）
    patchCanvasMeta({
      id: canvasId,
      patch: { description: 'changed by admin' },
      user: ADMIN,
    });

    // 验证主表 updated_by 已变成 admin
    const after = db.prepare('SELECT updated_by FROM canvases WHERE id=?').get(canvasId) as
      | { updated_by: number }
      | undefined;
    assert.equal(after!.updated_by, ADMIN.id);

    // Bob 基于 v=1 加新节点 n3 触发合并（自己创建不触发权限拦截）
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: [
            ...baseData.sheets[0].nodes,
            {
              id: 'n3',
              name: 'n3 by bob',
              type: 'process',
              position: { x: 400, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
        },
      ],
    };
    const result = saveCanvas({
      id: canvasId,
      baseVersion: 1,
      data: bobData,
      user: BOB,
    });

    assert.equal(result.ok, true);
    if (result.ok === true && result.merged) {
      // 关键断言：mergedFromUserId 必须是 Alice（v=2 saved_by）不是 admin（updated_by）
      assert.equal(result.report.mergedFromUserId, ALICE.id);
      assert.equal(result.report.mergedFromUsername, ALICE.username);
    } else {
      assert.fail(`expected merged ok, got: ${JSON.stringify(result)}`);
    }
  });
});

describe('阶段 C - DataIntegrityError 端到端（合并路径 currentData 历史脏数据）', () => {
  it('canvas_versions(v=2) 缺失 → DataIntegrityError 透传（saveCanvas 不静默 fallback）', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas();
    aliceAdvanceToV2(canvasId, baseData); // 推到 v=2

    // 制造 DB 损坏：删除 canvas_versions(v=2)（模拟手工修 DB / 迁移漏写）
    db.prepare('DELETE FROM canvas_versions WHERE canvas_id=? AND version=?').run(canvasId, 2);

    // Bob 基于 v=1 触发合并
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: baseData.sheets[0].nodes.map((n) =>
            n.id === 'n2' ? { ...n, name: 'node 2 by bob' } : n,
          ),
        },
      ],
    };

    assert.throws(
      () => {
        saveCanvas({
          id: canvasId,
          baseVersion: 1,
          data: bobData,
          user: BOB,
        });
      },
      (err) => err instanceof DataIntegrityError,
      'expected DataIntegrityError when canvas_versions(currentVersion) missing',
    );
  });

  it('currentData 含 duplicate node id（脏 DB）→ tryMerge 内 computeDelta 入口抛 DataIntegrityError 透传', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas();
    aliceAdvanceToV2(canvasId, baseData); // 推到 v=2

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
            { id: 'n1', name: 'b', type: 'process', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, expandable: false }, // duplicate
          ],
          connectors: [],
        },
      ],
    };
    db.prepare('UPDATE canvases SET data=? WHERE id=?').run(JSON.stringify(dirtyData), canvasId);

    // Bob 基于 v=1 加新节点 n3 触发合并（自己创建不触发权限拦截）
    // 走到 tryMerge → computeDelta(base, current) 时被脏 currentData 拦下抛 DataIntegrityError
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

    let caught: Error | undefined;
    let returned: unknown;
    try {
      returned = saveCanvas({
        id: canvasId,
        baseVersion: 1,
        data: bobData,
        user: BOB,
      });
    } catch (e) {
      caught = e as Error;
    }
    if (!caught) {
      assert.fail(
        `expected DataIntegrityError thrown; instead got returned: ${JSON.stringify(returned)}`,
      );
    }
    assert.ok(caught instanceof DataIntegrityError, `expected DataIntegrityError, got: ${caught.constructor.name}: ${caught.message}`);

    // DB 不应被改 — 主表仍是脏数据 v=2（事务已回滚，不该写出 v=3）
    const dbRow = db.prepare('SELECT version FROM canvases WHERE id=?').get(canvasId) as { version: number };
    assert.equal(dbRow.version, 2);
  });
});

describe('Day 3 D-2 - base_version_expired conflict_logs 写入', () => {
  it('Alice 推 v=1→v=2 + 删 canvas_versions(v=1) + Bob baseVersion=1 → 409 base_version_expired + conflict_logs 一条', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas();
    aliceAdvanceToV2(canvasId, baseData); // Alice 推到 v=2

    // 制造 base 快照缺失：删除 canvas_versions(v=1)
    db.prepare('DELETE FROM canvas_versions WHERE canvas_id=? AND version=?').run(canvasId, 1);

    // Bob 基于 v=1 加新节点 n3
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: [
            ...baseData.sheets[0].nodes,
            {
              id: 'n3',
              name: 'n3 by bob',
              type: 'process',
              position: { x: 400, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
        },
      ],
    };

    const result = saveCanvas({
      id: canvasId,
      baseVersion: 1,
      data: bobData,
      user: BOB,
    });

    assert.equal(result.ok, false);
    if (result.ok === false && result.error === 'base_version_expired') {
      assert.equal(result.status, 409);
      assert.equal(result.currentVersion, 2);
    } else {
      assert.fail(`expected base_version_expired, got: ${JSON.stringify(result)}`);
    }

    // DB v=2 不变
    const dbRow = db.prepare('SELECT version FROM canvases WHERE id=?').get(canvasId) as { version: number };
    assert.equal(dbRow.version, 2);

    // Day 3 D-2：conflict_logs 一条 base_version_expired（无 debugDelta，user_a_id=Alice）
    const log = db
      .prepare(`SELECT * FROM conflict_logs WHERE canvas_id=? ORDER BY id DESC LIMIT 1`)
      .get(canvasId) as
      | { user_a_id: number; user_b_id: number; resolution: string; details: string; base_version: number; current_version: number }
      | undefined;
    assert.ok(log);
    assert.equal(log.resolution, 'base_version_expired');
    // medium 风险吸收：currentVersionAuthor 提到 baseSnapshot 检查之前；user_a_id=Alice 必须有
    assert.equal(log.user_a_id, ALICE.id, 'user_a_id should be Alice (v=2 saved_by) — medium 风险已修');
    assert.equal(log.user_b_id, BOB.id);
    assert.equal(log.base_version, 1);
    assert.equal(log.current_version, 2);
    const logDetails = JSON.parse(log.details);
    assert.equal(logDetails.resolution, 'base_version_expired');
    // 无 baseSnapshot 不能 computeDelta，debugDelta 应缺失
    assert.equal(logDetails.debugDelta, undefined);
    assert.equal(logDetails.report, undefined);
    assert.equal(logDetails.conflicts, undefined);
  });
});

// =====================================================================
// F-16a — #34 端到端补丁 5 case（2026-05-08 04 范围判读审拍板 4）
// =====================================================================
//
// 闭环口径（详见 02-拍板记录 § F-16 子断言映射表）：
//   (a) annotations 表级联删除      → case 1
//   (b) sheet_removed_modified 副作用型 → case 2
//   (c) deprecated/alsoDeprecated 路径合并 → case 3
//   (d) E7 warnings 流入 mergeReport → case 4
//   (e) connector 自动合并 E1/E2/E3 → case 5
//
// 这 5 case 验证 saveCanvas 合并路径（baseVersion < currentVersion + 无冲突）
// 在端到端层面正确触发了：annotations 级联清理 / 删 sheet 阻断合并 /
// 标废弃元字段 rewrite / E7 dangling warning / connector 三类自动合并。

describe('F-16a case 1 — annotations 表级联删除（合并成功路径）', () => {
  it('A 改 s1 节点 + B 删 s2（s2 含节点 + annotations）→ 合并成功 + s2 annotations 级联清理', () => {
    seedUsers();

    // 构造 base：2 sheet / s1 含 n1（Alice 创建）/ s2 含 n_s2（admin 创建，方便后续 admin 删 sheet）
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
              name: 'n1',
              type: 'process',
              position: { x: 0, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
          connectors: [],
        },
        {
          id: 's2',
          name: 'sheet 2',
          nodes: [
            {
              id: 'n_s2',
              name: 'n_s2',
              type: 'process',
              position: { x: 0, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
          connectors: [],
        },
      ],
    };

    const ins = db.prepare(
      `INSERT INTO canvases
         (name, description, visibility, is_public_to_guest, owner_id, data, version,
          created_by, created_at, updated_by, updated_at, archived)
       VALUES (?, ?, 'public', 0, NULL, ?, 1, ?, ?, ?, ?, 0)`,
    ).run('test', null, JSON.stringify(baseData), ALICE.id, now, ALICE.id, now);
    const canvasId = Number(ins.lastInsertRowid);

    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, 1, ?, ?, ?)`,
    ).run(canvasId, JSON.stringify(baseData), ALICE.id, now);

    const insertMeta = db.prepare(
      `INSERT INTO nodes_meta
         (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
          is_deprecated, deprecated_by, deprecated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
    );
    insertMeta.run(canvasId, 's1', 'n1', ALICE.id, now, ALICE.id, now);
    insertMeta.run(canvasId, 's2', 'n_s2', ADMIN.id, now, ADMIN.id, now);

    // 在 s2 / n_s2 上插一条 annotation
    db.prepare(
      `INSERT INTO annotations (canvas_id, sheet_id, node_id, author_id, content, created_at)
       VALUES (?, 's2', 'n_s2', ?, '关于 n_s2 的批注', ?)`,
    ).run(canvasId, ADMIN.id, now);

    // sanity：annotation 已存在
    const annoBefore = db.prepare(
      `SELECT COUNT(*) as c FROM annotations WHERE canvas_id=? AND sheet_id='s2'`,
    ).get(canvasId) as { c: number };
    assert.equal(annoBefore.c, 1);

    // Alice 推到 v=2：改 n1.name（不动 s2）
    const aliceData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: baseData.sheets[0].nodes.map((n) => ({ ...n, name: 'n1 by alice' })),
        },
        baseData.sheets[1],
      ],
    };
    const aliceR = saveCanvas({ id: canvasId, baseVersion: 1, data: aliceData, user: ALICE });
    assert.equal(aliceR.ok, true);

    // admin 基于 v=1 删 s2（admin 在 public canvas 才能删节点 / 进合并路径）
    const adminData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [baseData.sheets[0]],
    };
    const result = saveCanvas({ id: canvasId, baseVersion: 1, data: adminData, user: ADMIN });

    assert.equal(result.ok, true);
    if (result.ok === true && result.merged) {
      assert.equal(result.version, 3);
      // mergedData 应只含 s1（s2 被 admin 删）+ s1.n1 应是 Alice 改的版本
      assert.equal(result.mergedData.sheets.length, 1);
      assert.equal(result.mergedData.sheets[0].id, 's1');
      const n1 = result.mergedData.sheets[0].nodes.find((n) => (n as { id: string }).id === 'n1');
      assert.equal((n1 as { name: string }).name, 'n1 by alice');
    } else {
      assert.fail(`expected merged ok, got: ${JSON.stringify(result)}`);
    }

    // 关键断言：s2 的 annotations 已被同事务级联清理
    const annoAfter = db.prepare(
      `SELECT COUNT(*) as c FROM annotations WHERE canvas_id=? AND sheet_id='s2'`,
    ).get(canvasId) as { c: number };
    assert.equal(annoAfter.c, 0, 's2 annotations should be cascade-deleted on sheet removal');

    // s2 的 nodes_meta 也应一并清理
    const metaAfter = db.prepare(
      `SELECT COUNT(*) as c FROM nodes_meta WHERE canvas_id=? AND sheet_id='s2'`,
    ).get(canvasId) as { c: number };
    assert.equal(metaAfter.c, 0, 's2 nodes_meta should be cleared on sheet removal');
  });
});

describe('F-16a case 2 — sheet_removed_modified 副作用型真冲突', () => {
  it('A 删 s2 + B 改 s2 内节点 → ok:false / 409 / sheet_removed_modified 冲突', () => {
    seedUsers();

    // 2 sheet base：s2 内有 n_s2（ADMIN 创建，便于双方都能改）
    const now = Date.now();
    const baseData: MultiCanvasProjectInput = {
      version: 2,
      id: 'p1',
      name: 'test',
      activeSheetId: 's1',
      sheets: [
        { id: 's1', name: 'sheet 1', nodes: [], connectors: [] },
        {
          id: 's2',
          name: 'sheet 2',
          nodes: [
            {
              id: 'n_s2',
              name: 'n_s2',
              type: 'process',
              position: { x: 0, y: 0 },
              size: { width: 100, height: 50 },
              expandable: false,
            },
          ],
          connectors: [],
        },
      ],
    };
    const ins = db.prepare(
      `INSERT INTO canvases
         (name, description, visibility, is_public_to_guest, owner_id, data, version,
          created_by, created_at, updated_by, updated_at, archived)
       VALUES (?, ?, 'public', 0, NULL, ?, 1, ?, ?, ?, ?, 0)`,
    ).run('test', null, JSON.stringify(baseData), ADMIN.id, now, ADMIN.id, now);
    const canvasId = Number(ins.lastInsertRowid);
    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, 1, ?, ?, ?)`,
    ).run(canvasId, JSON.stringify(baseData), ADMIN.id, now);
    db.prepare(
      `INSERT INTO nodes_meta
         (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
          is_deprecated, deprecated_by, deprecated_at)
       VALUES (?, 's2', 'n_s2', ?, ?, ?, ?, 0, NULL, NULL)`,
    ).run(canvasId, ADMIN.id, now, ADMIN.id, now);

    // ADMIN(A) 推到 v=2：删 s2
    const aliceData: MultiCanvasProjectInput = { ...baseData, sheets: [baseData.sheets[0]] };
    const aliceR = saveCanvas({ id: canvasId, baseVersion: 1, data: aliceData, user: ADMIN });
    assert.equal(aliceR.ok, true);

    // ALICE(B) 基于 v=1 改 s2 内节点（admin role 才能改他人节点；ALICE 是普通用户但 n_s2 是 ADMIN 创建）
    // 这里改用 ADMIN 重新作 B 行不通（同 actor）；用 ALICE 会先撞 forbidden_modify_others_node
    // 解法：改 sheet 元字段触发 sheetsModified 不触发节点权限
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        baseData.sheets[0],
        { ...baseData.sheets[1], name: 'sheet 2 renamed' }, // 仅改 sheet meta，不动节点
      ],
    };
    const result = saveCanvas({ id: canvasId, baseVersion: 1, data: bobData, user: ALICE });

    assert.equal(result.ok, false);
    if (result.ok === false && result.error === 'conflict') {
      assert.equal(result.status, 409);
      assert.equal(result.currentVersion, 2);
      assert.ok(result.conflicts);
      const c = result.conflicts!.find((x) => x.type === 'sheet_removed_modified');
      assert.ok(c, `expected sheet_removed_modified, got: ${JSON.stringify(result.conflicts)}`);
      assert.equal(c.sheetId, 's2');
    } else {
      assert.fail(`expected sheet_removed_modified conflict, got: ${JSON.stringify(result)}`);
    }

    // DB 仍 v=2（合并被冲突拦下）
    const dbRow = db.prepare('SELECT version FROM canvases WHERE id=?').get(canvasId) as { version: number };
    assert.equal(dbRow.version, 2);
  });
});

describe('F-16a case 3 — deprecated/alsoDeprecated 路径合并', () => {
  it('A 改 n2 字段 + B 标废弃 n1（deprecated 公开权限）→ 合并成功 + n1.is_deprecated=true / deprecated_by=Bob', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas(); // n1, n2 都是 Alice 创建
    aliceAdvanceToV2(canvasId, baseData); // Alice 改 n1.name 推到 v=2

    // Bob 基于 v=1 标废弃 n2（标废弃是公开权限，不查 creator）
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: baseData.sheets[0].nodes.map((n) =>
            n.id === 'n2' ? { ...n, is_deprecated: true } : n,
          ),
        },
      ],
    };
    const result = saveCanvas({ id: canvasId, baseVersion: 1, data: bobData, user: BOB });

    assert.equal(result.ok, true);
    if (result.ok === true && result.merged) {
      assert.equal(result.version, 3);
      // mergedData：n1 = Alice 改的 name；n2 = Bob 标废弃
      const n1 = result.mergedData.sheets[0].nodes.find((n) => (n as { id: string }).id === 'n1');
      const n2 = result.mergedData.sheets[0].nodes.find((n) => (n as { id: string }).id === 'n2');
      assert.equal((n1 as { name: string }).name, 'node 1 by alice');
      assert.equal((n2 as { is_deprecated: boolean }).is_deprecated, true);
      // deprecated_by/at rewrite 应是 Bob+now（不读旧 meta，旧 meta 是 null）
      assert.equal((n2 as { deprecated_by: number }).deprecated_by, BOB.id);
      // deprecatedChanged 计入 mergeReport
      assert.equal(result.report.nodesDeprecatedCount, 1);
    } else {
      assert.fail(`expected merged ok, got: ${JSON.stringify(result)}`);
    }

    // 主表 nodes_meta n2 应被同步：is_deprecated=1 / deprecated_by=Bob
    const meta = db.prepare(
      `SELECT is_deprecated, deprecated_by FROM nodes_meta
       WHERE canvas_id=? AND sheet_id='s1' AND node_id='n2'`,
    ).get(canvasId) as { is_deprecated: number; deprecated_by: number };
    assert.equal(meta.is_deprecated, 1);
    assert.equal(meta.deprecated_by, BOB.id);
  });
});

describe('F-16a case 4 — E7 warnings 流入 mergeReport', () => {
  it('A 加边 e_new 端点是 n2 + B 删 n2（admin）→ 合并成功 + warnings 含 edge_dropped_dangling_endpoint', () => {
    // detector N9-1/N9-2：B 加边引用 A 已删节点 → edge_endpoint_removed_by_other（真冲突）
    // 反向（detectEdgeConflicts L1 复审 N9-3）：A 加边 + B 删点 → 无冲突，applyDelta E7 丢边 + warning
    // 这里 A=Alice 加边、B=ADMIN 删点（public canvas 只 admin 能物删 + admin 删 Alice 节点合法）
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas(); // n1, n2 都是 Alice 创建

    // Alice 推到 v=2：加新边 e_new (n1→n2)
    const aliceData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          connectors: [{ id: 'e_new', sourceID: 'n1', targetID: 'n2' }],
        },
      ],
    };
    const aliceR = saveCanvas({ id: canvasId, baseVersion: 1, data: aliceData, user: ALICE });
    assert.equal(aliceR.ok, true);

    // ADMIN 基于 v=1 物删 n2（admin 才能在 public canvas 物删；reverse 方向 detector 不产 conflict）
    // applyDelta E7 dangling endpoint 扫描应丢 e_new + 产 warning
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          nodes: baseData.sheets[0].nodes.filter((n) => n.id !== 'n2'),
        },
      ],
    };
    const result = saveCanvas({ id: canvasId, baseVersion: 1, data: bobData, user: ADMIN });

    assert.equal(result.ok, true);
    if (result.ok === true && result.merged) {
      // mergedData 不含 e_new（被 E7 丢弃）
      const conns = result.mergedData.sheets[0].connectors;
      assert.equal(conns.length, 0, 'e_new should be dropped by E7 dangling endpoint');
      // mergeReport.warnings 含一条 edge_dropped_dangling_endpoint
      assert.equal(result.report.warnings.length, 1);
      const w = result.report.warnings[0];
      assert.equal(w.type, 'edge_dropped_dangling_endpoint');
      assert.equal(w.edgeId, 'e_new');
      assert.equal(w.missingEndpoint, 'n2');
      assert.equal(w.missingEndpointSide, 'target');
    } else {
      assert.fail(`expected merged ok with E7 warning, got: ${JSON.stringify(result)}`);
    }
  });
});

describe('F-16a case 5 — connector 自动合并（E1 双方加不同边 + E3 同边改不同字段）', () => {
  it('A 加边 e_a (n1→n2) + B 加边 e_b (n2→n1 反向) → 合并成功 + 两条边都在 mergedData', () => {
    seedUsers();
    const { canvasId, baseData } = seedBaseCanvas();

    // Alice 推 v=2：加 e_a (n1→n2)
    const aliceData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          connectors: [{ id: 'e_a', sourceID: 'n1', targetID: 'n2' }],
        },
      ],
    };
    const aliceR = saveCanvas({ id: canvasId, baseVersion: 1, data: aliceData, user: ALICE });
    assert.equal(aliceR.ok, true);

    // Bob 基于 v=1 加 e_b (n2→n1 反向，不同 ID + 不同 sem-key)
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          connectors: [{ id: 'e_b', sourceID: 'n2', targetID: 'n1' }],
        },
      ],
    };
    const result = saveCanvas({ id: canvasId, baseVersion: 1, data: bobData, user: BOB });

    assert.equal(result.ok, true);
    if (result.ok === true && result.merged) {
      // mergedData 含双方两条边
      const conns = result.mergedData.sheets[0].connectors;
      assert.equal(conns.length, 2);
      const ids = new Set(conns.map((c) => (c as { id: string }).id));
      assert.ok(ids.has('e_a'), 'e_a from Alice should be present');
      assert.ok(ids.has('e_b'), 'e_b from Bob should be present');
      // mergeReport.edgesAddedCount = 1（B 单边加的）
      assert.equal(result.report.edgesAddedCount, 1);
    } else {
      assert.fail(`expected merged ok, got: ${JSON.stringify(result)}`);
    }
  });

  it('E3 同边改不同字段：A 改 e_pre.label / B 改 e_pre.style → 合并成功 + 两个改动都进 mergedData', () => {
    seedUsers();

    // 自定义 base：含一条 connector e_pre (n1→n2)，n1/n2 都是 Alice 创建
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
            { id: 'n1', name: 'n1', type: 'process', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, expandable: false },
            { id: 'n2', name: 'n2', type: 'process', position: { x: 200, y: 0 }, size: { width: 100, height: 50 }, expandable: false },
          ],
          connectors: [
            {
              id: 'e_pre',
              sourceID: 'n1',
              targetID: 'n2',
              data: { label: 'old' },
            },
          ],
        },
      ],
    };
    const ins = db.prepare(
      `INSERT INTO canvases
         (name, description, visibility, is_public_to_guest, owner_id, data, version,
          created_by, created_at, updated_by, updated_at, archived)
       VALUES (?, ?, 'public', 0, NULL, ?, 1, ?, ?, ?, ?, 0)`,
    ).run('test', null, JSON.stringify(baseData), ALICE.id, now, ALICE.id, now);
    const canvasId = Number(ins.lastInsertRowid);
    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, 1, ?, ?, ?)`,
    ).run(canvasId, JSON.stringify(baseData), ALICE.id, now);
    const insertMeta = db.prepare(
      `INSERT INTO nodes_meta
         (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
          is_deprecated, deprecated_by, deprecated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
    );
    insertMeta.run(canvasId, 's1', 'n1', ALICE.id, now, ALICE.id, now);
    insertMeta.run(canvasId, 's1', 'n2', ALICE.id, now, ALICE.id, now);

    // Alice 推 v=2：改 e_pre.data.label 'old'→'alice-label'
    const aliceData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          connectors: [{ ...baseData.sheets[0].connectors[0], data: { label: 'alice-label' } }],
        },
      ],
    };
    const aliceR = saveCanvas({ id: canvasId, baseVersion: 1, data: aliceData, user: ALICE });
    assert.equal(aliceR.ok, true);

    // Bob 基于 v=1 改 e_pre.style（不同字段，E3 自动合并）— 加 style 字段不动 data
    const bobData: MultiCanvasProjectInput = {
      ...baseData,
      sheets: [
        {
          ...baseData.sheets[0],
          connectors: [
            {
              ...baseData.sheets[0].connectors[0],
              style: { stroke: '#ff0000' },
            },
          ],
        },
      ],
    };
    const result = saveCanvas({ id: canvasId, baseVersion: 1, data: bobData, user: BOB });

    assert.equal(result.ok, true);
    if (result.ok === true && result.merged) {
      const conn = result.mergedData.sheets[0].connectors[0];
      // 双方改动都在 mergedData（按 StorageConnector 真实形状取）
      assert.equal(conn.data?.label, 'alice-label', 'Alice 的 label 改动应保留');
      assert.equal(conn.style?.stroke, '#ff0000', 'Bob 的 style 改动应合并进');
      // mergeReport.edgesModifiedCount = 1（B 单边改的字段）
      assert.equal(result.report.edgesModifiedCount, 1);
    } else {
      assert.fail(`expected E3 auto-merge ok, got: ${JSON.stringify(result)}`);
    }
  });
});
