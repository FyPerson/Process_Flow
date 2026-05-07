// 阶段 5 Day 3 阶段 D-1 — Delta 序列化测试
//
// 验证：
// - 7 个 Map 全转 entries 数组（4 bucket：顶层 3 + sheets 内 nodes 4 + connectors 3）
// - JSON.stringify→parse round-trip 后结构与序列化输出一致
// - 截断策略：超限删 debugDelta + truncated:true / 不超限保留全字段

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  serializeDelta,
  maybeTruncateDetails,
  CONFLICT_LOG_DETAILS_MAX_BYTES,
  type SerializedDelta,
} from './serialize.ts';
import type {
  Delta,
  NodeDelta,
  ConnectorDelta,
  StorageNode,
  StorageConnector,
  StorageSheet,
  SheetDelta,
} from './types.ts';

// =====================================================================
// fixtures
// =====================================================================

const N1: StorageNode = {
  id: 'n1',
  name: 'node 1',
  type: 'process',
  position: { x: 0, y: 0 },
  size: { width: 100, height: 50 },
  expandable: false,
};
const N2: StorageNode = { ...N1, id: 'n2', name: 'node 2' };

const C1: StorageConnector = {
  id: 'e1',
  sourceID: 'n1',
  targetID: 'n2',
};

const SHEET1: StorageSheet = {
  id: 's1',
  name: 'sheet 1',
  nodes: [N1, N2],
  connectors: [C1],
};

const NODE_DELTA1: NodeDelta = {
  nodeId: 'n1',
  changedFields: [{ field: 'name', before: 'old', after: 'new' }],
};

const CONNECTOR_DELTA1: ConnectorDelta = {
  connectorId: 'e1',
  semanticKey: JSON.stringify(['s1', 'n1', 'n2', null, null]),
  changedFields: [{ field: 'label', before: 'a', after: 'b' }],
};

function makeFullDelta(): Delta {
  const sheetDelta: SheetDelta = {
    sheetId: 's1',
    sheetMetaChangedFields: [{ field: 'name', before: 'old name', after: 'new name' }],
    nodes: {
      added: new Map([['n3', { ...N1, id: 'n3' }]]),
      removed: new Map([['n4', { ...N1, id: 'n4' }]]),
      modified: new Map([['n1', NODE_DELTA1]]),
      deprecated: new Map([['n2', N2]]),
    },
    connectors: {
      added: new Map([['e2', { ...C1, id: 'e2' }]]),
      removed: new Map([['e3', { ...C1, id: 'e3' }]]),
      modified: new Map([['e1', CONNECTOR_DELTA1]]),
    },
  };
  return {
    projectMetaChangedFields: [
      { field: 'name', before: 'project A', after: 'project B' },
    ],
    sheetsAdded: new Map([['s2', { ...SHEET1, id: 's2' }]]),
    sheetsRemoved: new Map([['s3', { ...SHEET1, id: 's3' }]]),
    sheetsModified: new Map([['s1', sheetDelta]]),
  };
}

// =====================================================================
// case 1: 4 bucket 全 Map 转 entries
// =====================================================================

describe('serializeDelta — 4 bucket Map → entries', () => {
  it('顶层 3 Map（sheetsAdded / sheetsRemoved / sheetsModified）转 Array<[K, V]>', () => {
    const delta = makeFullDelta();
    const ser = serializeDelta(delta);

    assert.ok(Array.isArray(ser.sheetsAdded), 'sheetsAdded should be array');
    assert.equal(ser.sheetsAdded.length, 1);
    assert.equal(ser.sheetsAdded[0][0], 's2');

    assert.ok(Array.isArray(ser.sheetsRemoved));
    assert.equal(ser.sheetsRemoved.length, 1);
    assert.equal(ser.sheetsRemoved[0][0], 's3');

    assert.ok(Array.isArray(ser.sheetsModified));
    assert.equal(ser.sheetsModified.length, 1);
    assert.equal(ser.sheetsModified[0][0], 's1');
  });

  it('SheetDelta 内 nodes 4 Map（added/removed/modified/deprecated）转 entries', () => {
    const delta = makeFullDelta();
    const ser = serializeDelta(delta);
    const [, sheetDelta] = ser.sheetsModified[0];

    assert.equal(sheetDelta.nodes.added.length, 1);
    assert.equal(sheetDelta.nodes.added[0][0], 'n3');
    assert.equal(sheetDelta.nodes.removed.length, 1);
    assert.equal(sheetDelta.nodes.removed[0][0], 'n4');
    assert.equal(sheetDelta.nodes.modified.length, 1);
    assert.equal(sheetDelta.nodes.modified[0][0], 'n1');
    assert.equal(sheetDelta.nodes.deprecated.length, 1);
    assert.equal(sheetDelta.nodes.deprecated[0][0], 'n2');
  });

  it('SheetDelta 内 connectors 3 Map（added/removed/modified）转 entries', () => {
    const delta = makeFullDelta();
    const ser = serializeDelta(delta);
    const [, sheetDelta] = ser.sheetsModified[0];

    assert.equal(sheetDelta.connectors.added.length, 1);
    assert.equal(sheetDelta.connectors.added[0][0], 'e2');
    assert.equal(sheetDelta.connectors.removed.length, 1);
    assert.equal(sheetDelta.connectors.removed[0][0], 'e3');
    assert.equal(sheetDelta.connectors.modified.length, 1);
    assert.equal(sheetDelta.connectors.modified[0][0], 'e1');
  });
});

