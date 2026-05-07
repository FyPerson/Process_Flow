#!/usr/bin/env node
// Day 4 F-13 + L2：BFV conflict 保护守门 grep 脚本（防回归）
//
// 拦：BFV 三处用户跳转/卸载入口（handleImport / beforeunload / 类似路径）漏 conflict 判断
//
// 背景（codex 切片设计审 L2 调整）：
// - D-5 + H5 拍板：弹窗 modal block 期间，BFV handleImport / handleSwitchCanvas / beforeunload
//   都必须受 `dirty || saving || conflict` 保护，避免冲突期间用户切走丢失本地草稿/冲突状态
// - F-13 不"只加注释"，要补轻量验证防止后续改动者删除 conflict 判断
//
// 验证方法：临时删 BFV beforeunload 的 conflict 判断 → 此脚本应 FAIL

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TARGET = join(ROOT, 'src/pages/BusinessFlowVisualization/index.tsx');

const text = readFileSync(TARGET, 'utf8');

// 必须找到的"含 conflict 判断"的关键路径模式
// 模式说明：
// - beforeunload effect：早 return 条件含 conflict 引用
// - handleImport：dirty/saving/conflict 三件套防护
const CHECKS = [
  {
    name: 'beforeunload effect 含 conflict 判断',
    // 匹配：if (!dirty && !saving && !conflict) return;  或类似含 conflict 引用的早 return 守卫
    re: /if\s*\(\s*!dirty\s*&&\s*!saving\s*&&\s*!conflict\s*\)\s*return/,
  },
  {
    name: 'handleImport 含 conflict 判断',
    // 匹配：if (dirty || saving || conflict) { ... 二次确认 ... }
    re: /if\s*\(\s*dirty\s*\|\|\s*saving\s*\|\|\s*conflict\s*\)/,
  },
];

const violations = [];

for (const check of CHECKS) {
  if (!check.re.test(text)) {
    violations.push(check.name);
  }
}

if (violations.length === 0) {
  console.log(`[check-conflict-guards] OK — BusinessFlowVisualization conflict 三件套守门 ${CHECKS.length}/${CHECKS.length} 处都在`);
  process.exit(0);
}

console.error(`[check-conflict-guards] FAIL — 发现 ${violations.length} 处 conflict 守门缺失：`);
console.error(`  目标文件: src/pages/BusinessFlowVisualization/index.tsx\n`);
for (const name of violations) {
  console.error(`  ❌ ${name}`);
}
console.error(`\n规则（Day 4 D-5 + H5 + L2）：`);
console.error(`  弹窗 modal block 期间，BFV beforeunload / handleImport 都必须受`);
console.error(`  \`dirty || saving || conflict\` 保护，避免冲突期间用户切走丢失草稿。`);
console.error(`\n参考：docs/规划/codex审查记录/阶段5/P5-合并算法/Day4-真冲突UI/02-拍板记录.md F-13`);
process.exit(1);
