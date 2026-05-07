// detector 单元测试 — B-1（节点段）+ B-2（边段）切片
//
// 覆盖：
// - 节点段（B-1）：N4 / N6 / N7 / N8 / 跨 sheet 隔离 / auto-merge / N4 多重叠字段（L1'）/
//   alsoDeprecated=true 的 modified vs deprecated 组合（L1）
// - 边段（B-2）：E4 / E5 / N9 / edge_id_collision / edge_semantic_conflict（4 子场景）
// - sheet 段（B-2.5）：sheet_id_collision / sheet_removed_modified（双向）/ sheet_meta_conflict
// - project 段（B-2.5）：project_meta_conflict
// 不覆盖（后续切片）：active_sheet_missing → applyDelta 后 assertProjectIntegrity（B-3）/
//   E7 MergeWarning（B-3 applyDelta）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectEdgeConflicts,
  detectNodeConflicts,
  detectProjectConflicts,
  detectSheetConflicts,
} from './detector.ts';
import type {
  ConnectorDelta,
  Delta,
  DetectContext,
  NodeDelta,
  SheetDelta,
  StorageConnector,
  StorageNode,
  StorageSheet,
} from './types.ts';
import { connectorSemanticKey } from './types.ts';

// ============================================================
// 工厂 helper
// ============================================================

function makeNode(id: string, overrides: Partial<StorageNode> = {}): StorageNode {
  return { id, position: { x: 0, y: 0 }, type: 'process', ...overrides };
}

function makeNodeDelta(
  nodeId: string,
  fields: Array<{ field: string; before: unknown; after: unknown }>,
  alsoDeprecated?: boolean
): NodeDelta {
  return {
    nodeId,
    changedFields: fields,
    ...(alsoDeprecated !== undefined ? { alsoDeprecated } : {}),
  };
}

function makeConnector(
  id: string,
  source: string,
  target: string,
  overrides: Partial<StorageConnector> = {}
): StorageConnector {
  return { id, sourceID: source, targetID: target, ...overrides };
}

function makeConnectorDelta(
  connectorId: string,
  sheetId: string,
  conn: { sourceID: string; targetID: string; sourceHandle?: string; targetHandle?: string },
  fields: Array<{ field: string; before: unknown; after: unknown }>
): ConnectorDelta {
  return {
    connectorId,
    semanticKey: connectorSemanticKey(sheetId, conn as StorageConnector),
    changedFields: fields,
  };
}

function makeSheetDelta(sheetId: string, overrides: Partial<SheetDelta> = {}): SheetDelta {
  return {
    sheetId,
    sheetMetaChangedFields: [],
    nodes: {
      added: new Map(),
      removed: new Map(),
      modified: new Map(),
      deprecated: new Map(),
    },
    connectors: {
      added: new Map(),
      removed: new Map(),
      modified: new Map(),
    },
    ...overrides,
  };
}

function makeDelta(sheets: SheetDelta[]): Delta {
  const sheetsModified = new Map<string, SheetDelta>();
  for (const s of sheets) sheetsModified.set(s.sheetId, s);
  return {
    projectMetaChangedFields: [],
    sheetsAdded: new Map(),
    sheetsRemoved: new Map(),
    sheetsModified,
  };
}

const CTX: DetectContext = { userA: 1, userB: 2, visibility: 'public' };

// ============================================================
// Tests
// ============================================================

