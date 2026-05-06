// computeDelta 单元测试 — Day 1 骨架
//
// Day 2 会扩到方案 §5.9 要求的 25+ 用例（覆盖 N1-N10 / E1-E7 / sheet 增删 / 端点校验）。
// 当前覆盖：基础 7 case + Day 1 三审修法 5 case = 12 case。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta, isEmptyDelta, DataIntegrityError } from './computeDelta.ts';
import {
  connectorSemanticKey,
  type MultiCanvasProjectShape,
  type StorageConnector,
  type StorageNode,
  type StorageSheet,
} from './types.ts';

// ============================================================
// 工厂 helper
// ============================================================

function makeNode(id: string, overrides: Partial<StorageNode> = {}): StorageNode {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 60 },
    type: 'process',
    label: id,
    ...overrides,
  };
}

function makeConnector(id: string, source: string, target: string, overrides: Partial<StorageConnector> = {}): StorageConnector {
  return {
    id,
    sourceID: source,
    targetID: target,
    ...overrides,
  };
}

function makeSheet(id: string, nodes: StorageNode[] = [], connectors: StorageConnector[] = []): StorageSheet {
  return { id, name: id, nodes, connectors };
}

function makeProject(sheets: StorageSheet[], overrides: Partial<MultiCanvasProjectShape> = {}): MultiCanvasProjectShape {
  return {
    version: 2,
    id: 'p1',
    name: 'project',
    activeSheetId: sheets[0]?.id ?? 'sheet_1',
    sheets,
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('computeDelta — Day 1 骨架', () => {
  it('1. 完全相同 → empty delta', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const delta = computeDelta(base, incoming);
    assert.equal(isEmptyDelta(delta), true);
  });

  it('2. 加节点（N1）→ sheets[s1].nodes.added 含 n2', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1'), makeNode('n2')])]);
    const delta = computeDelta(base, incoming);
    assert.equal(delta.sheetsModified.size, 1);
    const s1 = delta.sheetsModified.get('s1');
    assert.ok(s1);
    assert.equal(s1.nodes.added.size, 1);
    assert.equal(s1.nodes.added.has('n2'), true);
  });

  it('3. 改节点 position（顶层 diff 字段）→ modified.changedFields 含 position', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const incoming = makeProject([
      makeSheet('s1', [makeNode('n1', { position: { x: 100, y: 200 } })]),
    ]);
    const delta = computeDelta(base, incoming);
    const s1 = delta.sheetsModified.get('s1');
    assert.ok(s1);
    const nDelta = s1.nodes.modified.get('n1');
    assert.ok(nDelta);
    assert.equal(nDelta.changedFields.length, 1);
    assert.equal(nDelta.changedFields[0]?.field, 'position');
  });

  it('4. 标废弃 false→true 且其他字段未变 → deprecated 分类', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1', { is_deprecated: false })])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1', { is_deprecated: true })])]);
    const delta = computeDelta(base, incoming);
    const s1 = delta.sheetsModified.get('s1');
    assert.ok(s1);
    assert.equal(s1.nodes.deprecated.size, 1);
    assert.equal(s1.nodes.modified.size, 0);
  });

  it('5. 服务端归属字段变化（updated_by/at）不进 changedFields（由 strip 列表保护）', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1', { updated_by: 1, updated_at: 1000 })])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1', { updated_by: 99, updated_at: 9999 })])]);
    const delta = computeDelta(base, incoming);
    // updated_by/at 不在 NODE_DIFF_FIELDS 白名单 → modified 不应触发
    assert.equal(delta.sheetsModified.size, 0);
    assert.equal(isEmptyDelta(delta), true);
  });

  it('6. 加边 + 改边 label，semanticKey 正确生成', () => {
    const base = makeProject([
      makeSheet('s1', [makeNode('a'), makeNode('b')], [makeConnector('e1', 'a', 'b', { label: 'old' })]),
    ]);
    const incoming = makeProject([
      makeSheet('s1', [makeNode('a'), makeNode('b'), makeNode('c')], [
        makeConnector('e1', 'a', 'b', { label: 'new' }),
        makeConnector('e2', 'b', 'c'),
      ]),
    ]);
    const delta = computeDelta(base, incoming);
    const s1 = delta.sheetsModified.get('s1');
    assert.ok(s1);

    // e1: modified（label 变）
    assert.equal(s1.connectors.modified.size, 1);
    const e1Delta = s1.connectors.modified.get('e1');
    assert.ok(e1Delta);
    // semanticKey 是 JSON 元组编码（M1 修法后），undefined handle → null
    assert.equal(e1Delta.semanticKey, '["s1","a","b",null,null]');
    assert.equal(e1Delta.changedFields[0]?.field, 'label');

    // e2: added
    assert.equal(s1.connectors.added.size, 1);
    assert.equal(s1.connectors.added.has('e2'), true);

    // 还有节点 c 是 added
    assert.equal(s1.nodes.added.size, 1);
    assert.equal(s1.nodes.added.has('c'), true);
  });

  it('connectorSemanticKey: 同 source/target/handles 的两个不同 id 边 semanticKey 相等（E2 去重支撑）', () => {
    const c1 = makeConnector('e1', 'a', 'b', { sourceHandle: 'h1', targetHandle: 'h2' });
    const c2 = makeConnector('e_other_id', 'a', 'b', { sourceHandle: 'h1', targetHandle: 'h2' });
    assert.equal(connectorSemanticKey('s1', c1), connectorSemanticKey('s1', c2));
  });

  // ============================================================
  // Day 1 三审修法新增 5 case（H1 / H2 / H3 / M1 / M3 配套）
  // ============================================================

  it('H2: 改 position + 同时标废弃 → modified.alsoDeprecated=true', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1', { is_deprecated: false })])]);
    const incoming = makeProject([
      makeSheet('s1', [makeNode('n1', { position: { x: 999, y: 999 }, is_deprecated: true })]),
    ]);
    const delta = computeDelta(base, incoming);
    const s1 = delta.sheetsModified.get('s1');
    assert.ok(s1);
    const nDelta = s1.nodes.modified.get('n1');
    assert.ok(nDelta);
    // changedFields 含 position（不含 is_deprecated）
    assert.equal(nDelta.changedFields[0]?.field, 'position');
    // alsoDeprecated 显式 true
    assert.equal(nDelta.alsoDeprecated, true);
    // 不进 deprecated 分类（有内容变化）
    assert.equal(s1.nodes.deprecated.size, 0);
  });

  it('H1: 改 name / detailConfig / hidden / description 4 个白名单字段 → 全部进 changedFields', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1', {
      name: 'old-name',
      detailConfig: undefined,
      hidden: false,
      description: 'old-desc',
    })])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1', {
      name: 'new-name',
      detailConfig: { description: 'detail-desc' } as Record<string, unknown>,
      hidden: true,
      description: 'new-desc',
    })])]);
    const delta = computeDelta(base, incoming);
    const s1 = delta.sheetsModified.get('s1');
    assert.ok(s1);
    const nDelta = s1.nodes.modified.get('n1');
    assert.ok(nDelta);
    const fields = new Set(nDelta.changedFields.map((c) => c.field));
    assert.equal(fields.has('name'), true);
    assert.equal(fields.has('detailConfig'), true);
    assert.equal(fields.has('hidden'), true);
    assert.equal(fields.has('description'), true);
    assert.equal(nDelta.changedFields.length, 4);
  });

  it('H3: 重复 nodeId → 抛 DataIntegrityError（防御层兜底，schema 层正常拦下）', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1'), makeNode('n1')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1')])]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('H3: 重复 sheetId → 抛 DataIntegrityError', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')]), makeSheet('s1', [makeNode('n2')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1')])]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M1: connectorSemanticKey 用 JSON 编码，不会被 handle 含 | 撞 key', () => {
    const c1 = makeConnector('e1', 'a', 'b', { sourceHandle: 'foo|bar', targetHandle: 'h2' });
    const c2 = makeConnector('e_other', 'a|bar', 'b', { sourceHandle: 'foo', targetHandle: 'h2' });
    // 旧拼接实现 'a|b|foo|bar|h2' === 'a|bar|b|foo|h2' → 后者 != 前者其实，
    // 关键是 JSON 编码后两者明显不同，不会因分隔符冲突 collide
    assert.notEqual(connectorSemanticKey('s1', c1), connectorSemanticKey('s1', c2));
    // 同时验证 undefined 与 '' 不再等价（JSON 编码 null vs ""）
    const cNull = makeConnector('e1', 'a', 'b'); // sourceHandle undefined
    const cEmpty = makeConnector('e1', 'a', 'b', { sourceHandle: '', targetHandle: undefined });
    assert.notEqual(connectorSemanticKey('s1', cNull), connectorSemanticKey('s1', cEmpty));
  });

  it('M1 三审: 新增 sheet 内部重复 nodeId → assertProjectIntegrity 拦下（防御层不再绕过）', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const incoming = makeProject([
      makeSheet('s1', [makeNode('n1')]),
      // 新增 sheet（base 没有），内部含重复 nodeId
      makeSheet('s_new', [makeNode('dup'), makeNode('dup')]),
    ]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M1 三审: 删除 sheet 内部重复 connectorId → assertProjectIntegrity 拦下', () => {
    const base = makeProject([
      makeSheet('s1', [makeNode('n1')]),
      // 即将被删的 sheet（incoming 没有），内部含重复 connectorId
      makeSheet('s_old', [makeNode('a'), makeNode('b')], [makeConnector('e1', 'a', 'b'), makeConnector('e1', 'a', 'b')]),
    ]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1')])]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M3 三审: connector handle = null → assertProjectIntegrity 拦下（与 undefined 区分）', () => {
    const base = makeProject([makeSheet('s1', [makeNode('a'), makeNode('b')])]);
    const badConn = { id: 'e1', sourceID: 'a', targetID: 'b', sourceHandle: null as unknown as undefined };
    const incoming = makeProject([makeSheet('s1', [makeNode('a'), makeNode('b')], [badConn])]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M1 四审: activeSheetId 指向不存在的 sheet → assertProjectIntegrity 拦下', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const broken: MultiCanvasProjectShape = {
      ...makeProject([makeSheet('s1', [makeNode('n1')])]),
      activeSheetId: 's_nonexistent',
    };
    assert.throws(() => computeDelta(base, broken), DataIntegrityError);
  });

  it('M1 四审: connector sourceID 指向不存在节点 → assertProjectIntegrity 拦下', () => {
    const base = makeProject([makeSheet('s1', [makeNode('a'), makeNode('b')])]);
    // incoming 含一条边端点指向不存在的节点
    const incoming = makeProject([
      makeSheet('s1', [makeNode('a'), makeNode('b')], [makeConnector('e1', 'a', 'ghost')]),
    ]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M2 四审: parentId 指向不存在节点 → assertProjectIntegrity 拦下', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const incoming = makeProject([
      makeSheet('s1', [makeNode('n1', { parentId: 'ghost_group' })]),
    ]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M2 四审: parentId 指向非 group 节点 → assertProjectIntegrity 拦下', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    // 'parent' 是 process 类型不是 group
    const incoming = makeProject([
      makeSheet('s1', [
        makeNode('parent', { type: 'process' }),
        makeNode('child', { parentId: 'parent' }),
      ]),
    ]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M1 五审: parentId 自引用 → assertProjectIntegrity 拦下', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const incoming = makeProject([
      makeSheet('s1', [makeNode('self', { parentId: 'self' })]),
    ]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M1 五审: group 节点带 parentId → assertProjectIntegrity 拦下（不允许 group 嵌套）', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const incoming = makeProject([
      makeSheet('s1', [
        makeNode('outerGroup', { type: 'group' }),
        makeNode('innerGroup', { type: 'group', parentId: 'outerGroup' }),
      ]),
    ]);
    assert.throws(() => computeDelta(base, incoming), DataIntegrityError);
  });

  it('M2 四审: parentId 指向 group 节点 → 通过', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    const incoming = makeProject([
      makeSheet('s1', [
        makeNode('g1', { type: 'group' }),
        makeNode('child', { parentId: 'g1' }),
      ]),
    ]);
    // 不应抛错；computeDelta 应正常返回（child 是 added，g1 是 added）
    const delta = computeDelta(base, incoming);
    const s1 = delta.sheetsModified.get('s1');
    assert.ok(s1);
    assert.equal(s1.nodes.added.size, 2);
  });

  it('M3 三审: incoming 传 is_deprecated false，但其他字段未变 → modified 不出现（dep 单向，反向静默忽略）', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1', { is_deprecated: true })])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1', { is_deprecated: false })])]);
    const delta = computeDelta(base, incoming);
    // is_deprecated 不在白名单 → changedFields 不含此字段
    // dep true→false 不进 deprecated 分类（只识别 false→true）
    // → 完全相等，sheet 不应 modified
    assert.equal(delta.sheetsModified.size, 0);
    assert.equal(isEmptyDelta(delta), true);
    // 注：业务规则单向废弃由 saveCanvas line 820 强制保废兜底，computeDelta 路径
    // applyDelta 用 deltaB 应用到 currentData 时 dep 状态来自 currentData，不被 incoming 误覆盖
  });
});
