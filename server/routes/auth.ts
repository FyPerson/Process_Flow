// 认证相关路由
// POST /api/auth/login          —— 登录拿 token
// GET  /api/auth/me             —— 当前用户信息（要求登录）
// POST /api/auth/refresh        —— 续期 token（要求登录）
// POST /api/auth/change-password —— 改密（要求登录）

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.ts';
import { requireAuth, signToken } from '../middleware/auth.ts';
import { loginRateLimitByIp, loginRateLimitByUsername } from '../middleware/rate-limit.ts';
import type { UserRow } from '../types/user.ts';
import { toPublic } from '../types/user.ts';
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from '../utils/password.ts';
import { PatchSelfRequestSchema } from '../schemas/user.ts';

export const authRouter: Router = Router();

const LoginSchema = z.object({
  username: z.string().min(1).max(20),
  password: z.string().min(1).max(200), // 上限防 DoS（bcrypt 长字符串很耗 CPU）
});

const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200),
});

/** POST /api/auth/login —— 双限流（IP + username）+ 不区分失败原因 */
authRouter.post(
  '/api/auth/login',
  loginRateLimitByIp,
  loginRateLimitByUsername,
  async (req: Request, res: Response) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input', message: 'username and password required' });
      return;
    }
    const { username, password } = parsed.data;

    const row = getDb()
      .prepare(
        `SELECT id, username, password_hash, role, nickname, created_at, updated_at, deleted_at
         FROM users WHERE username = ?`
      )
      .get(username) as UserRow | undefined;

    // 用户不存在 / 已软删 / 密码错误，统一报"凭据无效"
    // 不区分原因，避免泄露用户存在性给爆破
    if (!row || row.deleted_at !== null) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    const user = toPublic(row);
    const token = signToken(user);
    res.json({ token, user });
  }
);

/** GET /api/auth/me —— 实时查库取 nickname（JWT 不存 nickname 避免改昵称后陈旧）
 *  软删期间用旧 token 仍可调用 me，此时强制返 401 */
authRouter.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  const row = getDb()
    .prepare(
      `SELECT id, username, password_hash, role, nickname, created_at, updated_at, deleted_at
       FROM users WHERE id = ?`,
    )
    .get(req.user!.id) as UserRow | undefined;
  if (!row || row.deleted_at !== null) {
    res.status(401).json({ error: 'unauthorized', message: 'user not found or deleted' });
    return;
  }
  res.json({ user: toPublic(row) });
});

/** POST /api/auth/refresh —— 用当前 token 换一个新 token（延长有效期）
 *  同 me：实时查库取 nickname；软删期间走 401 */
authRouter.post('/api/auth/refresh', requireAuth, (req: Request, res: Response) => {
  const row = getDb()
    .prepare(
      `SELECT id, username, password_hash, role, nickname, created_at, updated_at, deleted_at
       FROM users WHERE id = ?`,
    )
    .get(req.user!.id) as UserRow | undefined;
  if (!row || row.deleted_at !== null) {
    res.status(401).json({ error: 'unauthorized', message: 'user not found or deleted' });
    return;
  }
  const user = toPublic(row);
  const token = signToken(user);
  res.json({ token, user });
});

/** PATCH /api/auth/me —— 用户自助改自己的资料（目前只允许改 nickname）
 *  - 仅登录用户（不限角色，admin/user 都可）
 *  - 不允许改 role / password（密码走独立 change-password 流程）
 *  - 软删用户用旧 token 调用走 401 */
authRouter.patch('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  const parsed = PatchSelfRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_input',
      message: 'nickname must be 1-30 characters (after trim)',
    });
    return;
  }
  const row = getDb()
    .prepare(
      `SELECT id, username, password_hash, role, nickname, created_at, updated_at, deleted_at
       FROM users WHERE id = ?`,
    )
    .get(req.user!.id) as UserRow | undefined;
  if (!row || row.deleted_at !== null) {
    res.status(401).json({ error: 'unauthorized', message: 'user not found or deleted' });
    return;
  }
  getDb()
    .prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?')
    .run(parsed.data.nickname, Date.now(), row.id);
  const updated = getDb()
    .prepare(
      `SELECT id, username, password_hash, role, nickname, created_at, updated_at, deleted_at
       FROM users WHERE id = ?`,
    )
    .get(row.id) as UserRow;
  res.json({ user: toPublic(updated) });
});

/** POST /api/auth/change-password */
authRouter.post(
  '/api/auth/change-password',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_input',
        message: `newPassword must be at least ${PASSWORD_MIN_LENGTH} characters`,
      });
      return;
    }
    const { oldPassword, newPassword } = parsed.data;

    const row = getDb()
      .prepare(
        `SELECT id, username, password_hash, role, nickname, created_at, updated_at, deleted_at
         FROM users WHERE id = ?`
      )
      .get(req.user!.id) as UserRow | undefined;

    if (!row || row.deleted_at !== null) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const ok = await verifyPassword(oldPassword, row.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'invalid_credentials', message: 'old password incorrect' });
      return;
    }

    const newHash = await hashPassword(newPassword);
    getDb()
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, Date.now(), row.id);

    res.json({ ok: true });
  }
);
