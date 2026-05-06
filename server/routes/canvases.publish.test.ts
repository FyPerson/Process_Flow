// P3G 路由层集成测试：publish/unpublish 端点 + POST visibility 强制 private
//
// 测目标：锁定 5 条产品规则的服务端契约（详见
// [01-取舍审查-P3G](../../docs/规划/codex审查记录/阶段3/P3G/01-取舍审查-P3G-公共画布发布治理.md)）
// 风格对齐 users.test.ts（Express ephemeral port + ':memory:' DB + 复跑 migrations）
//
// 测试矩阵（11 项，依据 P3G 方案文档"测试矩阵"段）：
// 1.  POST /api/canvases visibility=public（admin 也不行）→ 403
// 2.  POST /api/canvases visibility=private 通过 → 201
// 3.  publish 普通用户 → 401（requireFreshAdmin）
// 4.  publish 不带 token → 401
// 5.  publish admin token 被另一 admin 降权后 → 403（requireFreshAdmin 即时校验）
// 6.  publish 已 public 画布 → 409 already_public
// 7.  publish archived 画布 → 409 archived_canvas
// 8.  publish private 画布通过 → published_* 写入 / owner_id 不变 / is_public_to_guest=0
// 9.  unpublish 已 private → 409 already_private
// 10. unpublish public 通过 → visibility=private / owner_id 不变 / published_* 不清空 / unpublished_* 写入
// 11. PATCH /api/canvases/:id 传 visibility → 400（zod strict reject）
// 12. 历史 public 画布（migration 0003 回填）→ GET 列表返回 published_*
// 13. 普通 owner PATCH 自己 private 画布 name → 200（验证 P3G-2 不误伤）

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
const ADMIN2: UserPublic = { id: 2, username: 'admin2', role: 'admin' };
const ALICE: UserPublic = { id: 3, username: 'alice', role: 'user' };

let db: DatabaseType;
let server: Server;
let baseUrl: string;

