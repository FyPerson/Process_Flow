// useDraftRecovery（阶段 4 P4E，方案 §4.6 + 判断点 2/3）
//
// 职责：
// 1. 打开服务端画布时 GET /api/canvases/:cid/draft；命中（200）→ 弹恢复弹窗
// 2. localStorage 一次性迁移检测命中（旧 'saved-flow-data'）→ 弹同款弹窗（source=legacy_local_storage）
// 3. 恢复 → 解析 draft.data 调 onRestore；放弃 → DELETE draft（或 removeItem legacy）；留着 → 仅关弹窗
//
// 调用方约束：
// - 服务端画布：传 canvasId/currentVersion/onRestore；hook 自己拉草稿
// - localStorage 迁移：先用 useDraftAutosave 的 onLegacyLocalStorageDetected 回调收到 legacy 字符串后调用 markLegacyDraft

import { useCallback, useEffect, useState } from 'react';
import {
  deleteDraft as apiDeleteDraft,
  getDraft as apiGetDraft,
  type ApiError,
} from '../api/canvases';
import type { DraftRecoveryInfo } from '../components/DraftRecoveryDialog';
import type { MultiCanvasProject } from '../types/flow';
import { isMultiCanvasProject } from '../types/flow';

const LEGACY_LOCAL_STORAGE_KEY = 'saved-flow-data';

export interface UseDraftRecoveryOptions {
  /** 当前服务端画布 id；null 表示本地草稿模式 */
  canvasId: number | null;
  /** 当前主版本 version；用于警告"草稿基于过期版本"*/
  currentVersion: number | null;
  /** 是否启用 */
  enabled: boolean;
  /** 用户点"恢复"时调用：传入解析后的 project；caller 用它替换当前 project */
  onRestore: (project: MultiCanvasProject) => void;
}

export interface UseDraftRecoveryReturn {
  /** 当前显示的恢复信息（null 表示无弹窗）*/
  recoveryInfo: DraftRecoveryInfo | null;
  /** 三个按钮 handler；只在 recoveryInfo 非 null 时调用 */
  handleRestore: () => void;
  handleDiscard: () => void;
  handleKeep: () => void;
  /** 标记本地有 legacy 草稿（来自 useDraftAutosave 检测）*/
  markLegacyDraft: (legacyJson: string) => void;
}

export function useDraftRecovery(
  options: UseDraftRecoveryOptions,
): UseDraftRecoveryReturn {
  const { canvasId, currentVersion, enabled, onRestore } = options;
  const [recoveryInfo, setRecoveryInfo] = useState<DraftRecoveryInfo | null>(null);
  const [pendingProject, setPendingProject] = useState<MultiCanvasProject | null>(null);
  const [legacyJson, setLegacyJson] = useState<string | null>(null);

  // ---- 服务端草稿检测 ----
  useEffect(() => {
    if (!enabled || canvasId === null || currentVersion === null) {
      // 切走或禁用时不主动清弹窗——让用户先处理；caller 切 canvas 触发 unmount 自然清
      return;
    }
    let cancelled = false;
    apiGetDraft(canvasId)
      .then((draft) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(draft.data);
          if (!isMultiCanvasProject(parsed)) {
            console.warn('[draft recovery] draft.data 不是 MultiCanvasProject；跳过');
            return;
          }
          setPendingProject(parsed);
          setRecoveryInfo({
            baseVersion: draft.baseVersion,
            currentVersion,
            savedAt: draft.savedAt,
            source: 'server',
          });
        } catch (err) {
          console.warn('[draft recovery] draft.data parse 失败', err);
        }
      })
      .catch((err) => {
        const apiErr = err as ApiError;
        // 404 / no_draft 是正常情况
        if (apiErr?.status !== 404) {
          console.warn('[draft recovery] GET draft failed', apiErr);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, canvasId, currentVersion]);

  // ---- legacy localStorage 检测（来自 useDraftAutosave 回调）----
  const markLegacyDraft = useCallback((json: string) => {
    setLegacyJson(json);
    try {
      const parsed = JSON.parse(json);
      if (!isMultiCanvasProject(parsed)) {
        console.warn('[draft recovery] legacy localStorage 不是 MultiCanvasProject；跳过');
        return;
      }
      setPendingProject(parsed);
      setRecoveryInfo({
        baseVersion: 0, // legacy 无版本概念
        currentVersion: currentVersion ?? 0,
        savedAt: 0, // legacy 没保存时间，UI 会根据 source 不显示时间
        source: 'legacy_local_storage',
      });
    } catch (err) {
      console.warn('[draft recovery] legacy localStorage parse 失败', err);
    }
  }, [currentVersion]);

  const handleRestore = useCallback(() => {
    if (!pendingProject) return;
    onRestore(pendingProject);
    // 不删服务端草稿——保留作"恢复后未提交主版本时再次离开还能再恢复"
    // 主版本保存成功后由 useMultiCanvas.save() 自动 DELETE draft
    setRecoveryInfo(null);
    setPendingProject(null);
    if (legacyJson !== null) {
      // legacy 一次性迁移：恢复后立即清 localStorage（避免下次又弹）
      try { localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY); } catch { /* ignore */ }
      setLegacyJson(null);
    }
  }, [onRestore, pendingProject, legacyJson]);

  const handleDiscard = useCallback(() => {
    if (recoveryInfo?.source === 'server' && canvasId !== null) {
      void apiDeleteDraft(canvasId).catch((err) => {
        console.warn('[draft recovery] DELETE draft failed', err);
      });
    }
    if (recoveryInfo?.source === 'legacy_local_storage') {
      try { localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY); } catch { /* ignore */ }
    }
    setRecoveryInfo(null);
    setPendingProject(null);
    setLegacyJson(null);
  }, [recoveryInfo, canvasId]);

  const handleKeep = useCallback(() => {
    setRecoveryInfo(null);
    setPendingProject(null);
    // legacy 留着 → 也不清 localStorage，下次重开还会弹
  }, []);

  return { recoveryInfo, handleRestore, handleDiscard, handleKeep, markLegacyDraft };
}
