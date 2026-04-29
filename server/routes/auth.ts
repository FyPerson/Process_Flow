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
        `SELECT id, username, password_hash, role, created_at, updated_at, deleted_at
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

/** GET /api/auth/me */
authRouter.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

/** POST /api/auth/refresh —— 用当前 token 换一个新 token（延长有效期） */
authRouter.post('/api/auth/refresh', requireAuth, (req: Request, res: Response) => {
  // requireAuth 已验证旧 token；用 req.user 直接重签
  const token = signToken(req.user!);
  res.json({ token, user: req.user });
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
        `SELECT id, username, password_hash, role, created_at, updated_at, deleted_at
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
