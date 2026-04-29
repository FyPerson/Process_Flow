// 请求日志中间件
// dev: pino-pretty 彩色输出（人类可读）
// prod: 纯 JSON（一行一个 event，PM2 logs / logrotate 友好）

import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from '../config.ts';

const baseLogger = config.isProduction
  ? pino({ level: process.env.LOG_LEVEL || 'info' })
  : pino({
      level: process.env.LOG_LEVEL || 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });

export const logger = baseLogger;

export const httpLogger = pinoHttp({
  logger: baseLogger,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // dev 模式只记 /api/* 请求（避免 Vite 大量模块 fetch 刷屏）；prod 记全部
  autoLogging: config.isProduction
    ? true
    : { ignore: (req) => !req.url?.startsWith('/api/') },
  serializers: {
    // 简化序列化，去掉 headers 等大对象
    req(req) {
      return { method: req.method, url: req.url };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});
