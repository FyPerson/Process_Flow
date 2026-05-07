// 阶段 5 合并算法 — applyDelta：把 deltaB 字段补丁应用到 currentData，输出 mergedData
//
// 拍板依据：[Day2-合并算法/03-拍板记录.md](../../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day2-合并算法/03-拍板记录.md)
//
// 关键约定：
// - D5 拍板：纯函数 + 不接 db；服务端归属字段 rewrite 由 saveCanvas 路径的 helper 处理（阶段 A 已抽）
// - 已知风险 1：字段补丁严格按 changedFields.after，**禁止 spread incoming 整对象**
// - R-Day2-2 兜底：mergedData 输出前调 assertProjectIntegrity 复跑，E7 dangling endpoint 必须先丢弃
// - codex B-2.5 M2 必修：active_sheet_missing 错误映射 — 不让 DataIntegrityError 泄漏为 500
//
// 切片范围（B-3）：
// - applyDelta 主体：sheet 增删 / 节点字段补丁 / 边字段补丁 / E7 警告生成
// - active_sheet_missing 内部映射（B-2.5 M2 验收必修）
// - assertProjectIntegrity 复跑兜底（R-Day2-2）
// - E2 自动去重（同 ID 完全等价 / 不同 ID 同语义同非语义）

import {
  assertProjectIntegrity,
  DataIntegrityError,
  deepEqualJsonShape,
} from './computeDelta.ts';
import {
  CONNECTOR_DIFF_FIELDS,
  NODE_DIFF_FIELDS,
  NON_SEMANTIC_CONNECTOR_FIELDS,
  connectorSemanticKey,
  type Conflict,
  type Delta,
  type FieldChange,
  type MergeWarning,
  type MultiCanvasProjectShape,
  type SheetDelta,
  type StorageConnector,
  type StorageNode,
  type StorageSheet,
} from './types.ts';

/** applyDelta 输出 — 与 detector 风格一致：成功产 mergedData / 失败产 conflicts 短路 */
export type ApplyDeltaResult =
  | { ok: true; mergedData: MultiCanvasProjectShape; warnings: MergeWarning[] }
  | { ok: false; conflicts: Conflict[] };

/**
 * 把 deltaB 字段补丁打到 currentData，输出 mergedData。
 *
 * @param currentData 已写入 DB 的当前快照（含 A 已合并的所有改动）
 * @param deltaB     base→incoming 的差（B 用户当前未写入 DB 的改动）
 * @returns mergedData + E7 warnings；或 conflicts（active_sheet_missing 等）
 *
 * 调用前提：
 * - detector 已确认无冲突（detectNode + detectEdge + detectSheet + detectProject 全空）
 * - assertProjectIntegrity(currentData) 已在 computeDelta 入口校验过；但需注意：
 *   currentData 是 A 的合并后**暂态**结果——A 已合并的某些改动（如删除 sheet）可能让
 *   base.activeSheetId 不再存在。这种"暂态非完全合法"由 step 6 的 active_sheet_missing
 *   显式映射为 Conflict（codex B-2.5 M2 必修），不依赖调用前 currentData 完全合法。
 * - assertProjectIntegrity(incoming) 已在 computeDelta 入口校验过——applyDelta 不防御
 *   incoming 自相矛盾的脏 delta（如同时改 activeSheetId 到 s2 又删 s2）；这类输入由
 *   schema + computeDelta 入口拒绝。applyDelta 仅在 step 7 复跑兜底真损坏。
 */
