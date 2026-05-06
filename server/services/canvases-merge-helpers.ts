// canvases-merge-helpers.ts —— saveCanvas 副作用 helper 三件套
//
// 阶段 5 Day 2 取舍审 D5 决策：applyDelta 保持纯函数，副作用集中在 saveCanvas。
// 把 saveCanvas 分支 3（快速路径）的"权限校验 + nodes_meta 重写 + nodes_meta 同步 +
// annotations 删除"四块逻辑提取为独立 helper，让分支 2（合并路径）能复用同一份代码，
// 避免两套副作用永久漂移。
//
// 详见 [Day2-合并算法/03-拍板记录.md § D5](../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day2-合并算法/03-拍板记录.md)
//
// 设计要点：
// - helper 接 db: DatabaseType 参数（在事务内调用，不自己 getDb），事务边界由 saveCanvas 控制
// - helper 错误处理：抛类型化错误（PermissionError / DataIntegrityError），saveCanvas catch 映射到 SaveCanvasResult
// - helper 输入：deltaB（Day 1 Delta 类型）+ db handle + canvasId + user + now + visibility/owner_id
// - 严禁 spread incoming 整对象（codex Day 2 风险 1）：rewriteNodesFromMeta 按白名单字段补丁

import type { Database as DatabaseType } from 'better-sqlite3';
import type { UserPublic } from '../types/user.ts';
import type {
  Delta,
  MultiCanvasProjectShape,
  StorageNode,
  StorageSheet,
} from './merge/types.ts';
import { NODE_DIFF_FIELDS } from './merge/types.ts';

// ============================================================
// 类型化错误（saveCanvas 捕获后映射 SaveCanvasResult）
// ============================================================

/** 权限校验失败（403/409 节点级）—— 携带映射所需信息 */
export class PermissionError extends Error {
  constructor(
    public code:
      | 'node_id_collision'        // added 节点 ID 已存在 nodes_meta
      | 'node_meta_missing'        // modified/deprecated 节点 nodes_meta 缺失
      | 'forbidden_modify_others_node'
      | 'forbidden_remove_node',
    message: string,
    /** 仅 forbidden_modify_others_node / forbidden_remove_node 用 */
    public detail?: string
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

// ============================================================
// nodes_meta row 类型（从 saveCanvas 复制）
// ============================================================

export interface NodeMetaRow {
  node_id: string;
  sheet_id: string;
  creator_id: number;
  created_at: number;
  updated_by: number;
  updated_at: number;
  is_deprecated: number;
  deprecated_by: number | null;
  deprecated_at: number | null;
}

// ============================================================
// helper 1: validateDeltaBPermissions
// ============================================================

/**
 * 校验 deltaB 各项权限（§5.7 节点级权限严格化）：
 * - added：检查 nodes_meta 没记录（防 ID 撞车 → node_id_collision）
 * - modified：校验 creator == 当前用户 OR admin（否则 forbidden_modify_others_node）；meta 缺失 → node_meta_missing
 * - deprecated：检 meta 缺失（标废弃是公开权限不查 creator）
 * - removed：按 visibility 区分（admin / private owner 允许；其他禁 forbidden_remove_node）
 *
 * G4 约束：deltaB 是权限校验**唯一输入**；不读 mergedData，避免合并路径绕过权限。
 *
 * 调用方（saveCanvas）必须在事务内调用，且必须捕获 PermissionError 映射到 SaveCanvasResult。
 */
export function validateDeltaBPermissions(
  db: DatabaseType,
  canvasId: number,
  deltaB: Delta,
  user: UserPublic,
  visibility: 'public' | 'private',
  ownerId: number | null
): void {
  const isAdmin = user.role === 'admin';
  const checkMeta = db.prepare(
    `SELECT creator_id FROM nodes_meta WHERE canvas_id=? AND sheet_id=? AND node_id=?`
  );

  // sheetsAdded 内部所有 added 节点也需要校验 ID 撞车（虽然新 sheet 一般不会撞，但保守）
  // sheetsRemoved 内部节点的"批量物删"权限：与 sheetsModified 内 removed 同款规则
  // sheetsModified 内每个 sheet 的 added/removed/modified/deprecated 分别校验

  // 收集所有 added 节点（含 sheetsAdded 内部 + sheetsModified.added）
  const addedNodes: Array<{ sheetId: string; nodeId: string }> = [];
  for (const [sheetId, sheet] of deltaB.sheetsAdded) {
    for (const node of sheet.nodes) {
      addedNodes.push({ sheetId, nodeId: node.id });
    }
  }
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    for (const nodeId of sheetDelta.nodes.added.keys()) {
      addedNodes.push({ sheetId, nodeId });
    }
  }

  // 1. added：nodes_meta 不能已存在
  for (const { sheetId, nodeId } of addedNodes) {
    const existing = checkMeta.get(canvasId, sheetId, nodeId) as
      | { creator_id: number }
      | undefined;
    if (existing) {
      throw new PermissionError(
        'node_id_collision',
        `node ${nodeId} already exists in nodes_meta (sheet ${sheetId})`
      );
    }
  }

  // 2. modified：creator == user.id OR admin
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    for (const nodeId of sheetDelta.nodes.modified.keys()) {
      const meta = checkMeta.get(canvasId, sheetId, nodeId) as
        | { creator_id: number }
        | undefined;
      if (!meta) {
        throw new PermissionError(
          'node_meta_missing',
          `nodes_meta missing for modified node ${nodeId} in sheet ${sheetId}`
        );
      }
      if (meta.creator_id !== user.id && !isAdmin) {
        throw new PermissionError(
          'forbidden_modify_others_node',
          `cannot modify node ${nodeId} created by user ${meta.creator_id}`,
          `cannot modify node ${nodeId} created by user ${meta.creator_id}`
        );
      }
    }
  }