// 最小合法的 MultiCanvasProject（schema 要求 sheets[0].nodes 任意 / connectors 任意）
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
  for (const u of [ADMIN, ADMIN2, ALICE]) {
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

/** 创建 private 画布并返回 id（用 alice 作 owner） */
async function createPrivateCanvas(owner: UserPublic = ALICE, name = 'p1'): Promise<number> {
  const res = await fetch(`${baseUrl}/api/canvases`, {
    method: 'POST',
    headers: jsonHeader(owner),
    body: JSON.stringify({
      name,
      visibility: 'private',
      data: makeMinProject(),
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { id: number };
  return body.id;
}

// =====================================================================
describe('P3G publish/unpublish 路由契约', () => {
  // -------- 1. POST visibility=public 被强制拒（admin 也不行） --------
  it('1. admin POST /api/canvases visibility=public → 403', async () => {
    const res = await fetch(`${baseUrl}/api/canvases`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({
        name: 'should fail',
        visibility: 'public',
        data: makeMinProject(),
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'forbidden');
  });

  // -------- 1b. visibility 边界参数化（codex 02-审 #6） --------
  // 区分 schema 校验失败（400）vs route 策略拒（403）：
  // - schema enum 拒：缺失 / null / 'PUBLIC' / 'private '（trim 不在 schema 内）/ 非法字符串 → 400
  // - schema 通过 + route 策略拒：'public' → 403
  it('1b. visibility 缺失 → 400（schema enum 拒）', async () => {
    const res = await fetch(`${baseUrl}/api/canvases`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ name: 'x', data: makeMinProject() }),
    });
    assert.equal(res.status, 400);
  });

  it("1c. visibility=null → 400（schema enum 拒）", async () => {
    const res = await fetch(`${baseUrl}/api/canvases`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ name: 'x', visibility: null, data: makeMinProject() }),
    });
    assert.equal(res.status, 400);
  });

  it("1d. visibility='PUBLIC'（大小写错）→ 400", async () => {
    const res = await fetch(`${baseUrl}/api/canvases`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ name: 'x', visibility: 'PUBLIC', data: makeMinProject() }),
    });
    assert.equal(res.status, 400);
  });

  it("1e. visibility='private '（带空格）→ 400", async () => {
    const res = await fetch(`${baseUrl}/api/canvases`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ name: 'x', visibility: 'private ', data: makeMinProject() }),
    });
    assert.equal(res.status, 400);
  });

  it("1f. visibility='other'（非法字符串）→ 400", async () => {
    const res = await fetch(`${baseUrl}/api/canvases`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ name: 'x', visibility: 'other', data: makeMinProject() }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 2. POST private 通过 --------
  it('2. alice POST /api/canvases visibility=private → 201', async () => {
    const id = await createPrivateCanvas(ALICE);
    assert.ok(id > 0);
  });

  // -------- 3. publish 普通用户 → 403 --------
  it('3. alice POST /api/canvases/:id/publish → 403（requireFreshAdmin）', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ published_note: 'test note' }),
    });
    assert.equal(res.status, 403);
  });

  // -------- 4. publish 无 token → 401 --------
  it('4. 游客 POST /api/canvases/:id/publish → 401', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published_note: 'test note' }),
    });
    assert.equal(res.status, 401);
  });

  // -------- 5. admin token 被降权后 publish → 403 --------
  it('5. admin 被另一 admin 降权后 publish → 403（即时校验）', async () => {
    const id = await createPrivateCanvas(ALICE);
    // 降权 ADMIN2 → user
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('user', ADMIN2.id);
    // ADMIN2 持旧 admin token
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN2),
      body: JSON.stringify({ published_note: 'test note' }),
    });
    assert.equal(res.status, 403);
  });

  // -------- 6. publish 已 public → 409 already_public --------
  it('6. admin publish 已 public 画布 → 409 already_public', async () => {
    const id = await createPrivateCanvas(ALICE);
    const r1 = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: '首次发布' }),
    });
    assert.equal(r1.status, 200);
    const r2 = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: '重复发布' }),
    });
    assert.equal(r2.status, 409);
    const body = await r2.json() as { error: string };
    assert.equal(body.error, 'already_public');
  });

  // -------- 7. publish archived 画布 → 409 archived_canvas --------
  it('7. admin publish archived 画布 → 409 archived_canvas', async () => {
    const id = await createPrivateCanvas(ALICE);
    db.prepare('UPDATE canvases SET archived = 1 WHERE id = ?').run(id);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: 'test' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'archived_canvas');
  });

  // -------- 8. publish private 通过 + 字段语义校验 --------
  it('8. publish 通过 → published_* 写入 / owner_id 保留 / is_public_to_guest=0', async () => {
    const id = await createPrivateCanvas(ALICE);
    // 故意先把 is_public_to_guest 置 1 模拟异常态（publish 必须强制重置回 0）
    db.prepare('UPDATE canvases SET is_public_to_guest = 1 WHERE id = ?').run(id);

    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: '正式发布 v1' }),
    });
    assert.equal(res.status, 200);

    const row = db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as {
      visibility: string;
      is_public_to_guest: number;
      owner_id: number | null;
      published_at: number | null;
      published_by: number | null;
      published_note: string | null;
    };
    assert.equal(row.visibility, 'public');
    assert.equal(row.is_public_to_guest, 0, '即使发布前异常 = 1，publish 必须重置回 0');
    assert.equal(row.owner_id, ALICE.id, 'publish 必须保留发布前 owner_id（codex 审 #1）');
    assert.ok(row.published_at && row.published_at > 0);
    assert.equal(row.published_by, ADMIN.id);
    assert.equal(row.published_note, '正式发布 v1');
  });

  // -------- 9. unpublish 已 private → 409 already_private --------
  it('9. admin unpublish 已 private 画布 → 409 already_private', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/unpublish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'already_private');
  });

  // -------- 10. unpublish public 通过 + owner 不变 + published_* 保留 + unpublished_* 写入 --------
  it('10. unpublish public → visibility=private / owner_id 保留 / published_* 不清空 / unpublished_* 写入', async () => {
    const id = await createPrivateCanvas(ALICE);
    // 先发布
    await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: '初次发布' }),
    });
    // 撤回
    const res = await fetch(`${baseUrl}/api/canvases/${id}/unpublish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);

    const row = db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as {
      visibility: string;
      owner_id: number | null;
      published_at: number | null;
      published_note: string | null;
      unpublished_at: number | null;
      unpublished_by: number | null;
    };
    assert.equal(row.visibility, 'private');
    assert.equal(row.owner_id, ALICE.id, 'unpublish 不动 owner_id（codex 审 #1：避免悄悄夺权）');
    assert.ok(row.published_at && row.published_at > 0, 'published_at 保留');
    assert.equal(row.published_note, '初次发布', 'published_note 保留作"最近一次发布"语义');
    assert.ok(row.unpublished_at && row.unpublished_at > 0);
    assert.equal(row.unpublished_by, ADMIN.id);
  });

  // -------- 11. PATCH visibility 被 zod strict 拒 --------
  it('11. PATCH /api/canvases/:id 传 visibility → 400 invalid_input（zod strict）', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'PATCH',
      headers: jsonHeader(ADMIN),
      // visibility 不在 PatchCanvasRequestSchema 字段表里 + .strict() → 拒
      body: JSON.stringify({ visibility: 'public' }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 12. (已删除) migration 回填验证迁到独立 describe 块"P3G migration 0003 真实升级路径"
  //              codex 03 三审 #1：原 #12 复制旧语义 SQL + 跑完 0003 后再手动 UPDATE，
  //              语义不等同最新 COALESCE 实现，且 dedicated 测试已覆盖；删冗余 --------

  // -------- 13. 普通 owner PATCH 自己 private 画布 name → 200（P3G-2 不误伤） --------
  it('13. 普通 owner PATCH 自己 private 画布 name → 200', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}`, {
      method: 'PATCH',
      headers: jsonHeader(ALICE),
      body: JSON.stringify({ name: 'renamed by alice' }),
    });
    assert.equal(res.status, 200, '普通 owner 改自己 private 画布 name 不能被 P3G-2 误伤');
  });

  // -------- 14. publish published_note 全空格 → 400 invalid_input --------
  it('14. publish published_note 全空格 → 400 invalid_input', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: '   ' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'invalid_input');
  });

  // -------- 15. publish published_note 超长 → 400 (zod max 500) --------
  it('15. publish published_note > 500 字 → 400', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: 'x'.repeat(501) }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 16. trim 收敛：前后空格 + 正文 ≤500 通过；trim 后空被拒 --------
  it('16a. publish "  正文  "（前后空格）→ schema trim 后通过 200', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: '   正文 abc   ' }),
    });
    assert.equal(res.status, 200);
    const row = db.prepare('SELECT published_note FROM canvases WHERE id = ?').get(id) as {
      published_note: string;
    };
    assert.equal(row.published_note, '正文 abc', 'note 落库时应已 trim');
  });

  it('16b. publish 大量前后空格 + 正文恰好 500 → 通过 200（codex 02-审 #1）', async () => {
    const id = await createPrivateCanvas(ALICE);
    // schema 是 transform(trim).pipe(min(1).max(500))，先 trim 再校验长度
    // 原始 600 字（前 50 + 正文 500 + 后 50 空格）→ trim 后 500 字 → 通过
    const padded = '          ' + 'x'.repeat(500) + '          ';
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: padded }),
    });
    assert.equal(res.status, 200);
  });

  it('16c. publish trim 后超 500 → 400', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: '  ' + 'x'.repeat(501) + '  ' }),
    });
    assert.equal(res.status, 400);
  });

  // -------- 17. PublishCanvasRequestSchema .strict() 锁定（codex 03 三审建议）：
  //              body 带未知字段被 zod strict 拒，防止未来意外通过额外字段绕过 --------
  it('17. publish body 带未知字段 → 400（schema .strict() 拒）', async () => {
    const id = await createPrivateCanvas(ALICE);
    const res = await fetch(`${baseUrl}/api/canvases/${id}/publish`, {
      method: 'POST',
      headers: jsonHeader(ADMIN),
      body: JSON.stringify({ published_note: 'ok', extra_field: 'should be rejected' }),
    });
    assert.equal(res.status, 400);
  });
});

