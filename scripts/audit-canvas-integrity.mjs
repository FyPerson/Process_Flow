#!/usr/bin/env node
// audit-canvas-integrity.mjs —— 阶段 5 Day 2 接入合并算法前的旧数据完整性审计（codex 六审 H1）
//
// 用途：
//   扫描 canvases.data + canvas_versions.data 全量历史快照，按 server/services/merge/computeDelta.ts
//   的 assertProjectIntegrity 7 项规则校验，列出违规项。
//
// 校验规则：
//   1. sheets[].id 全局唯一
//   2. sheet 内 nodes[].id 唯一
//   3. sheet 内 connectors[].id 唯一
//   4. connector handle 不为 null
//   5. project.activeSheetId 必须在 sheets 中
//   6. connector.sourceID/targetID 必须指向同 sheet 节点
//   7. parentId 不自引用 / group 不嵌套 / parentId 必须指向同 sheet 内 group
//
// 用法：
//   DATA_DIR=E:/business-flow-data node scripts/audit-canvas-integrity.mjs
//   DATA_DIR=tmp-test/data node scripts/audit-canvas-integrity.mjs
//
// 退出码：0 全过 / 1 有违规 / 2 db 打不开

import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) {
  console.error('[audit] DATA_DIR env not set; usage: DATA_DIR=path node scripts/audit-canvas-integrity.mjs');
  process.exit(2);
}

const dbPath = path.join(DATA_DIR, 'app.db');
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  console.error(`[audit] cannot open db at ${dbPath}: ${err.message}`);
  process.exit(2);
}

console.log(`[audit] DB = ${dbPath}`);

// ============================================================
// 校验逻辑（与 assertProjectIntegrity 等价；独立实现避免依赖 ts 编译）
// ============================================================

/** 返回违规清单（空数组 = 全过） */
function checkProject(project, sourceLabel) {
  const issues = [];
  if (!project || !Array.isArray(project.sheets)) {
    issues.push({ sourceLabel, issue: 'project.sheets is not an array' });
    return issues;
  }

  const sheetIds = new Set();
  const sheetNodeMaps = new Map();

  for (const sheet of project.sheets) {
    if (sheetIds.has(sheet.id)) {
      issues.push({ sourceLabel, sheetId: sheet.id, issue: `duplicate sheet id ${sheet.id}` });
    }
    sheetIds.add(sheet.id);

    // codex 七审 M2：缺失/非数组的 nodes/connectors 显式记违规并跳过本 sheet 数组依赖检查
    const hasNodes = Array.isArray(sheet.nodes);
    const hasConns = Array.isArray(sheet.connectors);
    if (!hasNodes) {
      issues.push({ sourceLabel, sheetId: sheet.id, issue: `sheet.nodes is missing or not an array` });
    }
    if (!hasConns) {
      issues.push({ sourceLabel, sheetId: sheet.id, issue: `sheet.connectors is missing or not an array` });
    }

    const nodeMap = new Map();
    if (hasNodes) {
      for (const node of sheet.nodes) {
        if (nodeMap.has(node.id)) {
          issues.push({ sourceLabel, sheetId: sheet.id, issue: `duplicate node id ${node.id}` });
        }
        nodeMap.set(node.id, node);
      }
    }
    sheetNodeMaps.set(sheet.id, nodeMap);

    if (hasConns) {
      const connIds = new Set();
      for (const conn of sheet.connectors) {
        if (connIds.has(conn.id)) {
          issues.push({ sourceLabel, sheetId: sheet.id, issue: `duplicate connector id ${conn.id}` });
        }
        connIds.add(conn.id);
        if (conn.sourceHandle === null) {
          issues.push({ sourceLabel, sheetId: sheet.id, issue: `connector ${conn.id} sourceHandle is null` });
        }
        if (conn.targetHandle === null) {
          issues.push({ sourceLabel, sheetId: sheet.id, issue: `connector ${conn.id} targetHandle is null` });
        }
      }
    }
  }

  // activeSheetId
  if (project.activeSheetId !== undefined && !sheetIds.has(project.activeSheetId)) {
    issues.push({ sourceLabel, issue: `activeSheetId ${project.activeSheetId} not in sheets` });
  }

  // 第二遍：endpoints + parentId
  for (const sheet of project.sheets) {
    const nodeMap = sheetNodeMaps.get(sheet.id);
    if (!nodeMap) continue;

    for (const conn of sheet.connectors ?? []) {
      if (!nodeMap.has(conn.sourceID)) {
        issues.push({ sourceLabel, sheetId: sheet.id, issue: `connector ${conn.id} sourceID ${conn.sourceID} not in sheet` });
      }
      if (!nodeMap.has(conn.targetID)) {
        issues.push({ sourceLabel, sheetId: sheet.id, issue: `connector ${conn.id} targetID ${conn.targetID} not in sheet` });
      }
    }

    for (const node of sheet.nodes ?? []) {
      // codex 七审 H1：parentId === null 也是违规（assertProjectIntegrity 只跳 undefined）
      // 历史 DB 若有 parentId:null，computeDelta 入口仍会抛 DataIntegrityError
      if (node.parentId === undefined) continue;
      if (node.parentId === null) {
        issues.push({ sourceLabel, sheetId: sheet.id, issue: `node ${node.id} parentId is null (use undefined or remove the field)` });
        continue;
      }
      if (node.parentId === node.id) {
        issues.push({ sourceLabel, sheetId: sheet.id, issue: `node ${node.id} parentId self-reference` });
        continue;
      }
      if (node.type === 'group') {
        issues.push({ sourceLabel, sheetId: sheet.id, issue: `node ${node.id} is group with parentId (group nesting not allowed)` });
        continue;
      }
      const parent = nodeMap.get(node.parentId);
      if (!parent) {
        issues.push({ sourceLabel, sheetId: sheet.id, issue: `node ${node.id} parentId ${node.parentId} not found` });
        continue;
      }
      if (parent.type !== 'group') {
        issues.push({ sourceLabel, sheetId: sheet.id, issue: `node ${node.id} parentId ${node.parentId} points to non-group (type=${parent.type})` });
      }
    }
  }

  return issues;
}

