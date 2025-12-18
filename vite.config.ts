import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
    watch: {
      // 忽略 public 目录的变化，避免保存数据或页面更新时触发热重载
      ignored: ['**/public/**', '**/node_modules/**', '**/.git/**'],
    },
    hmr: {
      // 优化 HMR 配置
      overlay: true,
    },
  },
});
