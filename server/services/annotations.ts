// 批注业务服务层（方案 §4.4，2026-05-05 P3E 一审产品规则）
//
// 关键不变量：
// - 服务端通过 annotations.sheet_id/node_id 查 nodes_meta.creator_id 验关闭权限
// - POST 必须验证 sheetId/nodeId 对应节点存在于当前 canvases.data 最新版本中（含已标废弃）
// - 物理删除节点的批注理论不存在（§5.7 同事务清理已落地于 canvases.ts:853-855）
// - 标废弃节点仍可批注（讨论废弃本身需要批注）
// - resolve/reopen 必须先按 annotation.id 查出 canvas_id，再复核当前用户对该画布访问权
//   防止"知道 id 跨画布越权"

import { getDb } from '../db/index.ts';
import type { UserPublic } from '../types/user.ts';
import type { AnnotationResponse } from '../schemas/annotation.ts';
import {
  ANNOTATION_UNRESOLVED_MAX_PER_NODE,
  ANNOTATION_TOTAL_MAX_PER_NODE,
} from '../schemas/annotation.ts';
import type { CanvasRow } from './canvases.ts';

export interface AnnotationRow {
  id: number;
  canvas_id: number;
  sheet_id: string;
  node_id: string;
  author_id: number;
  content: string;
  status: 'unresolved' | 'resolved';
  resolved_by: number | null;
  resolved_at: number | null;
  created_at: number;
}

interface AnnotationJoinRow extends AnnotationRow {
  author_username: string | null;
  resolved_by_username: string | null;
}

/** 把 join 行转换为响应对象（外部不暴露 row 类型） */
function toResponse(row: AnnotationJoinRow): AnnotationResponse {
  return {
    id: row.id,
    canvas_id: row.canvas_id,
    sheet_id: row.sheet_id,
    node_id: row.node_id,
    author_id: row.author_id,
    author_username: row.author_username,
    content: row.content,
    status: row.status,
    resolved_by: row.resolved_by,
    resolved_by_username: row.resolved_by_username,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
  };
}

const SELECT_WITH_USERS_SQL = `
  SELECT a.id, a.canvas_id, a.sheet_id, a.node_id,
         a.author_id, ua.username AS author_username,
         a.content, a.status,
         a.resolved_by, ur.username AS resolved_by_username,
         a.resolved_at, a.created_at
  FROM annotations a
  LEFT JOIN users ua ON ua.id = a.author_id
  LEFT JOIN users ur ON ur.id = a.resolved_by
`;

// =====================================================================
// 查询
// =====================================================================

/**
 * 列出某画布所有批注（按 created_at 正序，方案 §1.4 展示规则）。
 *
 * 整画布一次返（不按节点拆请求），前端缓存为 Map<canvasId, Annotation[]>，
 * 节点徽章 useMemo 派生 annotationCountByNodeKey。
 */
export function listAnnotationsByCanvas(canvasId: number): AnnotationResponse[] {
  const rows = getDb()
    .prepare(`${SELECT_WITH_USERS_SQL} WHERE a.canvas_id = ? ORDER BY a.created_at ASC, a.id ASC`)
    .all(canvasId) as AnnotationJoinRow[];
  return rows.map(toResponse);
}

/** 按 id 查一条批注（含 join username）。用于 resolve/reopen 复核 canvas_id */
export function getAnnotationById(id: number): AnnotationResponse | null {
  const row = getDb()
    .prepare(`${SELECT_WITH_USERS_SQL} WHERE a.id = ?`)
    .get(id) as AnnotationJoinRow | undefined;
  return row ? toResponse(row) : null;
}

// =====================================================================
// 节点存在性 / 创作者校验（POST + resolve/reopen 用）
// =====================================================================

/**
 * 校验 sheetId/nodeId 对应节点存在于 canvases.data 最新版本（含已标废弃节点）。
 *
 * fail-closed 策略（codex 02-审 medium 2）：
 *   - JSON.parse 失败 → false
 *   - 合法 JSON 但结构损坏（sheets 不是数组 / 目标 sheet 的 nodes 不是数组）→ false
 *   服务端不应出现这些情况，但兜底防御避免 500
 *
 * @returns true 节点存在 / false 不存在（前端拼错、节点已被物理删除、或 data 结构损坏）
 */
export function nodeExistsInCanvas(canvasRow: CanvasRow, sheetId: string, nodeId: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canvasRow.data);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const sheets = (parsed as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets)) return false;
  const sheet = sheets.find(
    (s): s is { id: string; nodes: unknown } =>
      !!s && typeof s === 'object' && (s as { id?: unknown }).id === sheetId,
  );
  if (!sheet) return false;
  if (!Array.isArray(sheet.nodes)) return false;
  return sheet.nodes.some(
    (n): n is { id: string } =>
      !!n && typeof n === 'object' && (n as { id?: unknown }).id === nodeId,
  );
}

