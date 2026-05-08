// 用户管理路由（P3F-1，方案 §4.2）
//
// 全部要求 admin（requireAuth + requireAdmin）：
// - GET    /api/users        列表
// - POST   /api/users        创建
// - PATCH  /api/users/:id    改 role / 重置密码
// - DELETE /api/users/:id    软删

import { Router, type Request, type Response } from 'express';
import { requireFreshAdmin } from '../middleware/auth.ts';
import {
  CreateUserRequestSchema,
  PatchUserRequestSchema,
  PositiveIntegerIdSchema,
} from '../schemas/user.ts';
import {
  createUser,
  deleteUser,
  listUsers,
  patchUser,
} from '../services/users.ts';

export const usersRouter: Router = Router();

function parsePositiveIntegerParam(raw: unknown): number | null {
  const parsed = PositiveIntegerIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** GET /api/users —— 列表 */
usersRouter.get(
  '/api/users',
  requireFreshAdmin,
  (_req: Request, res: Response) => {
    const users = listUsers();
    res.json({ users });
  },
);

/** POST /api/users —— 创建 */
usersRouter.post(
  '/api/users',
  requireFreshAdmin,
  async (req: Request, res: Response) => {
    const parsed = CreateUserRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // 稳定短语而非 zod 原始 message（codex P3F-1 一审 low 2：前端契约不依赖 zod 文本）
      res.status(400).json({
        error: 'invalid_input',
        message: 'username / password / role invalid',
      });
      return;
    }
    const result = await createUser({
      username: parsed.data.username,
      password: parsed.data.password,
      role: parsed.data.role,
      nickname: parsed.data.nickname,
    });
    if (!result.ok) {
      // 两类 conflict 都映射 409；message 区分以便 admin UI 给提示
      const message =
        result.error.type === 'username_taken_soft_deleted'
          ? 'username taken by a soft-deleted user; not reusable'
          : 'username already exists';
      res.status(409).json({ error: 'conflict', message });
      return;
    }
    res.status(201).json({ user: result.user });
  },
);

/** PATCH /api/users/:id —— 改 role / 重置密码 */
usersRouter.patch(
  '/api/users/:id',
  requireFreshAdmin,
  async (req: Request, res: Response) => {
    const targetId = parsePositiveIntegerParam(req.params.id);
    if (targetId === null) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const parsed = PatchUserRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // 稳定短语而非 zod 原始 message（codex P3F-1 一审 low 2）
      res.status(400).json({
        error: 'invalid_input',
        message: 'role / password invalid, or both empty',
      });
      return;
    }
    const result = await patchUser({
      targetId,
      actorId: req.user!.id,
      role: parsed.data.role,
      password: parsed.data.password,
      nickname: parsed.data.nickname,
    });
    if (!result.ok) {
      switch (result.error.type) {
        case 'not_found':
          res.status(404).json({ error: 'not_found' });
          return;
        case 'already_deleted':
          res.status(410).json({ error: 'gone', message: 'user is soft-deleted' });
          return;
        case 'self_demote':
          res.status(409).json({
            error: 'self_demote_forbidden',
            message: 'admin cannot demote self to user; ask another admin',
          });
          return;
      }
    }
    res.json({ user: result.user });
  },
);

/** DELETE /api/users/:id —— 软删 */
usersRouter.delete(
  '/api/users/:id',
  requireFreshAdmin,
  (req: Request, res: Response) => {
    const targetId = parsePositiveIntegerParam(req.params.id);
    if (targetId === null) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const result = deleteUser({
      targetId,
      actorId: req.user!.id,
    });
    if (!result.ok) {
      switch (result.error.type) {
        case 'not_found':
          res.status(404).json({ error: 'not_found' });
          return;
        case 'already_deleted':
          res.status(410).json({ error: 'gone', message: 'user is already soft-deleted' });
          return;
        case 'self_delete':
          res.status(409).json({
            error: 'self_delete_forbidden',
            message: 'admin cannot soft-delete self; ask another admin',
          });
          return;
      }
    }
    res.json({ user: result.user });
  },
);
