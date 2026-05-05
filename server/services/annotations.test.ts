// P3E-1 服务端批注 service 单测
//
// 覆盖：
// - listAnnotationsByCanvas：正序 / 跨 sheet 同 node_id 不串
// - getAnnotationById / nodeExistsInCanvas / getNodeCreatorId
// - checkNodeCapacity：unresolved 上限 / 全部上限 / 边界
// - canCloseAnnotation：作者 / 节点 creator / admin / 其他用户
// - createAnnotation / resolveAnnotation / reopenAnnotation 幂等
//
// 与 canvases.removed.test.ts 同款：内存 db + setDbForTesting + 跑全部 migration

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

import { setDbForTesting } from '../db/index.ts';
import {
  canCloseAnnotation,
  checkNodeCapacity,
  createAnnotation,
  getAnnotationById,
  getNodeCreatorId,
  listAnnotationsByCanvas,
  nodeExistsInCanvas,
  reopenAnnotation,
  resolveAnnotation,
} from './annotations.ts';
import type { CanvasRow } from './canvases.ts';
import type { UserPublic } from '../types/user.ts';
import type { MultiCanvasProjectInput } from '../schemas/canvas.ts';
import {
  ANNOTATION_UNRESOLVED_MAX_PER_NODE,
  ANNOTATION_TOTAL_MAX_PER_NODE,
} from '../schemas/annotation.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

let db: DatabaseType;

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin' };
const ALICE: UserPublic = { id: 2, username: 'alice', role: 'user' };
const BOB: UserPublic = { id: 3, username: 'bob', role: 'user' };
const CAROL: UserPublic = { id: 4, username: 'carol', role: 'user' };