  // 3. deprecated：仅检 meta 缺失（标废弃是公开权限不校验 creator）
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    for (const nodeId of sheetDelta.nodes.deprecated.keys()) {
      const meta = checkMeta.get(canvasId, sheetId, nodeId) as
        | { creator_id: number }
        | undefined;
      if (!meta) {
        throw new PermissionError(
          'node_meta_missing',
          `nodes_meta missing for deprecated node ${nodeId} in sheet ${sheetId}`
        );
      }
    }
  }

  // 4. removed：按 visibility 区分
  // 收集所有 removed 节点数量（含 sheetsRemoved 内部 + sheetsModified.removed）
  let removedCount = 0;
  for (const sheet of deltaB.sheetsRemoved.values()) {
    removedCount += sheet.nodes.length;
  }
  for (const sheetDelta of deltaB.sheetsModified.values()) {
    removedCount += sheetDelta.nodes.removed.size;
  }
  if (removedCount > 0) {
    const isPrivateOwner = visibility === 'private' && ownerId === user.id;
    if (!isAdmin && !isPrivateOwner) {
      throw new PermissionError(
        'forbidden_remove_node',
        visibility === 'public'
          ? `cannot remove ${removedCount} node(s) on public canvas; only admin can physically delete (use deprecate instead)`
          : `cannot remove ${removedCount} node(s); only admin or canvas owner can physically delete`,
        visibility === 'public'
          ? `cannot remove ${removedCount} node(s) on public canvas; only admin can physically delete (use deprecate instead)`
          : `cannot remove ${removedCount} node(s); only admin or canvas owner can physically delete`
      );
    }
  }
}

// ============================================================
// helper 2: rewriteNodesFromMeta
// ============================================================

/**
 * 从 nodes_meta 重写 incoming data 的服务端独占归属字段（防客户端篡改）。
 *
 * 关键不变量（codex Day 2 风险 1+3）：
 * - 严禁 spread incoming 整对象——必须按白名单字段决定保留 / 用 meta 覆写 / 用 user.id+now 写入
 * - alsoDeprecated 节点用 user.id+now 写 deprecated_by/at（不能读旧 meta，旧 meta 是 null）
 * - 已存在节点的 creator/created_at 永远从 meta 读
 * - updated_by/updated_at 仅在 modified 时更新（标废弃不更新 updated_*）
 *
 * 调用顺序（关键）：rewrite → UPDATE canvases.data → UPDATE nodes_meta（步骤 syncNodesMetaFromDeltaB）。
 * 不能先 UPDATE nodes_meta 再 rewrite——rewrite 拿到的 by/at 仍是 null。
 *
 * @param data        incoming 数据（已通过 strip 服务端归属字段）
 * @param deltaB      Day 1 Delta 类型，用于判定哪些节点是 added/modified/deprecated/alsoDeprecated
 * @param metaIndex   nodes_meta 一次性查出的 (sheetId|nodeId) → row 索引
 * @param user        当前保存者
 * @param now         当前时间戳
 * @returns           重写后的新 data（不修改入参）
 */
