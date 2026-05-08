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

// 昵称：1-30 字符，trim 后非空（防 "   " 空白昵称）
// 字符集：中文/字母/数字/下划线/中划线/空格（codex v1.17.0 末尾审 M3 加固）
// 拒绝换行 / 控制字符 / RTL 控制符 / emoji / 括号 — 防止伪装成 [公共画布] 等系统前缀
// 5 人内网下用 regex 比展示层兜底更稳；与 username 严格风格一致
// \p{L} 字母 \p{N} 数字 \p{Mark} 给中文组合字符（如 ǎ ā）留空间；空格 + - + _ 只允许 ASCII 形式
// migration 0006：新建用户由 service 自动 nickname=username；用户/admin 后续可改
export const NicknameSchema = z
  .string()
  .trim()
  .min(1, 'nickname must not be empty after trim')
  .max(30, 'nickname must be 1-30 characters')
  .regex(
    /^[\p{L}\p{N}\p{Mark}_ -]+$/u,
    'nickname only allows letters, digits, underscore, hyphen, space',
  );

// POST /api/users
// nickname 不强制（service 层默认 = username）；如果传则走 NicknameSchema 校验
export const CreateUserRequestSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
    role: UserRoleSchema,
    nickname: NicknameSchema.optional(),
  })
  .strict();
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

// PATCH /api/users/:id —— admin 改 role / 重置密码 / 改昵称（任一即可，至少 1 个字段）
export const PatchUserRequestSchema = z
  .object({
    role: UserRoleSchema.optional(),
    password: PasswordSchema.optional(),
    nickname: NicknameSchema.optional(),
  })
  .strict()
  .refine(
    (v) => v.role !== undefined || v.password !== undefined || v.nickname !== undefined,
    { message: 'at least one of role / password / nickname is required' },
  );
export type PatchUserRequest = z.infer<typeof PatchUserRequestSchema>;

// PATCH /api/auth/me —— 用户自助改自己的资料（目前只允许改 nickname）
// 与 PatchUserRequestSchema 拆开是因为：
// (1) 自助接口不允许改 role / password（密码走独立 change-password 流程）
// (2) 自助接口不需要 admin 权限，权限边界更小
export const PatchSelfRequestSchema = z
  .object({
    nickname: NicknameSchema,
  })
  .strict();
export type PatchSelfRequest = z.infer<typeof PatchSelfRequestSchema>;

// 整数 ID 路径参数（与 annotations.ts 一致）
export const PositiveIntegerIdSchema = z.coerce.number().int().positive();

// 响应中暴露的用户视图（admin 视角，含 created_at / updated_at；不暴露 password_hash）
export interface AdminUserResponse {
  id: number;
  username: string;
  nickname: string;  // 空 nickname 由 toAdminResponse fallback 到 username
  role: 'user' | 'admin';
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
