// usePublicEditAck —— 公共画布编辑 ack 状态管理
//
// 用途：普通用户载入公共画布时，提示"修改会立即对所有人可见，
// 建议先复制到私人画布"。用户主动确认（或选"只查看"）前，强制 readOnly。
//
// 触发条件（全部满足才返回 shouldShowDialog=true）：
// - user 是普通用户（admin 编辑公共画布是日常，不弹）
// - canvasMetaState.kind === 'server'（避免 loading/local 抖动 — codex M1）
// - canvasId 非空 + project 非空 + !isProjectLoading（codex M1）
// - canvasMetaState.meta.visibility === 'public'
// - sessionStorage 没有此 (userId, canvasId) 的 ack 标记
//
// 三种状态决议：
// - acked=true：用户选过"继续编辑公共画布"（带强确认） → 解禁 effective writable
// - viewOnly=true：用户选过"只查看公共画布" → 关弹窗但保持 readOnly（codex H2）
// - 都为 false：未决议 → shouldShowDialog=true
//
// 不变量：
// - sessionStorage key 加 v1 命名空间（codex L1）
// - 切画布 / 切用户 → 自动重新评估（沿用新 (userId, canvasId) 的 ack 状态）
// - viewOnly 不写 sessionStorage（仅本次决议；下次进同画布还要弹 — 这是设计意图：
//   用户没主动确认编辑，每次重进都要重新提醒）

import { useCallback, useEffect, useState } from 'react';
import type { UserPublic } from '../auth/api';
import type { CanvasMetaState } from './useMultiCanvas';
import type { MultiCanvasProject } from '../types/flow';

export const ACK_KEY_PREFIX = 'bfv:public-edit-ack:v1:';

/** 导出供单测使用 */
export function ackKey(userId: number, canvasId: number): string {
  return `${ACK_KEY_PREFIX}${userId}:${canvasId}`;
}

function readAck(userId: number, canvasId: number): boolean {
  try {
    return sessionStorage.getItem(ackKey(userId, canvasId)) === '1';
  } catch {
    // sessionStorage 不可用（浏览器禁用 / 隐身模式）→ 视为未 ack；下游 fail-closed 走 readOnly
    return false;
  }
}

function writeAck(userId: number, canvasId: number): void {
  try {
    sessionStorage.setItem(ackKey(userId, canvasId), '1');
  } catch {
    // 写失败也不抛 —— 用户体验上当作"本次 session 内已 ack"（hook state 已更新）；
    // 下次刷新会重新弹（可接受）
  }
}

// ============================================================
// 纯函数：触发条件判定（导出供单测）
// ============================================================

interface PublicEditTriggerInputs {
  user: UserPublic | null;
  canvasMetaState: CanvasMetaState;
  canvasId: number | null;
  project: MultiCanvasProject | null;
  isProjectLoading: boolean;
}

/** 是否进入"公共画布编辑警告"判定 — 纯函数，方便单测穷举矩阵
 * codex 取舍审 M1：必须同时满足
 *   - user 非空且非 admin
 *   - canvasMetaState.kind === 'server' && visibility === 'public'
 *   - canvasId 非空
 *   - project 非空
 *   - !isProjectLoading
 */
export function isPublicCanvasReady(input: PublicEditTriggerInputs): boolean {
  const { user, canvasMetaState, canvasId, project, isProjectLoading } = input;
  if (user === null) return false;
  if (user.role === 'admin') return false;
  if (canvasMetaState.kind !== 'server') return false;
  if (canvasMetaState.meta.visibility !== 'public') return false;
  if (canvasId === null) return false;
  if (project === null) return false;
  if (isProjectLoading) return false;
  return true;
}

export interface UsePublicEditAckOptions {
  user: UserPublic | null;
  canvasMetaState: CanvasMetaState;
  canvasId: number | null;
  project: MultiCanvasProject | null;
  isProjectLoading: boolean;
}

export interface UsePublicEditAckReturn {
  /** 是否显示警告弹窗 */
  shouldShowDialog: boolean;
  /** 当前是否处于"未 ack 公共画布"态（用于覆盖 canvasWritable + 锁 autosave） */
  isPublicAndUnacked: boolean;
  /** 用户点"继续编辑"（带强确认勾选）→ 写 sessionStorage + 关弹窗 */
  ackAndContinueEdit: () => void;
  /** 用户点"只查看公共画布"→ 仅关弹窗，不写 sessionStorage（保持 readOnly） */
  setViewOnly: () => void;
  /** ack key 后缀，用作 FlowCanvas key 的一部分触发 remount（M5 解法） */
  ackedKey: string;
}

export function usePublicEditAck(opts: UsePublicEditAckOptions): UsePublicEditAckReturn {
  const { user, canvasMetaState, canvasId, project, isProjectLoading } = opts;

  // 三态：'unknown' = 未决议 / 'acked' = 用户已确认编辑 / 'view-only' = 用户选只查看
  const [decision, setDecision] = useState<'unknown' | 'acked' | 'view-only'>('unknown');

  // 触发条件计算（codex 取舍审 M1：必须同时要求 server + canvasId + project + !loading）
  const ready = isPublicCanvasReady({
    user,
    canvasMetaState,
    canvasId,
    project,
    isProjectLoading,
  });

  // codex 末尾审 M1：依赖收敛到稳定标量 user.id（不要整个 user 对象）
  // 否则 AuthContext token refresh 替换等价 user 对象时，view-only 决议会被错误重置为 unknown
  const userId = user?.id ?? null;

  // 切 (userId, canvasId) → 重新读 sessionStorage 决议
  // 用 effect 而非 useMemo，因为 sessionStorage 是副作用读
  useEffect(() => {
    if (!ready || userId === null || canvasId === null) {
      setDecision('unknown');
      return;
    }
    if (readAck(userId, canvasId)) {
      setDecision('acked');
    } else {
      setDecision('unknown');
    }
  }, [ready, userId, canvasId]);

  const ackAndContinueEdit = useCallback(() => {
    if (userId === null || canvasId === null) return;
    writeAck(userId, canvasId);
    setDecision('acked');
  }, [userId, canvasId]);

  const setViewOnly = useCallback(() => {
    setDecision('view-only');
  }, []);

  const shouldShowDialog = ready && decision === 'unknown';
  const isPublicAndUnacked = ready && decision !== 'acked';

  // ackedKey 拼进 FlowCanvas key：仅在"是否解锁 readOnly"维度变化时 remount（M5 + 末尾审 L2）
  // 末尾审 L2：unknown / view-only 都是 readOnly，节点视觉不变 → 压缩到 'locked'
  // 仅在 acked → readOnly 解除时才需要 remount 让 useNodesState 用最新 readOnly 重初始化
  // 避免用户点"只查看"时丢失视口/选择态/面板状态
  const ackedKey =
    userId !== null && canvasId !== null
      ? `${userId}:${canvasId}:${decision === 'acked' ? 'acked' : 'locked'}`
      : 'none';

  return {
    shouldShowDialog,
    isPublicAndUnacked,
    ackAndContinueEdit,
    setViewOnly,
    ackedKey,
  };
}
