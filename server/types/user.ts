// users 表的行类型 + 对外 API 用的精简类型

export type UserRole = 'user' | 'admin';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  nickname: string;  // 昵称；migration 0006 / 空字符串视为 fallback 到 username
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** 对外（API 响应、JWT payload）只暴露这些字段，永远不外漏 password_hash */
export interface UserPublic {
  id: number;
  username: string;
  role: UserRole;
  nickname: string;  // 显示用昵称（空字符串场景由 toPublic 已 fallback 为 username）
}

/** 把 row 转 public；nickname 空字符串 fallback 到 username 保护历史数据 */
export function toPublic(row: UserRow): UserPublic {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    nickname: row.nickname.length > 0 ? row.nickname : row.username,
  };
}

/** JWT payload —— 只放最小必要信息（不放 nickname：nickname 可改，避免 JWT 缓存陈旧；
 *  前端要拿当前 nickname 走 /api/auth/me 实时取） */
export interface JwtPayload {
  sub: number;        // user id
  username: string;
  role: UserRole;
  iat?: number;       // jwt 自动加
  exp?: number;       // jwt 自动加
}
