// canvas 业务服务层 —— 封装 DB 事务与权限规则
//
// 关键不变量（方案 §3.1 / §5.1 / §5.7）：
// - 创建画布必须**同事务**：插入 canvases + canvas_versions(v=1) + 为初始 data 中所有节点写 nodes_meta
// - 保存画布走"情况 1"路径（无并发）：baseVersion == currentVersion 才直接写；否则 409
//   完整合并算法（情况 2/3）留到方案 §7 阶段 5 再做
// - PUT 必须包在 BEGIN IMMEDIATE 事务里，避免两个并发 PUT 同时通过版本检查
// - nodes_meta 是节点元信息唯一可信源；服务端在保存前用它重写 canvases.data 中的元字段

import type { Database as DatabaseType } from 'better-sqlite3';
import { getDb } from '../db/index.ts';
import type { MultiCanvasProjectInput } from '../schemas/canvas.ts';
import type { UserPublic } from '../types/user.ts';

export type Visibility = 'public' | 'private';

export interface CanvasRow {
  id: number;
  name: string;
  description: string | null;
  visibility: Visibility;
  is_public_to_guest: number;
  owner_id: number | null;
  data: string; // JSON
  version: number;
  created_by: number;
  created_at: number;
  updated_by: number;
  updated_at: number;
  archived: number;
}

export interface CanvasListItem {
  id: number;
  name: string;
  description: string | null;
  visibility: Visibility;
  is_public_to_guest: boolean;
  owner_id: number | null;
  version: number;
  created_by: number;
  created_at: number;
  updated_by: number;
  updated_at: number;
  archived: boolean;
}

function toListItem(row: CanvasRow): CanvasListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    is_public_to_guest: row.is_public_to_guest === 1,
    owner_id: row.owner_id,
    version: row.version,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    archived: row.archived === 1,
  };
}

// =====================================================================
// 列表
// =====================================================================

/** 游客可见：仅 public + is_public_to_guest=1 + 未归档 */
export function listCanvasesForGuest(): CanvasListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM canvases
       WHERE visibility = 'public' AND is_public_to_guest = 1 AND archived = 0
       ORDER BY updated_at DESC`
    )
    .all() as CanvasRow[];
  return rows.map(toListItem);
}

/** 登录用户可见：所有 public（无论 guest 标记）+ 自己 owner 的 private + 未归档 */
export function listCanvasesForUser(userId: number): CanvasListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM canvases
       WHERE archived = 0
         AND (visibility = 'public' OR (visibility = 'private' AND owner_id = ?))
       ORDER BY updated_at DESC`
    )
    .all(userId) as CanvasRow[];
  return rows.map(toListItem);
}

/** admin：能看所有非归档 */
export function listCanvasesForAdmin(): CanvasListItem[] {
  const rows = getDb()
    .prepare(`SELECT * FROM canvases WHERE archived = 0 ORDER BY updated_at DESC`)
    .all() as CanvasRow[];
  return rows.map(toListItem);
}

// =====================================================================
// 单画布读
// =====================================================================

/** 读单个画布；权限检查由 route 层做 */
export function getCanvasRow(id: number): CanvasRow | null {
  const row = getDb().prepare('SELECT * FROM canvases WHERE id = ?').get(id) as
    | CanvasRow
    | undefined;
  return row ?? null;
}

/** 当前用户能否查看此画布 */
export function canRead(row: CanvasRow, user: UserPublic | null): boolean {
  if (row.archived === 1) {
    // 归档画布只 admin 能看（§9.4）
    return user?.role === 'admin';
  }
  if (row.visibility === 'public') {
    if (user) return true;
    return row.is_public_to_guest === 1; // 游客需要勾选标记
  }
  // private: 只 owner / admin
  if (!user) return false;
  if (user.role === 'admin') return true;
  return row.owner_id === user.id;
}

/** 当前用户能否编辑此画布（写权限）*/
export function canWrite(row: CanvasRow, user: UserPublic | null): boolean {
  if (!user) return false; // 游客不能写
  if (row.archived === 1) return user.role === 'admin'; // 归档只 admin 能改
  if (row.visibility === 'public') return true; // 任何登录用户能编辑共有画布
  // private: 只 owner / admin
  if (user.role === 'admin') return true;
  return row.owner_id === user.id;
}

// =====================================================================
// 创建
// =====================================================================

export interface CreateCanvasInput {
  name: string;
  description?: string;
  visibility: Visibility;
  is_public_to_guest?: boolean;
  data: MultiCanvasProjectInput;
  user: UserPublic;
}

export interface CreateCanvasResult {
  id: number;
  version: 1;
}

/**
 * 创建画布（方案 §3.1 初始快照三步流程）：
 * 1. INSERT canvases（version=1）
 * 2. INSERT canvas_versions(version=1, data, ...) 写初始快照
 * 3. 为初始 data 中所有节点写 nodes_meta（creator_id = 当前用户）
 *
 * 全部包在事务里；任一步失败回滚。
 *
 * 权限：visibility='public' 仅 admin 能创建；'private' 任何登录用户。
 */
