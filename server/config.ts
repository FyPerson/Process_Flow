// 服务端运行时配置：所有环境变量入口集中在这里
// 模式判断：NODE_ENV=production 走静态 dist；否则走 Vite middleware（HMR）

// dotenv 必须在所有 process.env 读取之前加载（敏感配置走 .env，不进仓库）
import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const isProduction = process.env.NODE_ENV === 'production';

// 启动时一次性读 package.json 拿版本号（C4 起 health 接口用）
const projectRootPath = path.resolve(__dirname, '..');
const pkg = JSON.parse(
  fs.readFileSync(path.join(projectRootPath, 'package.json'), 'utf-8')
) as { version: string };

export const config = {
  isProduction,

  // HTTP 监听
  port: Number(process.env.PORT) || 3001,
  host: process.env.HOST || '0.0.0.0',

  // 项目根目录（server/ 的上一级）
  projectRoot: projectRootPath,

  // 数据目录（仓库工作区**外**，方案 §3.3）
  // 开发期默认在仓库同级 ./业务全景图-data；生产覆盖为 E:\business-flow-data
  dataDir:
    process.env.DATA_DIR ||
    path.resolve(__dirname, '..', '..', '业务全景图-data'),

  // 应用版本（从 package.json 启动时一次性读）
  version: pkg.version,

  // JWT 配置（阶段 1 才用，先占位）
  jwtSecret: process.env.JWT_SECRET || '',
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS) || 7 * 24 * 60 * 60,

  // 初始管理员（阶段 1 才用，先占位）
  initialAdminUser: process.env.INITIAL_ADMIN_USER || '',
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || '',
} as const;
