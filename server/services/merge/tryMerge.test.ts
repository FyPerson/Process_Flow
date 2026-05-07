// tryMerge 单元测试 — B-4 切片
//
// 覆盖（拍板 D7：5-7 case）：
// - 成功合并（无冲突 + 节点新增）
// - 冲突短路（detector 任一段非空）
// - DataIntegrityError 透传（base/current/incoming 损坏 + applyDelta 兜底真损坏）
// - mergeReport 计数（节点 + 边 + 各 bucket）
// - debugDelta 携带（includeDebugDelta=true vs false）
// - codex B-3 L1 验收：ok:false 路径不携带 warnings
// - codex B-2.5 M2 + 07 路径 b：active_sheet_missing 透传

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tryMerge } from './tryMerge.ts';
import { DataIntegrityError } from './computeDelta.ts';
import type {
  DetectContext,
  MultiCanvasProjectShape,
  StorageConnector,
  StorageNode,
  StorageSheet,
} from './types.ts';

// ============================================================
// 工厂 helper
// ============================================================

function makeNode(id: string, overrides: Partial<StorageNode> = {}): StorageNode {
  return { id, position: { x: 0, y: 0 }, type: 'process', ...overrides };
}

function makeConnector(id: string, source: string, target: string, overrides: Partial<StorageConnector> = {}): StorageConnector {
  return { id, sourceID: source, targetID: target, ...overrides };
}

function makeSheet(id: string, nodes: StorageNode[] = [], connectors: StorageConnector[] = []): StorageSheet {
  return { id, name: id, nodes, connectors };
}

function makeProject(sheets: StorageSheet[], overrides: Partial<MultiCanvasProjectShape> = {}): MultiCanvasProjectShape {
  return {
    version: 2,
    id: 'p1',
    name: 'project',
    activeSheetId: sheets[0]?.id,
    sheets,
    ...overrides,
  };
}

const CTX: DetectContext = { userA: 1, userB: 2, visibility: 'public' };

const COMMON = {
  ctx: CTX,
  currentVersion: 5,
  mergedFromUserId: 1,
  mergedFromUsername: 'alice',
};

// ============================================================
// Tests
// ============================================================

describe('tryMerge — 成功合并', () => {
  it('A 加节点 nA + B 加节点 nB → 自动合并，mergedData 含两节点 + report 计数 nodesAdded=1', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n0')])]);
    const current = makeProject([makeSheet('s1', [makeNode('n0'), makeNode('nA')])]);  // A 加 nA
    const incoming = makeProject([makeSheet('s1', [makeNode('n0'), makeNode('nB')])]); // B 加 nB

    const result = tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ids = result.mergedData.sheets[0].nodes.map((n) => n.id).sort();
    assert.deepEqual(ids, ['n0', 'nA', 'nB']);
    // deltaB 只含 nB（A 的 nA 已在 currentData）
    assert.equal(result.report.nodesAddedCount, 1);
    assert.equal(result.report.mergedFromVersion, 5);
    assert.equal(result.report.mergedFromUserId, 1);
    assert.equal(result.report.mergedFromUsername, 'alice');
    assert.equal(result.report.warnings.length, 0);
  });

  it('A 改 n0.name + B 改 n0.position（字段不重叠 N3）→ 自动合并', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n0', { name: 'orig' })])]);
    const current = makeProject([makeSheet('s1', [makeNode('n0', { name: 'A-改' })])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n0', { name: 'orig', position: { x: 99, y: 99 } })])]);

    const result = tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const node = result.mergedData.sheets[0].nodes[0];
    // mergedData = currentData + deltaB 字段补丁；A 改的 name 保留 + B 改的 position 写入
    assert.equal(node.name, 'A-改');
    assert.deepEqual(node.position, { x: 99, y: 99 });
    assert.equal(result.report.nodesModifiedCount, 1);  // deltaB.modified 含 n0
  });
});

