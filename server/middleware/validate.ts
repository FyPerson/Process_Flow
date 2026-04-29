// Zod body 校验中间件（方案 §4.7）

import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // 把 Zod issues 整理为简洁错误（不返回完整堆栈给客户端）
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      res.status(400).json({
        error: 'invalid_input',
        message: 'request body validation failed',
        issues,
      });
      return;
    }
    // 替换 req.body 为已 strict 过滤的 data
    req.body = result.data as Request['body'];
    next();
  };
}