describe('detectNodeConflicts — B-1 节点段', () => {
  // ---------- N4：同节点同字段冲突（字段交集精确判定）----------

  it('N4-1: 同节点同字段双方都改 → node_modified_both', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'c' }]));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_modified_both');
    assert.equal(conflicts[0].sheetId, 's1');
    assert.equal(conflicts[0].targetId, 'n1');
    assert.equal(conflicts[0].field, 'name');
  });

  it('N4-2: 同节点改不同字段（N3 字段不重叠）→ 无冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'description', before: 'x', after: 'y' }]));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('N4-3: 同节点部分字段重叠 → 仅重叠字段产冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [
      { field: 'name', before: 'a', after: 'b' },
      { field: 'description', before: 'x', after: 'y' },
    ]));
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [
      { field: 'name', before: 'a', after: 'c' },
      { field: 'position', before: { x: 0, y: 0 }, after: { x: 1, y: 1 } },
    ]));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_modified_both');
    assert.equal(conflicts[0].field, 'name');
  });

  it('N4-4 (L1\'): 同节点多字段重叠（name + position）→ 每个重叠字段一条 conflict', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [
      { field: 'name', before: 'a', after: 'b' },
      { field: 'position', before: { x: 0, y: 0 }, after: { x: 5, y: 5 } },
    ]));
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [
      { field: 'name', before: 'a', after: 'c' },
      { field: 'position', before: { x: 0, y: 0 }, after: { x: 9, y: 9 } },
    ]));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 2);
    const fields = conflicts.map((c) => c.field).sort();
    assert.deepEqual(fields, ['name', 'position']);
    for (const c of conflicts) assert.equal(c.type, 'node_modified_both');
  });

  // ---------- N6：标废弃 vs 改字段 ----------

  it('N6-1: A 标废弃 + B 改字段 → node_deprecated_modified', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.deprecated.set('n1', makeNode('n1', { is_deprecated: true }));
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_deprecated_modified');
    assert.equal(conflicts[0].targetId, 'n1');
  });

  it('N6-2: B 标废弃 + A 改字段 → node_deprecated_modified（反向）', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));
    const sB = makeSheetDelta('s1');
    sB.nodes.deprecated.set('n1', makeNode('n1', { is_deprecated: true }));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_deprecated_modified');
  });

  it('N6-3 (L1): A 标废弃 + B alsoDeprecated=true 内容修改+同时标废弃 → node_deprecated_modified', () => {
    // 拍板：alsoDeprecated=true 的 modified 表示"内容修改 + 同时标废弃"，与 A 单纯标废弃组合 → N6
    const sA = makeSheetDelta('s1');
    sA.nodes.deprecated.set('n1', makeNode('n1', { is_deprecated: true }));
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }], true));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_deprecated_modified');
  });

  // ---------- N7：物删 vs 改字段 ----------

  it('N7-1: A 物删 + B 改字段 → node_removed_modified', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.removed.set('n1', makeNode('n1'));
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_removed_modified');
    assert.equal(conflicts[0].targetId, 'n1');
  });

  it('N7-2: B 物删 + A 改字段 → node_removed_modified（反向）', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));
    const sB = makeSheetDelta('s1');
    sB.nodes.removed.set('n1', makeNode('n1'));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_removed_modified');
  });

  // ---------- N8：物删 vs 标废弃（数据完整性）----------

  it('N8-1: A 物删 + B 标废弃 → node_removed_deprecated', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.removed.set('n1', makeNode('n1'));
    const sB = makeSheetDelta('s1');
    sB.nodes.deprecated.set('n1', makeNode('n1', { is_deprecated: true }));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_removed_deprecated');
    assert.equal(conflicts[0].targetId, 'n1');
  });

  it('N8-2: B 物删 + A 标废弃 → node_removed_deprecated（反向）', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.deprecated.set('n1', makeNode('n1', { is_deprecated: true }));
    const sB = makeSheetDelta('s1');
    sB.nodes.removed.set('n1', makeNode('n1'));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'node_removed_deprecated');
  });

  // ---------- 跨 sheet 隔离 ----------

  it('跨 sheet 隔离：A 改 s1 / B 改 s2 → 无冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));
    const sB = makeSheetDelta('s2');
    sB.nodes.modified.set('n2', makeNodeDelta('n2', [{ field: 'name', before: 'x', after: 'y' }]));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  // ---------- sheet meta 与节点段隔离（防 B-2 切片误把 sheet meta 混入节点段）----------

  it('仅 sheetMetaChangedFields 变化 + 节点无交集 → detectNodeConflicts 返回空（sheet 段冲突留给后续切片）', () => {
    const sA = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'b' }],
    });
    const sB = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'c' }],
    });

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  // ---------- N1/N2 auto-merge：仅一边动 ----------

  it('仅一边 modified（N2 各改不同节点）→ 无冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n2', makeNodeDelta('n2', [{ field: 'name', before: 'x', after: 'y' }]));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('双方都加新节点（N1）→ 无冲突（detector 不查 nodes_meta，ID 撞由 saveCanvas 处理）', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.added.set('nA', makeNode('nA'));
    const sB = makeSheetDelta('s1');
    sB.nodes.added.set('nB', makeNode('nB'));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('双方都标废弃同节点（N5 幂等）→ 无冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.deprecated.set('n1', makeNode('n1', { is_deprecated: true }));
    const sB = makeSheetDelta('s1');
    sB.nodes.deprecated.set('n1', makeNode('n1', { is_deprecated: true }));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('双方都物删同节点（幂等）→ 无冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.removed.set('n1', makeNode('n1'));
    const sB = makeSheetDelta('s1');
    sB.nodes.removed.set('n1', makeNode('n1'));

    const conflicts = detectNodeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });
});

