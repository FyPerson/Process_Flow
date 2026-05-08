// P3D-2 第 1 步：§5.7 saveCanvas removed 权限矩阵 5 分支单测
//
// 验证 §5.7 修订（commit d484501）后的 visibility 区分逻辑：
//
// | 画布 visibility | 操作者 | removed 节点 | 期待结果 |
// |---|---|---|---|
// | public | 普通用户 | 任意节点（含自己创建的）| 403 forbidden_remove_node |
// | public | admin | 任意节点 | ok |
// | private | owner（普通用户）| 任意节点 | ok |
// | private | 非 owner 普通用户 | 任意节点 | 403（route 层 canWrite 兜底；service 也防御） |
// | private | admin（不是 owner）| 任意节点 | ok |
//
// 用 better-sqlite3 :memory: db + 手动跑 schema，setDbForTesting 注入。
// 不走 initDb（避免文件系统依赖 + 单例污染）。
//
// 不变量：测试间通过 setDbForTesting(null) + db.close() 释放资源。

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

import { setDbForTesting } from '../db/index.ts';
import { saveCanvas, type SaveCanvasInput } from './canvases.ts';
import type { UserPublic } from '../types/user.ts';
import type { MultiCanvasProjectInput } from '../schemas/canvas.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

let db: DatabaseType;

