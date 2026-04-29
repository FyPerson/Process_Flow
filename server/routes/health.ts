import { Router } from 'express';
import { config } from '../config.ts';
import { getDb } from '../db/index.ts';

export const healthRouter: Router = Router();

healthRouter.get('/api/health', (_req, res) => {
  // dbWritable: 走 getDb 单例（不另开连接），用 SELECT 1 验证连接活；
  // WAL 文件损坏 / DB 文件被锁会抛异常 → 标记不健康
  let dbWritable = false;
  let dbError: string | undefined;
  try {
    const row = getDb().prepare('SELECT 1 AS ok').get() as { ok: number };
    dbWritable = row.ok === 1;
  } catch (err) {
    dbError = (err as Error).message;
  }

  const ok = dbWritable;
  res.status(ok ? 200 : 503).json({
    ok,
    version: config.version,
    mode: config.isProduction ? 'production' : 'development',
    dbWritable,
    ...(dbError ? { dbError } : {}),
    timestamp: Date.now(),
  });
});