// ============================================================
// 扫 canvases 当前 + canvas_versions 历史
// ============================================================

let totalIssues = 0;
const allIssues = [];

const canvases = db.prepare('SELECT id, name, version, data FROM canvases').all();
console.log(`[audit] scanning ${canvases.length} canvases (current data)`);
for (const row of canvases) {
  let project;
  try {
    project = JSON.parse(row.data);
  } catch (err) {
    // codex 七审 L3：parse 失败也计入 totalIssues 防误读"共 0 处违规"
    const parseIssue = { issue: `JSON parse failed: ${err.message}` };
    totalIssues += 1;
    allIssues.push({ source: `canvases id=${row.id} (${row.name}) v=${row.version}`, issues: [parseIssue] });
    continue;
  }
  const issues = checkProject(project, `canvases id=${row.id} (${row.name}) v=${row.version}`);
  if (issues.length > 0) {
    totalIssues += issues.length;
    allIssues.push({ source: `canvases id=${row.id} (${row.name}) v=${row.version}`, issues });
  }
}

const versions = db.prepare('SELECT canvas_id, version, data, saved_at FROM canvas_versions').all();
console.log(`[audit] scanning ${versions.length} canvas_versions snapshots`);
for (const row of versions) {
  let project;
  try {
    project = JSON.parse(row.data);
  } catch (err) {
    const parseIssue = { issue: `JSON parse failed: ${err.message}` };
    totalIssues += 1;
    allIssues.push({ source: `canvas_versions canvas_id=${row.canvas_id} v=${row.version}`, issues: [parseIssue] });
    continue;
  }
  const issues = checkProject(project, `canvas_versions canvas_id=${row.canvas_id} v=${row.version}`);
  if (issues.length > 0) {
    totalIssues += issues.length;
    allIssues.push({ source: `canvas_versions canvas_id=${row.canvas_id} v=${row.version}`, issues });
  }
}

db.close();

// ============================================================
// 输出报告
// ============================================================

if (allIssues.length === 0) {
  console.log(`[audit] OK — 全部数据通过 assertProjectIntegrity 7 项校验，可直接进入 Day 2 合并算法`);
  process.exit(0);
}

console.error(`\n[audit] FAIL — 共 ${totalIssues} 处违规，分布在 ${allIssues.length} 个快照：\n`);
for (const { source, issues } of allIssues) {
  console.error(`  ${source}`);
  for (const issue of issues) {
    console.error(`    - ${issue.sheetId ? `sheet=${issue.sheetId} ` : ''}${issue.issue}`);
  }
}
console.error(`\n[audit] 修复策略建议：`);
console.error(`  - 重复 ID / null handle / parentId 自引用：迁移脚本去重 / 改 undefined / 清空 parentId`);
console.error(`  - parentId 指向不存在节点：清空 parentId（孤儿降级）`);
console.error(`  - parentId 指向非 group：清空 parentId`);
console.error(`  - group 嵌套：改子 group 的 parentId 为 undefined`);
console.error(`  - activeSheetId 不存在：改为 sheets[0].id`);
console.error(`  - connector endpoints 失效：删除该连线`);
process.exit(1);
