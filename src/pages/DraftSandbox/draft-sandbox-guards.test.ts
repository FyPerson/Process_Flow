// DraftSandbox 反向断言测试（D-6）
//
// 目的：防止未来重构时意外把"导入"入口加回 DraftSandbox 目录。
// 方案 §2.2 + §6.2 产品红线：游客刻意不开"导入"入口，避免成为数据搬运绕过权限的漏洞
//
// 检测方式：grep DraftSandbox 目录所有 .ts/.tsx 文件，禁止出现以下模式：
//   1. <input type="file" —— 文件选择器（用户上传文件入口）
//   2. accept=".json" —— JSON 文件 accept 属性
//   3. accept="application/json" —— 同上
//   4. importDraft / importFlow / 任何 import* 函数名（产品意义的"导入"）
//   5. downloadCanvasFromServer / downloadProjectAsLocal —— 主应用 JSON 导出函数
//   6. exportCanvasAsSvg / exportCanvasAsJpg —— 仅 PNG（已确认 §7.2 后续讨论拍板）
//
// 例外：
//   - ES `import ... from ...` 语句（关键词在行首+空格识别 → 不算）
//   - useImperativeHandle 等 React API（不含 'import' 字样）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DRAFT_SANDBOX_DIR = join(import.meta.dirname ?? '.', '.');

/** 递归读取目录所有 .ts/.tsx 文件路径 + 内容 */
function collectFiles(dir: string): { path: string; content: string }[] {
  const entries = readdirSync(dir);
  const result: { path: string; content: string }[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      result.push(...collectFiles(full));
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      // 跳过测试文件本身（避免 self-match）
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      result.push({ path: full, content: readFileSync(full, 'utf-8') });
    }
  }
  return result;
}

