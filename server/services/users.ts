// 用户管理业务服务层（P3F-1，方案 §4.2 + 4 条产品规则）
//
// 关键不变量：
// - 软删用户的 username 唯一约束保留（DB 层）；service 层 createUser 命中已存在 username 返 409
// - admin 不能改自己的 role 为 user（service 层校验，路由层调用前传入 actorId）
// - password 永远 hash 后存储；返回的 AdminUserResponse 不暴露 password_hash
// - 软删 = 写 deleted_at = now；不真正 DELETE（保留外键引用）

import type { RunResult } from 'better-sqlite3';
import { getDb } from '../db/index.ts';
import type { UserRow } from '../types/user.ts';
import type { AdminUserResponse } from '../schemas/user.ts';
import { hashPassword } from '../utils/password.ts';

function toAdminResponse(row: UserRow): AdminUserResponse {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

const SELECT_COLUMNS = 'id, username, password_hash, role, created_at, updated_at, deleted_at';

// =====================================================================
// 查询
// =====================================================================

/**
 * 列出所有用户（含软删，admin 视角）。
 * 按 created_at 正序，相同 created_at 按 id 正序（稳定排序）。
 */
export function listUsers(): AdminUserResponse[] {
  const rows = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM users ORDER BY created_at ASC, id ASC`)
    .all() as UserRow[];
  return rows.map(toAdminResponse);
}

/** 按 id 查一个用户（含软删） */
export function getUserById(id: number): UserRow | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`)
    .get(id) as UserRow | undefined;
  return row ?? null;
}

/** 按 username 查（含软删，用于 createUser 唯一性检查） */
export function findUserByUsername(username: string): UserRow | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM users WHERE username = ?`)
    .get(username) as UserRow | undefined;
  return row ?? null;
}

// =====================================================================
// 写入
// =====================================================================

export type CreateUserError =
  | { type: 'username_taken' }
  | { type: 'username_taken_soft_deleted' }; // 与 username_taken 拆开是为路由层友好提示，但 HTTP 都是 409

export interface CreateUserParams {
  username: string;
  password: string;
  role: 'user' | 'admin';
}

/**
 * 创建用户。caller 已经过 zod 校验。
 *
 * 4 条产品规则之 #2：软删 username 不可重用——若命中已软删用户名，返 username_taken_soft_deleted
 * 普通命中（未软删）返 username_taken。两者路由层都映射 409。
 *
 * 并发兜底（codex P3F-1 一审 medium 2）：findUserByUsername + INSERT 之间不是原子事务。
 * 极端并发同名时 INSERT 抛 SqliteError UNIQUE，此处捕获后回查 username 区分软删状态再返 409。
 */
export async function createUser(
  params: CreateUserParams,
): Promise<{ ok: true; user: AdminUserResponse } | { ok: false; error: CreateUserError }> {
  const existing = findUserByUsername(params.username);
  if (existing) {
    if (existing.deleted_at !== null) {
      return { ok: false, error: { type: 'username_taken_soft_deleted' } };
    }
    return { ok: false, error: { type: 'username_taken' } };
  }
  const hash = await hashPassword(params.password);
  const now = Date.now();
  let result: RunResult;
  try {
    result = getDb()
      .prepare(
        `INSERT INTO users (username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(params.username, hash, params.role, now, now);
  } catch (err) {
    // better-sqlite3 UNIQUE 违反：code = 'SQLITE_CONSTRAINT_UNIQUE'
    // ⚠️ 此分支无运行时单测覆盖（ESM 只读绑定 + better-sqlite3 同步 API 双重原因）。
    // 依赖 better-sqlite3 当前错误码常量；若升级 better-sqlite3 主版本，请手工验证错误码未变
    // （grep "SQLITE_CONSTRAINT_UNIQUE" + 跑一次 race 模拟），否则此分支会漏接冒泡 500。
    if (err && typeof err === 'object' && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const racer = findUserByUsername(params.username);
      if (racer && racer.deleted_at !== null) {
        return { ok: false, error: { type: 'username_taken_soft_deleted' } };
      }
      return { ok: false, error: { type: 'username_taken' } };
    }
    throw err;
  }
  const id = Number(result.lastInsertRowid);
  const created = getUserById(id);
  if (!created) {
    // 不应到达；fail-closed
    throw new Error('user insert succeeded but row not found');
  }
  return { ok: true, user: toAdminResponse(created) };
}

export type PatchUserError =
  | { type: 'not_found' }
  | { type: 'already_deleted' }
  | { type: 'self_demote' }; // 4 条产品规则之 #1：admin 不能改自己 role 为 user

export interface PatchUserParams {
  targetId: number;
  actorId: number; // 当前 admin 自己的 id（self-demote 检测）
  role?: 'user' | 'admin';
  password?: string;
}

/**
 * 改 role / 重置密码。caller 已经过 zod 校验（至少一个字段存在）。
 *
 * 4 条产品规则之 #1：targetId === actorId && role === 'user' → self_demote 拒
 *   理由：防误操作锁死系统，至少保留一个 admin。
 *   注：本规则只防"admin 把自己降为 user"。如果生产里有多个 admin 互相降级，
 *       理论上仍可锁死，但内部 5 人项目场景不必过度设计。
 */
export async function patchUser(
  params: PatchUserParams,
): Promise<{ ok: true; user: AdminUserResponse } | { ok: false; error: PatchUserError }> {
  const target = getUserById(params.targetId);
  if (!target) return { ok: false, error: { type: 'not_found' } };
  if (target.deleted_at !== null) return { ok: false, error: { type: 'already_deleted' } };

  if (
    params.role === 'user' &&
    params.targetId === params.actorId
  ) {
    return { ok: false, error: { type: 'self_demote' } };
  }

  const updates: string[] = [];
  const values: Array<string | number> = [];
  if (params.role !== undefined) {
    updates.push('role = ?');
    values.push(params.role);
  }
  if (params.password !== undefined) {
    const hash = await hashPassword(params.password);
    updates.push('password_hash = ?');
    values.push(hash);
  }
  if (updates.length === 0) {
    // route 层 zod refine 已防住，此处兜底返回原 user 视为 noop
    return { ok: true, user: toAdminResponse(target) };
  }
  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(params.targetId);
  getDb()
    .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .run(...values);
  const updated = getUserById(params.targetId);
  if (!updated) throw new Error('user updated but row not found');
  return { ok: true, user: toAdminResponse(updated) };
}

export type DeleteUserError =
  | { type: 'not_found' }
  | { type: 'already_deleted' }
  | { type: 'self_delete' };

export interface DeleteUserParams {
  targetId: number;
  actorId: number;
}

/**
 * 软删用户（写 deleted_at = now，保留行）。
 *
 * 4 条产品规则之 #1 延伸：admin 不能软删自己（self_delete 拒）
 *   同样为防"误操作锁死系统"。
 */
export function deleteUser(
  params: DeleteUserParams,
): { ok: true; user: AdminUserResponse } | { ok: false; error: DeleteUserError } {
  const target = getUserById(params.targetId);
  if (!target) return { ok: false, error: { type: 'not_found' } };
  if (target.deleted_at !== null) return { ok: false, error: { type: 'already_deleted' } };
  if (params.targetId === params.actorId) {
    return { ok: false, error: { type: 'self_delete' } };
  }
  const now = Date.now();
  getDb()
    .prepare('UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, params.targetId);
  const updated = getUserById(params.targetId);
  if (!updated) throw new Error('user soft-delete but row not found');
  return { ok: true, user: toAdminResponse(updated) };
}