export function createCanvas(input: CreateCanvasInput): CreateCanvasResult {
  const db = getDb();
  const { name, description, visibility, is_public_to_guest, data, user } = input;
  const now = Date.now();
  const dataJson = JSON.stringify(data);

  // owner_id：private 时为创建者；public 不绑定 owner
  const ownerId = visibility === 'private' ? user.id : null;

  // BEGIN IMMEDIATE 立即拿写锁，避免两个并发创建打架
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO canvases
           (name, description, visibility, is_public_to_guest, owner_id, data, version,
            created_by, created_at, updated_by, updated_at, archived)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0)`
      )
      .run(
        name,
        description ?? null,
        visibility,
        is_public_to_guest ? 1 : 0,
        ownerId,
        dataJson,
        user.id,
        now,
        user.id,
        now
      );
    const canvasId = Number(result.lastInsertRowid);

    // 初始版本快照
    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, 1, ?, ?, ?)`
    ).run(canvasId, dataJson, user.id, now);

    // 为初始 data 中所有节点写 nodes_meta（方案 §3.1 v4 修订关键步骤）
    const insertMeta = db.prepare(
      `INSERT INTO nodes_meta
         (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at, is_deprecated)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    );
    for (const sheet of data.sheets) {
      for (const node of sheet.nodes) {
        insertMeta.run(canvasId, sheet.id, node.id, user.id, now, user.id, now);
      }
    }

    return canvasId;
  });

  // .immediate() 走 BEGIN IMMEDIATE（立即拿写锁），避免两个并发创建竞态
  const canvasId = tx.immediate();
  return { id: canvasId, version: 1 };
}

// =====================================================================
// 保存（情况 1：无并发版；后续阶段 5 加合并算法）
// =====================================================================

export interface SaveCanvasInput {
  id: number;
  baseVersion: number;
  data: MultiCanvasProjectInput;
  user: UserPublic;
}

export type SaveCanvasResult =
  | { ok: true; version: number; merged: false }
  | { ok: false; status: 409; error: 'conflict'; currentVersion: number };

/**
 * 保存画布（方案 §5.2 情况 1）：
 * - baseVersion == currentVersion → 直接保存为 currentVersion+1
 * - 不一致 → 返回 409 让前端走"看对方版本/覆盖"路径
 *
 * 同事务内：
 * 1. SELECT 当前 version + data（用于 nodes_meta 比对）
 * 2. 比 baseVersion；不等返 409
 * 3. UPDATE canvases.data + version=v+1 + updated_at/updated_by
 * 4. INSERT canvas_versions 新快照
 * 5. 同步 nodes_meta（增加新增节点，更新已有节点）—— §5.7
 *
 * v2.1 阶段加完整合并算法（§5.6）
 */
export function saveCanvas(input: SaveCanvasInput): SaveCanvasResult {
  const db = getDb();
  const { id, baseVersion, data, user } = input;
  const now = Date.now();
  const dataJson = JSON.stringify(data);

  const tx = db.transaction((): SaveCanvasResult => {
    // BEGIN IMMEDIATE 由 db.transaction 默认提供（写事务）
    const row = db.prepare('SELECT version FROM canvases WHERE id = ?').get(id) as
      | { version: number }
      | undefined;
    if (!row) {
      throw new Error('canvas_not_found');
    }
    if (row.version !== baseVersion) {
      // 情况 2/3：返回 409，让前端弹窗（阶段 5 才做合并）
      return {
        ok: false,
        status: 409,
        error: 'conflict',
        currentVersion: row.version,
      };
    }

    const newVersion = row.version + 1;

    // 写主表
    db.prepare(
      `UPDATE canvases
         SET data = ?, version = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(dataJson, newVersion, user.id, now, id);

    // 追加版本快照
    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, newVersion, dataJson, user.id, now);

    // 同步 nodes_meta：仅新增（新节点）和更新（已存在）
    // 完整规则见 §5.7（含越权检查、标废弃、admin 物理删等）—— 阶段 3 再补严格版
    // 当前 MVP 简化：所有当前 data 中的节点都 INSERT OR IGNORE，已存在的不动
    const insertMeta = db.prepare(
      `INSERT OR IGNORE INTO nodes_meta
         (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at, is_deprecated)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    );
    for (const sheet of data.sheets) {
      for (const node of sheet.nodes) {
        insertMeta.run(id, sheet.id, node.id, user.id, now, user.id, now);
      }
    }

    return { ok: true, version: newVersion, merged: false };
  });

  // .immediate(): BEGIN IMMEDIATE，避免两个并发 PUT 同时通过版本检查
  return tx.immediate();
}

// =====================================================================
// PATCH 元信息
// =====================================================================

export interface PatchCanvasInput {
  id: number;
  patch: {
    name?: string;
    description?: string;
    is_public_to_guest?: boolean;
    archived?: boolean;
    owner_id?: number | null;
  };
  user: UserPublic;
}

export function patchCanvasMeta(input: PatchCanvasInput): void {
  const db = getDb();
  const { id, patch, user } = input;
  const now = Date.now();

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    vals.push(patch.description);
  }
  if (patch.is_public_to_guest !== undefined) {
    sets.push('is_public_to_guest = ?');
    vals.push(patch.is_public_to_guest ? 1 : 0);
  }
  if (patch.archived !== undefined) {
    sets.push('archived = ?');
    vals.push(patch.archived ? 1 : 0);
  }
  if (patch.owner_id !== undefined) {
    sets.push('owner_id = ?');
    vals.push(patch.owner_id);
  }

  if (sets.length === 0) return; // no-op patch

  sets.push('updated_by = ?', 'updated_at = ?');
  vals.push(user.id, now);
  vals.push(id);

  db.prepare(`UPDATE canvases SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

// =====================================================================
// DELETE（归档）
// =====================================================================

/** 软删（archived=1）。彻底物理删需 admin 在管理后台另行操作（§9.4） */
export function archiveCanvas(id: number, user: UserPublic): void {
  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE canvases SET archived = 1, updated_by = ?, updated_at = ? WHERE id = ?`
    )
    .run(user.id, now, id);
}
