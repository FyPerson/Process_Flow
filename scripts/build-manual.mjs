// 把 docs/使用手册.md 编译成 public/manual.html
// + 把 docs/imgs/使用手册/ 拷贝到 public/manual-imgs/
// + 重写图片路径
//
// 跑法：node scripts/build-manual.mjs
// 时机：vite build 之前（package.json prebuild 钩子）
// 产物：public/manual.html + public/manual-imgs/*.png（vite build 自动包到 dist/）
//
// 不入仓决策：
//   - public/manual.html 入仓（手册本体，体积小）
//   - public/manual-imgs/ 入仓（截图入仓决策——见 .gitignore 调整）

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_MD = join(ROOT, 'docs', '使用手册.md');
const SRC_IMGS = join(ROOT, 'docs', 'imgs', '使用手册');
const OUT_HTML = join(ROOT, 'public', 'manual.html');
const OUT_IMGS = join(ROOT, 'public', 'manual-imgs');

function log(msg) {
  console.log(`[build-manual] ${msg}`);
}

function copyImages() {
  if (!existsSync(SRC_IMGS)) {
    log(`! source imgs dir not found: ${SRC_IMGS} (skipping image copy)`);
    return 0;
  }
  mkdirSync(OUT_IMGS, { recursive: true });
  const files = readdirSync(SRC_IMGS).filter((f) => /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(f));
  for (const f of files) {
    copyFileSync(join(SRC_IMGS, f), join(OUT_IMGS, f));
  }
  log(`copied ${files.length} images → public/manual-imgs/`);
  return files.length;
}

function buildHtml() {
  const md = readFileSync(SRC_MD, 'utf-8');
  const renderer = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });

  // 重写图片路径：imgs/使用手册/xxx.png → manual-imgs/xxx.png
  // 关键：在 normalizeLink 之前重写（token 阶段 attrs 拿到的是原始 markdown 字符串）
  // markdown-it 默认 normalizeLink 会把中文 URL-encode，所以必须在 token 阶段就改完
  const defaultImageRule = renderer.renderer.rules.image || ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  renderer.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const srcAttr = token.attrIndex('src');
    if (srcAttr >= 0) {
      let src = token.attrs[srcAttr][1];
      // 兼容两种形态：未编码的中文路径 + URL 已编码的路径（防御性）
      const ENCODED_PREFIX = 'imgs/' + encodeURIComponent('使用手册') + '/';
      const RAW_PREFIX = 'imgs/使用手册/';
      if (src.startsWith(RAW_PREFIX)) {
        src = 'manual-imgs/' + src.slice(RAW_PREFIX.length);
      } else if (src.startsWith(ENCODED_PREFIX)) {
        src = 'manual-imgs/' + src.slice(ENCODED_PREFIX.length);
      }
      token.attrs[srcAttr][1] = src;
    }
    return defaultImageRule(tokens, idx, opts, env, self);
  };

  const body = renderer.render(md);
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>业务全景图 - 使用手册</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    max-width: 880px;
    margin: 0 auto;
    padding: 32px 24px 80px;
    line-height: 1.7;
    color: #1f2937;
    background: #fafafa;
  }
  h1 { font-size: 28px; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; margin-top: 8px; }
  h2 { font-size: 22px; margin-top: 32px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
  h3 { font-size: 18px; margin-top: 24px; color: #2563eb; }
  h4 { font-size: 15px; margin-top: 16px; color: #374151; }
  p { margin: 12px 0; }
  ul, ol { padding-left: 24px; }
  li { margin: 4px 0; }
  blockquote {
    border-left: 4px solid #2563eb;
    background: #eff6ff;
    margin: 16px 0;
    padding: 12px 16px;
    color: #1e40af;
  }
  blockquote p { margin: 4px 0; }
  code {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: "Consolas", "Monaco", monospace;
    font-size: 0.92em;
    color: #be185d;
  }
  pre {
    background: #1f2937;
    color: #e5e7eb;
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
  }
  pre code { background: transparent; padding: 0; color: inherit; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 14px;
  }
  th, td {
    border: 1px solid #e5e7eb;
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f9fafb; font-weight: 600; }
  tr:nth-child(even) { background: #f9fafb; }
  img {
    max-width: 100%;
    height: auto;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    margin: 16px 0;
    display: block;
  }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { color: #111827; }
  .back-link {
    position: fixed;
    top: 16px;
    right: 16px;
    background: #2563eb;
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(37,99,235,0.3);
  }
  .back-link:hover { background: #1d4ed8; text-decoration: none; }
  @media (max-width: 600px) {
    body { padding: 16px 12px 60px; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; }
    h3 { font-size: 16px; }
  }
</style>
</head>
<body>
<a href="/" class="back-link">← 返回应用</a>
${body}
</body>
</html>
`;

  mkdirSync(dirname(OUT_HTML), { recursive: true });
  writeFileSync(OUT_HTML, html, 'utf-8');
  log(`wrote ${OUT_HTML} (${html.length} bytes)`);
}

function main() {
  if (!existsSync(SRC_MD)) {
    console.error(`[build-manual] FATAL: ${SRC_MD} not found`);
    process.exit(1);
  }
  const imgCount = copyImages();
  buildHtml();
  log(`done. manual.html + ${imgCount} images ready in public/`);
}

main();
