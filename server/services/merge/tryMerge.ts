// 阶段 5 合并算法 — tryMerge：编排 computeDelta + detector + applyDelta
//
// 拍板依据：[Day2-合并算法/03-拍板记录.md](../../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day2-合并算法/03-拍板记录.md)
//
// 关键约定：
// - D2 拍板：tryMerge(baseData, currentData, incomingData, ctx, ...): MergeResult
//   内部 computeDelta 两次（base→current = deltaA / base→incoming = deltaB）
//   MergeResult 加 debugDelta? 可选字段给 Day 3 conflict_logs 用
// - 编排顺序：computeDelta×2 → detect 4 段 → 任一非空短路 → applyDelta → mergeReport 计数
// - DataIntegrityError 透传：computeDelta / applyDelta 抛出的真损坏让上游 saveCanvas catch 映射 500
// - codex B-3 L1 验收：ok:false 路径**不携带 warnings**——warnings 仅在 ok:true 路径随 report 返回
//
// 切片范围（B-4）：
// - tryMerge 主体：编排 + 短路 + mergeReport 计数 + debugDelta
// - 不负责持久化（saveCanvas 阶段 C 切片做 helper rewrite + 写主表 + nodes_meta + annotations 同事务）

import { computeDelta } from './computeDelta.ts';
import { applyDelta } from './applyDelta.ts';
import {
  detectEdgeConflicts,
  detectNodeConflicts,
  detectProjectConflicts,
  detectSheetConflicts,
} from './detector.ts';
import type {
  Delta,
  DetectContext,
  MergeReport,
  MergeResult,
  MultiCanvasProjectShape,
} from './types.ts';

/** tryMerge 入参 */
export interface TryMergeInput {
  /** 三方合并的共同祖先版本数据（用户编辑前的快照） */
  baseData: MultiCanvasProjectShape;
  /** 服务端当前快照（含 A 已合并的所有改动） */
  currentData: MultiCanvasProjectShape;
  /** 当前用户 B 提交的待合并数据（已通过 schema 校验） */
  incomingData: MultiCanvasProjectShape;
  /** detect 上下文（userA/userB/visibility） */
  ctx: DetectContext;
  /** mergedFrom 元信息（用于 mergeReport，保持 UI toast 友好） */
  currentVersion: number;
  mergedFromUserId: number | null;
  mergedFromUsername: string | null;
  /** 是否在 MergeResult 携带 debugDelta（Day 3 conflict_logs 实施时由调用方传 true） */
  includeDebugDelta?: boolean;
}

/**
 * 编排合并流程：computeDelta×2 → detect 4 段 → applyDelta → mergeReport。
 *
 * 调用前提：incomingData 已通过 schema 校验（saveCanvas 路径已做 ZodSchema.parse）。
 *
 * 返回：
 *  - 成功 → ok: true + mergedData + report（含 warnings）
 *  - 冲突 → ok: false + conflicts（**不携带 warnings**，codex B-3 L1 验收）
 *
 * 抛错：
 *  - DataIntegrityError：computeDelta 入口或 applyDelta 内 assertProjectIntegrity 检测到真损坏
 *    （duplicate id / null handle / dangling parentId / connector endpoints 异常等）
 *    上游 saveCanvas 应 catch 并映射为 500 + 'data_integrity_error'
 */
