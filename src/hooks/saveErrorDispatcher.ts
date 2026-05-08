// Day 4 F-16b：save() catch 块副作用 dispatcher（B 方案 + 04 范围判读审拍板 2/3）
//
// 04 范围判读审 codex spec-critique 拍板：(f)/(h) 不引入 RTL/jsdom，但不接受注释/grep 关闭——
// 把 save 结果分支处理或副作用 dispatcher 抽成可注入函数，用 node --test 覆盖关键决策。
//
// 抽象边界：
// - useMultiCanvas.save() catch 块两条路径（base_version_expired / conflict）+ 兜底 rethrow
// - 决策函数纯函数（无副作用 / 无 setter / 无网络），只产 plan
// - 类型层守门：每条 plan 的 `shouldDeleteDraft: false` 写成字面常量，绕过路径在编译期被堵
//   （仿 mergeSavePlan g1：DeferMergedPlan 类型上不能携带推进字段）
//
// (f)/(h) 落点（详见 02-拍板记录 § F-16 子断言映射表）：
//   (f2) base_version_expired 重载    → SaveErrorBaseVersionExpiredPlan
//   (f3) 409 conflict 携 conflicts     → SaveErrorConflictPlan
//   (h)  discardAndReload 不删草稿     → 两 plan 类型层 shouldDeleteDraft: false 字面常量
//
// 不在范围：(f1)(f4) 已被 mergeSavePlan 覆盖；(f5) canvasId 切换 discarded 是 try 块早退非 catch 决策。

import type { ApiError } from '../api/canvases';
import type { Conflict } from '../api/canvases.types';
import type { SaveResult } from './useMultiCanvas';

// ============================================================
// Plan 类型（discriminated union；类型层守门）
// ============================================================

/** base_version_expired 路径决策：服务端基线已变，客户端必须重载，但**保留草稿**给用户继续编辑 */
export interface SaveErrorBaseVersionExpiredPlan {
  action: 'base_version_expired';
  currentVersion: number;
  /** 类型层硬约束：base_version_expired 路径不允许调 apiDeleteDraft（(h) 关键断言）*/
  shouldDeleteDraft: false;
  /** 同步设给 conflict state 让 BFV 弹窗渲染 BaseVersionExpiredDialog */
  conflictReason: 'base_version_expired';
  /** save() 返回值 */
  returnValue: Extract<SaveResult, { status: 'base_version_expired' }>;
}

/** 真合并冲突路径决策：携带 conflicts 数组（apiFetch 已解析）让真冲突弹窗渲染 */
export interface SaveErrorConflictPlan {
  action: 'conflict';
  currentVersion: number;
  /** undefined fallback 由 BFV ConflictResolutionDialog 渲染层处理（D-12 文案落点）*/
  conflicts: Conflict[] | undefined;
  /** 类型层硬约束：真冲突路径同样不删草稿（与 base_version_expired 同策略）*/
  shouldDeleteDraft: false;
  conflictReason: 'conflict';
  returnValue: Extract<SaveResult, { status: 'conflict' }>;
}

/** 403 forbidden_remove_node / forbidden_delete_public_canvas：服务端拒删动作（v1.16.2 新增）。
 *
 * 触发条件（不应在前端层冒到这里——前端 canDeleteNodeData 已拦下；服务端是 fail-closed 兜底）：
 *   - 公共画布上普通用户删了已保存节点（节点入了 nodes_meta）
 *   - 普通用户软删整个公共画布（v1.16.1 server 收紧）
 *
 * 处理策略：弹 Toast 提示用户"无法删除——XX"，**不 setServerError**（避免触发 BFV [887] 兜底页），
 * 同时返回一个特殊 status 让 hook 触发 reload 撤销前端的"幽灵删除"。
 *
 * 不删草稿（与 base_version_expired / conflict 同款防御）：草稿包含用户其他改动。
 */
export interface SaveErrorForbiddenRemovePlan {
  action: 'forbidden_remove';
  /** 给用户看的中文文案；优先用 server message，没有则按 error code 兜底 */
  message: string;
  /** 类型层硬约束：forbidden_remove 不删草稿（与 base_version_expired 同策略）*/
  shouldDeleteDraft: false;
  returnValue: Extract<SaveResult, { status: 'forbidden_remove' }>;
}

/** 兜底：非 409 / 非 base_version_expired 的其他错误 → 让上游 throw 不归一为 SaveResult */
export interface SaveErrorRethrowPlan {
  action: 'rethrow';
  /** 透传原 error 给 hook 重抛，hook 不应替决策；保留语义 */
  error: ApiError;
}

