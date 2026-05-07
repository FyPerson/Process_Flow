// 阶段 5 合并算法 — detector：基于 deltaA + deltaB 检测冲突
//
// 拍板依据：[Day2-合并算法/03-拍板记录.md](../../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day2-合并算法/03-拍板记录.md)
//
// 关键约定：
// - D1: detectConflicts(deltaA, deltaB, ctx): Conflict[]，仅产 conflicts/warnings 不产 mergedData
// - D3: N3/N4 同节点同字段判定按 changedFields 字段交集；不重叠 → 合并；重叠 → 冲突
//   不区分 ctx.userA === ctx.userB（拍板 03 已修订：D3 字段交集精确判定，userId 不参与节点段判定）
// - D4: a) sheet_id_collision 不深比；b) 双删幂等 auto-merge；c) sheetsModified ∧ sheetsRemoved 双向都判
// - 边界：detector 不读 nodes_meta；node_id_collision / node_meta_missing 由 saveCanvas
//   路径的 validateDeltaBPermissions（canvases-merge-helpers.ts）通过 PermissionError 处理
//
// 切片范围：
// - B-1：节点段 detectNodeConflicts + DetectContext 接入
// - B-2：边段 detectEdgeConflicts
// - B-2.5：sheet 段 detectSheetConflicts + project 段 detectProjectConflicts（本切片）
// - B-3：applyDelta（含 E7 dangling endpoint MergeWarning + R-Day2-1 active_sheet_missing 兜底，不在 detector 范围）
// - B-4：tryMerge 编排

import { deepEqualJsonShape } from './computeDelta.ts';
import {
  CONNECTOR_DIFF_FIELDS,
  NODE_DIFF_FIELDS,
  NON_SEMANTIC_CONNECTOR_FIELDS,
  SEMANTIC_CONNECTOR_FIELDS,
  type Conflict,
  type DetectContext,
  type Delta,
  type SheetDelta,
  type StorageConnector,
} from './types.ts';

// ============================================================
// detectNodeConflicts：节点段冲突检测
// ============================================================
//
// 覆盖：
//   N4  同节点同字段双方都改               → node_modified_both
//   N6  A 标废弃 + B 改字段                → node_deprecated_modified
//   N7  admin 物删 + B 改字段              → node_removed_modified
//   N8  A 物删 + B 标废弃（数据完整性）    → node_removed_deprecated
//
// 不覆盖（由其他路径处理）：
//   N1/N2/N5  纯 auto-merge（无冲突类型）
//   N3        字段不重叠 → 合并；本函数对"字段重叠"统一发 node_modified_both
//   N9        加边引用被删节点 → edge_endpoint_removed_by_other（边段 B-2）
//   N10       双方改 sheet 元信息字段       → sheet_meta_conflict（sheet 段 B-2.5）
//   node_id_collision / node_meta_missing → saveCanvas validateDeltaBPermissions
//
// 输入：deltaA = base→current（"对方"的改动），deltaB = base→incoming（"当前用户"的改动）
//      ctx 提供 visibility（影响 N7 admin 物删可达性的展示语义；本函数不据此短路）
//
// 输出：Conflict[]；同节点的产出规则：
//      - 删/废弃类（node_removed_modified / node_removed_deprecated / node_deprecated_modified）
//        因 computeDelta 互斥契约（modified/deprecated/removed 三 bucket 互斥），最多一条；
//      - N4 node_modified_both 按每个重叠字段产一条，因此同节点可能产生多条 N4。
//      不同 sheet 或不同节点各自独立。

export function detectNodeConflicts(
  deltaA: Delta,
  deltaB: Delta,
  _ctx: DetectContext
): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const [sheetId, sheetA] of deltaA.sheetsModified) {
    const sheetB = deltaB.sheetsModified.get(sheetId);
    if (!sheetB) continue;

    detectNodeConflictsInSheet(sheetId, sheetA, sheetB, conflicts);
  }

  return conflicts;
}

