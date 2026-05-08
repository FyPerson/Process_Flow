import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// v3 双进程架构：Vite 跑 5173 + proxy /api 到 Express 3001
// 之前 v2 是 Express 单进程嵌 Vite middleware，但 Windows 上 createViteServer
// 在 middlewareMode 下有概率卡住启动序列。详见 docs/规划/codex审查记录/横切问题/dev-hang/

// dev-only middleware：让 /manual.html 直接返回 public/manual.html 真实内容
// 不走 vite SPA fallback（默认会把所有 .html 重写到 index.html）
// 生产环境由 Express express.static('dist') 处理，不需要此 middleware
function serveManualHtmlInDev() {
  return {
    name: 'serve-manual-html-in-dev',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/manual.html' || req.url?.startsWith('/manual.html?')) {
          try {
            const content = readFileSync(resolve(__dirname, 'public/manual.html'), 'utf-8');
            _res.setHeader('Content-Type', 'text/html; charset=utf-8');
            _res.end(content);
            return;
          } catch {
            // fallthrough
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveManualHtmlInDev()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: true,
    watch: {
      // 忽略 public 目录的变化，避免保存数据或页面更新时触发热重载
      ignored: ['**/public/**', '**/node_modules/**', '**/.git/**'],
    },
    hmr: {
      overlay: true,
    },
    // dev 模式 proxy：所有 /api/* 请求转发到 Express（3001）
    // 生产模式 vite 不参与运行时（Express 直接 serve dist），proxy 不生效
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
});
