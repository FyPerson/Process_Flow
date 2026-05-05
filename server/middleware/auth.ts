// JWT 鉴权中间件
//
// 三个导出：
// - signToken(user): 签发 token
// - requireAuth: 必须登录才能进入路由（401 if no/invalid token）
// - optionalAuth: 解析 token 但不强制（用于 health / 列表等可游客访问的接口）
//
// JWT in localStorage 的安全前提（v4.1 codex 复审要求）：
// - 全代码库禁用 dangerouslySetInnerHTML（ESLint react/no-danger）
// - 用户输入纯文本渲染（<span>{userInput}</span>）
// - helmet CSP（在 index.ts 挂载）

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.ts';
import { getDb } from '../db/index.ts';
import type { JwtPayload, UserPublic, UserRow } from '../types/user.ts';

declare module 'express-serve-static-core' {
  // 给 req 加一个 user 字段；中间件解析 JWT 后塞进去
  interface Request {
    user?: UserPublic;
  }
}

/** 签发 JWT。token 含 sub / username / role / iat / exp。 */
export function signToken(user: UserPublic): string {
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET is not configured (.env missing?)');
  }
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds,
  });
}

/** 解析 Authorization header；成功返回 UserPublic，失败返回 null（不抛异常） */
function tryDecode(authHeader: string | undefined): UserPublic | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const decoded = jwt.verify(m[1], config.jwtSecret) as unknown as JwtPayload;
    return {
      id: decoded.sub,
      username: decoded.username,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}

/** 强制鉴权：无 token 或无效 token 直接 401 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = tryDecode(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'login required' });
    return;
  }
  req.user = user;
  next();
}

/** 可选鉴权：有 token 解析填充 req.user，无则 req.user 为 undefined（路由自行决定逻辑） */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const user = tryDecode(req.headers.authorization);
  if (user) req.user = user;
  next();
}

/** 仅管理员才能访问；前提是已经过 requireAuth */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden', message: 'admin only' });
    return;
  }
  next();
}

/**
 * admin 管理路由专用：JWT 解码后**回查 users 表**确认用户当前态。
 * 替代 `requireAuth + requireAdmin` 组合，仅用于 /api/users 一组管理端点。
 *
 * 解决 codex P3F-1 一审 high：JWT 内 role/id 是 token 签发时的快照，
 * 用户被另一 admin 降权或软删后，旧 token 在过期前仍可能继续访问 admin 路由。
 *
 * 单次 SELECT，性能成本可忽略（内部 5 人项目）。返回 400 / 401 / 403 而非 200 即拒。
 *
 * 不替代 requireAuth：其他路由（auth / canvases / annotations）仍走原中间件，
 * 容忍 token TTL 内的状态延迟（这是 JWT 通用语义）。
 */
export function requireFreshAdmin(req: Request, res: Response, next: NextFunction): void {
  const decoded = tryDecode(req.headers.authorization);
  if (!decoded) {
    res.status(401).json({ error: 'unauthorized', message: 'login required' });
    return;
  }
  // 回查 DB：要求用户存在 + 未软删 + 当前 role 仍是 admin
  const row = getDb()
    .prepare(
      `SELECT id, username, password_hash, role, created_at, updated_at, deleted_at
       FROM users WHERE id = ?`,
    )
    .get(decoded.id) as UserRow | undefined;
  if (!row || row.deleted_at !== null) {
    res.status(401).json({ error: 'unauthorized', message: 'account no longer valid' });
    return;
  }
  if (row.role !== 'admin') {
    res.status(403).json({ error: 'forbidden', message: 'admin only' });
    return;
  }
  // 用 DB 当前态填充 req.user（不信 token 内的快照）
  req.user = { id: row.id, username: row.username, role: row.role };
  next();
}