beforeEach(() => {
  // 每个测试用全新内存 db，避免互相污染
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 跑全部 migration（按文件名升序）
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
// Fixture helpers
// =====================================================================

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin', nickname: 'fixture_nick' };
const OWNER: UserPublic = { id: 2, username: 'owner', role: 'user', nickname: 'fixture_nick' };
const STRANGER: UserPublic = { id: 3, username: 'stranger', role: 'user', nickname: 'fixture_nick' };

/** 插入测试用户 */
function seedUsers() {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, '_test_hash_', ?, ?, ?)`,
  );
  stmt.run(ADMIN.id, ADMIN.username, ADMIN.role, now, now);
  stmt.run(OWNER.id, OWNER.username, OWNER.role, now, now);
  stmt.run(STRANGER.id, STRANGER.username, STRANGER.role, now, now);
}

/**
 * 创建一个画布 + 1 个节点（在 nodes_meta 中也登记）。
 *
 * codex 必修 1：canvasCreatedBy 和 nodeCreatedBy 必须可分开。否则 §5.7 v5
 * 核心语义"private owner 即使不是 node creator 也能删"无法被锁住——如果
 * 未来谁不小心把规则改回"creator 能删"，owner==creator 的测试仍会通过。
 *
 * @param visibility public 或 private
 * @param ownerId    画布 owner（admin 创建 public 时为 null；private 用 OWNER.id）
 * @param canvasCreatedBy   谁创建画布（写 canvases.created_by/updated_by/canvas_versions.saved_by）
 * @param nodeCreatedBy     谁创建节点（写 nodes_meta.creator_id）—— v5 关键：与 ownerId 解耦
 */
function seedCanvas(
  visibility: 'public' | 'private',
  ownerId: number | null,
  canvasCreatedBy: number,
  nodeCreatedBy: number = canvasCreatedBy,
): { canvasId: number; initialData: MultiCanvasProjectInput } {
  const now = Date.now();
  const initialData: MultiCanvasProjectInput = {
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
        ],
        connectors: [],
      },
    ],
  };

  const result = db
    .prepare(
      `INSERT INTO canvases
         (name, description, visibility, is_public_to_guest, owner_id, data, version,
          created_by, created_at, updated_by, updated_at, archived)
       VALUES (?, ?, ?, 0, ?, ?, 1, ?, ?, ?, ?, 0)`,
    )
    .run(
      'test canvas',
      null,
      visibility,
      ownerId,
      JSON.stringify(initialData),
      canvasCreatedBy,
      now,
      canvasCreatedBy,
      now,
    );
  const canvasId = Number(result.lastInsertRowid);

  // 写 nodes_meta（saveCanvas modified/removed 校验依赖此）
  // 注意：creator_id 用 nodeCreatedBy（与画布创建者可不同）
  db.prepare(
    `INSERT INTO nodes_meta
       (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
        is_deprecated, deprecated_by, deprecated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
  ).run(canvasId, 's1', 'n1', nodeCreatedBy, now, nodeCreatedBy, now);

  // 写 canvas_versions（save 时不查它，但保持数据完整）
  db.prepare(
    `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
     VALUES (?, 1, ?, ?, ?)`,
  ).run(canvasId, JSON.stringify(initialData), canvasCreatedBy, now);

  return { canvasId, initialData };
}

/** 构造 incoming data：从初始 data 拿掉 n1（触发 removed 路径） */
function dataWithoutN1(initialData: MultiCanvasProjectInput): MultiCanvasProjectInput {
  return {
    ...initialData,
    sheets: [{ ...initialData.sheets[0], nodes: [] }],
  };
}

// =====================================================================
// 5 分支测试
// =====================================================================

describe('saveCanvas - §5.7 removed 权限矩阵', () => {
  // -------- 分支 1：public + 普通用户 → 403 forbidden_remove_node --------
  it('1. public 画布 + 普通用户删除任意节点 → 403 forbidden_remove_node（即使是自己创建的也禁）', () => {
    seedUsers();
    // public 画布：created_by=OWNER, owner_id=null（public 不绑 owner）
    // OWNER 是节点 creator，但 OWNER 是普通用户 → public 上仍禁删
    const { canvasId, initialData } = seedCanvas('public', null, OWNER.id);

    const input: SaveCanvasInput = {
      id: canvasId,
      baseVersion: 1,
      data: dataWithoutN1(initialData),
      user: OWNER,
    };
    const result = saveCanvas(input);

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    if (result.ok === false && result.error === 'forbidden_remove_node') {
      assert.match(result.message, /public canvas/);
    } else {
      assert.fail(`expected forbidden_remove_node, got: ${JSON.stringify(result)}`);
    }
  });

  // -------- 分支 2：public + admin → ok --------
  it('2. public 画布 + admin 删除任意节点 → ok', () => {
    seedUsers();
    const { canvasId, initialData } = seedCanvas('public', null, OWNER.id);

    const input: SaveCanvasInput = {
      id: canvasId,
      baseVersion: 1,
      data: dataWithoutN1(initialData),
      user: ADMIN,
    };
    const result = saveCanvas(input);

    assert.equal(result.ok, true);
    if (result.ok === true) {
      assert.equal(result.version, 2);
    }
  });

  // -------- 分支 3：private + owner（普通用户）→ ok --------
  // **v5 核心语义验证**：owner 即使**不是** node creator 也能删（与 v3/v4 旧规则的本质差异）
  it('3. private 画布 + owner（普通用户）删除别人创建的节点 → ok（v5 核心：与 creator 解耦）', () => {
    seedUsers();
    // private + ownerId=OWNER；节点由 STRANGER 创建（owner != node creator）
    // 这个解耦能锁住 §5.7 isPrivateOwner 路径——若实现回退成"creator 能删"，此测试失败
    const { canvasId, initialData } = seedCanvas(
      'private',
      OWNER.id,
      OWNER.id, // canvas 由 OWNER 创建
      STRANGER.id, // node 由 STRANGER 创建
    );

    const input: SaveCanvasInput = {
      id: canvasId,
      baseVersion: 1,
      data: dataWithoutN1(initialData),
      user: OWNER, // OWNER 不是 node creator，但作为 owner 可以删
    };
    const result = saveCanvas(input);

    assert.equal(result.ok, true);
    if (result.ok === true) {
      assert.equal(result.version, 2);
    }
  });

  // -------- 分支 4：private + 非 owner 普通用户 → 403 forbidden_remove_node --------
  // 拆 2 个子用例：a) 既非 owner 也非 creator；b) 非 owner 但是 creator
  // 后者锁住 v5 不变量："creator 身份单独不足以删除节点"，必须 admin 或 owner
  it('4a. private 画布 + 非 owner 非 creator 普通用户删除节点 → 403', () => {
    seedUsers();
    // private + ownerId=OWNER；节点由 OWNER 创建；STRANGER 既不是 owner 也不是 creator
    const { canvasId, initialData } = seedCanvas('private', OWNER.id, OWNER.id);

    const input: SaveCanvasInput = {
      id: canvasId,
      baseVersion: 1,
      data: dataWithoutN1(initialData),
      user: STRANGER,
    };
    const result = saveCanvas(input);

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    if (result.ok === false && result.error === 'forbidden_remove_node') {
      assert.match(result.message, /admin or canvas owner/);
    } else {
      assert.fail(`expected forbidden_remove_node, got: ${JSON.stringify(result)}`);
    }
  });

  it('4b. private 画布 + 非 owner 但是 creator 普通用户删除自己节点 → 403（creator 不能删）', () => {
    seedUsers();
    // private + ownerId=OWNER；节点由 STRANGER 创建；STRANGER 是 creator 但不是 owner
    // 锁住 v5 不变量："creator 身份单独不足以删除节点"，必须 admin 或 owner
    const { canvasId, initialData } = seedCanvas(
      'private',
      OWNER.id,
      OWNER.id,
      STRANGER.id,
    );

    const input: SaveCanvasInput = {
      id: canvasId,
      baseVersion: 1,
      data: dataWithoutN1(initialData),
      user: STRANGER, // STRANGER 是节点 creator
    };
    const result = saveCanvas(input);

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    if (result.ok === false && result.error === 'forbidden_remove_node') {
      assert.match(result.message, /admin or canvas owner/);
    } else {
      assert.fail(`expected forbidden_remove_node, got: ${JSON.stringify(result)}`);
    }
  });

  // -------- 分支 5：private + admin（非 owner）→ ok --------
  it('5. private 画布 + admin（非 owner）删除节点 → ok（admin 全能）', () => {
    seedUsers();
    // private + ownerId = OWNER.id；ADMIN 不是 owner，但 isAdmin=true → 放行
    const { canvasId, initialData } = seedCanvas('private', OWNER.id, OWNER.id);

    const input: SaveCanvasInput = {
      id: canvasId,
      baseVersion: 1,
      data: dataWithoutN1(initialData),
      user: ADMIN,
    };
    const result = saveCanvas(input);

    assert.equal(result.ok, true);
    if (result.ok === true) {
      assert.equal(result.version, 2);
    }
  });

  // -------- 验证：成功删除时 nodes_meta + annotations 都被清理（同事务） --------
  // §5.7 步骤 8.4：DELETE annotations FIRST，再 DELETE nodes_meta（无 FK 级联，靠显式顺序）
  it('删除成功后 nodes_meta + annotations 同事务删除（边界验证）', () => {
    seedUsers();
    const { canvasId, initialData } = seedCanvas('public', null, OWNER.id);

    // 给 n1 加一条 annotation，验证 saveCanvas removed 时也会删掉
    const now = Date.now();
    db.prepare(
      `INSERT INTO annotations
         (canvas_id, sheet_id, node_id, author_id, content, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'unresolved', ?)`,
    ).run(canvasId, 's1', 'n1', OWNER.id, 'test annotation', now);

    // 删除前确认 annotation 存在
    const before = db
      .prepare(
        'SELECT COUNT(*) AS c FROM annotations WHERE canvas_id = ? AND node_id = ?',
      )
      .get(canvasId, 'n1') as { c: number };
    assert.equal(before.c, 1);

    // admin 删 n1
    saveCanvas({
      id: canvasId,
      baseVersion: 1,
      data: dataWithoutN1(initialData),
      user: ADMIN,
    });

    // 验证 nodes_meta 中 n1 已被删除
    const metaRemaining = db
      .prepare(
        'SELECT COUNT(*) AS c FROM nodes_meta WHERE canvas_id = ? AND node_id = ?',
      )
      .get(canvasId, 'n1') as { c: number };
    assert.equal(metaRemaining.c, 0);

    // 验证 annotations 也被同事务删除（§5.7 步骤 8.4）
    const annotationsRemaining = db
      .prepare(
        'SELECT COUNT(*) AS c FROM annotations WHERE canvas_id = ? AND node_id = ?',
      )
      .get(canvasId, 'n1') as { c: number };
    assert.equal(annotationsRemaining.c, 0);
  });
});
