// 阶段 5 Day 3 D-2 — conflict_logs service 单测
//
// 验证：
// - 3 种 resolution 都能正常 INSERT（auto_merged / conflict / base_version_expired）
// - details 字段含 schemaVersion + baseVersion + currentVersion + resolution + report?/conflicts?/debugDelta?
// - debugDelta 内 deltaA/deltaB 是 SerializedDelta（Map 已转 entries 数组）
// - 64KB 截断策略：超限删 debugDelta + 加 truncated:true 标志
//
// 测试结构：内存 db + migration + setDbForTesting（与 canvases.removed.test.ts 同款）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

import { setDbForTesting } from '../db/index.ts';
import { logConflictResolution } from './conflict_logs.ts';
import type { Conflict, Delta, MergeReport } from './merge/types.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

let db: DatabaseType;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
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
// fixtures
// =====================================================================

function emptyDelta(): Delta {
  return {
    projectMetaChangedFields: [],
    sheetsAdded: new Map(),
    sheetsRemoved: new Map(),
    sheetsModified: new Map(),
  };
}

function makeReport(): MergeReport {
  return {
    nodesAddedCount: 1,
    nodesModifiedCount: 0,
    nodesDeprecatedCount: 0,
    nodesRemovedCount: 0,
    edgesAddedCount: 0,
    edgesModifiedCount: 0,
    edgesRemovedCount: 0,
    warnings: [],
    mergedFromUserId: 1,
    mergedFromUsername: 'alice',
    mergedFromVersion: 2,
  };
}

function makeConflicts(): Conflict[] {
  return [
    { type: 'node_modified_both', sheetId: 's1', targetId: 'n1', field: 'name' },
  ];
}

function readLog() {
  return db
    .prepare('SELECT * FROM conflict_logs ORDER BY id DESC LIMIT 1')
    .get() as
    | {
        id: number;
        canvas_id: number;
        user_a_id: number;
        user_b_id: number;
        base_version: number;
        current_version: number;
        resolution: string;
        details: string;
        created_at: number;
      }
    | undefined;
}

// =====================================================================
// case
// =====================================================================

describe('conflict_logs - 3 种 resolution INSERT 写入', () => {
  it('auto_merged：含 report + debugDelta；details schemaVersion=1 + 关键字段', () => {
    logConflictResolution(db, {
      canvasId: 100,
      userAId: 1,
      userBId: 2,
      baseVersion: 1,
      currentVersion: 2,
      resolution: 'auto_merged',
      report: makeReport(),
      debugDelta: { deltaA: emptyDelta(), deltaB: emptyDelta() },
    });

    const row = readLog();
    assert.ok(row);
    assert.equal(row.canvas_id, 100);
    assert.equal(row.user_a_id, 1);
    assert.equal(row.user_b_id, 2);
    assert.equal(row.base_version, 1);
    assert.equal(row.current_version, 2);
    assert.equal(row.resolution, 'auto_merged');

    const details = JSON.parse(row.details);
    assert.equal(details.schemaVersion, 1);
    assert.equal(details.baseVersion, 1);
    assert.equal(details.currentVersion, 2);
    assert.equal(details.resolution, 'auto_merged');
    assert.equal(details.report.nodesAddedCount, 1);
    assert.equal(details.report.mergedFromUserId, 1);
    assert.ok(details.debugDelta);
    // serialize 后 sheetsAdded 是 Array，不是 {}
    assert.ok(Array.isArray(details.debugDelta.deltaA.sheetsAdded));
    assert.ok(Array.isArray(details.debugDelta.deltaB.sheetsAdded));
    // 不应包含 conflicts（auto_merged 路径）
    assert.equal(details.conflicts, undefined);
  });

  it('conflict：含 conflicts + debugDelta；不含 report', () => {
    logConflictResolution(db, {
      canvasId: 100,
      userAId: 1,
      userBId: 2,
      baseVersion: 1,
      currentVersion: 2,
      resolution: 'conflict',
      conflicts: makeConflicts(),
      debugDelta: { deltaA: emptyDelta(), deltaB: emptyDelta() },
    });

    const row = readLog();
    assert.ok(row);
    assert.equal(row.resolution, 'conflict');

    const details = JSON.parse(row.details);
    assert.equal(details.resolution, 'conflict');
    assert.equal(details.conflicts.length, 1);
    assert.equal(details.conflicts[0].type, 'node_modified_both');
    assert.equal(details.conflicts[0].targetId, 'n1');
    assert.ok(details.debugDelta);
    assert.equal(details.report, undefined);
  });

  it('base_version_expired：不含 debugDelta（无 baseSnapshot 不能 computeDelta）', () => {
    logConflictResolution(db, {
      canvasId: 100,
      userAId: 1,
      userBId: 2,
      baseVersion: 1,
      currentVersion: 5,
      resolution: 'base_version_expired',
    });

    const row = readLog();
    assert.ok(row);
    assert.equal(row.resolution, 'base_version_expired');

    const details = JSON.parse(row.details);
    assert.equal(details.resolution, 'base_version_expired');
    assert.equal(details.baseVersion, 1);
    assert.equal(details.currentVersion, 5);
    // 三个可选字段都不应出现
    assert.equal(details.debugDelta, undefined);
    assert.equal(details.conflicts, undefined);
    assert.equal(details.report, undefined);
  });
});