export function applyDelta(
  currentData: MultiCanvasProjectShape,
  deltaB: Delta
): ApplyDeltaResult {
  // 深拷贝避免污染调用方的 currentData
  const merged: MultiCanvasProjectShape = JSON.parse(JSON.stringify(currentData));
  const warnings: MergeWarning[] = [];

  // ---- 1. project 顶层元字段补丁（detector 已拒"双方都改"，到这里只可能 deltaB 单边改）----
  for (const change of deltaB.projectMetaChangedFields) {
    (merged as Record<string, unknown>)[change.field] = change.after;
  }

  // ---- 2. sheetsAdded：deltaB 加新 sheet（去重 if currentData 已有）----
  for (const [sheetId, newSheet] of deltaB.sheetsAdded) {
    if (merged.sheets.some((s) => s.id === sheetId)) {
      // currentData 已含此 sheetId（A 也加了同 ID sheet）— detector 应已产 sheet_id_collision
      // 防御：到这里仍出现说明上游短路失效；保守跳过避免覆盖 A 的版本
      continue;
    }
    merged.sheets.push(JSON.parse(JSON.stringify(newSheet)) as StorageSheet);
  }

  // ---- 3. sheetsRemoved：deltaB 删 sheet ----
  for (const sheetId of deltaB.sheetsRemoved.keys()) {
    const idx = merged.sheets.findIndex((s) => s.id === sheetId);
    if (idx >= 0) merged.sheets.splice(idx, 1);
  }

  // ---- 4. sheetsModified：节点 / 边字段补丁 ----
  for (const [sheetId, sheetDelta] of deltaB.sheetsModified) {
    const sheet = merged.sheets.find((s) => s.id === sheetId);
    if (!sheet) {
      // currentData 没有此 sheet — A 已删 + B 改，detector 应已产 sheet_removed_modified
      continue;
    }

    // 4a. sheet 元字段补丁（detector 已拒"双方都改"）
    for (const change of sheetDelta.sheetMetaChangedFields) {
      (sheet as Record<string, unknown>)[change.field] = change.after;
    }

    applyNodeChanges(sheet, sheetDelta);
    applyConnectorChanges(sheetId, sheet, sheetDelta);
  }

  // ---- 5. E7 dangling endpoint：扫所有边，端点不在同 sheet 节点中 → 丢弃 + warning ----
  // 必须在 assertProjectIntegrity 之前做，否则 connector endpoints 校验会拒绝合法合并
  for (const sheet of merged.sheets) {
    const nodeIds = new Set(sheet.nodes.map((n) => n.id));
    const kept: StorageConnector[] = [];
    for (const conn of sheet.connectors) {
      if (!nodeIds.has(conn.sourceID)) {
        warnings.push({
          type: 'edge_dropped_dangling_endpoint',
          sheetId: sheet.id,
          edgeId: conn.id,
          missingEndpoint: conn.sourceID,
          missingEndpointSide: 'source',
        });
        continue;
      }
      if (!nodeIds.has(conn.targetID)) {
        warnings.push({
          type: 'edge_dropped_dangling_endpoint',
          sheetId: sheet.id,
          edgeId: conn.id,
          missingEndpoint: conn.targetID,
          missingEndpointSide: 'target',
        });
        continue;
      }
      kept.push(conn);
    }
    sheet.connectors = kept;
  }

  // ---- 6. active_sheet_missing 内部映射（codex B-2.5 M2 必修）----
  // R-Day2-1 兜底：activeSheetId 指向已被对方删除的 sheet
  // 必须在 assertProjectIntegrity 之前显式检测，把 DataIntegrityError 转成 Conflict
  if (
    merged.activeSheetId !== undefined &&
    !merged.sheets.some((s) => s.id === merged.activeSheetId)
  ) {
    return {
      ok: false,
      conflicts: [
        {
          type: 'active_sheet_missing',
          sheetId: merged.activeSheetId,
          targetId: merged.activeSheetId,
          message: `当前激活 sheet ${merged.activeSheetId} 已被对方删除`,
        },
      ],
    };
  }

  // ---- 7. R-Day2-2 兜底：复跑 assertProjectIntegrity ----
  // 此时 E7 dangling 已丢弃 / activeSheetId 已检；其他完整性问题（duplicate id / null handle /
  // dangling parentId）都是真损坏，应抛 DataIntegrityError 给上游 saveCanvas catch 映射 500
  try {
    assertProjectIntegrity(merged, 'mergedData');
  } catch (err) {
    if (err instanceof DataIntegrityError) {
      // 不再尝试拆解 location 字符串映射 conflict — active_sheet_missing 已在第 6 步处理
      // 其他 DataIntegrityError 是真损坏，让它向上传播给 saveCanvas / route 层映射 500
      throw err;
    }
    throw err;
  }

  return { ok: true, mergedData: merged, warnings };
}

// ============================================================
// 节点字段补丁
// ============================================================