function detectNodeConflictsInSheet(
  sheetId: string,
  sheetA: SheetDelta,
  sheetB: SheetDelta,
  out: Conflict[]
): void {
  // 同节点产出规则（与函数头部注释一致）：
  // - 删/废弃类（N7 / N8 / N6）最多一条——computeDelta 保证 modified/deprecated/removed 三
  //   bucket 互斥，且本函数对 removed 分支用 if/else if，单侧不会同时触发 N7+N8。
  // - N4 node_modified_both 按每个重叠字段产一条。
  // 同节点同时进多个 bucket（modified+deprecated → alsoDeprecated；标废弃单走 deprecated）
  // 由 computeDelta 互斥契约保证不会发生。

  // ---- N7: A 物删 + B 改字段（包括 alsoDeprecated 内容修改）----
  for (const nodeId of sheetA.nodes.removed.keys()) {
    if (sheetB.nodes.modified.has(nodeId)) {
      out.push({
        type: 'node_removed_modified',
        sheetId,
        targetId: nodeId,
        message: `节点 ${nodeId} 被对方删除，但你修改了字段`,
      });
    } else if (sheetB.nodes.deprecated.has(nodeId)) {
      // N8 外加项：A 物删 + B 标废弃（数据完整性，不能在已删节点上写 deprecated_*）
      out.push({
        type: 'node_removed_deprecated',
        sheetId,
        targetId: nodeId,
        message: `节点 ${nodeId} 被对方删除，但你标记了废弃`,
      });
    }
  }

  // ---- N7 反向：B 物删（incoming 这一侧）+ A 改字段 ----
  // detector 视角是双向：deltaB.removed ∧ deltaA.modified 同样冲突，因为 mergedData 必须保留
  // 与对方一致的删除语义；如果"当前用户删了 A 改字段的节点"，自动合并会丢 A 的改动
  for (const nodeId of sheetB.nodes.removed.keys()) {
    if (sheetA.nodes.modified.has(nodeId)) {
      out.push({
        type: 'node_removed_modified',
        sheetId,
        targetId: nodeId,
        message: `节点 ${nodeId} 被你删除，但对方修改了字段`,
      });
    } else if (sheetA.nodes.deprecated.has(nodeId)) {
      out.push({
        type: 'node_removed_deprecated',
        sheetId,
        targetId: nodeId,
        message: `节点 ${nodeId} 被你删除，但对方标记了废弃`,
      });
    }
  }

  // ---- N6: A 标废弃 + B 改字段（modified 仅含 alsoDeprecated=false 或 omit；废弃不重复算）----
  // alsoDeprecated=true 的 modified 表示"内容修改 + 同时标废弃"，A 单纯标废弃 vs B 内容修改 +
  // 同时标废弃 → 视作 N6（A 已废弃，B 又改字段）。
  for (const nodeId of sheetA.nodes.deprecated.keys()) {
    if (sheetB.nodes.modified.has(nodeId)) {
      out.push({
        type: 'node_deprecated_modified',
        sheetId,
        targetId: nodeId,
        message: `节点 ${nodeId} 被对方标记废弃，但你修改了字段`,
      });
    }
  }
  // 反向：B 标废弃 + A 改字段
  for (const nodeId of sheetB.nodes.deprecated.keys()) {
    if (sheetA.nodes.modified.has(nodeId)) {
      out.push({
        type: 'node_deprecated_modified',
        sheetId,
        targetId: nodeId,
        message: `节点 ${nodeId} 被你标记废弃，但对方修改了字段`,
      });
    }
  }

  // ---- N4: 同节点同字段双方都改（D3 字段交集精确判定）----
  // 仅当节点同时在 deltaA.modified 和 deltaB.modified，且 changedFields 有交集时才冲突；
  // 字段不重叠（N3 同人多窗口或不同人改不同字段）→ auto-merge，不进 conflicts。
  for (const [nodeId, nodeA] of sheetA.nodes.modified) {
    const nodeB = sheetB.nodes.modified.get(nodeId);
    if (!nodeB) continue;

    const fieldsA = new Set(nodeA.changedFields.map((c) => c.field));
    const overlapped: string[] = [];
    for (const change of nodeB.changedFields) {
      if (fieldsA.has(change.field)) overlapped.push(change.field);
    }

    if (overlapped.length === 0) continue;

    for (const field of overlapped) {
      // 防御：仅认 NODE_DIFF_FIELDS 白名单内的字段（computeDelta 已保证，再做一道）
      if (!(NODE_DIFF_FIELDS as readonly string[]).includes(field)) continue;
      out.push({
        type: 'node_modified_both',
        sheetId,
        targetId: nodeId,
        field,
        message: `节点 ${nodeId} 字段 ${field} 双方都改了`,
      });
    }
  }
}