// ============================================================
// detectEdgeConflicts — B-2 边段
// ============================================================

describe('detectEdgeConflicts — B-2 边段', () => {
  // ---------- E4: 同边同字段双方都改 ----------

  it('E4-1: 同边同字段（label）双方都改 → edge_modified_both', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'label', before: 'A', after: 'B' }]
    ));
    const sB = makeSheetDelta('s1');
    sB.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'label', before: 'A', after: 'C' }]
    ));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_modified_both');
    assert.equal(conflicts[0].targetId, 'e1');
    assert.equal(conflicts[0].field, 'label');
  });

  it('E4-2: 同边改不同字段 → 无冲突（E3 auto-merge 字段级）', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'label', before: 'A', after: 'B' }]
    ));
    const sB = makeSheetDelta('s1');
    sB.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'edgeType', before: 'straight', after: 'smoothstep' }]
    ));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('E4-3: 同边修改但双方都触及语义字段且 sem-key 分歧 → edge_semantic_conflict', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },  // A 把 target 改到 n2
      [{ field: 'targetID', before: 'n0', after: 'n2' }]
    ));
    const sB = makeSheetDelta('s1');
    sB.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n3' },  // B 把 target 改到 n3
      [{ field: 'targetID', before: 'n0', after: 'n3' }]
    ));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_semantic_conflict');
    assert.equal(conflicts[0].targetId, 'e1');
  });

  it('E4-4 (H1 修法): 仅 A 触及语义字段 + B 改 label → 无冲突（字段不重叠 auto-merge）', () => {
    // codex B-2 H1 修法：modified 路径只有"双方都触及语义字段"才产 semantic conflict
    // 此 case：A 改 targetID（语义字段，sem-key 必然变）+ B 改 label（非语义）
    // 字段不重叠且仅一方触及语义 → 不产冲突，applyDelta 阶段会按字段补丁合并
    const sA = makeSheetDelta('s1');
    sA.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },  // A 改 target → sem-key 变
      [{ field: 'targetID', before: 'n0', after: 'n2' }]
    ));
    const sB = makeSheetDelta('s1');
    sB.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n0' },  // B 没改端点
      [{ field: 'label', before: 'A', after: 'B' }]
    ));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('E4-5 (H1 修法): 仅 B 触及语义字段 + A 改 label → 无冲突（反向）', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n0' },
      [{ field: 'label', before: 'A', after: 'B' }]
    ));
    const sB = makeSheetDelta('s1');
    sB.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'targetID', before: 'n0', after: 'n2' }]
    ));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('E4-6 (H1 修法): 双方都触及语义字段但同改成相同端点（sem-key 不分歧）→ 字段交集判 E4', () => {
    // 双方都改 targetID 但都改成同一个 n2 → sem-key 一致，按字段交集判 E4（targetID 重叠）
    const sA = makeSheetDelta('s1');
    sA.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'targetID', before: 'n0', after: 'n2' }]
    ));
    const sB = makeSheetDelta('s1');
    sB.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'targetID', before: 'n0', after: 'n2' }]
    ));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_modified_both');
    assert.equal(conflicts[0].field, 'targetID');
  });

  // ---------- E5: 删边 vs 改边（双向）----------

  it('E5-1: A 删边 + B 改边 → edge_removed_modified', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.removed.set('e1', makeConnector('e1', 'n1', 'n2'));
    const sB = makeSheetDelta('s1');
    sB.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'label', before: 'A', after: 'B' }]
    ));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_removed_modified');
  });

  it('E5-2: B 删边 + A 改边 → edge_removed_modified（反向）', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'label', before: 'A', after: 'B' }]
    ));
    const sB = makeSheetDelta('s1');
    sB.connectors.removed.set('e1', makeConnector('e1', 'n1', 'n2'));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_removed_modified');
  });

  // ---------- edge_id_collision: 同 ID + 不同 semanticKey ----------

  it('edge_id_collision: 双方都新建同 ID 但端点不同 → edge_id_collision', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2'));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('e1', makeConnector('e1', 'n3', 'n4'));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_id_collision');
    assert.equal(conflicts[0].targetId, 'e1');
  });

  it('同 ID + 同 semanticKey + 非语义字段也相同 → 无冲突（E2 auto-merge 去重保留 A）', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2', { label: 'L' }));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2', { label: 'L' }));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  // ---------- edge_semantic_conflict 子场景 ----------

  it('edge_semantic_conflict-1: 同 ID + 同 semanticKey + 非语义字段不同 → edge_semantic_conflict', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2', { label: 'A' }));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2', { label: 'B' }));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_semantic_conflict');
  });

  it('edge_semantic_conflict-2: 不同 ID + 同 semanticKey + 非语义字段不同 → edge_semantic_conflict', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('eA', makeConnector('eA', 'n1', 'n2', { label: 'A' }));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('eB', makeConnector('eB', 'n1', 'n2', { label: 'B' }));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_semantic_conflict');
  });

  it('不同 ID + 同 semanticKey + 非语义字段也相同 → 无冲突（E2 auto-merge 去重）', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('eA', makeConnector('eA', 'n1', 'n2', { label: 'L' }));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('eB', makeConnector('eB', 'n1', 'n2', { label: 'L' }));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('M1 修法: 同 ID + 同 sem-key + style 对象 key 顺序不同但语义相同 → 无冲突（deepEqual key 顺序无关）', () => {
    // codex B-2 M1 修法：用 deepEqualJsonShape 替代 JSON.stringify 比对，避免 key 顺序敏感
    // 此 case：双方都加同 ID + 同端点 + style 对象 {color, fontSize} 但 key 顺序不同
    // 修法前会因 JSON.stringify 不同字符串误报；修法后应判等不产 semantic conflict
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2', {
      style: { color: 'red', fontSize: 14 },
    }));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2', {
      style: { fontSize: 14, color: 'red' },  // 同语义不同 key 顺序
    }));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('M1 修法: 不同 ID + 同 sem-key + data 对象 key 顺序不同但语义相同 → 无冲突', () => {
    // 与上一个 case 同款，覆盖"不同 ID 同 sem-key"路径
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('eA', makeConnector('eA', 'n1', 'n2', {
      data: { foo: 1, bar: 2 },
    }));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('eB', makeConnector('eB', 'n1', 'n2', {
      data: { bar: 2, foo: 1 },
    }));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  // ---------- N9: deltaB 加边引用 deltaA 已删节点 ----------

  it('N9-1: B 加新边 source 端点是 A 已删节点 → edge_endpoint_removed_by_other', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.removed.set('n1', makeNode('n1'));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2'));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_endpoint_removed_by_other');
    assert.equal(conflicts[0].targetId, 'e1');
  });

  it('N9-2: B 加新边 target 端点是 A 已删节点 → edge_endpoint_removed_by_other', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.removed.set('n2', makeNode('n2'));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2'));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'edge_endpoint_removed_by_other');
  });

  it('反向（A 加边 + B 删点）→ 无冲突（E7 由 applyDelta 产 MergeWarning）', () => {
    // detector 边段不处理反向场景；这是 B-3 applyDelta 的事
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2'));
    const sB = makeSheetDelta('s1');
    sB.nodes.removed.set('n2', makeNode('n2'));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  // ---------- 跨 sheet 隔离 / auto-merge ----------

  it('跨 sheet 隔离：A 改 s1 边 / B 改 s2 边 → 无冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.modified.set('e1', makeConnectorDelta(
      'e1', 's1',
      { sourceID: 'n1', targetID: 'n2' },
      [{ field: 'label', before: 'A', after: 'B' }]
    ));
    const sB = makeSheetDelta('s2');
    sB.connectors.modified.set('e2', makeConnectorDelta(
      'e2', 's2',
      { sourceID: 'n3', targetID: 'n4' },
      [{ field: 'label', before: 'X', after: 'Y' }]
    ));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('双方都删同边（E6 幂等）→ 无冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.removed.set('e1', makeConnector('e1', 'n1', 'n2'));
    const sB = makeSheetDelta('s1');
    sB.connectors.removed.set('e1', makeConnector('e1', 'n1', 'n2'));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });

  it('E1 加不同边（不同 ID + 不同 semanticKey）→ 无冲突', () => {
    const sA = makeSheetDelta('s1');
    sA.connectors.added.set('eA', makeConnector('eA', 'n1', 'n2'));
    const sB = makeSheetDelta('s1');
    sB.connectors.added.set('eB', makeConnector('eB', 'n3', 'n4'));

    const conflicts = detectEdgeConflicts(makeDelta([sA]), makeDelta([sB]), CTX);
    assert.equal(conflicts.length, 0);
  });
});

