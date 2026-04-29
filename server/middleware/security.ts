// 安全 headers 中间件（helmet）
//
// 方案 §7 阶段 1 安全前提（v4.1 codex 复审强制）：
// - helmet 提供基础 CSP（default-src 'self' + 必要白名单）
// - 所有 API 响应必须带 Content-Security-Policy header
// - 配合 ESLint react/no-danger + grep 扫描 dangerouslySetInnerHTML，构成 XSS 三层防御
//
// 模式差异：
// - prod: 启用 CSP（'self' + 必要的内联 style，因为 React inline style 大量使用）
// - dev: 关闭 CSP（避免和 vite HMR 的 inline script / eval 冲突）；保留其他安全 headers

import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { config } from '../config.ts';

/** 一组合并到 Express 的安全中间件（数组 push 进 app.use） */
export const securityMiddleware: RequestHandler[] = config.isProduction
  ? [
      helmet({
        contentSecurityPolicy: {
          // 不使用 helmet 默认的所有 directive，按业务需要白名单
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            // 脚本仅允许同源（vite build 产物是同源静态文件）
            scriptSrc: ["'self'"],
            // React 内联 style 大量使用，必须允许 unsafe-inline
            // （v4.1 验收里不要求 strict-dynamic 等，5 人协作够用）
            styleSrc: ["'self'", "'unsafe-inline'"],
            // 图片：自身 + data: URL（base64 截图等）+ blob:（File API 预览）
            imgSrc: ["'self'", 'data:', 'blob:'],
            // 字体仅同源
            fontSrc: ["'self'", 'data:'],
            // XHR/fetch 仅同源（API 都是 /api/*）
            connectSrc: ["'self'"],
            // iframe 嵌入：方案里有静态业务页面（public/pages/*）通过 iframe 加载
            frameSrc: ["'self'"],
            // 禁止 object/embed 标签
            objectSrc: ["'none'"],
            // 表单提交目标限定同源
            formAction: ["'self'"],
            // 禁止页面被嵌入到他站 iframe（点击劫持防护）
            frameAncestors: ["'self'"],
            // 注意：这里曾经设过 upgradeInsecureRequests: [] 让 http→https 自动升级，
            // 但当前生产是纯 HTTP 部署（172.16.0.138:3001），开启会让浏览器把
            // /assets/*.js 也强制走 https → SSL 握手失败 → 整个 SPA 白屏。
            // 等以后真正上 HTTPS 时再加回来。
          },
        },
        // 禁用 helmet 默认的 cross-origin-embedder-policy（会拦 unsplash 等外链图）
        crossOriginEmbedderPolicy: false,
      }),
    ]
  : [
      // dev 模式只用基础 headers，关 CSP 避免和 vite HMR / inline eval 冲突
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
      }),
    ];
