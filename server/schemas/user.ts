// Zod schemas for /api/users（P3F-1 admin 用户管理）
//
// 关键约束（P3F 拆分草案 4 条产品规则）：
// - admin 不能改自己的 role 为 user（在 route/service 层校验，不在 zod 层）
// - 软删用户的 username 不可重用（DB 唯一约束保留 + service 层 409 防御）
// - password 复用 utils/password.ts 的 PASSWORD_MIN_LENGTH=8（与 auth.ts ChangePasswordSchema 一致）

import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '../utils/password.ts';

// 创建用户的 username schema：1-20 字符 + 限制集合（字母/数字/下划线/中文）
//
// 故意比 auth.ts 的 LoginSchema 严格（LoginSchema 仅限 1-20 字符不限字符集）：
// - LoginSchema 保留宽松是为了"兼容历史用户"——本项目早期 admin 用 ssh + INSERT 直创建过非常规用户名
// - 创建用户走严格校验避免 seed-users CLI 类工具被 shell 特殊字符（空格、`:`、引号）吃坏
// - 现存 5 个种子用户（user01-05 + admin）都符合严格规则，无 schema 不一致风险
// - 决策来源：codex P3F-1 一审 low 1（注释锁定，不强行合并两套 schema）
export const UsernameSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[\p{L}\p{N}_]+$/u, 'username may contain letters, digits, underscore only');

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(200); // 上限防 DoS（bcrypt 长字符串很耗 CPU）

export const UserRoleSchema = z.enum(['user', 'admin']);

// POST /api/users
export const CreateUserRequestSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
    role: UserRoleSchema,
  })
  .strict();
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

// PATCH /api/users/:id —— 改 role / 重置密码（互斥不强制；同请求里都可改）
// 至少一个字段必须存在（否则 400）
export const PatchUserRequestSchema = z
  .object({
    role: UserRoleSchema.optional(),
    password: PasswordSchema.optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.password !== undefined, {
    message: 'at least one of role / password is required',
  });
export type PatchUserRequest = z.infer<typeof PatchUserRequestSchema>;

// 整数 ID 路径参数（与 annotations.ts 一致）
export const PositiveIntegerIdSchema = z.coerce.number().int().positive();

// 响应中暴露的用户视图（admin 视角，含 created_at / updated_at；不暴露 password_hash）
export interface AdminUserResponse {
  id: number;
  username: string;
  role: 'user' | 'admin';
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
