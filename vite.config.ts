import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// v3 双进程架构：Vite 跑 5173 + proxy /api 到 Express 3001
// 之前 v2 是 Express 单进程嵌 Vite middleware，但 Windows 上 createViteServer
// 在 middlewareMode 下有概率卡住启动序列。详见 docs/规划/codex审查记录/dev-hang/
export default defineConfig({
  plugins: [react()],
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