// ============================================================
// detectEdgeConflicts：边段冲突检测（B-2 切片）
// ============================================================
//
// 覆盖（边段冲突）：
//   E4       同边同字段双方都改                    → edge_modified_both
//   E5       A 删边 + B 改边 / B 删边 + A 改边     → edge_removed_modified（双向）
//   N9       deltaB 加新边引用 deltaA 已删节点     → edge_endpoint_removed_by_other（主动行为）
//   外加     同 edge ID 但 semanticKey 不同        → edge_id_collision
//   edge_semantic_conflict 3 子场景（详见 types.ts ConflictType 定义）：
//     a) added 路径 同 ID + sem-key 相同 + 非语义字段不同
//     b) added 路径 不同 ID + sem-key 相同 + 非语义字段不同
//     c) modified 路径 双方都触及语义字段且 sem-key 分歧（codex B-2 H1 修法收紧）
//
// 不覆盖（由其他路径处理）：
//   E1 加不同边 / E3 改同边不同字段 / E6 双方都删同边 → auto-merge（无冲突类型）
//   E2 同语义边去重（不同 ID + sem-key 相同 + 非语义字段也相同）→ applyDelta 选 A
//   E7 加边时端点已被删（base 已有边 + 一边删点）   → applyDelta 产 MergeWarning（B-3 切片）
//   N9 反向：deltaA 加边引用 deltaB 已删节点         → applyDelta E7 路径（A 加边时不知道 B 删点；
//                                                     从用户视角是"B 看到自己丢了一条边"，走 warning）
//
// 输入：deltaA / deltaB / ctx（_ctx 当前不读，与节点段一致）
//
// 输出：Conflict[]；同一边的优先级解析（避免一条边同时产多类型冲突）：
//   - 删/改对：edge_removed_modified > edge_modified_both
//   - 修改路径：semantic 分歧（双方都触及语义字段时）短路于 edge_modified_both
//   - 新增 ID 撞车：edge_id_collision > edge_semantic_conflict（端点都不一样最严重）

export function detectEdgeConflicts(
  deltaA: Delta,
  deltaB: Delta,
  _ctx: DetectContext
): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const [sheetId, sheetA] of deltaA.sheetsModified) {
    const sheetB = deltaB.sheetsModified.get(sheetId);
    if (!sheetB) continue;

    detectEdgeConflictsInSheet(sheetId, sheetA, sheetB, conflicts);
  }

  return conflicts;
}