export type SaveErrorPlan =
  | SaveErrorBaseVersionExpiredPlan
  | SaveErrorConflictPlan
  | SaveErrorForbiddenRemovePlan
  | SaveErrorRethrowPlan;

// ============================================================
// 决策函数（纯函数）
// ============================================================

/** 入参形状守卫：判定 input 是否符合 ApiError 形状。
 *
 * F-17 末尾审 M1 修法：apiFetch 已归一化网络/HTTP 错误为 ApiError，但 catch 块仍可能接到
 * 非 ApiError 抛出（如底层 TypeError / Object.assign 异常 / 第三方代码 throw 普通 Error）。
 * 不守门时 planSaveError 访问 .status 会二次异常，把原始错误掩盖。
 */
function isApiErrorShape(input: unknown): input is ApiError {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  return typeof obj.status === 'number' && typeof obj.error === 'string';
}

/** 输入任意 throw 值，输出 SaveErrorPlan。
 *
 * 决策树：
 *   0. 非 ApiError 形状（null/undefined/普通 Error/TypeError 等）→ rethrow（让 hook 兜底）
 *   1. 非 409 → rethrow（业务语义未定义）
 *   2. 409 + error='base_version_expired' + currentVersion 数字 → base_version_expired plan
 *   3. 409 + currentVersion 数字 → conflict plan
 *   4. 其他 409（无 currentVersion）→ rethrow（数据形状非法）
 *
 * 不在 dispatcher 范围：
 * - 网络异常（fetch reject）—— 已被 apiFetch 归一成 ApiError；非 ApiError 走 step 0 兜底
 * - canvasId 切换 discarded —— 是 try 块入口早退，不在 catch
 *
 * F-17 末尾审 M1 修法：入参从 ApiError 放宽为 unknown + 形状守卫（防御性兜底）。
 * rethrow plan 的 error 字段兼容 ApiError | unknown：调用方 hook 收到 rethrow 后用原始 err
 * 重抛（throw err 而非 throw errorPlan.error），守住旧语义不变。
 */
export function planSaveError(err: unknown): SaveErrorPlan {
  if (!isApiErrorShape(err)) {
    // F-17 M1：非 ApiError 形状 → rethrow，让 hook 用原始 err 重抛保留 stack trace
    // rethrow plan 的 error 字段在该路径不被消费（hook 只用它判断 action 走向），
    // 类型上记成最小 ApiError shape 兜底（status=0 / error='non_api_error'）以满足类型契约
    return {
      action: 'rethrow',
      error: { status: 0, error: 'non_api_error_shape' },
    };
  }

  // v1.16.2：403 forbidden_remove_node / forbidden_delete_public_canvas 友好处理
  if (err.status === 403) {
    if (err.error === 'forbidden_remove_node') {
      return {
        action: 'forbidden_remove',
        message: err.message ?? '公共画布上的节点只允许管理员物理删除。如不再需要，请使用"标废弃"代替。',
        shouldDeleteDraft: false,
        returnValue: { status: 'forbidden_remove', message: err.message ?? '' },
      };
    }
    if (err.error === 'forbidden_delete_public_canvas') {
      return {
        action: 'forbidden_remove',
        message: err.message ?? '只有管理员可以归档公共画布。',
        shouldDeleteDraft: false,
        returnValue: { status: 'forbidden_remove', message: err.message ?? '' },
      };
    }
    // 其他 403（如 forbidden_modify_others_node）→ rethrow（不在 dispatcher 范围；hook 兜底）
    return { action: 'rethrow', error: err };
  }

  if (err.status !== 409) {
    return { action: 'rethrow', error: err };
  }

  if (err.error === 'base_version_expired' && typeof err.currentVersion === 'number') {
    return {
      action: 'base_version_expired',
      currentVersion: err.currentVersion,
      shouldDeleteDraft: false,
      conflictReason: 'base_version_expired',
      returnValue: {
        status: 'base_version_expired',
        currentVersion: err.currentVersion,
      },
    };
  }

  if (typeof err.currentVersion === 'number') {
    return {
      action: 'conflict',
      currentVersion: err.currentVersion,
      conflicts: err.conflicts,
      shouldDeleteDraft: false,
      conflictReason: 'conflict',
      returnValue: {
        status: 'conflict',
        currentVersion: err.currentVersion,
        conflicts: err.conflicts,
      },
    };
  }

  // 409 但缺 currentVersion → 服务端响应形状非法（不应发生），让 hook 重抛
  return { action: 'rethrow', error: err };
}
