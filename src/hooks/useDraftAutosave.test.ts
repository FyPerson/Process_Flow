// canonicalizeProject 单测（阶段 4 P4D 判断点 1）
//
// 测目标：保证 canonical JSON diff 正确，避免 React Flow nodes/edges 数组重排假阳性
//
// 测试矩阵：
// 1. nodes 数组顺序变化 → canonical 字符串不变
// 2. connectors 数组顺序变化 → canonical 字符串不变
// 3. sheets 数组顺序变化 → canonical 字符串不变
// 4. 真实改动（节点 position 修改） → canonical 字符串变化
// 5. 真实改动（节点 data.detailConfig 深层字段） → canonical 字符串变化
// 6. 多 sheet 各自独立排序 + 项目顶层字段保留

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeProject } from './useDraftAutosave';
import type { MultiCanvasProject } from '../types/flow';

type FlowNode = MultiCanvasProject['sheets'][number]['nodes'][number];

function mkNode(id: string, x = 0, y = 0): FlowNode {
  return {
    id,
    name: id.toUpperCase(),
    type: 'process',
    position: { x, y },
    size: { width: 150, height: 40 },
    expandable: false,
  } as FlowNode;
}

function mkProject(overrides: Partial<MultiCanvasProject> = {}): MultiCanvasProject {
  return {
    version: 2 as const,
    id: 'p1',
    name: 'P',
    activeSheetId: 's1',
    sheets: [
      {
        id: 's1',
        name: 'Sheet 1',
        nodes: [mkNode('n_a', 0, 0), mkNode('n_b', 1, 1)],
        connectors: [
          { id: 'e_x', sourceID: 'n_a', targetID: 'n_b' },
          { id: 'e_y', sourceID: 'n_b', targetID: 'n_a' },
        ],
      },
    ],
    ...overrides,
  } as MultiCanvasProject;
}

describe('canonicalizeProject (P4D 判断点 1)', () => {
  it('1. nodes 数组顺序变化 → canonical 字符串不变', () => {
    const a = mkProject();
    const b = mkProject();
    b.sheets[0].nodes = [b.sheets[0].nodes[1], b.sheets[0].nodes[0]];
    assert.equal(canonicalizeProject(a), canonicalizeProject(b));
  });

  it('2. connectors 数组顺序变化 → canonical 字符串不变', () => {
    const a = mkProject();
    const b = mkProject();
    b.sheets[0].connectors = [b.sheets[0].connectors[1], b.sheets[0].connectors[0]];
    assert.equal(canonicalizeProject(a), canonicalizeProject(b));
  });

  it('3. sheets 数组顺序变化 → canonical 字符串不变', () => {
    const a = mkProject({
      sheets: [
        { id: 's1', name: 'A', nodes: [], connectors: [] },
        { id: 's2', name: 'B', nodes: [], connectors: [] },
      ],
    });
    const b = mkProject({
      sheets: [
        { id: 's2', name: 'B', nodes: [], connectors: [] },
        { id: 's1', name: 'A', nodes: [], connectors: [] },
      ],
    });
    assert.equal(canonicalizeProject(a), canonicalizeProject(b));
  });

  it('4. 节点 position 修改 → canonical 不同', () => {
    const a = mkProject();
    const b = mkProject();
    b.sheets[0].nodes[0].position = { x: 999, y: 999 };
    assert.notEqual(canonicalizeProject(a), canonicalizeProject(b));
  });

  it('5. 深层 detailConfig 修改 → canonical 不同', () => {
    const a = mkProject();
    const b = mkProject();
    (b.sheets[0].nodes[0] as Record<string, unknown>).detailConfig = { tables: [{ tableName: 't1', description: 'd', fields: [] }] };
    assert.notEqual(canonicalizeProject(a), canonicalizeProject(b));
  });

  it('6. 多 sheet 各自独立排序 + 项目顶层字段保留', () => {
    const a = mkProject({
      activeSheetId: 's2',
      sheets: [
        { id: 's2', name: 'S2', nodes: [mkNode('n_2')], connectors: [] },
        { id: 's1', name: 'S1', nodes: [mkNode('n_1')], connectors: [] },
      ],
    });
    const out = JSON.parse(canonicalizeProject(a));
    assert.equal(out.activeSheetId, 's2');
    assert.equal(out.sheets[0].id, 's1', 'sheets sorted by id ASC');
    assert.equal(out.sheets[1].id, 's2');
  });
});
