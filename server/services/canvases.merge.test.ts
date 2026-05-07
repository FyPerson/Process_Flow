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