// =====================================================================
// case 2: JSON round-trip 结构断言
// =====================================================================

describe('serializeDelta — JSON.stringify → parse round-trip', () => {
  it('完整 Delta serialize 后 JSON.stringify→parse 结构等同', () => {
    const delta = makeFullDelta();
    const ser = serializeDelta(delta);
    const json = JSON.stringify(ser);
    const parsed = JSON.parse(json) as SerializedDelta;

    // projectMetaChangedFields 数组保留
    assert.deepEqual(parsed.projectMetaChangedFields, ser.projectMetaChangedFields);
    // sheetsAdded entries 保留
    assert.equal(parsed.sheetsAdded.length, 1);
    assert.equal(parsed.sheetsAdded[0][0], 's2');
    // sheetsModified[0].nodes.modified 嵌套结构保留
    assert.equal(parsed.sheetsModified[0][1].nodes.modified[0][1].nodeId, 'n1');
    assert.equal(
      parsed.sheetsModified[0][1].nodes.modified[0][1].changedFields[0].after,
      'new'
    );
  });

  it('空 Delta（4 个 Map 都空）serialize 后仍是有效 JSON', () => {
    const empty: Delta = {
      projectMetaChangedFields: [],
      sheetsAdded: new Map(),
      sheetsRemoved: new Map(),
      sheetsModified: new Map(),
    };
    const ser = serializeDelta(empty);
    const json = JSON.stringify(ser);
    const parsed = JSON.parse(json) as SerializedDelta;

    assert.deepEqual(parsed.projectMetaChangedFields, []);
    assert.deepEqual(parsed.sheetsAdded, []);
    assert.deepEqual(parsed.sheetsRemoved, []);
    assert.deepEqual(parsed.sheetsModified, []);
  });
});

// =====================================================================
// case 3: 截断策略
// =====================================================================

describe('maybeTruncateDetails — 截断策略（隐藏判断 #5）', () => {
  it('小 details 不截断，truncated=false', () => {
    const details = {
      schemaVersion: 1,
      baseVersion: 1,
      currentVersion: 2,
      resolution: 'auto_merged',
      debugDelta: { deltaA: { hello: 'world' } },
    };
    const r = maybeTruncateDetails(details);
    assert.equal(r.truncated, false);
    const parsed = JSON.parse(r.json);
    assert.deepEqual(parsed.debugDelta, { deltaA: { hello: 'world' } });
    assert.equal(parsed.truncated, undefined, 'small payload should not have truncated flag');
  });

  it('超过 64KB 上限时删 debugDelta + 加 truncated=true 标志', () => {
    // 构造 ~80KB 的 debugDelta（伪造大数组）
    const hugeArray = Array.from({ length: 1000 }, (_, i) => ({
      idx: i,
      payload: 'x'.repeat(80), // ~80 字节 / entry → ~80KB total
    }));
    const details = {
      schemaVersion: 1,
      baseVersion: 1,
      currentVersion: 2,
      resolution: 'auto_merged',
      report: { nodesAddedCount: 1 }, // 关键事实保留
      debugDelta: { deltaA: hugeArray, deltaB: hugeArray },
    };
    const fullSize = Buffer.byteLength(JSON.stringify(details), 'utf8');
    assert.ok(fullSize > CONFLICT_LOG_DETAILS_MAX_BYTES, `fixture size ${fullSize} should exceed limit`);

    const r = maybeTruncateDetails(details);
    assert.equal(r.truncated, true);
    const parsed = JSON.parse(r.json);
    assert.equal(parsed.truncated, true);
    // debugDelta 已被删（undefined → JSON.stringify 不输出）
    assert.equal(parsed.debugDelta, undefined);
    // report / resolution 保留（关键事实）
    assert.deepEqual(parsed.report, { nodesAddedCount: 1 });
    assert.equal(parsed.resolution, 'auto_merged');
    assert.equal(parsed.schemaVersion, 1);
  });

  it('上限边界值附近不截断（恰好等于上限）', () => {
    // 构造刚好等于上限的字符串（用 'a' 简单填充但减去其它字段开销）
    const pad = 'a'.repeat(CONFLICT_LOG_DETAILS_MAX_BYTES - 100);
    const details = {
      schemaVersion: 1,
      pad,
    };
    const r = maybeTruncateDetails(details);
    // 应该不截断
    assert.equal(r.truncated, false);
  });
});
