// 阶段 5 Day 3 阶段 D-1 — Delta 序列化 helper
//
// 拍板依据：[Day3-客户端/01-取舍审-客户端接合并响应+conflict_logs.md](../../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day3-客户端/01-取舍审-客户端接合并响应+conflict_logs.md)
//
// 关键约定：
// - 判断点 4：放在 server/services/merge/ 同目录（与 detector / applyDelta / tryMerge 同子域）
// - 隐藏判断 #4：Delta 含 Map<K, V>，JSON.stringify 直接序列化 Map 会变 `{}`，必须先转 entries 数组
// - 隐藏判断 #4：测试覆盖 JSON.stringify→parse 结构断言，**不要求反序列化回 Map**（除非未来 conflict_logs 重放）
// - 隐藏判断 #5：details 软上限或截断策略；超限至少保留 conflicts/report，delta 可截断并写 truncated=true
//
// Delta 内的 7 个 Map：
//   顶层：sheetsAdded / sheetsRemoved / sheetsModified
//   SheetDelta.nodes：added / removed / modified / deprecated
//   SheetDelta.connectors：added / removed / modified

import type {
  ConnectorDelta,
  Delta,
  FieldChange,
  NodeDelta,
  SheetDelta,
  StorageConnector,
  StorageNode,
  StorageSheet,
} from './types.ts';

/** 序列化 Delta 内嵌 Map<K, V> 转 entries 数组的 JSON 形态 */
export interface SerializedSheetDelta {
  sheetId: string;
  sheetMetaChangedFields: FieldChange[];
  nodes: {
    added: Array<[string, StorageNode]>;
    removed: Array<[string, StorageNode]>;
    modified: Array<[string, NodeDelta]>;
    deprecated: Array<[string, StorageNode]>;
  };
  connectors: {
    added: Array<[string, StorageConnector]>;
    removed: Array<[string, StorageConnector]>;
    modified: Array<[string, ConnectorDelta]>;
  };
}

export interface SerializedDelta {
  projectMetaChangedFields: FieldChange[];
  sheetsAdded: Array<[string, StorageSheet]>;
  sheetsRemoved: Array<[string, StorageSheet]>;
  sheetsModified: Array<[string, SerializedSheetDelta]>;
}

/**
 * 序列化 Delta 为 JSON-friendly 形态（Map<K,V> → Array<[K,V]>）。
 *
 * 不做截断；调用方（conflict_logs service）负责后续 JSON.stringify 后判长度截断。
 */
export function serializeDelta(delta: Delta): SerializedDelta {
  return {
    projectMetaChangedFields: delta.projectMetaChangedFields,
    sheetsAdded: Array.from(delta.sheetsAdded.entries()),
    sheetsRemoved: Array.from(delta.sheetsRemoved.entries()),
    sheetsModified: Array.from(delta.sheetsModified.entries()).map(([sheetId, sd]) => [
      sheetId,
      serializeSheetDelta(sd),
    ]),
  };
}

function serializeSheetDelta(sd: SheetDelta): SerializedSheetDelta {
  return {
    sheetId: sd.sheetId,
    sheetMetaChangedFields: sd.sheetMetaChangedFields,
    nodes: {
      added: Array.from(sd.nodes.added.entries()),
      removed: Array.from(sd.nodes.removed.entries()),
      modified: Array.from(sd.nodes.modified.entries()),
      deprecated: Array.from(sd.nodes.deprecated.entries()),
    },
    connectors: {
      added: Array.from(sd.connectors.added.entries()),
      removed: Array.from(sd.connectors.removed.entries()),
      modified: Array.from(sd.connectors.modified.entries()),
    },
  };
}

// ============================================================
// 截断策略（隐藏判断 #5）
// ============================================================
//
// conflict_logs.details 是 TEXT 列，但建议软上限避免单行 JSON 失控。
// 5 人内网每天 < 100 条日志，单行多大都不至于撑爆 SQLite，但仍然给个上限：
//
// 上限：64KB（足够覆盖典型场景：单 sheet 含数十节点的 deltaA + deltaB）
//
// 超限策略：
// 1. 保留 schemaVersion / baseVersion / currentVersion / resolution / report / conflicts（合并冲突的"事实"，不能丢）
// 2. 截掉 debugDelta（deltaA / deltaB —— 只是审计可重放素材，损失可接受）
// 3. 加 truncated:true 标志便于事后查"哪些日志被截了"

export const CONFLICT_LOG_DETAILS_MAX_BYTES = 64 * 1024; // 64KB

/**
 * 截断策略：尝试 JSON.stringify(details)；若超过 MAX 则把 debugDelta 删掉再 stringify，
 * 加 truncated:true 标志。仍超限则返回截断 + 不再尝试（极端场景，conflicts/report 也巨大）。
 *
 * 入参 details 已经是序列化后的扁平对象（debugDelta 字段值是 SerializedDelta 不是原始 Delta）。
 *
 * 类型约束放宽：泛型 T 不强求含 debugDelta，因为 base_version_expired 路径的 details 没 debugDelta；
 * 截断时仅当字段存在时才删（spread 中 undefined 字段 JSON.stringify 不输出）。
 */
export function maybeTruncateDetails<T extends object>(
  details: T
): { json: string; truncated: boolean } {
  const fullJson = JSON.stringify(details);
  if (Buffer.byteLength(fullJson, 'utf8') <= CONFLICT_LOG_DETAILS_MAX_BYTES) {
    return { json: fullJson, truncated: false };
  }
  // 超限：删 debugDelta + 加 truncated:true
  const truncated = { ...details, debugDelta: undefined, truncated: true };
  const truncatedJson = JSON.stringify(truncated);
  return { json: truncatedJson, truncated: true };
}
