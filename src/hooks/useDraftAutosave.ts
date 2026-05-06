// 草稿自动保存 hook（阶段 4 P4D，方案 §4.6 + 判断点 1/3/4/5/7）
//
// 职责：
// - 30s 定时器 + canonical JSON diff 检测；变化 → PUT /api/canvases/:cid/draft
// - visibilitychange to hidden / pagehide → fetch keepalive 兜底（判断点 5）
// - 一次性 localStorage 迁移检测（判断点 3）：旧 'saved-flow-data' 命中则回调 onLegacyLocalStorageDetected
// - 状态文案上报 onStatusChange，供顶栏显示（判断点 4：'idle' / 'saving' / 'saved' / 'failed' / 'too_large' / 'quota'）
//
// 设计约束：
// - canonical：先按 sheets[].id 升序、sheet.nodes[].id 升序、sheet.connectors[].id 升序后 stringify（判断点 1）
// - dirty 不由本 hook 清（判断点 4）：草稿保存只更新自己的 status，dirty 由主版本保存清
// - 失败状态保留 dirty=true，下个 30s 周期重试（判断点 3 codex 补充）
// - 配额/超大错误不重试（避免刷屏）：状态切到 too_large/quota 后，定时器跳过 PUT 直到 data 变化重新进入 saving

import { useEffect, useRef, useState } from 'react';
import { putDraft, type ApiError } from '../api/canvases';
import type { MultiCanvasProject, CanvasSheet, FlowConnector } from '../types/flow';

const DRAFT_AUTOSAVE_INTERVAL_MS = 30_000;
const LEGACY_LOCAL_STORAGE_KEY = 'saved-flow-data';
// fetch keepalive 浏览器实测限制约 64KB；超过此阈值的卸载兜底直接跳过
// （codex P4 二审 #4：避免给 2MB 草稿提供不存在的可靠性承诺）
const KEEPALIVE_PAYLOAD_MAX_BYTES = 60 * 1024; // 60KB 留 4KB 余量给 headers

// ===========================================================================
// 跨 hook 协同（codex P4 二审 #3）：主版本保存时暂停草稿 PUT，避免顺序冲突
// useMultiCanvas.save() 启动时调 pauseDraftAutosave 让 30s tick 跳过；
// save 成功（含 DELETE draft）后调 resumeDraftAutosave。
// 用模块级 ref 跨 hook 共享，避免 React Context 跨多个 hook 的复杂度
// ===========================================================================

const moduleScopedPauseUntilRef = { current: 0 };

export function pauseDraftAutosave(durationMs = 5000): void {
  moduleScopedPauseUntilRef.current = Date.now() + durationMs;
}

export function resumeDraftAutosave(): void {
  moduleScopedPauseUntilRef.current = 0;
}

// 主版本保存成功后：清空所有 useDraftAutosave 实例的 snapshot 基线
// 避免下一轮 30s tick 用旧基线和当前 project 比 → 没变 → no_changes
// 然后接下来用户改一点 → diff 命中 → PUT，但服务端已 DELETE 了，再 PUT 又复活草稿
// 解：保存成功后强制下一轮 tick 重新抓 baseline（认为"已 sync"），等用户实际改才 PUT
const moduleScopedSnapshotResetVersion = { current: 0 };

export function resetDraftAutosaveSnapshot(): void {
  moduleScopedSnapshotResetVersion.current += 1;
}

export type DraftStatus =
  | 'idle' // 未启动 / 已 unmount
  | 'no_changes' // 启动但本周期无变更
  | 'saving' // PUT 进行中
  | 'saved' // 上次 PUT 成功
  | 'failed' // 网络/服务端失败，下周期重试
  | 'too_large' // 单画布 > 2MB；不再尝试，等 data 缩小
  | 'quota'; // 用户草稿数 ≥ 200；不再尝试，等用户清理

export interface UseDraftAutosaveOptions {
  /** 画布 id；null 表示本地草稿模式（不上报）*/
  canvasId: number | null;
  /** 当前主版本 version（草稿基于这个版本号；服务端 baseVersion 字段）*/
  baseVersion: number | null;
  /** 当前 project；本 hook 不修改它，只读取 + canonical stringify */
  project: MultiCanvasProject | null;
  /** 启用开关；游客 / readOnly / 无 user 时禁用 */
  enabled: boolean;
  /** 一次性迁移检测命中（旧 localStorage 'saved-flow-data' 存在）— 由 caller 弹恢复弹窗 */
  onLegacyLocalStorageDetected?: (data: string) => void;
}