/**
 * 查 nodes_meta.creator_id（用于 resolve/reopen 权限判定）。
 *
 * @returns creator_id / null 表示 nodes_meta 无对应记录（节点已被物理删除或 ID 错误）
 */
export function getNodeCreatorId(
  canvasId: number,
  sheetId: string,
  nodeId: string,
): number | null {
  const row = getDb()
    .prepare(
      `SELECT creator_id FROM nodes_meta
       WHERE canvas_id = ? AND sheet_id = ? AND node_id = ?`,
    )
    .get(canvasId, sheetId, nodeId) as { creator_id: number } | undefined;
  return row ? row.creator_id : null;
}

// =====================================================================
// 容量限制校验（POST 用）
// =====================================================================

export interface AnnotationCapacityError {
  type: 'unresolved_limit' | 'total_limit';
  current: number;
  max: number;
}

/**
 * 校验单节点批注数量是否超限（unresolved + 全部）。
 * 在 POST 入库前调用，超限返回 error，正常返回 null。
 */
export function checkNodeCapacity(
  canvasId: number,
  sheetId: string,
  nodeId: string,
): AnnotationCapacityError | null {
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'unresolved' THEN 1 ELSE 0 END) AS unresolved,
         COUNT(*) AS total
       FROM annotations
       WHERE canvas_id = ? AND sheet_id = ? AND node_id = ?`,
    )
    .get(canvasId, sheetId, nodeId) as { unresolved: number | null; total: number };
  const unresolved = stats.unresolved ?? 0;
  if (unresolved >= ANNOTATION_UNRESOLVED_MAX_PER_NODE) {
    return { type: 'unresolved_limit', current: unresolved, max: ANNOTATION_UNRESOLVED_MAX_PER_NODE };
  }
  if (stats.total >= ANNOTATION_TOTAL_MAX_PER_NODE) {
    return { type: 'total_limit', current: stats.total, max: ANNOTATION_TOTAL_MAX_PER_NODE };
  }
  return null;
}

// =====================================================================
// 关闭权限判定（resolve / reopen 共用）
// =====================================================================

/**
 * 判定当前用户是否能 resolve/reopen 指定批注。
 *
 * 权限规则（方案 §1.4）：批注作者 + 节点 creator + admin 之一。
 * 调用前 caller 必须已经验证：
 *   - 用户已登录（requireAuth）
 *   - 用户对该画布有读权限（canRead 复核）
 *   - 批注存在（getAnnotationById）
 */
export function canCloseAnnotation(
  annotation: AnnotationResponse,
  user: UserPublic,
): boolean {
  if (user.role === 'admin') return true;
  if (annotation.author_id === user.id) return true;
  // 节点 creator
  const creatorId = getNodeCreatorId(annotation.canvas_id, annotation.sheet_id, annotation.node_id);
  if (creatorId !== null && creatorId === user.id) return true;
  return false;
}

// =====================================================================
// 写入：POST / resolve / reopen
// =====================================================================

export interface CreateAnnotationParams {
  canvasId: number;
  sheetId: string;
  nodeId: string;
  authorId: number;
  content: string;
}

/**
 * 创建批注（caller 必须已经做过节点存在性 + 容量校验）。
 * 单 INSERT 不需要事务包裹。
 */
export function createAnnotation(params: CreateAnnotationParams): AnnotationResponse {
  const db = getDb();
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO annotations (canvas_id, sheet_id, node_id, author_id, content, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'unresolved', ?)`,
    )
    .run(params.canvasId, params.sheetId, params.nodeId, params.authorId, params.content, now);
  const id = Number(result.lastInsertRowid);
  const created = getAnnotationById(id);
  if (!created) {
    // 不可能到这；fail-closed
    throw new Error('annotation insert succeeded but row not found');
  }
  return created;
}

/** 标记 resolved（已校验权限，幂等：已 resolved 不再改 resolved_by/at） */
export function resolveAnnotation(id: number, userId: number): AnnotationResponse | null {
  const db = getDb();
  const existing = getAnnotationById(id);
  if (!existing) return null;
  if (existing.status === 'resolved') return existing; // 幂等
  const now = Date.now();
  db.prepare(
    `UPDATE annotations
     SET status = 'resolved', resolved_by = ?, resolved_at = ?
     WHERE id = ? AND status = 'unresolved'`,
  ).run(userId, now, id);
  return getAnnotationById(id);
}

/** 重开（已校验权限，幂等：已 unresolved 不变） */
export function reopenAnnotation(id: number): AnnotationResponse | null {
  const db = getDb();
  const existing = getAnnotationById(id);
  if (!existing) return null;
  if (existing.status === 'unresolved') return existing; // 幂等
  db.prepare(
    `UPDATE annotations
     SET status = 'unresolved', resolved_by = NULL, resolved_at = NULL
     WHERE id = ? AND status = 'resolved'`,
  ).run(id);
  return getAnnotationById(id);
}