function detectEdgeConflictsInSheet(
  sheetId: string,
  sheetA: SheetDelta,
  sheetB: SheetDelta,
  out: Conflict[]
): void {
  // ---- E5: A 删边 + B 改边（双向）----
  for (const edgeId of sheetA.connectors.removed.keys()) {
    if (sheetB.connectors.modified.has(edgeId)) {
      out.push({
        type: 'edge_removed_modified',
        sheetId,
        targetId: edgeId,
        message: `连线 ${edgeId} 被对方删除，但你修改了字段`,
      });
    }
  }
  for (const edgeId of sheetB.connectors.removed.keys()) {
    if (sheetA.connectors.modified.has(edgeId)) {
      out.push({
        type: 'edge_removed_modified',
        sheetId,
        targetId: edgeId,
        message: `连线 ${edgeId} 被你删除，但对方修改了字段`,
      });
    }
  }

  // ---- E4 + edge_semantic_conflict modified 子场景（codex B-2 H1 修法）----
  // 修法策略：modified 路径只有"双方都触及语义字段（sourceID/targetID/sourceHandle/targetHandle）
  //   且 sem-key 分歧"时才产 edge_semantic_conflict 短路；否则按字段交集判 E4。
  // 示例：
  //   - A 改 targetID + B 改 label：A 触及语义、B 没触及 → 字段不重叠 auto-merge（不产冲突）
  //   - A 改 targetID + B 改 sourceID：双方都触及语义 + sem-key 必然分歧 → edge_semantic_conflict
  //   - A 改 label + B 改 label：双方都没触及语义 → 字段交集判 E4
  // 这与 E3"改同边不同字段自动合并"的边界对齐——单边端点变化不是冲突。
  for (const [edgeId, edgeA] of sheetA.connectors.modified) {
    const edgeB = sheetB.connectors.modified.get(edgeId);
    if (!edgeB) continue;

    const semFieldsA = edgeA.changedFields.filter((c) =>
      (SEMANTIC_CONNECTOR_FIELDS as readonly string[]).includes(c.field)
    );
    const semFieldsB = edgeB.changedFields.filter((c) =>
      (SEMANTIC_CONNECTOR_FIELDS as readonly string[]).includes(c.field)
    );
    const bothTouchedSemantic = semFieldsA.length > 0 && semFieldsB.length > 0;

    if (bothTouchedSemantic && edgeA.semanticKey !== edgeB.semanticKey) {
      // 双方都改了端点/handle 且语义键分歧 → 短路产 1 条 semantic conflict，跳过字段交集判 E4
      // （此时同一边在合并后无法保留单一端点，是真正的端点冲突）
      out.push({
        type: 'edge_semantic_conflict',
        sheetId,
        targetId: edgeId,
        message: `连线 ${edgeId} 双方都修改了端点/handle，语义键已分歧`,
      });
      continue;
    }

    // 其他场景按字段交集判 E4：
    // - 双方都没触及语义字段 → 纯非语义字段重叠判 E4
    // - 仅一方触及语义字段 → 按字段交集，端点字段不重叠时不产冲突（auto-merge 字段级）
    const fieldsA = new Set(edgeA.changedFields.map((c) => c.field));
    for (const change of edgeB.changedFields) {
      if (!fieldsA.has(change.field)) continue;
      if (!(CONNECTOR_DIFF_FIELDS as readonly string[]).includes(change.field)) continue;
      out.push({
        type: 'edge_modified_both',
        sheetId,
        targetId: edgeId,
        field: change.field,
        message: `连线 ${edgeId} 字段 ${change.field} 双方都改了`,
      });
    }
  }

  // ---- edge_id_collision: 同 edge ID 双方都 added 但 semanticKey 不同 ----
  // 同 ID 双方都 added 且 semanticKey 相同 → 走 E2 auto-merge 去重（applyDelta 处理，detector 不产）
  // 同 ID 双方都 added 且 semanticKey 相同但非语义字段不同 → edge_semantic_conflict（见下）
  // 同 ID 双方都 added 且 semanticKey 不同 → edge_id_collision（最严重，端点都不一样还撞 ID）
  for (const [edgeId, connA] of sheetA.connectors.added) {
    const connB = sheetB.connectors.added.get(edgeId);
    if (!connB) continue;

    const keyA = computeAddedSemanticKey(sheetId, connA);
    const keyB = computeAddedSemanticKey(sheetId, connB);

    if (keyA !== keyB) {
      out.push({
        type: 'edge_id_collision',
        sheetId,
        targetId: edgeId,
        message: `连线 ID ${edgeId} 双方都新建但端点不同`,
      });
      continue;
    }

    // 同 ID + 同 semanticKey：检查非语义字段（如 label / style / waypoints）是否一致
    if (!nonSemanticFieldsEqual(connA, connB)) {
      out.push({
        type: 'edge_semantic_conflict',
        sheetId,
        targetId: edgeId,
        message: `连线 ${edgeId} 双方新建同语义边但非语义字段不同`,
      });
    }
    // else: 完全相同 → E2 auto-merge 去重（applyDelta 选 A，本函数不产）
  }

  // ---- edge_semantic_conflict（不同 ID + 同 semanticKey 但非语义字段不同）----
  // 此场景：双方各自新建 edge ID 不同但 sheetId+sourceID+targetID+handle 完全一致——这是"两人独立画
  // 了同一条业务连线"。若非语义字段也一致 → E2 auto-merge 去重保留 A；否则 → edge_semantic_conflict
  const semanticIndexB = new Map<string, { id: string; conn: StorageConnector }>();
  for (const [idB, connB] of sheetB.connectors.added) {
    if (sheetA.connectors.added.has(idB)) continue; // 已在上面 id collision 段处理
    semanticIndexB.set(computeAddedSemanticKey(sheetId, connB), { id: idB, conn: connB });
  }
  for (const [idA, connA] of sheetA.connectors.added) {
    if (sheetB.connectors.added.has(idA)) continue; // 同上
    const keyA = computeAddedSemanticKey(sheetId, connA);
    const matchB = semanticIndexB.get(keyA);
    if (!matchB) continue;

    if (!nonSemanticFieldsEqual(connA, matchB.conn)) {
      out.push({
        type: 'edge_semantic_conflict',
        sheetId,
        targetId: idA,
        message: `连线 ${idA} / ${matchB.id} 同语义但非语义字段不同（双方独立新建同业务连线）`,
      });
    }
    // else: 完全相同 → E2 auto-merge 去重（applyDelta 处理）
  }

  // ---- N9: deltaB 加新边引用 deltaA 已删节点 ----
  // detector 视角：B 主动加边时该端点节点在 A 已删 — 用户应被弹窗（"你新连的线，对方已经把节点删了"）
  // 反向（A 加边引用 B 删节点）走 E7 MergeWarning，不在 detect 段（B-3 applyDelta 处理）
  for (const [edgeId, conn] of sheetB.connectors.added) {
    if (sheetA.nodes.removed.has(conn.sourceID)) {
      out.push({
        type: 'edge_endpoint_removed_by_other',
        sheetId,
        targetId: edgeId,
        message: `连线 ${edgeId} 的源节点 ${conn.sourceID} 被对方删除`,
      });
      continue;
    }
    if (sheetA.nodes.removed.has(conn.targetID)) {
      out.push({
        type: 'edge_endpoint_removed_by_other',
        sheetId,
        targetId: edgeId,
        message: `连线 ${edgeId} 的目标节点 ${conn.targetID} 被对方删除`,
      });
    }
  }
}