beforeEach(() => {
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
  userStmt.run(ADMIN.id, ADMIN.username, ADMIN.role, now, now);
  userStmt.run(ALICE.id, ALICE.username, ALICE.role, now, now);
  userStmt.run(BOB.id, BOB.username, BOB.role, now, now);
  userStmt.run(CAROL.id, CAROL.username, CAROL.role, now, now);
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

// =====================================================================
// fixture：建带两个 sheet（s1 / s2）+ 同 node_id 'n1' 的画布
// 用来验证"跨 sheet 同 node_id 不串"
// =====================================================================
function seedCanvasWith2Sheets(canvasCreatedBy: number, nodeCreatedBy: number = canvasCreatedBy): {
  canvasId: number;
  canvasRow: CanvasRow;
  data: MultiCanvasProjectInput;
} {
  const now = Date.now();
  const data: MultiCanvasProjectInput = {
    version: 2,
    id: 'p1',
    name: 'test',
    activeSheetId: 's1',
    sheets: [
      {
        id: 's1',
        name: 'sheet 1',
        nodes: [
          { id: 'n1', name: 'node s1-n1', type: 'process', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, expandable: false },
          { id: 'n2', name: 'node s1-n2', type: 'process', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, expandable: false },
        ],
        connectors: [],
      },
      {
        id: 's2',
        name: 'sheet 2',
        nodes: [
          { id: 'n1', name: 'node s2-n1 (同 node_id)', type: 'process', position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, expandable: false },
        ],
        connectors: [],
      },
    ],
  };

  const result = db
    .prepare(
      `INSERT INTO canvases (name, description, visibility, is_public_to_guest, owner_id, data, version,
                              created_by, created_at, updated_by, updated_at, archived)
       VALUES ('test', NULL, 'public', 0, NULL, ?, 1, ?, ?, ?, ?, 0)`,
    )
    .run(JSON.stringify(data), canvasCreatedBy, now, canvasCreatedBy, now);
  const canvasId = Number(result.lastInsertRowid);

  // nodes_meta 三条：s1.n1 / s1.n2 / s2.n1
  const metaStmt = db.prepare(
    `INSERT INTO nodes_meta (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
                              is_deprecated, deprecated_by, deprecated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
  );
  metaStmt.run(canvasId, 's1', 'n1', nodeCreatedBy, now, nodeCreatedBy, now);
  metaStmt.run(canvasId, 's1', 'n2', nodeCreatedBy, now, nodeCreatedBy, now);
  metaStmt.run(canvasId, 's2', 'n1', nodeCreatedBy, now, nodeCreatedBy, now);

  const canvasRow = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId) as CanvasRow;
  return { canvasId, canvasRow, data };
}

// =====================================================================
describe('nodeExistsInCanvas', () => {
  it('1. 节点存在 → true', () => {
    const { canvasRow } = seedCanvasWith2Sheets(ALICE.id);
    assert.equal(nodeExistsInCanvas(canvasRow, 's1', 'n1'), true);
    assert.equal(nodeExistsInCanvas(canvasRow, 's1', 'n2'), true);
    assert.equal(nodeExistsInCanvas(canvasRow, 's2', 'n1'), true);
  });

  it('2. sheetId 不存在 → false', () => {
    const { canvasRow } = seedCanvasWith2Sheets(ALICE.id);
    assert.equal(nodeExistsInCanvas(canvasRow, 's999', 'n1'), false);
  });

  it('3. nodeId 不存在 → false', () => {
    const { canvasRow } = seedCanvasWith2Sheets(ALICE.id);
    assert.equal(nodeExistsInCanvas(canvasRow, 's1', 'n999'), false);
  });

  it('4. canvases.data 损坏 → false（fail-closed）', () => {
    const { canvasRow } = seedCanvasWith2Sheets(ALICE.id);
    const broken = { ...canvasRow, data: 'not-json' };
    assert.equal(nodeExistsInCanvas(broken, 's1', 'n1'), false);
  });
});

// =====================================================================
describe('getNodeCreatorId', () => {
  it('1. 节点存在 → 返回 creator_id', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id, ALICE.id);
    assert.equal(getNodeCreatorId(canvasId, 's1', 'n1'), ALICE.id);
  });

  it('2. 节点不存在 → null', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    assert.equal(getNodeCreatorId(canvasId, 's1', 'ghost'), null);
  });

  it('3. 跨 sheet 同 node_id 各自独立', () => {
    // canvas creator = ALICE 但 nodeCreatedBy = BOB
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id, BOB.id);
    assert.equal(getNodeCreatorId(canvasId, 's1', 'n1'), BOB.id);
    assert.equal(getNodeCreatorId(canvasId, 's2', 'n1'), BOB.id);
  });
});

// =====================================================================
describe('createAnnotation + listAnnotationsByCanvas', () => {
  it('1. 创建后能查到，状态 unresolved，author_username hydrate', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const created = createAnnotation({
      canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'hello',
    });
    assert.equal(created.status, 'unresolved');
    assert.equal(created.author_id, ALICE.id);
    assert.equal(created.author_username, ALICE.username);
    assert.equal(created.content, 'hello');
    assert.equal(created.resolved_by, null);
    assert.equal(created.resolved_at, null);

    const list = listAnnotationsByCanvas(canvasId);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });

  it('2. 列表按 created_at 正序（早→晚）', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'first' });
    // 同毫秒入栈，靠 ORDER BY id 兜底
    const b = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: BOB.id, content: 'second' });
    const list = listAnnotationsByCanvas(canvasId);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, a.id);
    assert.equal(list[1].id, b.id);
  });

  it('3. 跨 sheet 同 node_id 不串', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 's1-n1' });
    createAnnotation({ canvasId, sheetId: 's2', nodeId: 'n1', authorId: ALICE.id, content: 's2-n1' });
    const list = listAnnotationsByCanvas(canvasId);
    const s1n1 = list.filter((a) => a.sheet_id === 's1' && a.node_id === 'n1');
    const s2n1 = list.filter((a) => a.sheet_id === 's2' && a.node_id === 'n1');
    assert.equal(s1n1.length, 1);
    assert.equal(s2n1.length, 1);
    assert.equal(s1n1[0].content, 's1-n1');
    assert.equal(s2n1[0].content, 's2-n1');
  });

  it('4. 作者用户软删（deleted_at 设值，row 仍存在）→ author_username 仍 hydrate', () => {
    // 业务规则（schema users §3.1 / §9.3）：用户走软删 deleted_at，不物理删除
    // → users 行仍在 → LEFT JOIN 仍返 username → 前端展示用户名仍正常
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const created = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), ALICE.id);
    const fetched = getAnnotationById(created.id);
    assert.ok(fetched);
    assert.equal(fetched!.author_id, ALICE.id);
    assert.equal(fetched!.author_username, ALICE.username);
  });
});

// =====================================================================
describe('checkNodeCapacity', () => {
  it('1. 空节点 → null', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    assert.equal(checkNodeCapacity(canvasId, 's1', 'n1'), null);
  });

  it('2. unresolved 达上限 → unresolved_limit', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    // 直接用 DB 插入加速（不通过 createAnnotation 一条条来）
    const stmt = db.prepare(
      `INSERT INTO annotations (canvas_id, sheet_id, node_id, author_id, content, status, created_at)
       VALUES (?, 's1', 'n1', ?, ?, 'unresolved', ?)`,
    );
    const now = Date.now();
    for (let i = 0; i < ANNOTATION_UNRESOLVED_MAX_PER_NODE; i++) {
      stmt.run(canvasId, ALICE.id, `c${i}`, now + i);
    }
    const cap = checkNodeCapacity(canvasId, 's1', 'n1');
    assert.ok(cap);
    assert.equal(cap!.type, 'unresolved_limit');
    assert.equal(cap!.current, ANNOTATION_UNRESOLVED_MAX_PER_NODE);
    assert.equal(cap!.max, ANNOTATION_UNRESOLVED_MAX_PER_NODE);
  });

  it('3. unresolved 未达但全部达上限 → total_limit', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const stmt = db.prepare(
      `INSERT INTO annotations (canvas_id, sheet_id, node_id, author_id, content, status, resolved_by, resolved_at, created_at)
       VALUES (?, 's1', 'n1', ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    // 50 条 unresolved + 450 条 resolved = 500 全部
    for (let i = 0; i < 50; i++) {
      stmt.run(canvasId, ALICE.id, `u${i}`, 'unresolved', null, null, now + i);
    }
    for (let i = 0; i < ANNOTATION_TOTAL_MAX_PER_NODE - 50; i++) {
      stmt.run(canvasId, ALICE.id, `r${i}`, 'resolved', ALICE.id, now, now + 50 + i);
    }
    const cap = checkNodeCapacity(canvasId, 's1', 'n1');
    assert.ok(cap);
    assert.equal(cap!.type, 'total_limit');
    assert.equal(cap!.max, ANNOTATION_TOTAL_MAX_PER_NODE);
  });

  it('4. 跨节点不互相影响', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const stmt = db.prepare(
      `INSERT INTO annotations (canvas_id, sheet_id, node_id, author_id, content, status, created_at)
       VALUES (?, 's1', 'n1', ?, ?, 'unresolved', ?)`,
    );
    const now = Date.now();
    for (let i = 0; i < ANNOTATION_UNRESOLVED_MAX_PER_NODE; i++) {
      stmt.run(canvasId, ALICE.id, `c${i}`, now + i);
    }
    // n1 满，但 n2 仍可创建
    assert.equal(checkNodeCapacity(canvasId, 's1', 'n2'), null);
  });
});

