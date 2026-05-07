// 阶段 5 Day 3 阶段 D-2 — conflict_logs service
//
// 拍板依据：[Day3-客户端/01-取舍审-客户端接合并响应+conflict_logs.md](../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day3-客户端/01-取舍审-客户端接合并响应+conflict_logs.md)
//
// 关键约定：
// - 判断点 1：service 内同事务写 INSERT（与 saveCanvas 主表 / canvas_versions 同事务）
// - 判断点 2：details 字段含 deltaA/deltaB 完整（debugDelta） + report / conflicts
// - 判断点 9：每次写一条（5 人内网量小）
// - 隐藏判断 #1：baseVersion > currentVersion 异常路径不写日志（saveCanvas 已在 logConflictResolution 之前 return）
// - 隐藏判断 #3：details 字段 schemaVersion: 1 + ...
// - 隐藏判断 #5：details 截断策略（serialize.ts maybeTruncateDetails）
// - 隐藏判断 #6：插入失败不 catch（事务回滚）
// - 判断点 3：Day 3 仅 3 种 resolution（auto_merged / conflict / base_version_expired）；overwrite/cancelled 留 Day 4
//
// 使用方式：在 saveCanvas 合并分支三个返回点前调用。
// 调用方必须在事务内调用（saveCanvas 主事务），不要自起 tx。

import type { Database as DatabaseType } from 'better-sqlite3';
import type { Conflict, Delta, MergeReport } from './merge/types.ts';
import { maybeTruncateDetails, serializeDelta } from './merge/serialize.ts';

/** Day 3 covered resolution（overwrite/cancelled 留 Day 4 真冲突 UI 实施时加） */
export type ConflictLogResolution =
  | 'auto_merged'             // tryMerge ok:true，B 改动已合并到 currentData
  | 'conflict'                 // detector 4 段产 conflicts 短路 / applyDelta active_sheet_missing 透传
  | 'base_version_expired';    // canvas_versions(baseVersion) 缺失（B 客户端版本太旧）

/** 写入 conflict_logs 一条记录的入参（saveCanvas 持有这些信息） */
export interface LogConflictInput {
  canvasId: number;
  /** 当前版本保存者（A）—— canvas_versions.saved_by 不是 canvases.updated_by（codex 阶段 C 修订 #2 #3） */
  userAId: number;
  /** B 触发本次保存（来自 SaveCanvasInput.user.id） */
  userBId: number;
  baseVersion: number;
  currentVersion: number;
  resolution: ConflictLogResolution;
  /** 成功合并路径才有；conflict 路径 undefined */
  report?: MergeReport;
  /** 真冲突路径才有（detector 4 段 + applyDelta active_sheet_missing） */
  conflicts?: Conflict[];
  /** tryMerge includeDebugDelta=true 返回的 deltaA/deltaB（成功 + 冲突路径都有；
   *  base_version_expired 没有 baseSnapshot 不能 computeDelta，故此字段为 undefined） */
  debugDelta?: { deltaA: Delta; deltaB: Delta };
}

/** details JSON shape（隐藏判断 #3） */
interface ConflictLogDetails {
  schemaVersion: 1;
  baseVersion: number;
  currentVersion: number;
  resolution: ConflictLogResolution;
  report?: MergeReport;
  conflicts?: Conflict[];
  debugDelta?: {
    deltaA: ReturnType<typeof serializeDelta>;
    deltaB: ReturnType<typeof serializeDelta>;
  };
  truncated?: boolean;
}

/**
 * 写入 conflict_logs 一条记录（同事务）。
 *
 * 必须在 saveCanvas 主事务内调用。INSERT 失败抛出，让事务回滚（隐藏判断 #6）。
 *
 * details 字段超过 64KB → 删 debugDelta + 加 truncated:true（serialize.ts maybeTruncateDetails 兜底）。
 */
export function logConflictResolution(db: DatabaseType, input: LogConflictInput): void {
  const detailsObject: ConflictLogDetails = {
    schemaVersion: 1,
    baseVersion: input.baseVersion,
    currentVersion: input.currentVersion,
    resolution: input.resolution,
  };
  if (input.report !== undefined) {
    detailsObject.report = input.report;
  }
  if (input.conflicts !== undefined) {
    detailsObject.conflicts = input.conflicts;
  }
  if (input.debugDelta !== undefined) {
    detailsObject.debugDelta = {
      deltaA: serializeDelta(input.debugDelta.deltaA),
      deltaB: serializeDelta(input.debugDelta.deltaB),
    };
  }

  const { json } = maybeTruncateDetails(detailsObject);

  db.prepare(
    `INSERT INTO conflict_logs
       (canvas_id, user_a_id, user_b_id, base_version, current_version, resolution, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.canvasId,
    input.userAId,
    input.userBId,
    input.baseVersion,
    input.currentVersion,
    input.resolution,
    json,
    Date.now()
  );
}