// 同 ID added 双方都新建时，semanticKey 由原 connector 信息现算（modified delta 才会带 semanticKey）
function computeAddedSemanticKey(
  sheetId: string,
  conn: { sourceID: string; targetID: string; sourceHandle?: string; targetHandle?: string }
): string {
  return JSON.stringify([
    sheetId,
    conn.sourceID,
    conn.targetID,
    conn.sourceHandle ?? null,
    conn.targetHandle ?? null,
  ]);
}

// 比对非语义字段（types.ts 的 NON_SEMANTIC_CONNECTOR_FIELDS = CONNECTOR_DIFF_FIELDS - SEMANTIC_CONNECTOR_FIELDS）
// 用 deepEqualJsonShape（key 顺序无关，与 computeDelta 同款语义；codex B-2 复审 M1 修法）
function nonSemanticFieldsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  for (const field of NON_SEMANTIC_CONNECTOR_FIELDS) {
    if (!deepEqualJsonShape(a[field], b[field])) return false;
  }
  return true;
}

// ============================================================
// detectSheetConflicts：sheet 段冲突检测（B-2.5 切片）
// ============================================================
//
// 覆盖（拍板 D4 + G3 保守 409）：
//   sheet_id_collision      两人各自新建同 sheetId（不深比，直接 409）
//   sheet_removed_modified  sheetsModified ∧ sheetsRemoved 双向（D4 c：A 改 + B 删 / B 改 + A 删）
//   sheet_meta_conflict     双方都改同 sheet 的 sheetMetaChangedFields（G3：任意字段冲突即 409）
//
// 不覆盖：
//   双删幂等（D4 b）→ auto-merge 不产
//   sheetsModified 单边出现 → auto-merge（一方动一方不动）
//   active_sheet_missing → applyDelta 后 assertProjectIntegrity 兜底（R-Day2-1 由 B-3 处理）