export function rewriteNodesFromMeta(
  data: MultiCanvasProjectShape,
  deltaB: Delta,
  metaIndex: Map<string, NodeMetaRow>,
  user: UserPublic,
  now: number
): MultiCanvasProjectShape {
  // 索引 deltaB：哪些 (sheetId|nodeId) 是 modified、deprecated、alsoDeprecated
  // sheetsAdded 整 sheet 都是 added
  const isModified = new Set<string>();
  const isDeprecatedChanged = new Set<string>();
  const isAlsoDeprecated = new Set<string>();
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    for (const [nodeId, nodeDelta] of sheetDelta.nodes.modified) {
      isModified.add(`${sheetId}|${nodeId}`);
      if (nodeDelta.alsoDeprecated) {
        isAlsoDeprecated.add(`${sheetId}|${nodeId}`);
      }
    }
    for (const nodeId of sheetDelta.nodes.deprecated.keys()) {
      isDeprecatedChanged.add(`${sheetId}|${nodeId}`);
    }
  }

  const rewrittenSheets: StorageSheet[] = data.sheets.map((sheet) => ({
    ...sheet,
    nodes: sheet.nodes.map((rawNode) => {
      const node = stripServerAttribution(rawNode);
      const key = `${sheet.id}|${node.id}`;
      const meta = metaIndex.get(key);
      if (!meta) {
        // added 节点（meta 不存在）
        // P3C codex 必修 5：客户端可能传 is_deprecated=true（导入/迁移），需服务端写 deprecated_by/at
        const isAddedDeprecated = !!node.is_deprecated;
        return {
          ...node,
          creator_id: user.id,
          created_at: now,
          updated_by: user.id,
          updated_at: now,
          is_deprecated: isAddedDeprecated,
          ...(isAddedDeprecated
            ? { deprecated_by: user.id, deprecated_at: now }
            : {}),
        };
      }
      // 已存在节点
      const wasModified = isModified.has(key);
      const wasDeprecatedChanged = isDeprecatedChanged.has(key);
      const wasAlsoDeprecated = isAlsoDeprecated.has(key);
      const isDeprecatingNow = wasDeprecatedChanged || wasAlsoDeprecated;
      const newDeprecated = isDeprecatingNow || !!meta.is_deprecated;

      let deprecatedAttribution: {
        deprecated_by?: number;
        deprecated_at?: number;
      } = {};
      if (isDeprecatingNow) {
        deprecatedAttribution = { deprecated_by: user.id, deprecated_at: now };
      } else if (
        meta.is_deprecated &&
        meta.deprecated_by !== null &&
        meta.deprecated_at !== null
      ) {
        deprecatedAttribution = {
          deprecated_by: meta.deprecated_by,
          deprecated_at: meta.deprecated_at,
        };
      }

      return {
        ...node,
        creator_id: meta.creator_id,
        created_at: meta.created_at,
        updated_by: wasModified ? user.id : meta.updated_by,
        updated_at: wasModified ? now : meta.updated_at,
        is_deprecated: newDeprecated,
        ...deprecatedAttribution,
      };
    }),
  }));

  return { ...data, sheets: rewrittenSheets };
}

/** 与 saveCanvas 内 stripServerAttributionForSaveInput 同语义：strip 服务端独占归属字段，保留 is_deprecated */
function stripServerAttribution(n: StorageNode): StorageNode {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    creator_id,
    creator_username,
    created_at,
    updated_by,
    updated_at,
    deprecated_by,
    deprecated_at,
    deprecated_by_username,
    ...rest
  } = n;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return rest as StorageNode;
}

// ============================================================
// helper 3: syncNodesMetaFromDeltaB
// ============================================================

/**
 * 按 deltaB 同步 nodes_meta（INSERT/UPDATE/DELETE）+ DELETE annotations（同事务）。
 *
 * 处理路径：
 * - sheetsAdded：所有节点 INSERT nodes_meta（新 sheet 内的 added 也要建 meta）
 * - sheetsModified.added：INSERT nodes_meta
 * - sheetsModified.modified：UPDATE updated_*；alsoDeprecated 时同时 UPDATE deprecated_*
 * - sheetsModified.deprecated：UPDATE deprecated_* + is_deprecated（不动 updated_*）
 * - sheetsModified.removed：DELETE annotations + nodes_meta
 * - sheetsRemoved：DELETE 该 sheet 下所有 annotations + nodes_meta（codex Day 2 风险 4）
 *
 * 调用方必须在事务内调用。
 */
