#!/usr/bin/env node
// Day 4 F-7 + H4 (g3)：B 方案不变量 grep 守门
//
// 拦：useMultiCanvas.ts merged 分支 `plan.action === 'defer'` 子句里
//      推进 serverVersionRef / setServerVersion / 替换 projectRef / setProject 等"推进"操作
//
// 背景：
// - Day 3 末尾审三审锁定 B 方案核心不变量：serverVersionRef ≡ projectRef 服务端基线
// - merged=true + changeSeq 不等时 server-side state 全部不动（plan='defer' 路径）
// - F-6 mergeSavePlan 纯函数已把不变量提升为类型守门
// - F-7 grep 二次守门：避免后续改动者直接在 hook 里绕过 plan 用 changeSeqRef.current 判断
//
// 验证方法：临时在 useMultiCanvas merged plan='defer' 路径加 `serverVersionRef.current = result.version` →
//          运行此脚本应直接 FAIL。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TARGET = join(ROOT, 'src/hooks/useMultiCanvas.ts');

// 推进/替换 server-side state 的禁用模式（plan='defer' 路径绝不允许）
const FORBIDDEN_IN_DEFER = [
  { name: '推进 serverVersionRef', re: /serverVersionRef\.current\s*=/ },
  { name: '推进 setServerVersion', re: /setServerVersion\s*\(/ },
  { name: '替换 projectRef', re: /projectRef\.current\s*=/ },
  { name: '替换 setProject', re: /setProject\s*\(/ },
  { name: '清 dirty', re: /setDirty\s*\(\s*false\s*\)/ },
  { name: 'bumpLoadRevision', re: /bumpLoadRevision\s*\(/ },
  { name: '删草稿', re: /apiDeleteDraft\s*\(/ },
  { name: 'resetDraftAutosaveSnapshot', re: /resetDraftAutosaveSnapshot\s*\(/ },
];

const text = readFileSync(TARGET, 'utf8');
const lines = text.split(/\r?\n/);

// 定位 merged 分支的 plan='defer' 路径（else 子句）
// 模式：`if (plan.action === 'apply')` ... `} else {` ... `}`（else 块到下一个 `}`）
let inMergedBlock = false;
let inDeferBlock = false;
let deferDepth = 0;
let mergedBraceDepth = 0;

const violations = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  // 跳过注释行（避免文档/示例字面量误报）
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

  // 进入 merged 块：`if (result.merged) {`
  if (!inMergedBlock && /if\s*\(\s*result\.merged\s*\)\s*\{/.test(line)) {
    inMergedBlock = true;
    mergedBraceDepth = 1;
    continue;
  }

  if (!inMergedBlock) continue;

  // 跟踪 merged 块的大括号深度（粗略：忽略字符串里的 {/}）
  for (const ch of line) {
    if (ch === '{') mergedBraceDepth++;
    else if (ch === '}') mergedBraceDepth--;
  }
  if (mergedBraceDepth <= 0) {
    inMergedBlock = false;
    inDeferBlock = false;
    continue;
  }

  // 进入 defer 子句：`} else {`（紧跟 apply if 块的 else）
  if (!inDeferBlock && /\}\s*else\s*\{/.test(line)) {
    inDeferBlock = true;
    deferDepth = 1;
    continue;
  }

  if (!inDeferBlock) continue;

  // 跟踪 defer 子句深度
  for (const ch of line) {
    if (ch === '{') deferDepth++;
    else if (ch === '}') deferDepth--;
  }
  if (deferDepth <= 0) {
    inDeferBlock = false;
    continue;
  }

  // defer 块内 — 扫禁用模式
  for (const { name, re } of FORBIDDEN_IN_DEFER) {
    if (re.test(line)) {
      violations.push({
        line: i + 1,
        pattern: name,
        snippet: trimmed.slice(0, 120),
      });
    }
  }
}

if (violations.length === 0) {
  console.log(`[check-b-plan-invariant] OK — useMultiCanvas.ts merged plan='defer' 路径 0 处推进 server-side state 违规`);
  process.exit(0);
}

console.error(`[check-b-plan-invariant] FAIL — 发现 ${violations.length} 处违反 B 方案不变量：`);
console.error(`  目标文件: src/hooks/useMultiCanvas.ts`);
console.error(`  规则：merged + changeSeq 不等（plan='defer'）路径，server-side state 全不动\n`);
for (const v of violations) {
  console.error(`  L${v.line}  [${v.pattern}]`);
  console.error(`    ${v.snippet}`);
}
console.error(`\nDay 3 末尾审三审锁定的 B 方案核心不变量被破坏。`);
console.error(`参考：docs/规划/codex审查记录/阶段5/P5-合并算法/Day3-客户端/04-末尾审-三审.md`);
console.error(`修法：把推进操作放回 plan.action === 'apply' 子句；defer 子句只 console.warn 不动 state`);
process.exit(1);