// =====================================================================
// migration 0003 真实升级路径测试（codex 02-审 #5 + 03 三审 #2）：
// 不复用 beforeEach（那个一次性跑完所有 migration），自建独立 in-memory DB，
// 只跑 0001/0002 → 插 legacy public 行 → 跑 0003 → 断言回填生效。
// 验证 migration 文件本身在"旧库升级"场景中真的工作，而不是测试复制实现 SQL。
//
// 文件定位用 startsWith 显式查找（codex 03 三审 #2），避免依赖数组下标
// （未来若插入更早编号或调整文件排序，下标会跑错文件）。
// =====================================================================

/** 按编号前缀显式定位 migration 文件，返回绝对路径 */
function findMigration(prefix: string): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const found = files.find((f) => f.startsWith(prefix));
  assert.ok(found, `migration with prefix ${prefix} not found in ${MIGRATIONS_DIR}`);
  return path.join(MIGRATIONS_DIR, found!);
}

/** 跑指定 migration 文件 */
function runMigration(db: DatabaseType, prefix: string): void {
  db.exec(fs.readFileSync(findMigration(prefix), 'utf-8'));
}

/** 准备一个只跑了 0001/0002 的库（即 P3G 之前的旧库状态），插入一个 admin */
function makePreUpgradeDb(): DatabaseType {
  const upgradeDb = new Database(':memory:');
  upgradeDb.pragma('journal_mode = WAL');
  upgradeDb.pragma('foreign_keys = ON');
  runMigration(upgradeDb, '0001_');
  runMigration(upgradeDb, '0002_');
  const now = Date.now();
  upgradeDb
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (1, 'admin', 'h', 'admin', ?, ?)`,
    )
    .run(now, now);
  return upgradeDb;
}

describe('P3G migration 0003 真实升级路径', () => {
  it('真升级：跑 0001/0002 → 插 legacy public → 跑 0003 → 字段被回填', () => {
    const upgradeDb = makePreUpgradeDb();
    const now = Date.now();

    // 此时 canvases 表还没 published_* 列；INSERT 自然不带这些列
    upgradeDb
      .prepare(
        `INSERT INTO canvases
           (id, name, description, visibility, is_public_to_guest, owner_id,
            data, version, created_by, created_at, updated_by, updated_at, archived)
         VALUES (?, ?, NULL, 'public', 0, NULL, ?, 1, ?, ?, ?, ?, 0)`,
      )
      .run(99, 'legacy public', '{"sheets":[]}', 1, now, 1, now);

    runMigration(upgradeDb, '0003_'); // 真"旧库升级"动作

    const row = upgradeDb.prepare('SELECT * FROM canvases WHERE id = 99').get() as {
      published_at: number | null;
      published_by: number | null;
      published_note: string | null;
      unpublished_at: number | null;
    };
    assert.equal(row.published_at, now, 'published_at 应回填为 created_at');
    assert.equal(row.published_by, 1, 'published_by 应回填为 created_by');
    assert.equal(row.published_note, '历史 public 画布迁移回填');
    assert.equal(row.unpublished_at, null, 'unpublished_at 不应被回填');

    upgradeDb.close();
  });

  it('真升级：archived public 不回填', () => {
    const upgradeDb = makePreUpgradeDb();
    const now = Date.now();
    upgradeDb
      .prepare(
        `INSERT INTO canvases
           (id, name, visibility, is_public_to_guest, owner_id, data, version,
            created_by, created_at, updated_by, updated_at, archived)
         VALUES (98, 'archived legacy public', 'public', 0, NULL, '{"sheets":[]}', 1, 1, ?, 1, ?, 1)`,
      )
      .run(now, now);

    runMigration(upgradeDb, '0003_');

    const row = upgradeDb.prepare('SELECT published_at FROM canvases WHERE id = 98').get() as {
      published_at: number | null;
    };
    assert.equal(row.published_at, null, '归档画布不在 admin 列表，不需要回填');

    upgradeDb.close();
  });

  it('真升级：private 画布不回填', () => {
    const upgradeDb = makePreUpgradeDb();
    const now = Date.now();
    upgradeDb
      .prepare(
        `INSERT INTO canvases
           (id, name, visibility, is_public_to_guest, owner_id, data, version,
            created_by, created_at, updated_by, updated_at, archived)
         VALUES (97, 'private one', 'private', 0, 1, '{"sheets":[]}', 1, 1, ?, 1, ?, 0)`,
      )
      .run(now, now);

    runMigration(upgradeDb, '0003_');

    const row = upgradeDb.prepare('SELECT published_at FROM canvases WHERE id = 97').get() as {
      published_at: number | null;
    };
    assert.equal(row.published_at, null, 'private 画布不应被回填');

    upgradeDb.close();
  });

  it('回填 SQL 语义：部分字段缺失仅补缺失值（codex 02-审 #2 + 03 三审 #1 改名）', () => {
    // 注意：这是"回填 SQL 语义验证"——不是旧库真实升级路径。
    // 模拟未来 SQL 直接改库塞进部分字段（如 published_at 有但 by/note NULL）后再次执行回填。
    // 完整的旧库升级路径见上方"真升级：跑 0001/0002 → 插 legacy public → 跑 0003"用例。
    const upgradeDb = makePreUpgradeDb();
    runMigration(upgradeDb, '0003_'); // 升级到最新 schema

    const now = Date.now();
    const earlier = now - 100000;
    upgradeDb
      .prepare(
        `INSERT INTO canvases
           (id, name, visibility, is_public_to_guest, owner_id, data, version,
            created_by, created_at, updated_by, updated_at, archived,
            published_at, published_by, published_note)
         VALUES (96, 'partial', 'public', 0, NULL, '{"sheets":[]}', 1, 1, ?, 1, ?, 0,
                 ?, NULL, NULL)`,
      )
      .run(now, now, earlier);

    // 再次跑回填语义（与 0003 中 UPDATE 完全一致；这里是验证 SQL 语义而非 migration 升级）
    upgradeDb
      .prepare(
        `UPDATE canvases
           SET published_at = COALESCE(published_at, created_at),
               published_by = COALESCE(published_by, created_by),
               published_note = COALESCE(published_note, '历史 public 画布迁移回填')
         WHERE visibility = 'public'
           AND archived = 0
           AND (published_at IS NULL OR published_by IS NULL OR published_note IS NULL)`,
      )
      .run();

    const row = upgradeDb.prepare('SELECT * FROM canvases WHERE id = 96').get() as {
      published_at: number;
      published_by: number;
      published_note: string;
    };
    assert.equal(row.published_at, earlier, '已有 published_at 不应被覆盖');
    assert.equal(row.published_by, 1, 'published_by 缺失被回填');
    assert.equal(row.published_note, '历史 public 画布迁移回填');

    upgradeDb.close();
  });
});
