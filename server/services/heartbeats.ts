// 心跳业务服务层（阶段 4 P4A，方案 §4.5 + 判断点 6 决策）
//
// 设计约束：
// - 单一时钟源在服务端：客户端只展示服务端 query 结果，避免各端时钟偏差（判断点 6）
// - 30s 上报 / 90s 过期：upsertHeartbeat 顺手清理 last_seen_at < now-90s 的过期记录
// - 列表查询过滤软删用户（heartbeats CASCADE 不会触发 users 软删；JOIN users 兜底）
//
// 不变量：
// - heartbeats(user_id, canvas_id) 是主键 → 同用户同画布多 tab 自动去重（DB 层）
// - 写入只走 upsertHeartbeat（INSERT OR REPLACE），永远是当前时间戳

import { getDb } from '../db/index.ts';

export const HEARTBEAT_TTL_MS = 90_000; // 90 秒过期（容忍 1 次心跳丢失）

export interface ActiveEditor {
  userId: number;
  username: string;
  /** 显示名（v1.18.x）：service 层已做 trim 判空 fallback 到 username，
   *  前端可直接展示无需再次 fallback */
  nickname: string;
  lastSeenAt: number;
}

/** SELECT 行类型：JOIN 来的原始 nickname 可能为空字符串/null，service 层 fallback */
interface ActiveEditorRow {
  userId: number;
  username: string;
  rawNickname: string | null;
  lastSeenAt: number;
}

function toActiveEditor(row: ActiveEditorRow): ActiveEditor {
  // 与 server/services/canvases.ts toListItem 同口径：trim 判空才 fallback
  let nickname: string;
  if (row.rawNickname !== null && row.rawNickname.trim().length > 0) {
    nickname = row.rawNickname;
  } else {
    nickname = row.username;
  }
  return {
    userId: row.userId,
    username: row.username,
    nickname,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * 上报心跳：upsert 当前用户对画布的 last_seen_at 为 now，并顺手清理全表过期心跳
 *
 * 返回除自己之外的活跃编辑者列表（用于响应客户端"还有谁在改这张画布"）
 */
export function upsertHeartbeat(input: {
  userId: number;
  canvasId: number;
  now?: number;
}): ActiveEditor[] {
  const db = getDb();
  const now = input.now ?? Date.now();
  const cutoff = now - HEARTBEAT_TTL_MS;

  // 单事务：upsert 当前心跳 + 清理过期心跳
  // 过期清理放写路径而不是定时任务，避免 cron 之类的运行时复杂度
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO heartbeats (user_id, canvas_id, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, canvas_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
    ).run(input.userId, input.canvasId, now);

    db.prepare(`DELETE FROM heartbeats WHERE last_seen_at < ?`).run(cutoff);
  });
  tx();

  return listActiveEditorsExcept({
    canvasId: input.canvasId,
    excludeUserId: input.userId,
    now,
  });
}

/**
 * 列出某画布的活跃编辑者（last_seen_at >= now - 90s），可选排除自己
 *
 * 软删用户兜底：JOIN users 过滤 deleted_at IS NULL（CASCADE 不会触发 users 软删）
 */
export function listActiveEditorsExcept(input: {
  canvasId: number;
  excludeUserId?: number;
  now?: number;
}): ActiveEditor[] {
  const db = getDb();
  const now = input.now ?? Date.now();
  const cutoff = now - HEARTBEAT_TTL_MS;

  const rows = db
    .prepare(
      `SELECT h.user_id AS userId,
              u.username AS username,
              u.nickname AS rawNickname,
              h.last_seen_at AS lastSeenAt
       FROM heartbeats h
       JOIN users u ON u.id = h.user_id
       WHERE h.canvas_id = ?
         AND h.last_seen_at >= ?
         AND u.deleted_at IS NULL
         ${input.excludeUserId !== undefined ? 'AND h.user_id != ?' : ''}
       ORDER BY h.last_seen_at DESC`
    )
    .all(
      ...(input.excludeUserId !== undefined
        ? [input.canvasId, cutoff, input.excludeUserId]
        : [input.canvasId, cutoff])
    ) as ActiveEditorRow[];

  return rows.map(toActiveEditor);
}

/**
 * 列表页用：批量返回多张画布的活跃编辑者计数（用于"X 人在编辑"角标）
 *
 * 入参 canvasIds 为空时返回空 Map，避免 SQL 拼空 IN 列表
 *
 * codex P4 二审 #6：可选 excludeUserId 参数让 SQL 一次性排除自己，避免 route 层做 N+1 + 扣减
 */
export function countActiveEditorsByCanvas(input: {
  canvasIds: number[];
  excludeUserId?: number;
  now?: number;
}): Map<number, number> {
  const counts = new Map<number, number>();
  if (input.canvasIds.length === 0) return counts;

  const db = getDb();
  const now = input.now ?? Date.now();
  const cutoff = now - HEARTBEAT_TTL_MS;

  const placeholders = input.canvasIds.map(() => '?').join(',');
  const excludeClause = input.excludeUserId !== undefined ? 'AND h.user_id != ?' : '';
  const params: unknown[] = [...input.canvasIds, cutoff];
  if (input.excludeUserId !== undefined) params.push(input.excludeUserId);

  const rows = db
    .prepare(
      `SELECT h.canvas_id AS canvasId, COUNT(*) AS cnt
       FROM heartbeats h
       JOIN users u ON u.id = h.user_id
       WHERE h.canvas_id IN (${placeholders})
         AND h.last_seen_at >= ?
         AND u.deleted_at IS NULL
         ${excludeClause}
       GROUP BY h.canvas_id`
    )
    .all(...params) as { canvasId: number; cnt: number }[];

  for (const row of rows) {
    counts.set(row.canvasId, row.cnt);
  }
  return counts;
}