function applyNodeChanges(sheet: StorageSheet, sheetDelta: SheetDelta): void {
  // sheetsModified.nodes.added：新增节点（detector 已拒同 ID 撞车在 saveCanvas 层）
  for (const [nodeId, newNode] of sheetDelta.nodes.added) {
    if (sheet.nodes.some((n) => n.id === nodeId)) continue; // 防御去重
    sheet.nodes.push(JSON.parse(JSON.stringify(newNode)) as StorageNode);
  }

  // sheetsModified.nodes.removed：物理删除（admin 路径）
  for (const nodeId of sheetDelta.nodes.removed.keys()) {
    const idx = sheet.nodes.findIndex((n) => n.id === nodeId);
    if (idx >= 0) sheet.nodes.splice(idx, 1);
  }

  // sheetsModified.nodes.modified：按 changedFields 字段补丁
  // 已知风险 1：禁止 spread incoming 整对象（会覆盖服务端归属字段）
  for (const [nodeId, nodeDelta] of sheetDelta.nodes.modified) {
    const node = sheet.nodes.find((n) => n.id === nodeId);
    if (!node) continue; // detector 应已产 node_removed_modified；防御跳过
    applyFieldPatches(node, nodeDelta.changedFields, NODE_DIFF_FIELDS);
    // alsoDeprecated=true：内容修改 + 同时标废弃
    // applyDelta 是纯函数不写归属字段；deprecated_by/at 由 saveCanvas 路径的
    // syncNodesMetaFromDeltaB helper 在持久化时写入
    if (nodeDelta.alsoDeprecated) {
      node.is_deprecated = true;
    }
  }

  // sheetsModified.nodes.deprecated：仅 is_deprecated false→true
  for (const nodeId of sheetDelta.nodes.deprecated.keys()) {
    const node = sheet.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    node.is_deprecated = true;
  }
}

// ============================================================
// 边字段补丁（含 E2 自动去重）
// ============================================================

function applyConnectorChanges(
  sheetId: string,
  sheet: StorageSheet,
  sheetDelta: SheetDelta
): void {
  // sheetsModified.connectors.added：新增边
  // E2 自动去重：currentData 可能已有同 semanticKey 的边（A 也加了语义相同的边）
  //   - 不同 ID 同 semanticKey 同非语义字段 → 跳过 deltaB 这条（保留 A）
  //   - 同 ID 已存在 → 跳过（detector edge_id_collision 已在上游短路；防御去重）
  const currentSemanticKeys = new Map<string, string>(); // semanticKey → edge ID
  for (const conn of sheet.connectors) {
    currentSemanticKeys.set(connectorSemanticKey(sheetId, conn), conn.id);
  }
  for (const [edgeId, newConn] of sheetDelta.connectors.added) {
    if (sheet.connectors.some((c) => c.id === edgeId)) continue; // ID 已存在
    const newKey = connectorSemanticKey(sheetId, newConn);
    const existingId = currentSemanticKeys.get(newKey);
    if (existingId !== undefined) {
      // 同语义边已存在；E2 比对非语义字段
      const existing = sheet.connectors.find((c) => c.id === existingId)!;
      if (nonSemanticConnectorFieldsEqual(existing, newConn)) {
        // 完全等价 → 保留 A（已存在）；丢弃 B 的副本
        continue;
      }
      // 非语义字段不同 → detector 应已产 edge_semantic_conflict 短路掉这条路径
      // 走到这里说明 detector 漏判 / currentData 含历史脏数据 / 调用方跳过 detector
      // 抛 DataIntegrityError 而非静默跳过——防止用户改动消失无痕（codex B-3 M1 修法）
      throw new DataIntegrityError(
        `connector ${edgeId} has same semanticKey as existing ${existingId} but non-semantic fields differ; detector should have produced edge_semantic_conflict`,
        `applyDelta sheet=${sheetId}`
      );
    }
    sheet.connectors.push(JSON.parse(JSON.stringify(newConn)) as StorageConnector);
    currentSemanticKeys.set(newKey, edgeId);
  }

  // sheetsModified.connectors.removed
  for (const edgeId of sheetDelta.connectors.removed.keys()) {
    const idx = sheet.connectors.findIndex((c) => c.id === edgeId);
    if (idx >= 0) sheet.connectors.splice(idx, 1);
  }

  // sheetsModified.connectors.modified：按 changedFields 字段补丁
  for (const [edgeId, connDelta] of sheetDelta.connectors.modified) {
    const conn = sheet.connectors.find((c) => c.id === edgeId);
    if (!conn) continue; // detector 应已产 edge_removed_modified；防御跳过
    applyFieldPatches(conn, connDelta.changedFields, CONNECTOR_DIFF_FIELDS);
  }
}

// ============================================================
// 字段补丁工具（防御白名单 + 禁止 spread）
// ============================================================

function applyFieldPatches(
  target: Record<string, unknown>,
  changedFields: FieldChange[],
  whitelist: readonly string[]
): void {
  for (const change of changedFields) {
    // 仅认白名单字段（computeDelta 已保证；再做一道防御）
    if (!whitelist.includes(change.field)) continue;
    target[change.field] = change.after;
  }
}

function nonSemanticConnectorFieldsEqual(
  a: StorageConnector,
  b: StorageConnector
): boolean {
  for (const field of NON_SEMANTIC_CONNECTOR_FIELDS) {
    if (!deepEqualJsonShape((a as Record<string, unknown>)[field], (b as Record<string, unknown>)[field])) {
      return false;
    }
  }
  return true;
}
