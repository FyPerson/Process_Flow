// 阶段 5 Day 3 D-3 — 客户端 SaveCanvasResult / Conflict / MergeReport 类型镜像
//
// 拍板依据：[Day3-客户端/01-取舍审-客户端接合并响应+conflict_logs.md](../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day3-客户端/01-取舍审-客户端接合并响应+conflict_logs.md)
//
// 关键约定（codex 判断点 7 选项 C）：
// - 客户端不能 import server/，故镜像类型而非共享
// - 必须有契约测试守住"镜像与 server 真类型 shape 一致"，避免漂移
// - 类型镜像放 src/api/ 同目录（与 canvases.ts 平级），不进 server/
//
// 与 server/services/canvases.ts SaveCanvasResult / server/services/merge/types.ts 的对齐：
// - 任何字段加减都必须同步 server/ + 跑契约测试

import type { MultiCanvasProject } from '../types/flow.ts';

/** 镜像 server/services/merge/types.ts ConflictType（16 项）
 *  反向验证已通过：删任一值会让 contract test tsc 报错（验证日期 2026-05-07） */
export type ConflictType =
  | 'node_modified_both'
  | 'node_deprecated_modified'
  | 'node_removed_modified'
  | 'node_removed_deprecated'
  | 'node_id_collision'
  | 'node_meta_missing'
  | 'edge_id_collision'
  | 'edge_semantic_conflict'
  | 'edge_modified_both'
  | 'edge_removed_modified'
  | 'edge_endpoint_removed_by_other'
  | 'sheet_id_collision'
  | 'sheet_removed_modified'
  | 'sheet_meta_conflict'
  | 'project_meta_conflict'
  | 'active_sheet_missing';

/** 镜像 server/services/merge/types.ts Conflict */
export interface Conflict {
  type: ConflictType;
  sheetId?: string;
  targetId?: string;
  field?: string;
  message?: string;
}

/** 镜像 server/services/merge/types.ts MergeWarning */
export interface MergeWarning {
  type: 'edge_dropped_dangling_endpoint';
  sheetId: string;
  edgeId: string;
  missingEndpoint: string;
  missingEndpointSide: 'source' | 'target';
}

/** 镜像 server/services/merge/types.ts MergeReport */
export interface MergeReport {
  nodesAddedCount: number;
  nodesModifiedCount: number;
  nodesDeprecatedCount: number;
  nodesRemovedCount: number;
  edgesAddedCount: number;
  edgesModifiedCount: number;
  edgesRemovedCount: number;
  warnings: MergeWarning[];
  mergedFromUserId: number | null;
  mergedFromUsername: string | null;
  mergedFromVersion: number;
}

/** 镜像 server/services/canvases.ts SaveCanvasResult（成功子集 — 客户端只关心 200/204 路径；
 *  失败路径走 ApiError 而非返回值）
 *
 *  Day 3 D-3 收紧：merged=true 时携 mergedData / mergedFromVersion / report；
 *  merged=false 时只 version。 */
export type SaveCanvasResultClient =
  | { ok: true; version: number; merged: false }
  | {
      ok: true;
      version: number;
      merged: true;
      mergedData: MultiCanvasProject;
      mergedFromVersion: number;
      report: MergeReport;
    };
