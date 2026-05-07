// applyDelta 单元测试 — B-3 切片
//
// 覆盖：
// - 字段补丁：node / connector / project meta / sheet meta
// - alsoDeprecated=true 标记
// - 节点 added / removed / modified / deprecated
// - sheet added / removed
// - E2 自动去重：同 ID 完全等价 / 不同 ID 同语义同非语义
// - E7 dangling endpoint warning（删节点 + 加边端点不存在）
// - active_sheet_missing 错误映射（codex B-2.5 M2 必修 3 路径）
// - assertProjectIntegrity 兜底：duplicate id / dangling parentId 真损坏抛 DataIntegrityError

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta } from './applyDelta.ts';
import { DataIntegrityError } from './computeDelta.ts';
import {
  connectorSemanticKey,
  type Delta,
  type MultiCanvasProjectShape,
  type SheetDelta,
  type StorageConnector,
  type StorageNode,
  type StorageSheet,
} from './types.ts';

// ============================================================
// 工厂 helper
// ============================================================

function makeNode(id: string, overrides: Partial<StorageNode> = {}): StorageNode {
  return { id, position: { x: 0, y: 0 }, type: 'process', ...overrides };
}

function makeConnector(
  id: string,
  source: string,
  target: string,
  overrides: Partial<StorageConnector> = {}
): StorageConnector {
  return { id, sourceID: source, targetID: target, ...overrides };
}

function makeSheet(
  id: string,
  nodes: StorageNode[] = [],
  connectors: StorageConnector[] = [],
  overrides: Partial<StorageSheet> = {}
): StorageSheet {
  return { id, name: id, nodes, connectors, ...overrides };
}