export function detectSheetConflicts(
  deltaA: Delta,
  deltaB: Delta,
  _ctx: DetectContext
): Conflict[] {
  const conflicts: Conflict[] = [];

  // ---- sheet_id_collision: 两人 sheetsAdded 同 ID ----
  for (const sheetId of deltaA.sheetsAdded.keys()) {
    if (deltaB.sheetsAdded.has(sheetId)) {
      conflicts.push({
        type: 'sheet_id_collision',
        sheetId,
        targetId: sheetId,
        message: `Sheet ID ${sheetId} 双方都新建（不深比，直接 409）`,
      });
    }
  }

  // ---- sheet_removed_modified: 双向 D4 c ----
  // A 删 + B 改
  for (const sheetId of deltaA.sheetsRemoved.keys()) {
    if (deltaB.sheetsModified.has(sheetId)) {
      conflicts.push({
        type: 'sheet_removed_modified',
        sheetId,
        targetId: sheetId,
        message: `Sheet ${sheetId} 被对方删除，但你修改了内容`,
      });
    }
  }
  // B 删 + A 改
  for (const sheetId of deltaB.sheetsRemoved.keys()) {
    if (deltaA.sheetsModified.has(sheetId)) {
      conflicts.push({
        type: 'sheet_removed_modified',
        sheetId,
        targetId: sheetId,
        message: `Sheet ${sheetId} 被你删除，但对方修改了内容`,
      });
    }
  }

  // ---- sheet_meta_conflict: 双方都改同 sheet 元字段（G3 保守 409 任意字段冲突即报）----
  for (const [sheetId, sheetA] of deltaA.sheetsModified) {
    const sheetB = deltaB.sheetsModified.get(sheetId);
    if (!sheetB) continue;
    if (sheetA.sheetMetaChangedFields.length > 0 && sheetB.sheetMetaChangedFields.length > 0) {
      // G3：MVP 不做字段级合并，任意元信息字段双方都改 → 409
      conflicts.push({
        type: 'sheet_meta_conflict',
        sheetId,
        targetId: sheetId,
        message: `Sheet ${sheetId} 元信息双方都改（G3 保守 409 不做字段级合并）`,
      });
    }
  }

  return conflicts;
}

// ============================================================
// detectProjectConflicts：project 段冲突检测（B-2.5 切片）
// ============================================================
//
// 覆盖（G3 保守 409）：
//   project_meta_conflict   双方都改 project 顶层元信息（name / description / activeSheetId）
//                           任意字段双方都改 → 409，不做字段级合并
//
// 不覆盖：
//   active_sheet_missing → applyDelta 后 assertProjectIntegrity 兜底（R-Day2-1 由 B-3 处理）

export function detectProjectConflicts(
  deltaA: Delta,
  deltaB: Delta,
  _ctx: DetectContext
): Conflict[] {
  const conflicts: Conflict[] = [];

  if (
    deltaA.projectMetaChangedFields.length > 0 &&
    deltaB.projectMetaChangedFields.length > 0
  ) {
    // G3：MVP 不做字段级合并，任意 project 元字段双方都改 → 409
    conflicts.push({
      type: 'project_meta_conflict',
      message: 'Project 元信息（name/description/activeSheetId）双方都改（G3 保守 409 不做字段级合并）',
    });
  }

  return conflicts;
}