describe('tryMerge — 冲突短路', () => {
  it('N4 同字段冲突 → ok:false + conflicts 含 node_modified_both', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n0', { name: 'orig' })])]);
    const current = makeProject([makeSheet('s1', [makeNode('n0', { name: 'A-改' })])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n0', { name: 'B-改' })])]);

    const result = tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].type, 'node_modified_both');
    assert.equal(result.conflicts[0].field, 'name');
  });

  it('codex B-4 M2: applyDelta 返 active_sheet_missing 被 tryMerge 原样透传 + 不携带 warnings', () => {
    // base: s1+s2, activeSheetId=s2（合法）
    // A 删 s1（不动 activeSheetId） → currentData = {s2, activeSheetId=s2}（合法）
    // B 改 activeSheetId 到 s1（base 还存在 s1，B 视角合法）→ incomingData = {s1+s2, activeSheetId=s1}（合法）
    // detector：A 删 s1 不在 deltaB.sheetsModified → 无 sheet_removed_modified；
    //          B 单边改 project meta → 不产 project_meta_conflict
    //          全部 detect 段空 → 进 applyDelta
    // applyDelta: mergedData = currentData(s2) + 改 activeSheetId 到 s1 → s1 不在 sheets → active_sheet_missing
    const base = makeProject([makeSheet('s1'), makeSheet('s2')], { activeSheetId: 's2' });
    const current = makeProject([makeSheet('s2')], { activeSheetId: 's2' });  // A 删 s1
    const incoming = makeProject([makeSheet('s1'), makeSheet('s2')], { activeSheetId: 's1' });  // B 改 active 到 s1

    const result = tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].type, 'active_sheet_missing');
    // ok:false 路径不携带 warnings（codex B-3 L1 验收 + B-4 M2 在 active_sheet_missing 路径锁定）
    assert.equal('warnings' in result, false);
  });

  it('codex B-3 L1 验收: ok:false 路径不携带 warnings', () => {
    // 构造一个会产 detect 冲突 + 同时 deltaB 带删节点（如果未短路 applyDelta 会产 E7 warning）
    const base = makeProject([makeSheet('s1', [makeNode('n0', { name: 'orig' }), makeNode('n1')], [makeConnector('e1', 'n0', 'n1')])]);
    const current = makeProject([makeSheet('s1', [makeNode('n0', { name: 'A-改' }), makeNode('n1')], [makeConnector('e1', 'n0', 'n1')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n0', { name: 'B-改' })], [])]);  // B 改 name + 删 n1 + 删 e1

    const result = tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.conflicts.length > 0);
    // 关键：返回值类型不带 warnings；TypeScript 编译期保证（类型 narrow 为 ok:false 分支）
    assert.equal('warnings' in result, false);
  });

  it('B-2.5 M2 / 07 路径 b 在正常 saveCanvas 新写入链路不可达: 历史脏数据/迁移/导入旁路仍可达，由 DataIntegrityError → 500 兜底', () => {
    // ⚠️ codex B-4 H1 修正：原"路径 b 不可达"过乐观。该不可达性**仅在所有 currentData 都
    // 必经 saveCanvas+computeDelta 写入时成立**。阶段 C 接入后还可能有以下旁路链路把不合法
    // currentData 喂给 tryMerge：
    //   - v1.x 历史快照（assertProjectIntegrity 是 P5 Day 1 才加的真校验）
    //   - 迁移脚本 / import / 手工修 DB
    // 这些旁路下，tryMerge 依然会在 computeDelta(base, current) 处抛 DataIntegrityError，
    // 不会变成 active_sheet_missing 业务化冲突。**阶段 C 验收必修**：把这类 DataIntegrityError
    // 统一映射为 500 + data_integrity_error，让运维介入；不强行改造 tryMerge 兜底业务化。
    //
    // applyDelta 单元层面路径 a/c 防御仍有意义；本 case 锁定"正常新写入链路不可达性 + 旁路 500"。
    const base = makeProject([makeSheet('s1'), makeSheet('s2')], { activeSheetId: 's2' });
    const current = makeProject([makeSheet('s1')], { activeSheetId: 's2' });  // 暂态非法
    const incoming = base;

    assert.throws(
      () => tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON }),
      (err: unknown) =>
        err instanceof DataIntegrityError &&
        err.reason.includes('activeSheetId s2 does not exist')
    );
  });
});