function makeProject(
  sheets: StorageSheet[],
  overrides: Partial<MultiCanvasProjectShape> = {}
): MultiCanvasProjectShape {
  return {
    version: 2,
    id: 'p1',
    name: 'project',
    activeSheetId: sheets[0]?.id,
    sheets,
    ...overrides,
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

function makeDelta(opts: {
  projectMetaChangedFields?: Array<{ field: string; before: unknown; after: unknown }>;
  sheetsAdded?: Map<string, StorageSheet>;
  sheetsRemoved?: Map<string, StorageSheet>;
  sheetsModified?: SheetDelta[];
} = {}): Delta {
  const sheetsModified = new Map<string, SheetDelta>();
  for (const s of opts.sheetsModified ?? []) sheetsModified.set(s.sheetId, s);
  return {
    projectMetaChangedFields: opts.projectMetaChangedFields ?? [],
    sheetsAdded: opts.sheetsAdded ?? new Map(),
    sheetsRemoved: opts.sheetsRemoved ?? new Map(),
    sheetsModified,
  };
}

// ============================================================
// Tests — 字段补丁
// ============================================================

describe('applyDelta — 字段补丁', () => {
  it('节点字段补丁：仅按 changedFields.after 写，不覆盖未列字段', () => {
    const current = makeProject([
      makeSheet('s1', [makeNode('n1', {
        name: 'old',
        position: { x: 0, y: 0 },
        creator_id: 99,  // 服务端归属字段不应被覆盖
      })]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.nodes.modified.set('n1', {
      nodeId: 'n1',
      changedFields: [{ field: 'name', before: 'old', after: 'new' }],
    });
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const node = result.mergedData.sheets[0].nodes[0];
    assert.equal(node.name, 'new');
    assert.equal(node.creator_id, 99);  // 未被覆盖
    assert.deepEqual(node.position, { x: 0, y: 0 });
  });

  it('alsoDeprecated=true：内容修改 + 同时标废弃', () => {
    const current = makeProject([
      makeSheet('s1', [makeNode('n1', { name: 'old', is_deprecated: false })]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.nodes.modified.set('n1', {
      nodeId: 'n1',
      changedFields: [{ field: 'name', before: 'old', after: 'new' }],
      alsoDeprecated: true,
    });
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const node = result.mergedData.sheets[0].nodes[0];
    assert.equal(node.name, 'new');
    assert.equal(node.is_deprecated, true);
  });

  it('connector 字段补丁：仅 label 改，sourceID/targetID 保持', () => {
    const current = makeProject([
      makeSheet('s1', [makeNode('n1'), makeNode('n2')], [
        makeConnector('e1', 'n1', 'n2', { label: 'old' }),
      ]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.connectors.modified.set('e1', {
      connectorId: 'e1',
      semanticKey: connectorSemanticKey('s1', { id: 'e1', sourceID: 'n1', targetID: 'n2' } as StorageConnector),
      changedFields: [{ field: 'label', before: 'old', after: 'new' }],
    });
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const conn = result.mergedData.sheets[0].connectors[0];
    assert.equal(conn.label, 'new');
    assert.equal(conn.sourceID, 'n1');
    assert.equal(conn.targetID, 'n2');
  });

  it('project 顶层元字段补丁', () => {
    const current = makeProject([makeSheet('s1')], { name: 'old' });
    const result = applyDelta(current, makeDelta({
      projectMetaChangedFields: [{ field: 'name', before: 'old', after: 'new' }],
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mergedData.name, 'new');
  });

  it('sheet meta 字段补丁（codex B-3 M2 必修）：sheet.name 改动 + nodes/connectors 不被影响', () => {
    const current = makeProject([
      makeSheet('s1', [makeNode('n1'), makeNode('n2')], [makeConnector('e1', 'n1', 'n2')], { name: 'old-sheet' }),
    ]);
    const sheetDelta = makeSheetDelta('s1', {
      sheetMetaChangedFields: [{ field: 'name', before: 'old-sheet', after: 'new-sheet' }],
    });
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const sheet = result.mergedData.sheets[0];
    assert.equal(sheet.name, 'new-sheet');
    assert.equal(sheet.nodes.length, 2);
    assert.equal(sheet.connectors.length, 1);
  });
});

// ============================================================
// Tests — 节点 / sheet 增删
// ============================================================

describe('applyDelta — 增删', () => {
  it('节点 added：在 sheet 内追加新节点', () => {
    const current = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.nodes.added.set('n2', makeNode('n2'));
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ids = result.mergedData.sheets[0].nodes.map((n) => n.id).sort();
    assert.deepEqual(ids, ['n1', 'n2']);
  });

  it('节点 removed：从 sheet 内删除节点', () => {
    const current = makeProject([makeSheet('s1', [makeNode('n1'), makeNode('n2')])]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.nodes.removed.set('n2', makeNode('n2'));
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.mergedData.sheets[0].nodes.map((n) => n.id), ['n1']);
  });

  it('sheet added：追加新 sheet', () => {
    const current = makeProject([makeSheet('s1')]);
    const result = applyDelta(current, makeDelta({
      sheetsAdded: new Map([['s2', makeSheet('s2')]]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.mergedData.sheets.map((s) => s.id).sort(), ['s1', 's2']);
  });

  it('sheet removed：从 project 内删除 sheet', () => {
    const current = makeProject([makeSheet('s1'), makeSheet('s2')], { activeSheetId: 's1' });
    const result = applyDelta(current, makeDelta({
      sheetsRemoved: new Map([['s2', makeSheet('s2')]]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.mergedData.sheets.map((s) => s.id), ['s1']);
  });

  it('节点 deprecated：仅写 is_deprecated=true', () => {
    const current = makeProject([
      makeSheet('s1', [makeNode('n1', { is_deprecated: false })]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.nodes.deprecated.set('n1', makeNode('n1', { is_deprecated: true }));
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mergedData.sheets[0].nodes[0].is_deprecated, true);
  });
});

// ============================================================
// Tests — E2 自动去重
// ============================================================

describe('applyDelta — E2 同语义边自动去重', () => {
  it('同 ID 完全等价：currentData 已有同 ID 边，deltaB.added 同 ID 跳过', () => {
    const current = makeProject([
      makeSheet('s1', [makeNode('n1'), makeNode('n2')], [
        makeConnector('e1', 'n1', 'n2', { label: 'L' }),
      ]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.connectors.added.set('e1', makeConnector('e1', 'n1', 'n2', { label: 'L' }));
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // 仍只有 1 条边
    assert.equal(result.mergedData.sheets[0].connectors.length, 1);
    assert.equal(result.mergedData.sheets[0].connectors[0].id, 'e1');
  });

  it('不同 ID 同语义同非语义：保留 A 的 ID，丢弃 B 的副本', () => {
    // currentData 已含 A 加的 eA；deltaB 加的 eB 同语义同非语义 → 丢弃 eB
    const current = makeProject([
      makeSheet('s1', [makeNode('n1'), makeNode('n2')], [
        makeConnector('eA', 'n1', 'n2', { label: 'L' }),
      ]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.connectors.added.set('eB', makeConnector('eB', 'n1', 'n2', { label: 'L' }));
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // 只有 eA 一条
    const ids = result.mergedData.sheets[0].connectors.map((c) => c.id);
    assert.deepEqual(ids, ['eA']);
  });

  it('M1 防御（codex B-3 M1 修法）：同 sem-key 但非语义字段不等 → 抛 DataIntegrityError（detector 漏判兜底）', () => {
    // 此场景应已被 detector edge_semantic_conflict 短路；走到 applyDelta 说明 detector 漏判
    // 或调用方跳过 detector / currentData 含历史脏数据；不能静默吞用户改动，必须显式抛错
    const current = makeProject([
      makeSheet('s1', [makeNode('n1'), makeNode('n2')], [
        makeConnector('eA', 'n1', 'n2', { label: 'A' }),
      ]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.connectors.added.set('eB', makeConnector('eB', 'n1', 'n2', { label: 'B' }));  // 非语义字段不同
    assert.throws(
      () => applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] })),
      (err: unknown) => err instanceof DataIntegrityError && err.reason.includes('non-semantic fields differ')
    );
  });
});

// ============================================================
// Tests — E7 dangling endpoint
// ============================================================

describe('applyDelta — E7 dangling endpoint warning', () => {
  it('删节点导致悬空边：自动丢弃 + warning', () => {
    const current = makeProject([
      makeSheet('s1', [makeNode('n1'), makeNode('n2')], [
        makeConnector('e1', 'n1', 'n2'),
      ]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.nodes.removed.set('n2', makeNode('n2'));
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // e1 被丢弃
    assert.equal(result.mergedData.sheets[0].connectors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].type, 'edge_dropped_dangling_endpoint');
    assert.equal(result.warnings[0].edgeId, 'e1');
    assert.equal(result.warnings[0].missingEndpoint, 'n2');
    assert.equal(result.warnings[0].missingEndpointSide, 'target');
  });

  it('加边端点不存在：丢弃新加的边 + warning', () => {
    const current = makeProject([
      makeSheet('s1', [makeNode('n1')], []),
    ]);
    // deltaB 加边 e1 引用不存在的 n2（detector 会判 N9，但本 case 测纯 applyDelta 防御）
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.connectors.added.set('e1', makeConnector('e1', 'n1', 'n_ghost'));
    const result = applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mergedData.sheets[0].connectors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].missingEndpoint, 'n_ghost');
  });
});

// ============================================================
// Tests — active_sheet_missing 错误映射（codex B-2.5 M2 必修 3 路径）
// ============================================================

describe('applyDelta — active_sheet_missing 映射（B-2.5 M2 必修）', () => {
  it('路径 a: deltaB 修改 activeSheetId 指向被 deltaA 删的 sheet → active_sheet_missing', () => {
    // currentData 已是 A 合并后状态（A 已删 s2）；deltaB 把 activeSheetId 改成 s2
    const current = makeProject([makeSheet('s1')], { activeSheetId: 's1' });
    const result = applyDelta(current, makeDelta({
      projectMetaChangedFields: [{ field: 'activeSheetId', before: 's1', after: 's2' }],
    }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].type, 'active_sheet_missing');
    assert.equal(result.conflicts[0].sheetId, 's2');
  });

  it('路径 b (applyDelta 单元层面防御覆盖): currentData 暂态 activeSheetId 指向已删 sheet → active_sheet_missing', () => {
    // ⚠️ 重要修正（B-4 实施时发现）：此路径在 tryMerge 层级**不可达**——
    // computeDelta 入口的 assertProjectIntegrity 对两个入参都校验 activeSheetId 存在性，
    // A 用户提交 incomingData 时（删 base.activeSheetId 指向的 sheet 但不改 activeSheetId）
    // 会立即被 DataIntegrityError 拦下，永远写不入产生 currentData 暂态。
    //
    // 但 applyDelta 单元测试可以**直接构造**该状态绕开 computeDelta，作为 applyDelta 的
    // 兜底防御覆盖。详见 [07/08 归档 § 后续修正](../../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day2-合并算法/07-阶段B-2.5-代码审查-detector-sheet-project段.md)
    //
    // 历史上 codex B-2.5 M2 的论证基于"detector 推到 B-3 因为路径 b 看不到"，但论证前提错。
    // 此 case 不再宣称"关键"——保留作 applyDelta 单元层面防御覆盖即可。
    const current = makeProject([makeSheet('s2')], { activeSheetId: 's1' });  // 暂态 s1 已被删
    const result = applyDelta(current, makeDelta());  // deltaB 完全空
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.conflicts[0].type, 'active_sheet_missing');
    assert.equal(result.conflicts[0].sheetId, 's1');
  });

  it('路径 c（脏 delta 防御 / codex B-3 L2）: deltaB 同时改 activeSheetId 到 s2 又删 s2 → active_sheet_missing', () => {
    // 注意：此 case 的 deltaB 是自相矛盾输入（同时把 activeSheetId 改到 s2 又删 s2），
    // 正常 computeDelta(incoming) 前 incoming 的 assertProjectIntegrity 应该已经拒绝这种数据。
    // 保留此 case 作为 applyDelta 的"脏 delta 兜底"防御覆盖，**不是**常规 detector / 合并路径。
    // currentData 含 s1, s2，activeSheetId=s1；deltaB 改 activeSheetId 到 s2 + 删 s2
    // 合并后 mergedData.activeSheetId=s2 但 sheets 不含 s2
    const current = makeProject([makeSheet('s1'), makeSheet('s2')], { activeSheetId: 's1' });
    const result = applyDelta(current, makeDelta({
      projectMetaChangedFields: [{ field: 'activeSheetId', before: 's1', after: 's2' }],
      sheetsRemoved: new Map([['s2', makeSheet('s2')]]),
    }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.conflicts[0].type, 'active_sheet_missing');
  });

  it('正常: activeSheetId 仍指向存在的 sheet → ok', () => {
    const current = makeProject([makeSheet('s1'), makeSheet('s2')], { activeSheetId: 's1' });
    const result = applyDelta(current, makeDelta({
      sheetsRemoved: new Map([['s2', makeSheet('s2')]]),
    }));
    assert.equal(result.ok, true);
  });
});

// ============================================================
// Tests — assertProjectIntegrity 兜底
// ============================================================

describe('applyDelta — assertProjectIntegrity 兜底（R-Day2-2）', () => {
  it('真损坏（duplicate node id 跨 add 与已存）→ 抛 DataIntegrityError，不被吞', () => {
    // currentData 已含 n1；deltaB.added 也加 n1（detector node_id_collision 应已短路；
    // 此 case 测 applyDelta 的去重 + assertProjectIntegrity 兜底——applyDelta 的防御去重会跳过 deltaB.n1）
    // 想让 assertProjectIntegrity 真触发，构造一个 currentData 本身就含 dup id 的脏数据
    const dupSheet = makeSheet('s1', [makeNode('n1'), makeNode('n1')]);  // duplicate
    const current = makeProject([dupSheet]);
    assert.throws(
      () => applyDelta(current, makeDelta()),
      (err: unknown) => err instanceof DataIntegrityError && err.reason.includes('duplicate node id')
    );
  });

  it('parentId 指向已删 group：抛 DataIntegrityError', () => {
    // currentData 中 n2.parentId='g1'，deltaB 删 g1 → mergedData parentId 悬空
    const current = makeProject([
      makeSheet('s1', [
        makeNode('g1', { type: 'group' }),
        makeNode('n2', { parentId: 'g1' }),
      ]),
    ]);
    const sheetDelta = makeSheetDelta('s1');
    sheetDelta.nodes.removed.set('g1', makeNode('g1', { type: 'group' }));
    assert.throws(
      () => applyDelta(current, makeDelta({ sheetsModified: [sheetDelta] })),
      (err: unknown) => err instanceof DataIntegrityError
    );
  });
});
