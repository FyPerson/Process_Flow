// Express 入口
//
// === v3 架构（2026-04-30 双进程）===
// dev:  Express 跑 3001（仅 API），Vite 跑 5173 单独进程并 proxy /api → 3001
// prod: Express 跑 3001（serve dist + /api/*）—— 单进程不变
//
// 之前 v2 是单进程（dev 里嵌 Vite middleware），但 createViteServer({middlewareMode:true})
// 在 Windows 上有概率卡住启动序列（[db] ready 后无任何输出 60-90 秒），已多次踩坑。
// 详见 docs/规划/codex审查记录/横切问题/dev-hang/00-诊断-dev 启动 hang 根因.md

import express from 'express';
import path from 'node:path';
import { config } from './config.ts';
import { bootstrapInitialAdmin } from './db/bootstrap.ts';
import { closeDb, initDb } from './db/index.ts';
import { httpLogger, logger } from './middleware/logger.ts';
import { securityMiddleware } from './middleware/security.ts';
import { annotationsRouter } from './routes/annotations.ts';
import { authRouter } from './routes/auth.ts';
import { canvasesRouter } from './routes/canvases.ts';
import { draftsRouter } from './routes/drafts.ts';
import { healthRouter } from './routes/health.ts';
import { heartbeatsRouter } from './routes/heartbeats.ts';
import { usersRouter } from './routes/users.ts';

async function bootstrap() {
  const startedAt = Date.now();

  // === DB 必须在注册路由之前就绪（codex C2 复审建议）===
  // initDb() 失败直接 throw，bootstrap.catch 会让进程 exit(1)，避免带病启动
  const t0 = Date.now();
  const db = initDb();
  logger.info({ ms: Date.now() - t0 }, '[startup] initDb done');

  const t1 = Date.now();
  await bootstrapInitialAdmin(db);
  logger.info({ ms: Date.now() - t1 }, '[startup] bootstrapInitialAdmin done');

  const t2 = Date.now();
  const app = express();
  app.disable('x-powered-by');

  app.use(httpLogger);
  app.use(securityMiddleware);
  app.use(express.json({ limit: '2mb' }));

  // === API 路由 ===
  app.use(healthRouter);
  app.use(authRouter);
  app.use(canvasesRouter);
  app.use(draftsRouter);
  app.use(heartbeatsRouter);
  app.use(annotationsRouter);
  app.use(usersRouter);
  logger.info({ ms: Date.now() - t2 }, '[startup] middlewares + routes registered');

  // === 前端资源（仅生产模式 serve dist；dev 模式由独立 Vite 进程处理）===
  if (config.isProduction) {
    const t3 = Date.now();
    const distDir = path.join(config.projectRoot, 'dist');
    app.use(express.static(distDir));
    app.get('*splat', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
    logger.info({ distDir, ms: Date.now() - t3 }, '[startup] production static serve registered');
  } else {
    logger.info(
      '[startup] dev mode: API only on this process. Frontend served by separate Vite (npm run dev:vite, default port 5173)'
    );
  }

  // app.listen 用 Promise 包装，让端口占用等错误能进 bootstrap.catch 走 closeDb 路径
  // （codex 审查建议：纯 callback 形式的 app.listen 错误会逃逸到 process unhandled，
  //  跳过 closeDb → wal 不被 checkpoint）
  const t4 = Date.now();
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      logger.info(
        {
          host: config.host,
          port: config.port,
          mode: config.isProduction ? 'production' : 'development',
          listenMs: Date.now() - t4,
          totalStartupMs: Date.now() - startedAt,
        },
        '[server] listening'
      );
      resolve();
    });
    server.once('error', (err) => reject(err));
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
