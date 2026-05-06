// 草稿业务服务层（阶段 4 P4B，方案 §4.6 + 判断点 7 简化方案 X）
//
// 设计约束：
// - 每用户每画布只 1 份草稿（PRIMARY KEY user_id+canvas_id），upsert 覆盖
// - 单画布草稿 ≤ 2MB（约束 A）→ 服务端 413
// - 用户草稿 ≤ 200 个（判断点 7 简化方案 X）→ 服务端 429
// - data 字段为 TEXT JSON，业务层不做 schema 校验（route 层 zod 校验）
//
// 不变量：
// - DELETE 幂等（删不存在的草稿返回 ok）
// - GET 不存在返 null（route 层转 404）
// - 写入只走 putDraft；canRead 在 route 层做（service 不知道 user.role）

import { getDb } from '../db/index.ts';

export const DRAFT_QUOTA_PER_USER = 200;
export const DRAFT_DATA_MAX_BYTES = 2 * 1024 * 1024; // 2MB

export interface DraftRow {
  user_id: number;
  canvas_id: number;
  data: string; // JSON 字符串
  base_version: number;
  saved_at: number;
}

export interface PutDraftResult {
  ok: boolean;
  status?: 413 | 429;
  error?: 'draft_too_large' | 'draft_quota_exceeded';
  message?: string;
  savedAt?: number;
}

/** 获取草稿（不存在返 null） */
export function getDraft(input: { userId: number; canvasId: number }): DraftRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT user_id, canvas_id, data, base_version, saved_at
       FROM drafts WHERE user_id=? AND canvas_id=?`,
    )
    .get(input.userId, input.canvasId) as DraftRow | undefined;
  return row ?? null;
}

/**
 * upsert 草稿
 *
 * 配额校验：
 * - 单 data ≤ 2MB → 413
 * - 用户草稿数（含本次升级覆盖路径）≤ 200 → 429
 *   触达后服务端拒写，前端 toast 提示用户清理（不做 FIFO 自动清理，避免静默丢草稿）
 *
 * 注意 data 字节数算 Buffer.byteLength（UTF-8 多字节字符）；
 * route 层 express.json({ limit: 2mb }) 已在路由前拦了，service 层兜底再查一次防绕过
 */
export function putDraft(input: {
  userId: number;
  canvasId: number;
  data: string;
  baseVersion: number;
  now?: number;
}): PutDraftResult {
  const dataBytes = Buffer.byteLength(input.data, 'utf-8');
  if (dataBytes > DRAFT_DATA_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'draft_too_large',
      message: `draft data exceeds 2MB limit (got ${dataBytes} bytes)`,
    };
  }

  const db = getDb();
  const now = input.now ?? Date.now();

  // 单事务：配额查 + upsert
  // 仅在"新建草稿"时查配额；如果是覆盖现有草稿（同 user_id+canvas_id），不计入新增
  const tx = db.transaction(() => {
    const existing = db
      .prepare(`SELECT 1 AS hit FROM drafts WHERE user_id=? AND canvas_id=?`)
      .get(input.userId, input.canvasId) as { hit: number } | undefined;

    if (!existing) {
      const cnt = db
        .prepare(`SELECT COUNT(*) AS cnt FROM drafts WHERE user_id=?`)
        .get(input.userId) as { cnt: number };
      if (cnt.cnt >= DRAFT_QUOTA_PER_USER) {
        return { ok: false as const, status: 429 as const, error: 'draft_quota_exceeded' as const };
      }
    }

    db.prepare(
      `INSERT INTO drafts (user_id, canvas_id, data, base_version, saved_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, canvas_id) DO UPDATE
       SET data=excluded.data,
           base_version=excluded.base_version,
           saved_at=excluded.saved_at`,
    ).run(input.userId, input.canvasId, input.data, input.baseVersion, now);

    return { ok: true as const, savedAt: now };
  });

  const result = tx();
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      message:
        result.error === 'draft_quota_exceeded'
          ? `draft quota exceeded (limit ${DRAFT_QUOTA_PER_USER}); please delete unused drafts`
          : 'unknown error',
    };
  }
  return { ok: true, savedAt: result.savedAt };
}

/** 删草稿（幂等，删不存在的返回 ok=true） */
export function deleteDraft(input: { userId: number; canvasId: number }): { ok: true } {
  const db = getDb();
  db.prepare(`DELETE FROM drafts WHERE user_id=? AND canvas_id=?`).run(
    input.userId,
    input.canvasId,
  );
  return { ok: true };
}

/** 计数：用户当前草稿数（用于配额展示） */
export function countDraftsForUser(userId: number): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM drafts WHERE user_id=?`)
    .get(userId) as { cnt: number };
  return row.cnt;
}
