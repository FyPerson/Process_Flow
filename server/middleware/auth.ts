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
import type { JwtPayload, UserPublic } from '../types/user.ts';

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
