// users 表的行类型 + 对外 API 用的精简类型

export type UserRole = 'user' | 'admin';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** 对外（API 响应、JWT payload）只暴露这些字段，永远不外漏 password_hash */
export interface UserPublic {
  id: number;
  username: string;
  role: UserRole;
}

export function toPublic(row: UserRow): UserPublic {
  return { id: row.id, username: row.username, role: row.role };
}

/** JWT payload —— 只放最小必要信息 */
export interface JwtPayload {
  sub: number;        // user id
  username: string;
  role: UserRole;
  iat?: number;       // jwt 自动加
  exp?: number;       // jwt 自动加
}
