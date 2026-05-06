#!/usr/bin/env node
// P3B 节点 ID 生成回归保护：扫禁用模式
//
// 拦：业务代码（src/）里手写 `${Date.now()}` 拼节点/分组/边 ID
// 放行：utils/ids.ts 自身、SaveStatus 的 setNow、updatedAt 这类时间戳、
//       sheet_/screenshot_/project_ 这类非节点 ID、单测 fixture（*.test.ts）

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

// 禁用模式（节点/边/分组 ID 生成专用）
// codex 二审 #4 + 三审 #4：扩展覆盖
//   - 模板字符串前缀：n/g/e/node/group/edge/new_node/new_edge/new_group
//   - 时间戳 token：Date.now/performance.now/.toString(36)/getTime()/ts/now/timestamp/baseTs
//   - 字符串拼接：'n_' + Date.now() / 'g_' + ts / "edge_" + Date.now()
const TIMESTAMP_TOKEN = /(?:Date\.now|performance\.now|\.toString\(36\)|new Date\([^)]*\)\.getTime|\bts\b|\bnow\b|\btimestamp\b|\bbaseTs\b)/;
const PREFIX_GROUP = '(?:n|g|e|node|group|edge|new_node|new_edge|new_group)';
const FORBIDDEN = [
  {
    name: '节点/边/分组 ID 用 `<前缀>_${... 时间戳/计数 ...}` 拼接',
    re: new RegExp(
      '`' + PREFIX_GROUP + '[_-]\\$\\{[^`]*' + TIMESTAMP_TOKEN.source,
    ),
  },
  {
    name: '节点/边/分组 ID 用字符串拼接（"<前缀>_" + 时间戳/计数）',
    // 匹配 `'n_' + Date.now()`、`"node_" + ts`、`"new_edge_" + timestamp` 等
    re: new RegExp(
      '["\']' + PREFIX_GROUP + '[_-]["\']\\s*\\+\\s*[^;\\n]*?' + TIMESTAMP_TOKEN.source,
    ),
  },
];

// 不扫的子树
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tmp', 'tmp-test', '.git']);
// 不扫的文件后缀
const SKIP_EXT = ['.test.ts', '.test.tsx', '.spec.ts'];
// codex 二审 #4：不再整文件跳过 utils/ids.ts；改为按行跳过注释（line.trimStart 以 // 开头）
// 这样 utils/ids.ts 的 helper 实现本身仍受 lint 约束，避免被改回时间戳实现

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(p, out);
    } else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.tsx'))) {
      if (SKIP_EXT.some((x) => e.name.endsWith(x))) continue;
      out.push(p);
    }
  }
  return out;
}

const violations = [];
const files = await walk(SRC);

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // 跳过整行注释（// 开头），并剥掉行内尾注释（避免文档/示例字面量误报）
    // 注：粗略剥离，不处理字符串内含 "//" 的极端情况；当前业务代码无此模式
    if (rawLine.trimStart().startsWith('//')) continue;
    const commentIdx = rawLine.indexOf('//');
    const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    for (const { name, re } of FORBIDDEN) {
      if (re.test(line)) {
        violations.push({
          file: relative(ROOT, file),
          line: i + 1,
          pattern: name,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`[check-id-generation] OK — 扫描 ${files.length} 个文件，0 处违规`);
  process.exit(0);
}

console.error(`[check-id-generation] FAIL — 发现 ${violations.length} 处禁用 ID 生成模式：\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.pattern}]`);
  console.error(`    ${v.snippet}`);
}
console.error(`\n请改用 src/utils/ids.ts 中的 newNodeId() / newGroupId() / newEdgeId()。`);
process.exit(1);