export function syncNodesMetaFromDeltaB(
  db: DatabaseType,
  canvasId: number,
  deltaB: Delta,
  user: UserPublic,
  now: number
): void {
  const insertMetaUndeprecated = db.prepare(
    `INSERT INTO nodes_meta
       (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
        is_deprecated, deprecated_by, deprecated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`
  );
  const insertMetaDeprecated = db.prepare(
    `INSERT INTO nodes_meta
       (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
        is_deprecated, deprecated_by, deprecated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const updateMetaModified = db.prepare(
    `UPDATE nodes_meta SET updated_by=?, updated_at=?
     WHERE canvas_id=? AND sheet_id=? AND node_id=?`
  );
  const updateMetaModifiedAndDeprecated = db.prepare(
    `UPDATE nodes_meta SET updated_by=?, updated_at=?,
                            is_deprecated=1, deprecated_by=?, deprecated_at=?
     WHERE canvas_id=? AND sheet_id=? AND node_id=?`
  );
  const updateMetaDeprecated = db.prepare(
    `UPDATE nodes_meta SET is_deprecated=1, deprecated_by=?, deprecated_at=?
     WHERE canvas_id=? AND sheet_id=? AND node_id=?`
  );
  const deleteAnnotations = db.prepare(
    `DELETE FROM annotations WHERE canvas_id=? AND sheet_id=? AND node_id=?`
  );
  const deleteMeta = db.prepare(
    `DELETE FROM nodes_meta WHERE canvas_id=? AND sheet_id=? AND node_id=?`
  );

  // sheet 级删除（codex Day 2 风险 4）：先删 sheet 下所有 annotations + nodes_meta
  const deleteSheetAnnotations = db.prepare(
    `DELETE FROM annotations WHERE canvas_id=? AND sheet_id=?`
  );
  const deleteSheetMeta = db.prepare(
    `DELETE FROM nodes_meta WHERE canvas_id=? AND sheet_id=?`
  );

  // 1. sheetsAdded：所有节点 INSERT nodes_meta
  for (const [sheetId, sheet] of deltaB.sheetsAdded) {
    for (const node of sheet.nodes) {
      if (node.is_deprecated) {
        insertMetaDeprecated.run(
          canvasId,
          sheetId,
          node.id,
          user.id,
          now,
          user.id,
          now,
          user.id,
          now
        );
      } else {
        insertMetaUndeprecated.run(
          canvasId,
          sheetId,
          node.id,
          user.id,
          now,
          user.id,
          now
        );
      }
    }
  }

  // 2. sheetsModified.added：INSERT
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    for (const [nodeId, node] of sheetDelta.nodes.added) {
      if (node.is_deprecated) {
        insertMetaDeprecated.run(
          canvasId,
          sheetId,
          nodeId,
          user.id,
          now,
          user.id,
          now,
          user.id,
          now
        );
      } else {
        insertMetaUndeprecated.run(
          canvasId,
          sheetId,
          nodeId,
          user.id,
          now,
          user.id,
          now
        );
      }
    }
  }

  // 3. sheetsModified.modified：UPDATE updated_*；alsoDeprecated 同时 UPDATE deprecated_*
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    for (const [nodeId, nodeDelta] of sheetDelta.nodes.modified) {
      if (nodeDelta.alsoDeprecated) {
        updateMetaModifiedAndDeprecated.run(
          user.id,
          now,
          user.id,
          now,
          canvasId,
          sheetId,
          nodeId
        );
      } else {
        updateMetaModified.run(user.id, now, canvasId, sheetId, nodeId);
      }
    }
  }

  // 4. sheetsModified.deprecated：UPDATE is_deprecated + deprecated_*（不动 updated_*）
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    for (const nodeId of sheetDelta.nodes.deprecated.keys()) {
      updateMetaDeprecated.run(user.id, now, canvasId, sheetId, nodeId);
    }
  }

  // 5. sheetsModified.removed：DELETE annotations + nodes_meta
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    for (const nodeId of sheetDelta.nodes.removed.keys()) {
      deleteAnnotations.run(canvasId, sheetId, nodeId);
      deleteMeta.run(canvasId, sheetId, nodeId);
    }
  }

  // 6. sheetsRemoved：sheet 级清理（codex Day 2 风险 4）
  for (const sheetId of deltaB.sheetsRemoved.keys()) {
    deleteSheetAnnotations.run(canvasId, sheetId);
    deleteSheetMeta.run(canvasId, sheetId);
  }
}

// ============================================================
// 工具：把 SaveCanvasInput.data 适配为 MultiCanvasProjectShape
// ============================================================

/**
 * SaveCanvasInput.data 的类型是 MultiCanvasProjectInput（schema），与 merge/types 的
 * MultiCanvasProjectShape 字段对齐但 TS 类型不同（schema 推导 vs 手写 type）。
 * 此 helper 做最小适配，确保 computeDelta / rewriteNodesFromMeta 能消费。
 *
 * 主要差异：
 * - schema 没有 [key: string]: unknown 索引签名，但运行时是同一个 plain object
 * - schema 的 nodes/connectors 类型严格，merge/types 用宽容的 StorageNode/StorageConnector
 *
 * 运行时只是结构访问，TS 层用 as 断言即可（运行时无开销）。
 */
export function asProjectShape(
  data: unknown
): MultiCanvasProjectShape {
  return data as MultiCanvasProjectShape;
}
