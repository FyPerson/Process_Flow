// PM2 配置 —— 生产环境用
// 用法：在 E:\business-flow\ 目录下执行
//   pm2 start ecosystem.config.cjs --env production
//   pm2 restart business-flow
//   pm2 reload business-flow
//
// 敏感配置（JWT_SECRET / INITIAL_ADMIN_* 等）走服务器本地 `.env` 文件，
// 不进仓库；server/config.ts 通过 process.env 读取。
//
// 注：使用 .cjs 扩展名是因为项目根 package.json 是 "type": "module"，
// PM2 配置必须用 CommonJS 才能 require()。

module.exports = {
  apps: [
    {
      name: 'business-flow',
      script: 'server/index.ts',
      interpreter: 'node',
      // 用 tsx 加载器跑 TypeScript（不预编译，与 npm start 一致）
      // node --import 是 Node 24 推荐的方式
      node_args: ['--import', 'tsx'],
      cwd: 'E:/business-flow',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        HOST: '0.0.0.0',
        DATA_DIR: 'E:/business-flow-data',
        // JWT_SECRET / INITIAL_ADMIN_USER / INITIAL_ADMIN_PASSWORD
        // 由本地 .env 提供（PM2 不在这里硬编码秘密）
        // 如果 .env 在 PM2 进程启动时不被自动读取，C4 之后 server 启动时
        // 用 dotenv 显式加载（阶段 1 实施 JWT 时落地）
      },
      // 日志：PM2 默认会写到 ~/.pm2/logs/，结合 logrotate 模块更省心
      // 这里不重定向，让 PM2 自管理
      autorestart: true,
      // 内存超过 500MB 自动重启（防内存泄漏；正常 < 200MB）
      max_memory_restart: '500M',
      // 启动超时：vite middleware 启动比纯静态慢
      kill_timeout: 5000,
    },
  ],
};