export interface UseDraftAutosaveReturn {
  status: DraftStatus;
  /** 上次成功的 PUT draft 时间戳（用于顶栏"草稿已保存 14:23"展示）*/
  lastSavedAt: number | null;
}

/**
 * 把 MultiCanvasProject 序列化为 canonical JSON
 * （sheets/nodes/connectors 都按 id 升序排序，避免数组重排导致假阳性 diff）
 *
 * 判断点 1 决策：选 canonical 而非浅比，准确捕获深层 detailConfig/data 变更
 */
export function canonicalizeProject(project: MultiCanvasProject): string {
  const sortedSheets: CanvasSheet[] = [...project.sheets]
    .map((sheet) => ({
      ...sheet,
      nodes: [...(sheet.nodes ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
      connectors: [...(sheet.connectors ?? [])].sort((a: FlowConnector, b: FlowConnector) =>
        a.id.localeCompare(b.id),
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({ ...project, sheets: sortedSheets });
}

export function useDraftAutosave(options: UseDraftAutosaveOptions): UseDraftAutosaveReturn {
  const { canvasId, baseVersion, project, enabled, onLegacyLocalStorageDetected } = options;

  const [status, setStatus] = useState<DraftStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // 上次成功 PUT 时的 canonical 字符串（用于 diff）
  const lastSnapshotRef = useRef<string | null>(null);
  const inflightRef = useRef(false);
  // ref-stable inputs（codex P4 二审 #1）：tick 从 ref 读 project/baseVersion/canvasId，
  // 避免 project 变化重启 interval 导致"最后一次编辑后 30s 才 PUT"
  const projectRef = useRef(project);
  const baseVersionRef = useRef(baseVersion);
  const canvasIdRef = useRef(canvasId);
  // codex P4 二审 #5：canvasId 变化时重置 lastSnapshotRef 不依赖组件 unmount
  const lastCanvasIdRef = useRef<number | null>(canvasId);
  // 监听主版本保存触发的 snapshot 重置（resetDraftAutosaveSnapshot 调用后下一轮 tick 重抓基线）
  const lastSeenResetVersionRef = useRef<number>(moduleScopedSnapshotResetVersion.current);
  // codex P4 二审 #2：413/429 后阻塞同 snapshot 重试，等 snapshot 变化清阻塞
  const blockedSnapshotRef = useRef<string | null>(null);
  const blockedReasonRef = useRef<'too_large' | 'quota' | null>(null);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    baseVersionRef.current = baseVersion;
  }, [baseVersion]);
  useEffect(() => {
    canvasIdRef.current = canvasId;
  }, [canvasId]);

  // ---- 一次性 localStorage 迁移检测（判断点 3 codex 补充）----
  // 用 ref 保证只触发一次，避免 enabled 切换时多次回调
  const legacyCheckedRef = useRef(false);
  useEffect(() => {
    if (legacyCheckedRef.current) return;
    legacyCheckedRef.current = true;
    if (typeof localStorage === 'undefined') return;
    try {
      const legacy = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
      if (legacy && onLegacyLocalStorageDetected) {
        onLegacyLocalStorageDetected(legacy);
      }
    } catch {
      // localStorage 访问失败（隐私模式等）→ silent
    }
  }, [onLegacyLocalStorageDetected]);

  // ---- canvasId 变化时重置 snapshot 基线（codex P4 二审 #5）----
  // 切画布不依赖组件 unmount——直接代码保护，避免用旧画布 snapshot 与新画布比导致
  // 写入"初始草稿"
  useEffect(() => {
    if (lastCanvasIdRef.current !== canvasId) {
      lastCanvasIdRef.current = canvasId;
      lastSnapshotRef.current = null;
      blockedSnapshotRef.current = null;
      blockedReasonRef.current = null;
    }
  }, [canvasId]);

  // ---- 30s 定时器主循环（ref-stable，不被 project 变化重启）----
  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      lastSnapshotRef.current = null;
      blockedSnapshotRef.current = null;
      blockedReasonRef.current = null;
      return;
    }
    if (canvasId === null) {
      setStatus('idle');
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (inflightRef.current) return;
      if (Date.now() < moduleScopedPauseUntilRef.current) return; // 主版本保存中暂停

      const cur = projectRef.current;
      const cid = canvasIdRef.current;
      const bv = baseVersionRef.current;
      if (cur === null || cid === null || bv === null) return;

      // 主版本保存成功 → resetDraftAutosaveSnapshot 触发，下一轮 tick 重抓基线
      // 避免 DELETE draft 后旧 snapshot 与当前 project 仍 diff 命中 → PUT 把刚 DELETE 的草稿重建
      if (
        lastSeenResetVersionRef.current !== moduleScopedSnapshotResetVersion.current
      ) {
        lastSeenResetVersionRef.current = moduleScopedSnapshotResetVersion.current;
        lastSnapshotRef.current = canonicalizeProject(cur);
        blockedSnapshotRef.current = null;
        blockedReasonRef.current = null;
        setStatus('no_changes');
        return;
      }

      const snapshot = canonicalizeProject(cur);

      // 启动时先以当前快照为基准（避免首次 tick PUT 一份"初始草稿"）
      if (lastSnapshotRef.current === null) {
        lastSnapshotRef.current = snapshot;
        setStatus('no_changes');
        return;
      }

      // 阻塞快照检查：413/429 后同 snapshot 不重试（codex P4 二审 #2）
      if (
        blockedSnapshotRef.current === snapshot &&
        blockedReasonRef.current !== null
      ) {
        return; // 状态已是 too_large/quota；data 没变就不刷
      }

      if (snapshot === lastSnapshotRef.current) {
        setStatus((prev) => (prev === 'saved' || prev === 'no_changes' ? prev : 'no_changes'));
        return;
      }

      // snapshot 变化 → 清阻塞
      blockedSnapshotRef.current = null;
      blockedReasonRef.current = null;

      inflightRef.current = true;
      setStatus('saving');
      try {
        await putDraft(cid, snapshot, bv);
        if (cancelled) return;
        // 主版本保存可能在 PUT 期间发生；如果 pauseUntilRef 此时被设置，
        // 不更新 lastSnapshotRef 也不报 saved（避免和 DELETE draft 顺序冲突）
        if (Date.now() < moduleScopedPauseUntilRef.current) {
          setStatus('failed');
          return;
        }
        lastSnapshotRef.current = snapshot;
        setLastSavedAt(Date.now());
        setStatus('saved');
      } catch (err) {
        if (cancelled) return;
        const apiErr = err as ApiError;
        if (apiErr?.status === 413) {
          blockedSnapshotRef.current = snapshot;
          blockedReasonRef.current = 'too_large';
          setStatus('too_large');
        } else if (apiErr?.status === 429) {
          blockedSnapshotRef.current = snapshot;
          blockedReasonRef.current = 'quota';
          setStatus('quota');
        } else {
          setStatus('failed');
        }
        console.warn('[draft autosave] put failed', apiErr);
      } finally {
        inflightRef.current = false;
      }
    };

    const timer = setInterval(tick, DRAFT_AUTOSAVE_INTERVAL_MS);

    // ---- 卸载兜底（codex P4 二/三审 #4 + #3-b）：keepalive 仅在小 payload + 非 pause 期发 ----
    const flushOnUnload = () => {
      // 主版本保存中暂停草稿（codex P4 三审 #3-b）：visibilitychange/pagehide 不能绕过 pause
      if (Date.now() < moduleScopedPauseUntilRef.current) return;
      // PUT 在途：避免并发发送第二个 PUT
      if (inflightRef.current) return;
      const cur = projectRef.current;
      const cid = canvasIdRef.current;
      const bv = baseVersionRef.current;
      if (cur === null || cid === null || bv === null) return;
      const snapshot = canonicalizeProject(cur);
      if (snapshot === lastSnapshotRef.current) return;
      const bytes = new Blob([snapshot]).size;
      if (bytes > KEEPALIVE_PAYLOAD_MAX_BYTES) {
        // 大草稿 keepalive 不可靠 → 跳过 + 顶栏 UI 反馈（codex P4 三审 medium 12）
        // status='failed' 让"草稿保存失败（重试中）"提示用户，下次正常 30s tick 仍会尝试
        setStatus('failed');
        console.warn(
          '[draft autosave] payload too large for keepalive flush, skipping',
          { bytes, threshold: KEEPALIVE_PAYLOAD_MAX_BYTES },
        );
        return;
      }
      void putDraft(cid, snapshot, bv, { keepalive: true }).catch(() => {
        // 兜底失败不弹错
      });
    };

    const onVisibility = () => {
      if (document.hidden) flushOnUnload();
    };
    const onPagehide = () => flushOnUnload();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPagehide);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPagehide);
    };
    // 关键：不依赖 project / baseVersion；只在 enabled / canvasId 变化时重启
  }, [enabled, canvasId]);

  return { status, lastSavedAt };
}
