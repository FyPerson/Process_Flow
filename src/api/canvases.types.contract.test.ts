// 阶段 5 Day 3 D-3 — 客户端类型镜像契约测试
//
// 目的：守住 src/api/canvases.types.ts 镜像与 server/services/{canvases,merge/types}.ts 真类型 shape 一致。
//
// 设计：
// - 契约测试只在 dev/test 时跑（test tsconfig 同时 include src + server）；prod 客户端打包不含 server import
// - 用 TypeScript 类型相容性断言（编译期）+ 运行时 sample shape 断言（双重保险）
// - 任何字段加减漏改一边就编译报错或测试 fail
//
// 这是 codex Day 3 取舍审判断点 7 选项 C 的关键守门：客户端不能 import server，
// 但要避免镜像漂移就必须有契约测试。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 客户端镜像
import type {
  Conflict as ClientConflict,
  ConflictType as ClientConflictType,
  MergeReport as ClientMergeReport,
  MergeWarning as ClientMergeWarning,
  SaveCanvasResultClient,
} from './canvases.types.ts';

// 服务端真类型
import type {
  Conflict as ServerConflict,
  ConflictType as ServerConflictType,
  MergeReport as ServerMergeReport,
  MergeWarning as ServerMergeWarning,
} from '../../server/services/merge/types.ts';
import type { SaveCanvasResult as ServerSaveCanvasResult } from '../../server/services/canvases.ts';

// =====================================================================
// 编译期类型相容性断言（真 compile-fail pattern）
// =====================================================================
//
// codex Day 3 末尾审 high #1 修法：
// 旧 pattern `type X = A extends B ? true : never;` 不满足时只得 never，
// 但 `type alias = never` 在 TS 中合法编译，断言**不生效**（漂移时也不报错）。
//
// 新 pattern：`type Assert<T extends true> = T;` + `type IsEqual<X, Y>`，
// 不满足时 Assert<false> 真编译报错 "Type 'false' does not satisfy the constraint 'true'"。
//
// 验证方法：临时把 ClientConflictType 删一个值（如 'active_sheet_missing'）→ tsc -p tsconfig.test.json
// 应直接报 "Type 'false' does not satisfy the constraint 'true'"。已通过验证。

/** 编译期断言：T 必须是 true，否则编译报错 */
type Assert<T extends true> = T;

/** 类型严格相等：双向 extends 都成立 */
type IsEqual<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
  ? true
  : false;

/** 类型双向相容（structurally equal）：X 可赋值给 Y 且 Y 可赋值给 X */
type IsBidirectionalAssignable<X, Y> = [X] extends [Y]
  ? [Y] extends [X]
    ? true
    : false
  : false;

// ConflictType 镜像 = 服务端（严格 union 相等）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ConflictTypeMatch = Assert<IsEqual<ClientConflictType, ServerConflictType>>;

// Conflict 双向相容（field shape 双向 extends）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ConflictMatch = Assert<IsBidirectionalAssignable<ClientConflict, ServerConflict>>;

// MergeReport 双向相容
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MergeReportMatch = Assert<IsBidirectionalAssignable<ClientMergeReport, ServerMergeReport>>;

// MergeWarning 双向相容
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MergeWarningMatch = Assert<IsBidirectionalAssignable<ClientMergeWarning, ServerMergeWarning>>;

// SaveCanvasResultClient 是 ServerSaveCanvasResult 的成功子集（ok:true 路径）
// 客户端不接 ok:false（走 ApiError）；故只验证 client → server 的 forward
// 但服务端 mergedData 是 MultiCanvasProjectShape 而客户端是 MultiCanvasProject —— 跨边界类型不能直接相容（不同 import 路径）
// 故只验证非 mergedData 字段（version/merged/mergedFromVersion/report）shape 相容
type ServerSaveOkOnly = Extract<ServerSaveCanvasResult, { ok: true }>;
// 移除 mergedData 字段后两边应相容
type StripMergedData<T> = T extends { mergedData: unknown } ? Omit<T, 'mergedData'> : T;
// 严格用 Assert：不满足时编译报错（不像 = never 那样静默通过）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SaveOkMinusMergedData = Assert<
  IsBidirectionalAssignable<
    StripMergedData<SaveCanvasResultClient>,
    StripMergedData<ServerSaveOkOnly>
  >
>;

// =====================================================================
// 运行时 sample shape 断言（双重保险）
// =====================================================================

describe('canvases.types 契约 — 运行时 sample 断言', () => {
  it('Conflict sample 双向类型可赋值', () => {
    const serverSample: ServerConflict = {
      type: 'node_modified_both',
      sheetId: 's1',
      targetId: 'n1',
      field: 'name',
    };
    // 服务端 → 客户端
    const asClient: ClientConflict = serverSample;
    assert.equal(asClient.type, 'node_modified_both');
    assert.equal(asClient.targetId, 'n1');

    // 客户端 → 服务端
    const clientSample: ClientConflict = {
      type: 'edge_semantic_conflict',
      sheetId: 's1',
      message: 'msg',
    };
    const asServer: ServerConflict = clientSample;
    assert.equal(asServer.type, 'edge_semantic_conflict');
  });

  it('MergeReport sample 双向类型可赋值', () => {
    const serverSample: ServerMergeReport = {
      nodesAddedCount: 1,
      nodesModifiedCount: 0,
      nodesDeprecatedCount: 0,
      nodesRemovedCount: 0,
      edgesAddedCount: 0,
      edgesModifiedCount: 0,
      edgesRemovedCount: 0,
      warnings: [],
      mergedFromUserId: 1,
      mergedFromUsername: 'alice',
      mergedFromVersion: 2,
    };
    const asClient: ClientMergeReport = serverSample;
    assert.equal(asClient.mergedFromUserId, 1);
  });

  it('MergeWarning sample 双向类型可赋值', () => {
    const serverSample: ServerMergeWarning = {
      type: 'edge_dropped_dangling_endpoint',
      sheetId: 's1',
      edgeId: 'e1',
      missingEndpoint: 'n1',
      missingEndpointSide: 'source',
    };
    const asClient: ClientMergeWarning = serverSample;
    assert.equal(asClient.missingEndpointSide, 'source');
  });
});