// Self-test：确认 grep / extractImports 模式真能戳穿"如果真有导入入口"的反例
// 不引入临时文件污染源码树，直接用字符串字面值喂给检测函数
test('Self-test：grep 模式能命中真"导入"入口反例', () => {
  // 反例 1：含文件上传
  const fake1 = `<input type="file" accept=".json" onChange={handleImport} />`;
  assert.match(fake1, /<input[^>]*type=["']file["']/i, '应该命中 file input');
  assert.match(fake1, /accept=["'](\.json|application\/json)["']/i, '应该命中 accept json');

  // 反例 2：含 handleImport 定义
  const fake2 = `const handleImport = () => { /* ... */ };`;
  assert.match(fake2, /\bhandleImport\b/, '应该命中 handleImport');

  // 反例 3：含 import 主应用模块
  const fake3 = `import { useAuth } from '../../auth/AuthContext';`;
  const { names, paths } = extractImports(fake3);
  assert.ok(names.includes('useAuth'), 'extractImports 应该提取 useAuth');
  assert.ok(paths[0].includes('/auth/'), 'extractImports 应该提取 /auth/ 路径');

  // 反例 4：含 import FlowCanvas
  const fake4 = `import { FlowCanvas } from '../../components/FlowCanvas';`;
  const { names: names4 } = extractImports(fake4);
  assert.ok(names4.includes('FlowCanvas'), 'extractImports 应该提取 FlowCanvas');

  // D-8 取舍审 M4 新增反例：
  // 反例 5：fetch('/api/...)
  const fake5 = `await fetch('/api/canvases');`;
  assert.match(fake5, /fetch\s*\(\s*['"`]\/api\//, '应该命中 fetch /api');

  // 反例 6：new WebSocket
  const fake6 = `const sock = new WebSocket('ws://localhost');`;
  assert.match(fake6, /\bnew\s+WebSocket\s*\(/, '应该命中 WebSocket');

  // 反例 7：new EventSource
  const fake7 = `const es = new EventSource('/api/stream');`;
  assert.match(fake7, /\bnew\s+EventSource\s*\(/, '应该命中 EventSource');

  // 反例 8：import axios
  const fake8 = `import axios from 'axios';`;
  const { paths: paths8 } = extractImports(fake8);
  assert.ok(paths8.includes('axios'), 'extractImports 应该提取 axios');
});

test('反向断言：DraftSandbox 不含文件上传入口 <input type="file"', () => {
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  for (const { path, content } of files) {
    assert.ok(
      !/<input[^>]*type=["']file["']/i.test(content),
      `${path} 包含 <input type="file" — 违反方案 §2.2 产品红线（游客刻意不开"导入"入口）`,
    );
  }
});

test('反向断言：DraftSandbox 不含 accept=".json" 或 accept="application/json"', () => {
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  for (const { path, content } of files) {
    assert.ok(
      !/accept=["'](\.json|application\/json)["']/i.test(content),
      `${path} 包含 JSON 文件 accept 属性 — 违反产品红线（游客刻意不开"导入"入口）`,
    );
  }
});

test('反向断言：DraftSandbox 不引用主应用 JSON 导出函数', () => {
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  const forbidden = [
    'downloadCanvasFromServer',
    'downloadProjectAsLocal',
  ];
  for (const { path, content } of files) {
    for (const fn of forbidden) {
      assert.ok(
        !content.includes(fn),
        `${path} 引用了 ${fn} — 违反方案 §2.2（游客仅图片格式 / 不支持 JSON 导出）`,
      );
    }
  }
});

test('反向断言：DraftSandbox 不定义"导入"动作（importDraft / importFlow / handleImport 等）', () => {
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  // 匹配函数/常量定义：function importXxx / const importXxx / handleImport
  const forbiddenPatterns = [
    /\bfunction\s+import[A-Z]\w*/,
    /\bconst\s+import[A-Z]\w*\s*=/,
    /\bhandleImport\b/,
  ];
  for (const { path, content } of files) {
    for (const pattern of forbiddenPatterns) {
      const match = pattern.exec(content);
      assert.ok(
        !match,
        `${path} 定义了"导入"动作 (matched: ${match?.[0]}) — 违反方案 §6.2 (导入入口刻意不做)`,
      );
    }
  }
});

test('反向断言：DraftSandbox 仅用 exportCanvasAsPng（不引入 JPG/SVG 多格式入口）', () => {
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  // SVG 导出对游客无意义（PNG 已覆盖 90% 场景，多格式增加产品复杂度）
  // 当前已确认仅 PNG，未来若加 SVG/JPG 需要重新评估产品红线
  for (const { path, content } of files) {
    assert.ok(
      !content.includes('exportCanvasAsSvg'),
      `${path} 引用了 exportCanvasAsSvg — 当前 MVP 仅 PNG，加格式前请重新评估`,
    );
    assert.ok(
      !content.includes('exportCanvasAsJpg'),
      `${path} 引用了 exportCanvasAsJpg — 当前 MVP 仅 PNG，加格式前请重新评估`,
    );
  }
});

// 提取真实 import 语句（排除注释/字符串字面值）
// ES module import 语法：import [...] from 'xxx' / import 'xxx'
// 匹配 import 子句中的 identifier + 路径中的 module 名
function extractImports(content: string): { names: string[]; paths: string[] } {
  const names: string[] = [];
  const paths: string[] = [];
  // 匹配 import { a, b as c } from './foo'  /  import D from 'x'  /  import * as M from 'x'
  const importRe = /^\s*import\s+(?:type\s+)?(?:\*\s+as\s+\w+|{[^}]*}|\w+(?:\s*,\s*{[^}]*})?)\s+from\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    paths.push(m[1]);
    // 提取 { a, b as c } 中的 a, c —— 不再深挖具体逻辑识别，配合 paths 检查足够
    const namesMatch = /{([^}]+)}/.exec(m[0]);
    if (namesMatch) {
      for (const n of namesMatch[1].split(',')) {
        const trimmed = n.split(/\s+as\s+/)[0].trim();
        if (trimmed) names.push(trimmed);
      }
    }
    const defaultMatch = /^\s*import\s+(\w+)\s/.exec(m[0]);
    if (defaultMatch) names.push(defaultMatch[1]);
  }
  return { names, paths };
}

test('反向断言：DraftSandbox 不 import AuthProvider / useAuth（保持完全独立）', () => {
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  // 方案 §3.1：DraftSandbox 完全独立于 AuthProvider
  for (const { path, content } of files) {
    const { names, paths } = extractImports(content);
    for (const p of paths) {
      assert.ok(
        !p.includes('/auth/') && !p.endsWith('/auth'),
        `${path} 从 ${p} import — 违反方案 §3.1 (DraftSandbox 完全独立于 auth 模块)`,
      );
    }
    for (const n of names) {
      assert.ok(
        n !== 'useAuth' && n !== 'AuthProvider' && n !== 'AuthContext',
        `${path} import 了 ${n} — 违反方案 §3.1`,
      );
    }
  }
});

test('反向断言：DraftSandbox 不发起服务端通信（fetch /api / axios）', () => {
  // D-8 取舍审 M4：游客草稿不入服务端数据库 / 不绕权限 / 不协作 —
  // 反向断言扩展从"禁导入入口"到"禁服务端通信通道"
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  for (const { path, content } of files) {
    // fetch('/api/...) 模式
    assert.ok(
      !/fetch\s*\(\s*['"`]\/api\//.test(content),
      `${path} 包含 fetch('/api/...) — 违反"游客草稿不入服务端数据库"产品红线`,
    );
    // axios 模块（无论命名 import）
    const { names, paths } = extractImports(content);
    assert.ok(
      !paths.some((p) => p === 'axios' || p.startsWith('axios/')),
      `${path} import 了 axios — 违反"游客草稿不发起服务端通信"约束`,
    );
    // 主应用 api 层模块
    assert.ok(
      !paths.some((p) => p.includes('/api/canvases') || p.includes('/api/users') || p.includes('/api/auth')),
      `${path} import 了主应用 /api/ 模块 — 违反"游客草稿不绕主应用权限"约束`,
    );
    // 直接引用 ApiError 也算（说明在做主应用 API 调用）
    assert.ok(
      !names.includes('ApiError'),
      `${path} import 了 ApiError — 间接说明走了主应用 API`,
    );
  }
});

test('反向断言：DraftSandbox 不开实时通道（WebSocket / EventSource / Socket.IO）', () => {
  // D-8 取舍审 M4：游客草稿是单人独占场景，无需实时同步
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  for (const { path, content } of files) {
    // new WebSocket(...)
    assert.ok(
      !/\bnew\s+WebSocket\s*\(/.test(content),
      `${path} 包含 new WebSocket — 违反"游客草稿不协作"约束`,
    );
    // new EventSource(...)
    assert.ok(
      !/\bnew\s+EventSource\s*\(/.test(content),
      `${path} 包含 new EventSource — 违反"游客草稿不协作"约束`,
    );
    // socket.io-client import
    const { paths } = extractImports(content);
    assert.ok(
      !paths.some((p) => p.includes('socket.io')),
      `${path} import 了 socket.io 模块 — 违反"游客草稿不协作"约束`,
    );
  }
});

test('反向断言：DraftSandbox 不 import 主应用画布组件', () => {
  const files = collectFiles(DRAFT_SANDBOX_DIR);
  // 方案 §3.2：裸 React Flow，不复用主应用 FlowCanvas（避免污染主组件）
  const forbiddenImports = [
    'FlowCanvas',
    'useFlowOperations',
    'useMultiCanvas',
    'useFlowHistory',
    'useFlowClipboard',
    'CustomNode',
    'useDraftAutosave',
    'NodeDetailPanel',
    'SaveStatus',
  ];
  for (const { path, content } of files) {
    const { names } = extractImports(content);
    for (const n of names) {
      assert.ok(
        !forbiddenImports.includes(n),
        `${path} import 了 ${n} — 违反方案 §3.2 (DraftSandbox 裸 React Flow 不复用主应用组件)`,
      );
    }
  }
});
