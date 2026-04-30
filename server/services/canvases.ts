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
  | { ok: false; status: 409; error: 'conflict'; currentVersion: number }
  | { ok: false; status: 409; error: 'node_id_collision'; currentVersion: number }
  | { ok: false; status: 409; error: 'node_meta_missing'; currentVersion: number }
  | { ok: false; status: 403; error: 'forbidden_modify_others_node'; message: string; currentVersion: number }
  | { ok: false; status: 403; error: 'forbidden_remove_node_non_admin'; message: string; currentVersion: number };

/**
 * 保存画布（方案 §5.2 情况 1 + §5.7 节点级权限严格化）：
 * - baseVersion == currentVersion → 直接保存为 currentVersion+1
 * - 不一致 → 返回 409 让前端走"看对方版本/覆盖"路径
 *
 * 同事务内（§5.7 阶段 3 严格化版本）：
 * 1. SELECT 当前 version + data
 * 2. 比 baseVersion；不等返 409
 * 3. **计算 deltaB**：按 (sheet_id, node_id) 比对当前服务端 data vs incoming data
 *    · added: 新增节点（服务端没有）
 *    · removed: 物理删除节点（服务端有但客户端没有）
 *    · modified: 节点内容变了（不只是 is_deprecated）
 *    · deprecated_changed: 仅 is_deprecated false→true 的"标废弃"变化
 * 4. **权限校验**（按 §5.7 规则）：
 *    · added → INSERT nodes_meta，creator = 当前用户
 *    · modified → 校验 creator == 当前用户 OR admin；否则 403
 *    · deprecated_changed → 任何登录用户允许（标废弃是公开权限）
 *    · removed → 仅 admin 允许；否则 403
 * 5. **重写 data 的节点元字段**：服务端从 nodes_meta 强制覆写客户端传的 creator/updated 等字段
 * 6. UPDATE canvases.data + version=v+1
 * 7. INSERT canvas_versions 新快照
 *
 * v2.1 阶段加完整合并算法（§5.6）
 */
type StorageNode = { id: string; is_deprecated?: boolean; [key: string]: unknown };
type StorageSheet = { id: string; nodes: StorageNode[]; [key: string]: unknown };
type NodeMetaRow = {
  node_id: string;
  sheet_id: string;
  creator_id: number;
  created_at: number;
  updated_by: number;
  updated_at: number;
  is_deprecated: number;
  deprecated_by: number | null;
  deprecated_at: number | null;
};

/** 节点 storage 内容比对 —— 排除元字段（creator/updated/deprecated 由服务端管）*/
function nodeContentEquals(a: StorageNode, b: StorageNode): boolean {
  // 把元字段剔除后再 JSON 比较
  const stripMeta = (n: StorageNode): unknown => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { creator_id, created_at, updated_by, updated_at, is_deprecated, ...rest } = n;
    return rest;
  };
  return JSON.stringify(stripMeta(a)) === JSON.stringify(stripMeta(b));
}

