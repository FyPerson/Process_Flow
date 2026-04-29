// 登录限流（方案 §4.1）：5 次/分钟/IP + 5 次/分钟/username
//
// 策略：两个 limiter 串联，先 IP 后 username。任一超限都返回 429。
// 失败响应里不暴露细节给爆破方。

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 5;

export const loginRateLimitByIp = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_PER_WINDOW,
  // 仅对失败的登录计数（成功的不算）—— 让正常用户多次切换账号不被误伤
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'too many login attempts, retry later' },
});

export const loginRateLimitByUsername = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_PER_WINDOW,
  skipSuccessfulRequests: true,
  // 关键：keyGenerator 改为 username（小写，防大小写绕过）
  keyGenerator: (req: Request) => {
    const u =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    return `username:${u}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'too many login attempts for this account' },
});