// ============================================================
// detectSheetConflicts — B-2.5 sheet 段
// ============================================================

function makeSheet(id: string, overrides: Partial<StorageSheet> = {}): StorageSheet {
  return { id, name: id, nodes: [], connectors: [], ...overrides };
}

function makeDeltaWithSheets(
  added: Map<string, StorageSheet> = new Map(),
  removed: Map<string, StorageSheet> = new Map(),
  modified: SheetDelta[] = [],
  projectMetaChangedFields: Array<{ field: string; before: unknown; after: unknown }> = []
): Delta {
  const sheetsModified = new Map<string, SheetDelta>();
  for (const s of modified) sheetsModified.set(s.sheetId, s);
  return {
    projectMetaChangedFields,
    sheetsAdded: added,
    sheetsRemoved: removed,
    sheetsModified,
  };
}

describe('detectSheetConflicts — B-2.5 sheet 段', () => {
  // ---------- sheet_id_collision ----------

  it('sheet_id_collision: 双方都新建同 sheetId → sheet_id_collision', () => {
    const deltaA = makeDeltaWithSheets(new Map([['s1', makeSheet('s1')]]));
    const deltaB = makeDeltaWithSheets(new Map([['s1', makeSheet('s1')]]));

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'sheet_id_collision');
    assert.equal(conflicts[0].targetId, 's1');
  });

  it('双方都新建不同 sheetId → 无冲突', () => {
    const deltaA = makeDeltaWithSheets(new Map([['sA', makeSheet('sA')]]));
    const deltaB = makeDeltaWithSheets(new Map([['sB', makeSheet('sB')]]));

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 0);
  });

  // ---------- sheet_removed_modified（双向 D4 c）----------

  it('sheet_removed_modified-1: A 删 sheet + B 改 sheet 内容 → sheet_removed_modified', () => {
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map([['s1', makeSheet('s1')]])
    );
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));
    const deltaB = makeDeltaWithSheets(new Map(), new Map(), [sB]);

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'sheet_removed_modified');
    assert.equal(conflicts[0].targetId, 's1');
  });

  it('sheet_removed_modified-2: B 删 sheet + A 改 sheet 内容 → sheet_removed_modified（反向）', () => {
    const sA = makeSheetDelta('s1');
    sA.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'name', before: 'a', after: 'b' }]));
    const deltaA = makeDeltaWithSheets(new Map(), new Map(), [sA]);
    const deltaB = makeDeltaWithSheets(
      new Map(), new Map([['s1', makeSheet('s1')]])
    );

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'sheet_removed_modified');
  });

  it('双方都删同 sheet（D4 b 双删幂等）→ 无冲突', () => {
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map([['s1', makeSheet('s1')]])
    );
    const deltaB = makeDeltaWithSheets(
      new Map(), new Map([['s1', makeSheet('s1')]])
    );

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 0);
  });

  it('sheet_removed_modified-3 (codex B-2.5 L1): A 删 sheet + B 仅改 sheetMetaChangedFields → sheet_removed_modified', () => {
    // 锁定 sheet_removed_modified 不只覆盖"节点内容"路径，元信息修改也应触发
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map([['s1', makeSheet('s1')]])
    );
    const sB = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'b' }],
    });
    const deltaB = makeDeltaWithSheets(new Map(), new Map(), [sB]);

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'sheet_removed_modified');
    assert.equal(conflicts[0].targetId, 's1');
  });

  // ---------- sheet_meta_conflict（G3 任意字段冲突即 409）----------

  it('sheet_meta_conflict: 双方都改同 sheet 元字段 → sheet_meta_conflict', () => {
    const sA = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'b' }],
    });
    const sB = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'c' }],
    });
    const deltaA = makeDeltaWithSheets(new Map(), new Map(), [sA]);
    const deltaB = makeDeltaWithSheets(new Map(), new Map(), [sB]);

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'sheet_meta_conflict');
    assert.equal(conflicts[0].targetId, 's1');
  });

  it('sheet_meta_conflict: G3 保守语义：双方 sheetMetaChangedFields 都非空即冲突（不做字段级合并）', () => {
    // codex B-2.5 复审 L2：SHEET_META_DIFF_FIELDS 当前只有 'name'，无法构造"字段不同"
    // 真正的语义是：双方 changedFields 都非空就 409，不论 field/before/after 是否相同
    const sA = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'b' }],
    });
    const sB = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'd' }],
    });
    const deltaA = makeDeltaWithSheets(new Map(), new Map(), [sA]);
    const deltaB = makeDeltaWithSheets(new Map(), new Map(), [sB]);

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'sheet_meta_conflict');
  });

  it('仅一方改 sheet 元字段 + 另一方改 sheet 内容 → 无冲突（一方未动元信息）', () => {
    const sA = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'b' }],
    });
    const sB = makeSheetDelta('s1');
    sB.nodes.modified.set('n1', makeNodeDelta('n1', [{ field: 'label', before: 'a', after: 'b' }]));
    const deltaA = makeDeltaWithSheets(new Map(), new Map(), [sA]);
    const deltaB = makeDeltaWithSheets(new Map(), new Map(), [sB]);

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 0);
  });

  it('sheetsModified 单边出现 → 无冲突', () => {
    const sA = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'a', after: 'b' }],
    });
    const deltaA = makeDeltaWithSheets(new Map(), new Map(), [sA]);
    const deltaB = makeDeltaWithSheets(new Map(), new Map(), []);

    const conflicts = detectSheetConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 0);
  });
});