describe('conflict_logs - details 截断策略（隐藏判断 #5）', () => {
  it('超过 64KB → 删 debugDelta + 加 truncated:true；保留 report/conflicts', () => {
    // 构造伪造的巨大 conflict 数组（每条带 80 字节 message → ~1000 条 ~ 80KB）
    const hugeConflicts: Conflict[] = Array.from({ length: 1000 }, (_, i) => ({
      type: 'node_modified_both',
      sheetId: 's1',
      targetId: `n${i}`,
      field: 'name',
      message: 'x'.repeat(60), // 60 字节 message
    }));

    // 同时 debugDelta 也巨大
    const fakeDelta: Delta = {
      projectMetaChangedFields: Array.from({ length: 200 }, (_, i) => ({
        field: `f${i}`,
        before: `before-${'x'.repeat(50)}`,
        after: `after-${'x'.repeat(50)}`,
      })),
      sheetsAdded: new Map(),
      sheetsRemoved: new Map(),
      sheetsModified: new Map(),
    };

    logConflictResolution(db, {
      canvasId: 100,
      userAId: 1,
      userBId: 2,
      baseVersion: 1,
      currentVersion: 2,
      resolution: 'conflict',
      conflicts: hugeConflicts,
      debugDelta: { deltaA: fakeDelta, deltaB: fakeDelta },
    });

    const row = readLog();
    assert.ok(row);
    const details = JSON.parse(row.details);

    // truncated 标志置 true
    assert.equal(details.truncated, true);
    // debugDelta 已被删
    assert.equal(details.debugDelta, undefined);
    // 关键事实保留
    assert.equal(details.resolution, 'conflict');
    assert.equal(details.schemaVersion, 1);
    assert.ok(Array.isArray(details.conflicts));
    assert.equal(details.conflicts.length, 1000);
  });
});

describe('conflict_logs - 失败回滚（隐藏判断 #6）', () => {
  it('插入抛错时调用方事务回滚（用 db.transaction 包装验证）', () => {
    // 制造插入失败：传入超长 resolution 字符串触发 CHECK 约束
    let caught: Error | null = null;
    try {
      db.transaction(() => {
        logConflictResolution(db, {
          canvasId: 100,
          userAId: 1,
          userBId: 2,
          baseVersion: 1,
          currentVersion: 2,
          // @ts-expect-error 故意传非法 resolution
          resolution: 'invalid_resolution_value',
        });
      })();
    } catch (e) {
      caught = e as Error;
    }

    // CHECK 约束应失败
    assert.ok(caught, 'expected CHECK constraint to fail');
    // 事务回滚后 conflict_logs 表应仍为空
    const count = db.prepare('SELECT COUNT(*) AS n FROM conflict_logs').get() as { n: number };
    assert.equal(count.n, 0);
  });
});
