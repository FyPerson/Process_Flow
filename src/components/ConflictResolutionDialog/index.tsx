// Day 4 F-9 + D-pre-1 + D-1 + D-2 + D-5 + D-7 + D-12 + D-15：真冲突弹窗（4B 流程）
//
// 三按钮（D-pre-1）：
// - 保存草稿并查看最新版本（D-1：主动 PUT draft 后 reload；PUT 失败保留弹窗 + dirty）
// - 继续编辑草稿（D-2：调 hook clearConflictAndResumeAutosave；不动 server-side state）
// - 取消（D-14：关弹窗保留 conflict state；BFV 顶栏显示「冲突待处理」可重开弹窗）
//
// 设计决策：
// - **React Portal 挂 document.body**（D-10）
// - **aria-modal=true**（D-5 + H5）；ESC 不隐式关闭（用户必须显式选三按钮之一）
// - **pending 中 disable 全部按钮**（D-15 + X3 + A2）
// - **conflicts undefined fallback**（D-12 + L2 调整）：保留三按钮，详情区显示 fallback 文案
// - **conflicts 列表 max-height + scroll**（D-10）；50+ 条不做 virtualize（< 100 用户场景下不会爆量）

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Conflict, ConflictType } from '../../api/canvases.types';
import './styles.css';

interface Props {
  /** 服务端返回的真冲突数组；undefined = 服务端 409 但 conflicts 字段缺失（防御 fallback） */
  conflicts: Conflict[] | undefined;
  /** 服务端 currentVersion（显示「服务端 vN」让用户知道差距） */
  currentVersion: number;
  /** 「保存草稿并查看最新版本」按钮（D-1：先 PUT draft 成功后 reload；失败 caller 自己处理） */
  onSaveDraftAndReload: () => Promise<void>;
  /** 「继续编辑草稿」按钮（D-2：caller 调 hook.clearConflictAndResumeAutosave；不动 server state） */
  onContinueEdit: () => void;
  /** 「取消」按钮（D-14：caller 关弹窗保留 conflict state；BFV 顶栏显示可重开） */
  onCancel: () => void;
}

// ConflictType → 用户友好文案
const CONFLICT_TYPE_LABEL: Record<ConflictType, string> = {
  node_modified_both: '节点双方都改',
  node_deprecated_modified: '节点已废弃但被修改',
  node_removed_modified: '节点已删除但被修改',
  node_removed_deprecated: '节点已删除但被废弃',
  node_id_collision: '节点 ID 冲突',
  node_meta_missing: '节点元信息缺失',
  edge_id_collision: '边 ID 冲突',
  edge_semantic_conflict: '边语义冲突（端点/类型）',
  edge_modified_both: '边双方都改',
  edge_removed_modified: '边已删除但被修改',
  edge_endpoint_removed_by_other: '边的端点被对方删除',
  sheet_id_collision: '工作表 ID 冲突',
  sheet_removed_modified: '工作表已删除但被修改',
  sheet_meta_conflict: '工作表元信息冲突',
  project_meta_conflict: '项目元信息冲突',
  active_sheet_missing: '当前工作表已被对方删除',
};

export function ConflictResolutionDialog({
  conflicts,
  currentVersion,
  onSaveDraftAndReload,
  onContinueEdit,
  onCancel,
}: Props) {
  // pending 状态守门（X3 + D-15）：任一按钮触发 await 期间禁用所有按钮
  const [pendingAction, setPendingAction] = useState<
    null | 'saveDraft' | 'continueEdit' | 'cancel'
  >(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 弹窗打开时聚焦主按钮（焦点管理）；ESC 不隐式关闭（H5）
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // 第一个 button 是「保存草稿并查看最新版本」（主操作）
    const firstButton = dialog.querySelector<HTMLButtonElement>('button.conflict-dialog-btn--primary');
    firstButton?.focus();

    // ESC 不隐式关闭（D-5 + H5）：监听并 stopPropagation 防止全局 ESC 处理器误关
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
      // 成功后 caller 通常 unmount 此弹窗（清 conflict state）；这里不主动 setPendingAction(null)
    } catch (err) {
      console.error('[ConflictResolutionDialog] saveDraft failed', err);
      setPendingAction(null);
      // PUT 失败 caller 自己处理（H1 落点：保留弹窗 + dirty）
    }
  };

  const handleContinueEdit = () => {
    if (pendingAction !== null) return;
    setPendingAction('continueEdit');
    onContinueEdit(); // 同步调用（D-2 是 hook setter 不需 await）
  };

  const handleCancel = () => {
    if (pendingAction !== null) return;
    setPendingAction('cancel');
    onCancel();
  };

  const isPending = pendingAction !== null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="conflict-dialog-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
      >
        <h3 id="conflict-dialog-title" className="conflict-dialog-title">
          检测到协作冲突
        </h3>
        <div className="conflict-dialog-body">
          <p className="conflict-dialog-summary">
            另一位编辑者已经更新了画布到 <strong>v{currentVersion}</strong>，
            你的本地改动与对方的改动有 {conflicts?.length ?? '?'} 处冲突无法自动合并。
          </p>

          {/* 冲突明细 — D-10 max-height + scroll */}
          {conflicts === undefined ? (
            // L2：conflicts undefined fallback（服务端 409 但缺 conflicts 字段）
            <div className="conflict-dialog-fallback">
              服务端未返回冲突明细，建议先保存草稿后查看最新版。
            </div>
          ) : conflicts.length === 0 ? (
            // 理论上不应发生（detector 4 段产 conflicts 至少一条才进 conflict 路径）
            // 但服务端可能因边缘 case 返空数组；同样走 fallback
            <div className="conflict-dialog-fallback">
              服务端冲突列表为空，建议先保存草稿后查看最新版。
            </div>
          ) : (
            <ul className="conflict-dialog-list">
              {conflicts.map((c, i) => (
                <li key={i} className="conflict-dialog-list-item">
                  <span className="conflict-dialog-list-type">
                    {CONFLICT_TYPE_LABEL[c.type] ?? c.type}
                  </span>
                  {c.sheetId && (
                    <span className="conflict-dialog-list-meta">
                      工作表 {c.sheetId}
                    </span>
                  )}
                  {c.targetId && (
                    <span className="conflict-dialog-list-meta">
                      ID: <code>{c.targetId}</code>
                    </span>
                  )}
                  {c.field && (
                    <span className="conflict-dialog-list-meta">字段: {c.field}</span>
                  )}
                  {c.message && (
                    <span className="conflict-dialog-list-message">{c.message}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="conflict-dialog-help">
            <strong>建议操作：</strong>
            <br />
            点击「保存草稿并查看最新版本」会把当前编辑保存为草稿、重载对方最新版本，之后再决定如何合并；
            <br />
            点击「继续编辑草稿」会保留当前改动并恢复自动保存（下次保存时服务端会再次尝试合并）。
          </p>
        </div>
        <div className="conflict-dialog-actions">
          <button
            type="button"
            className="conflict-dialog-btn conflict-dialog-btn--primary"
            onClick={handleSaveDraft}
            disabled={isPending}
          >
            {pendingAction === 'saveDraft' ? '处理中…' : '保存草稿并查看最新版本'}
          </button>
          <button
            type="button"
            className="conflict-dialog-btn"
            onClick={handleContinueEdit}
            disabled={isPending}
          >
            继续编辑草稿
          </button>
          <button
            type="button"
            className="conflict-dialog-btn conflict-dialog-btn--ghost"
            onClick={handleCancel}
            disabled={isPending}
          >
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