describe('tryMerge — DataIntegrityError 透传', () => {
  // ⚠️ codex B-4 M1 决策（不补 case，与 codex 建议二选一一致）：
  // applyDelta 兜底抛 DataIntegrityError 的场景（mergedData 含 dangling parentId / null handle 等）
  // **难以通过合法三方输入触发**——schema + computeDelta 入口 assertProjectIntegrity 已锁死
  // incoming 不能含悬空 parentId，A 那边的 currentData 也由 saveCanvas 之前的 incoming 校验过。
  //
  // 唯一能让 applyDelta 兜底真触发的链路是 currentData 含历史脏数据 + deltaB 制造问题，
  // 但这等同于 "currentData 含 duplicate node id" case 已覆盖的"computeDelta 入口抛"路径，
  // 因为 computeDelta 入口先于 applyDelta 跑。
  //
  // 处置：tryMerge 透传契约（不 catch、不改写 DataIntegrityError）由 "currentData 含 duplicate
  // node id" case 锁定；applyDelta 兜底独立分支由 applyDelta.test.ts R-Day2-2 段（2 case）单元
  // 层覆盖。这与 codex M1 建议"若难以通过合法三方输入构造，应承认该分支属于 applyDelta 单测覆盖"一致。

  it('currentData 含 duplicate node id（脏数据）→ computeDelta 入口抛 DataIntegrityError', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n1')])]);
    // currentData 含两个同 ID 节点（脏数据）
    const current = makeProject([makeSheet('s1', [makeNode('n1'), makeNode('n1')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n1'), makeNode('n2')])]);

    assert.throws(
      () => tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON }),
      (err: unknown) => err instanceof DataIntegrityError && err.reason.includes('duplicate node id')
    );
  });
});

describe('tryMerge — debugDelta', () => {
  it('includeDebugDelta=true：MergeResult 携带 debugDelta', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n0')])]);
    const current = makeProject([makeSheet('s1', [makeNode('n0'), makeNode('nA')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n0'), makeNode('nB')])]);

    const result = tryMerge({
      baseData: base, currentData: current, incomingData: incoming, ...COMMON,
      includeDebugDelta: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.debugDelta);
    // deltaA 含 A 加的 nA
    assert.ok(result.debugDelta.deltaA.sheetsModified.get('s1')?.nodes.added.has('nA'));
    // deltaB 含 B 加的 nB
    assert.ok(result.debugDelta.deltaB.sheetsModified.get('s1')?.nodes.added.has('nB'));
  });

  it('includeDebugDelta=false（默认）：MergeResult 不携带 debugDelta', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n0')])]);
    const current = makeProject([makeSheet('s1', [makeNode('n0'), makeNode('nA')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n0'), makeNode('nB')])]);

    const result = tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.debugDelta, undefined);
  });

  it('冲突短路时也支持 debugDelta', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n0', { name: 'orig' })])]);
    const current = makeProject([makeSheet('s1', [makeNode('n0', { name: 'A-改' })])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n0', { name: 'B-改' })])]);

    const result = tryMerge({
      baseData: base, currentData: current, incomingData: incoming, ...COMMON,
      includeDebugDelta: true,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.debugDelta);
  });
});

describe('tryMerge — mergeReport 计数', () => {
  it('混合改动：deltaB 加 1 节点 + 改 1 节点 + 删 1 节点 + 加 1 边 + sheetsAdded 含 1 节点', () => {
    const base = makeProject([
      makeSheet('s1', [makeNode('n0', { name: 'orig' }), makeNode('n_remove')], [makeConnector('e0', 'n0', 'n_remove')]),
    ]);
    // current = base（A 没改）
    const current: MultiCanvasProjectShape = JSON.parse(JSON.stringify(base));
    // B 改：删 n_remove + 加 nB + 改 n0.name + 加新 sheet s2 含 1 节点
    // 但删 n_remove 会让 e0 变悬空 → E7 warning 自动丢弃
    const incoming = makeProject([
      makeSheet('s1', [makeNode('n0', { name: 'B-改' }), makeNode('nB')], []),
      makeSheet('s2', [makeNode('n_in_s2')]),
    ]);

    const result = tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // deltaB 计数：
    // - sheetsModified.s1: nodes.added=1(nB) / nodes.removed=1(n_remove) / nodes.modified=1(n0)
    //   connectors.removed=1(e0)
    // - sheetsAdded.s2: nodes.length=1(n_in_s2)
    assert.equal(result.report.nodesAddedCount, 2); // nB + n_in_s2
    assert.equal(result.report.nodesRemovedCount, 1); // n_remove
    assert.equal(result.report.nodesModifiedCount, 1); // n0
    assert.equal(result.report.edgesRemovedCount, 1); // e0
    // E7 warning：n_remove 被删导致 e0 悬空？
    // 实际：e0 在 currentData 中 + deltaB 含删 n_remove + 删 e0；applyDelta 先按 deltaB 删 e0
    // 不会留 dangling。所以 warnings=0。
    assert.equal(result.report.warnings.length, 0);
  });

  it('codex B-4 M3: 跨 sheet bucket 全覆盖 — sheetsRemoved 整 sheet / nodesDeprecated / edgesAdded / edgesModified', () => {
    // base: s_keep 含 n_dep + n_emod_src + n_emod_tgt + e_emod, s_remove 含 n_in_removed + e_in_removed
    // current = base（A 没改）
    // B 改：
    //   - sheetsRemoved s_remove（整 sheet 1 节点 + 1 边）
    //   - sheetsModified s_keep:
    //     - nodes.deprecated: n_dep → is_deprecated=true
    //     - connectors.added: e_new (n_emod_src → n_emod_tgt) — 注意要换 handle 避免与 e_emod 撞 sem-key
    //     - connectors.modified: e_emod label 'old' → 'new'
    const base = makeProject([
      makeSheet('s_keep',
        [
          makeNode('n_dep'),
          makeNode('n_emod_src'),
          makeNode('n_emod_tgt'),
        ],
        [makeConnector('e_emod', 'n_emod_src', 'n_emod_tgt', { label: 'old' })]
      ),
      makeSheet('s_remove',
        [makeNode('n_in_removed')],
        [makeConnector('e_in_removed', 'n_in_removed', 'n_in_removed')]  // 自环避免 endpoint 校验失败
      ),
    ]);
    const current: MultiCanvasProjectShape = JSON.parse(JSON.stringify(base));
    const incoming = makeProject([
      makeSheet('s_keep',
        [
          makeNode('n_dep', { is_deprecated: true }),
          makeNode('n_emod_src'),
          makeNode('n_emod_tgt'),
        ],
        [
          makeConnector('e_emod', 'n_emod_src', 'n_emod_tgt', { label: 'new' }),
          makeConnector('e_new', 'n_emod_src', 'n_emod_tgt', { sourceHandle: 'h1' }),  // 换 handle 不撞 sem-key
        ]
      ),
    ], { activeSheetId: 's_keep' });

    const result = tryMerge({ baseData: base, currentData: current, incomingData: incoming, ...COMMON });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // sheetsRemoved s_remove 整 sheet：1 节点 + 1 边
    assert.equal(result.report.nodesRemovedCount, 1, 'sheetsRemoved 整 sheet 节点');
    assert.equal(result.report.edgesRemovedCount, 1, 'sheetsRemoved 整 sheet 边');
    // sheetsModified s_keep：
    assert.equal(result.report.nodesDeprecatedCount, 1, 'nodes.deprecated bucket');
    assert.equal(result.report.edgesAddedCount, 1, 'connectors.added bucket');
    assert.equal(result.report.edgesModifiedCount, 1, 'connectors.modified bucket');
    // 没有 nodes.added / nodes.modified
    assert.equal(result.report.nodesAddedCount, 0);
    assert.equal(result.report.nodesModifiedCount, 0);
  });

  it('mergeReport 元信息字段：mergedFromVersion / userId / username 透传', () => {
    const base = makeProject([makeSheet('s1', [makeNode('n0')])]);
    const current = makeProject([makeSheet('s1', [makeNode('n0'), makeNode('nA')])]);
    const incoming = makeProject([makeSheet('s1', [makeNode('n0'), makeNode('nB')])]);

    const result = tryMerge({
      baseData: base, currentData: current, incomingData: incoming,
      ctx: CTX,
      currentVersion: 42,
      mergedFromUserId: 7,
      mergedFromUsername: 'bob',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.report.mergedFromVersion, 42);
    assert.equal(result.report.mergedFromUserId, 7);
    assert.equal(result.report.mergedFromUsername, 'bob');
  });
});
