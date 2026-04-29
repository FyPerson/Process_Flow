// Express 入口 —— 单进程同时承担 API + 前端资源
// dev:  Express + Vite middleware（HMR 保留）
// prod: Express + static dist（vite build 产物）

import express from 'express';
import path from 'node:path';
import { config } from './config.ts';
import { closeDb, initDb } from './db/index.ts';
import { httpLogger, logger } from './middleware/logger.ts';
import { healthRouter } from './routes/health.ts';

async function bootstrap() {
  // === DB 必须在注册路由之前就绪（codex C2 复审建议）===
  // initDb() 失败直接 throw，bootstrap.catch 会让进程 exit(1)，避免带病启动
  initDb();

  const app = express();

  app.disable('x-powered-by');

  // 请求日志要在所有路由之前 —— 否则未匹配请求/异常没法被记录
  app.use(httpLogger);

  app.use(express.json({ limit: '2mb' }));

  // === API 路由必须在前端资源之前注册 ===
  // 否则 vite middleware 或 SPA fallback 会拦截 /api/* 请求
  app.use(healthRouter);

  // === 前端资源 ===
  if (config.isProduction) {
    // 生产模式：serve dist + SPA fallback
    const distDir = path.join(config.projectRoot, 'dist');
    app.use(express.static(distDir));
    app.get('*splat', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
    logger.info({ distDir }, '[server] production mode, serving dist');
  } else {
    // 开发模式：嵌入 Vite middleware，保留 HMR
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: config.projectRoot,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    logger.info('[server] development mode, vite middleware active (HMR enabled)');
  }

  app.listen(config.port, config.host, () => {
    logger.info(
      { host: config.host, port: config.port, mode: config.isProduction ? 'production' : 'development' },
      '[server] listening'
    );
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, '[server] failed to start');
  closeDb();
  process.exit(1);
});

// 优雅关闭 DB（PM2 stop / Ctrl+C / kill）
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info({ signal: sig }, '[server] received signal, closing db');
    closeDb();
    process.exit(0);
  });
}