export function tryMerge(input: TryMergeInput): MergeResult {
  const {
    baseData,
    currentData,
    incomingData,
    ctx,
    currentVersion,
    mergedFromUserId,
    mergedFromUsername,
    includeDebugDelta,
  } = input;

  // 1. 计算双 delta（computeDelta 入口会跑 assertProjectIntegrity 防御 base/current/incoming 损坏）
  const deltaA = computeDelta(baseData, currentData);
  const deltaB = computeDelta(baseData, incomingData);

  const debugDelta = includeDebugDelta ? { deltaA, deltaB } : undefined;

  // 2. 四段 detector 收集所有冲突：四段全部跑完后判 conflicts.length > 0 → 短路 applyDelta
  // 设计权衡（codex B-4 L1 澄清）：不在第一段非空时立即 return，因为收集所有段冲突让前端能
  // 一次性展示多类冲突；性能影响可忽略（detector 是纯 Map 比较，O(N+M) 节点+边数）
  const conflicts = [
    ...detectNodeConflicts(deltaA, deltaB, ctx),
    ...detectEdgeConflicts(deltaA, deltaB, ctx),
    ...detectSheetConflicts(deltaA, deltaB, ctx),
    ...detectProjectConflicts(deltaA, deltaB, ctx),
  ];

  if (conflicts.length > 0) {
    // codex B-3 L1：ok:false 路径不携带 warnings；只返 conflicts + 可选 debugDelta
    return debugDelta !== undefined
      ? { ok: false, conflicts, debugDelta }
      : { ok: false, conflicts };
  }

  // 3. detect 全空 → 调 applyDelta（纯函数，输出 mergedData / 短路 conflicts）
  const applyResult = applyDelta(currentData, deltaB);

  if (!applyResult.ok) {
    // applyDelta 短路场景：active_sheet_missing（B-2.5 M2 必修映射）
    return debugDelta !== undefined
      ? { ok: false, conflicts: applyResult.conflicts, debugDelta }
      : { ok: false, conflicts: applyResult.conflicts };
  }

  // 4. 合并成功 → 计算 mergeReport（自动合并量统计）
  const report = computeMergeReport(
    deltaB,
    applyResult.warnings,
    currentVersion,
    mergedFromUserId,
    mergedFromUsername
  );

  return debugDelta !== undefined
    ? { ok: true, mergedData: applyResult.mergedData, report, debugDelta }
    : { ok: true, mergedData: applyResult.mergedData, report };
}

// ============================================================
// mergeReport 计数
// ============================================================
//
// 计数源：deltaB（B 用户改动落到 mergedData 的部分）。
// detector 已确认无冲突 + applyDelta 自动去重过 → deltaB 的所有变化都"成功合并"。
// E2 自动去重场景下 deltaB.connectors.added 被丢弃的 incoming 副本仍计入"新增数量"——
// 这是符合用户视角的："我加了一条边" + 实际保留 A 的 ID 但语义已合并。

function computeMergeReport(
  deltaB: Delta,
  warnings: MergeReport['warnings'],
  currentVersion: number,
  mergedFromUserId: number | null,
  mergedFromUsername: string | null
): MergeReport {
  let nodesAdded = 0;
  let nodesModified = 0;
  let nodesDeprecated = 0;
  let nodesRemoved = 0;
  let edgesAdded = 0;
  let edgesModified = 0;
  let edgesRemoved = 0;

  // sheetsAdded 内的节点 / 边整 sheet 计入对应类
  for (const sheet of deltaB.sheetsAdded.values()) {
    nodesAdded += sheet.nodes.length;
    edgesAdded += sheet.connectors.length;
  }

  // sheetsRemoved 内的节点 / 边整 sheet 计入删除
  for (const sheet of deltaB.sheetsRemoved.values()) {
    nodesRemoved += sheet.nodes.length;
    edgesRemoved += sheet.connectors.length;
  }

  // sheetsModified 内的节点 / 边按 4 个 bucket 分别累加
  for (const sheetDelta of deltaB.sheetsModified.values()) {
    nodesAdded += sheetDelta.nodes.added.size;
    nodesRemoved += sheetDelta.nodes.removed.size;
    nodesModified += sheetDelta.nodes.modified.size;
    nodesDeprecated += sheetDelta.nodes.deprecated.size;
    edgesAdded += sheetDelta.connectors.added.size;
    edgesRemoved += sheetDelta.connectors.removed.size;
    edgesModified += sheetDelta.connectors.modified.size;
  }

  return {
    nodesAddedCount: nodesAdded,
    nodesModifiedCount: nodesModified,
    nodesDeprecatedCount: nodesDeprecated,
    nodesRemovedCount: nodesRemoved,
    edgesAddedCount: edgesAdded,
    edgesModifiedCount: edgesModified,
    edgesRemovedCount: edgesRemoved,
    warnings,
    mergedFromUserId,
    mergedFromUsername,
    mergedFromVersion: currentVersion,
  };
}