// =====================================================================
describe('canCloseAnnotation', () => {
  it('1. 批注作者 → true', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id, BOB.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    assert.equal(canCloseAnnotation(a, ALICE), true);
  });

  it('2. 节点 creator（非批注作者）→ true', () => {
    // node creator = BOB；批注 author = CAROL；BOB 应该能关
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id, BOB.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: CAROL.id, content: 'x' });
    assert.equal(canCloseAnnotation(a, BOB), true);
  });

  it('3. admin → true（不论作者/creator）', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id, BOB.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: CAROL.id, content: 'x' });
    assert.equal(canCloseAnnotation(a, ADMIN), true);
  });

  it('4. 其他普通用户 → false', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id, BOB.id);
    // node creator=BOB, author=ALICE；CAROL 既不是作者也不是 creator 也不是 admin
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    assert.equal(canCloseAnnotation(a, CAROL), false);
  });

  it('5. nodes_meta 缺失（节点已物理删除）→ creator 路径不放行（仅 admin/作者）', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id, BOB.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    // 模拟物理删除节点（理论上 §5.7 会同事务清 annotations，但防御性测试）
    db.prepare(`DELETE FROM nodes_meta WHERE canvas_id=? AND sheet_id='s1' AND node_id='n1'`).run(canvasId);
    // BOB 是节点 creator 但 nodes_meta 已无记录 → false
    assert.equal(canCloseAnnotation(a, BOB), false);
    // ALICE 是作者 → 仍 true
    assert.equal(canCloseAnnotation(a, ALICE), true);
    // admin → true
    assert.equal(canCloseAnnotation(a, ADMIN), true);
  });
});

// =====================================================================
describe('resolveAnnotation / reopenAnnotation', () => {
  it('1. resolve 后 status=resolved + resolved_by/at 填入', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    const resolved = resolveAnnotation(a.id, BOB.id);
    assert.ok(resolved);
    assert.equal(resolved!.status, 'resolved');
    assert.equal(resolved!.resolved_by, BOB.id);
    assert.equal(resolved!.resolved_by_username, BOB.username);
    assert.ok(resolved!.resolved_at !== null);
  });

  it('2. resolve 幂等（已 resolved 不变 resolved_by）', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    const first = resolveAnnotation(a.id, BOB.id);
    const second = resolveAnnotation(a.id, CAROL.id); // 试图覆盖
    assert.equal(second!.resolved_by, BOB.id, 'resolved_by 应保持首次解决者');
    assert.equal(second!.resolved_at, first!.resolved_at);
  });

  it('3. reopen 后 status=unresolved + resolved_by/at 清空', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    resolveAnnotation(a.id, BOB.id);
    const reopened = reopenAnnotation(a.id);
    assert.ok(reopened);
    assert.equal(reopened!.status, 'unresolved');
    assert.equal(reopened!.resolved_by, null);
    assert.equal(reopened!.resolved_at, null);
  });

  it('4. reopen 幂等（已 unresolved 不变）', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    const a = createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    const r = reopenAnnotation(a.id);
    assert.ok(r);
    assert.equal(r!.status, 'unresolved');
  });

  it('5. resolve/reopen 不存在的 id → null', () => {
    assert.equal(resolveAnnotation(99999, ALICE.id), null);
    assert.equal(reopenAnnotation(99999), null);
  });
});

// =====================================================================
describe('§5.7 集成：物理删除节点级联清 annotations', () => {
  it('1. 画布物理删除 → ON DELETE CASCADE 清 annotations', () => {
    const { canvasId } = seedCanvasWith2Sheets(ALICE.id);
    createAnnotation({ canvasId, sheetId: 's1', nodeId: 'n1', authorId: ALICE.id, content: 'x' });
    db.prepare('DELETE FROM canvases WHERE id = ?').run(canvasId);
    const remaining = db
      .prepare('SELECT COUNT(*) AS c FROM annotations WHERE canvas_id = ?')
      .get(canvasId) as { c: number };
    assert.equal(remaining.c, 0);
  });
});