export function saveCanvas(input: SaveCanvasInput): SaveCanvasResult {
  const db = getDb();
  const { id, baseVersion, data, user } = input;
  const now = Date.now();

  const tx = db.transaction((): SaveCanvasResult => {
    // 1. 取当前画布（version + data）
    const row = db.prepare('SELECT version, data FROM canvases WHERE id = ?').get(id) as
      | { version: number; data: string }
      | undefined;
    if (!row) {
      throw new Error('canvas_not_found');
    }
    // 2. 版本对齐
    if (row.version !== baseVersion) {
      return {
        ok: false,
        status: 409,
        error: 'conflict',
        currentVersion: row.version,
      };
    }

    // 3. 计算 deltaB（按 sheet+node 复合 ID）
    const baseData = JSON.parse(row.data) as { sheets: StorageSheet[] };
    const incomingData = data as unknown as { sheets: StorageSheet[] };

    // 索引：(sheetId|nodeId) → node
    const baseIndex = new Map<string, { sheetId: string; node: StorageNode }>();
    for (const sheet of baseData.sheets) {
      for (const node of sheet.nodes) {
        baseIndex.set(`${sheet.id}|${node.id}`, { sheetId: sheet.id, node });
      }
    }
    const incomingIndex = new Map<string, { sheetId: string; node: StorageNode }>();
    for (const sheet of incomingData.sheets) {
      for (const node of sheet.nodes) {
        incomingIndex.set(`${sheet.id}|${node.id}`, { sheetId: sheet.id, node });
      }
    }

    const added: Array<{ sheetId: string; node: StorageNode }> = [];
    const removed: Array<{ sheetId: string; node: StorageNode }> = [];
    const modified: Array<{ sheetId: string; node: StorageNode; baseNode: StorageNode }> = [];
    const deprecatedChanged: Array<{ sheetId: string; node: StorageNode; baseNode: StorageNode }> = [];

    for (const [key, { sheetId, node }] of incomingIndex) {
      const baseEntry = baseIndex.get(key);
      if (!baseEntry) {
        added.push({ sheetId, node });
      } else {
        const baseNode = baseEntry.node;
        const baseDep = !!baseNode.is_deprecated;
        const newDep = !!node.is_deprecated;
        const contentSame = nodeContentEquals(baseNode, node);
        if (contentSame && baseDep === newDep) {
          // 完全一样
          continue;
        }
        // 检查是否仅 is_deprecated 变化
        if (contentSame && !baseDep && newDep) {
          deprecatedChanged.push({ sheetId, node, baseNode });
        } else {
          modified.push({ sheetId, node, baseNode });
        }
      }
    }
    for (const [key, { sheetId, node }] of baseIndex) {
      if (!incomingIndex.has(key)) {
        removed.push({ sheetId, node });
      }
    }

    // 4. 权限校验（§5.7）
    const isAdmin = user.role === 'admin';

    // 4.1 added：检查 nodes_meta 没记录（防 ID 撞车）
    const checkMeta = db.prepare(
      `SELECT creator_id FROM nodes_meta WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    for (const { sheetId, node } of added) {
      const existing = checkMeta.get(id, sheetId, node.id) as { creator_id: number } | undefined;
      if (existing) {
        // ID 撞车 —— 数据完整性问题
        return {
          ok: false,
          status: 409,
          error: 'node_id_collision',
          currentVersion: row.version,
        };
      }
    }

    // 4.2 modified：校验 creator == 当前用户 OR admin
    for (const { sheetId, node } of modified) {
      const meta = checkMeta.get(id, sheetId, node.id) as { creator_id: number } | undefined;
      if (!meta) {
        // 节点在 incoming 里有但 nodes_meta 没记录 —— 数据不一致
        return {
          ok: false,
          status: 409,
          error: 'node_meta_missing',
          currentVersion: row.version,
        };
      }
      if (meta.creator_id !== user.id && !isAdmin) {
        return {
          ok: false,
          status: 403,
          error: 'forbidden_modify_others_node',
          // 给 caller 一个能定位的信息
          message: `cannot modify node ${node.id} created by user ${meta.creator_id}`,
          currentVersion: row.version,
        };
      }
    }

    // 4.3 removed：仅 admin 允许
    if (removed.length > 0 && !isAdmin) {
      return {
        ok: false,
        status: 403,
        error: 'forbidden_remove_node_non_admin',
        message: `cannot remove ${removed.length} node(s); only admin can physically delete (use deprecate instead)`,
        currentVersion: row.version,
      };
    }

    // 4.4 deprecated_changed：任何登录用户都允许（公开权限）—— 不需校验

    // 5. 服务端从 nodes_meta 重写 incoming data 的元字段（防客户端篡改）
    // 一次性查所有相关 nodes_meta
    const allMetaRows = db.prepare(
      `SELECT node_id, sheet_id, creator_id, created_at, updated_by, updated_at,
              is_deprecated, deprecated_by, deprecated_at
       FROM nodes_meta WHERE canvas_id=?`
    ).all(id) as NodeMetaRow[];
    const metaIndex = new Map<string, NodeMetaRow>();
    for (const m of allMetaRows) {
      metaIndex.set(`${m.sheet_id}|${m.node_id}`, m);
    }
    // 逐节点重写
    const rewrittenSheets = incomingData.sheets.map((sheet) => ({
      ...sheet,
      nodes: sheet.nodes.map((node) => {
        const meta = metaIndex.get(`${sheet.id}|${node.id}`);
        if (!meta) {
          // 是 added 节点；用当前用户和 now（同步 nodes_meta 在下一步做）
          return {
            ...node,
            creator_id: user.id,
            created_at: now,
            updated_by: user.id,
            updated_at: now,
            is_deprecated: !!node.is_deprecated, // 客户端传的初始值
          };
        }
        // 已存在节点：creator/created_at 永远从表里读
        // updated_by/updated_at 在内容修改时更新（modified），标废弃不更新
        const isModified = modified.some((m) => m.sheetId === sheet.id && m.node.id === node.id);
        const isDeprecated = deprecatedChanged.some(
          (d) => d.sheetId === sheet.id && d.node.id === node.id
        );
        return {
          ...node,
          creator_id: meta.creator_id,
          created_at: meta.created_at,
          updated_by: isModified ? user.id : meta.updated_by,
          updated_at: isModified ? now : meta.updated_at,
          is_deprecated: isDeprecated ? true : !!meta.is_deprecated,
        };
      }),
    }));
    const rewrittenData = { ...incomingData, sheets: rewrittenSheets };
    const dataJson = JSON.stringify(rewrittenData);

    const newVersion = row.version + 1;

    // 6. 写主表
    db.prepare(
      `UPDATE canvases
         SET data = ?, version = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(dataJson, newVersion, user.id, now, id);

    // 7. 追加版本快照
    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, newVersion, dataJson, user.id, now);

    // 8. 同步 nodes_meta —— 严格化版本
    // 8.1 added：INSERT
    const insertMeta = db.prepare(
      `INSERT INTO nodes_meta
         (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at, is_deprecated)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    );
    for (const { sheetId, node } of added) {
      insertMeta.run(id, sheetId, node.id, user.id, now, user.id, now);
    }
    // 8.2 modified：UPDATE updated_by/updated_at
    const updateMetaModified = db.prepare(
      `UPDATE nodes_meta SET updated_by=?, updated_at=?
       WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    for (const { sheetId, node } of modified) {
      updateMetaModified.run(user.id, now, id, sheetId, node.id);
    }
    // 8.3 deprecated_changed：UPDATE is_deprecated + deprecated_by/at（不动 updated_*）
    const updateMetaDeprecated = db.prepare(
      `UPDATE nodes_meta SET is_deprecated=1, deprecated_by=?, deprecated_at=?
       WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    for (const { sheetId, node } of deprecatedChanged) {
      updateMetaDeprecated.run(user.id, now, id, sheetId, node.id);
    }
    // 8.4 removed：DELETE annotations + nodes_meta（同事务）
    const deleteAnnotations = db.prepare(
      `DELETE FROM annotations WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    const deleteMeta = db.prepare(
      `DELETE FROM nodes_meta WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    for (const { sheetId, node } of removed) {
      deleteAnnotations.run(id, sheetId, node.id);
      deleteMeta.run(id, sheetId, node.id);
    }

    return { ok: true, version: newVersion, merged: false };
  });

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