// ============================================================
// detectProjectConflicts — B-2.5 project 段
// ============================================================

describe('detectProjectConflicts — B-2.5 project 段', () => {
  it('project_meta_conflict: 双方都改 project name → project_meta_conflict', () => {
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'name', before: 'p', after: 'pA' }]
    );
    const deltaB = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'name', before: 'p', after: 'pB' }]
    );

    const conflicts = detectProjectConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'project_meta_conflict');
  });

  it('project_meta_conflict: A 改 name + B 改 description（G3 任意字段冲突即 409）→ 仍 project_meta_conflict', () => {
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'name', before: 'p', after: 'pA' }]
    );
    const deltaB = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'description', before: '', after: 'desc' }]
    );

    const conflicts = detectProjectConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'project_meta_conflict');
  });

  it('仅一方改 project 元字段 → 无冲突', () => {
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'name', before: 'p', after: 'pA' }]
    );
    const deltaB = makeDeltaWithSheets();

    const conflicts = detectProjectConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 0);
  });

  it('双方都没改 project 元字段 → 无冲突', () => {
    const deltaA = makeDeltaWithSheets();
    const deltaB = makeDeltaWithSheets();

    const conflicts = detectProjectConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 0);
  });

  it('project_meta_conflict (codex B-2.5 M1): G3 保守语义—双方都改 name 改成相同 after 值仍 409', () => {
    // codex 复审 M1：G3 不做字段级合并，detector 只看 changedFields 长度，不看 after 值
    // 即使 A 和 B 都把 name 从 'p' 改成 'pX'，仍产 project_meta_conflict
    // 这是有意选择的"过保守"语义；5 人内网下双方独立改成同一值概率极低
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'name', before: 'p', after: 'pX' }]
    );
    const deltaB = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'name', before: 'p', after: 'pX' }]
    );

    const conflicts = detectProjectConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'project_meta_conflict');
  });

  it('project_meta_conflict (codex B-2.5 L3): 双方都改 activeSheetId → project_meta_conflict', () => {
    // activeSheetId 是 active_sheet_missing 检测的关键字段（B-3 验收依赖）；锁定 detector 行为
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'activeSheetId', before: 's0', after: 's1' }]
    );
    const deltaB = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'activeSheetId', before: 's0', after: 's2' }]
    );

    const conflicts = detectProjectConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'project_meta_conflict');
  });

  it('仅一方改 activeSheetId (codex B-2.5 L3) → 无冲突（detector 不产 active_sheet_missing；推到 B-3）', () => {
    const deltaA = makeDeltaWithSheets(
      new Map(), new Map(), [],
      [{ field: 'activeSheetId', before: 's0', after: 's1' }]
    );
    const deltaB = makeDeltaWithSheets();

    const conflicts = detectProjectConflicts(deltaA, deltaB, CTX);
    assert.equal(conflicts.length, 0);
  });
});
