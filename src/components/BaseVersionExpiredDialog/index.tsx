// Day 4 F-10 + D-9 + A1：base_version_expired 独立弹窗
//
// 与 ConflictResolutionDialog 的语义区别（M4 + A1）：
// - ConflictResolutionDialog：detector 4 段产真冲突 → 用户可以「继续编辑草稿」让服务端下次再合并
// - BaseVersionExpiredDialog：客户端 baseVersion 太旧（canvas_versions 已被清理）→ **无法走合并**
//   用户只能：A. 保存草稿后重载；B. 留在草稿但不恢复 autosave（A1：onStayInDraft 不调 hook 恢复）
//
// 复用 conflict-dialog 的 CSS 类名（DRY；UI 风格一致）

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './styles.css';

interface Props {
  /** 服务端 currentVersion（让用户知道差距） */
  currentVersion: number;
  /** 「保存草稿后重载」按钮（先 PUT draft 成功后 reload；A1 与 conflict 弹窗同语义） */
  onSaveDraftAndReload: () => Promise<void>;
  /** 「留在草稿」按钮（A1：只关弹窗，**不**调 hook 恢复 autosave；用户必须手动 reload 才能继续保存） */
  onStayInDraft: () => void;
}

export function BaseVersionExpiredDialog({
  currentVersion,
  onSaveDraftAndReload,
  onStayInDraft,
}: Props) {
  const [pendingAction, setPendingAction] = useState<null | 'saveDraft' | 'stayInDraft'>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 焦点管理 + ESC 不隐式关闭（与 ConflictResolutionDialog 同策略）
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const firstButton = dialog.querySelector<HTMLButtonElement>('button.bve-dialog-btn--primary');
    firstButton?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const handleSaveDraft = async () => {
    if (pendingAction !== null) return;
    setPendingAction('saveDraft');
    try {
      await onSaveDraftAndReload();
    } catch (err) {
      console.error('[BaseVersionExpiredDialog] saveDraft failed', err);
      setPendingAction(null);
    }
  };

  const handleStayInDraft = () => {
    if (pendingAction !== null) return;
    setPendingAction('stayInDraft');
    onStayInDraft();
  };

  const isPending = pendingAction !== null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="bve-dialog-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="bve-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bve-dialog-title"
      >
        <h3 id="bve-dialog-title" className="bve-dialog-title">
          画布历史版本已超出可合并范围
        </h3>
        <div className="bve-dialog-body">
          <p>
            服务端版本已更新到 <strong>v{currentVersion}</strong>，
            而你的本地草稿基于的版本太旧（已超出系统保留的合并范围）。
            <strong>无法自动合并</strong>双方改动。
          </p>
          <p className="bve-dialog-warning">
            ⚠️ 你的本地草稿已保留。可以选择：
          </p>
          <ul className="bve-dialog-list">
            <li>
              <strong>保存草稿后重载</strong>：把当前编辑保存为草稿、重载服务端最新版本，
              你之后可以从「草稿恢复」继续工作（推荐）。
            </li>
            <li>
              <strong>留在草稿</strong>：保持当前画布显示不变，但
              <strong>自动保存仍处于停用状态</strong>，
              你需要手动重载最新版本后才能恢复保存。
            </li>
          </ul>
        </div>
        <div className="bve-dialog-actions">
          <button
            type="button"
            className="bve-dialog-btn bve-dialog-btn--primary"
            onClick={handleSaveDraft}
            disabled={isPending}
          >
            {pendingAction === 'saveDraft' ? '处理中…' : '保存草稿后重载'}
          </button>
          <button
            type="button"
            className="bve-dialog-btn bve-dialog-btn--ghost"
            onClick={handleStayInDraft}
            disabled={isPending}
          >
            留在草稿
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
