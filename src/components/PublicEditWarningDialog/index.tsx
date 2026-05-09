// PublicEditWarningDialog —— 普通用户载入公共画布时的编辑警告
//
// 用户行为决议（codex 取舍审 H2 + M3）：
// - 主推荐「复制为我的私人画布」→ onCopyToPrivate（弹 prompt 命名 + createOnServer）
// - 次选「继续编辑公共画布」→ 必须勾选「我了解修改会自动保存并对所有人可见」复选框
//   然后才点击「继续编辑」启用 → onAckAndContinueEdit（写 sessionStorage + 解禁 effective writable）
// - 第三项「只查看公共画布」→ onViewOnly（关弹窗但保持 readOnly；不写 sessionStorage）
//
// codex M3：「继续编辑」加 checkbox 防一键穿透，避免 sessionStorage 5s 后 autosave 误改公共画布
// codex H2：第三项不要做"切走本地草稿"语义；用"只查看"明确语义，不强制带离当前画布
//
// 与 BaseVersionExpiredDialog / ConflictResolutionDialog 同风格 + Portal 挂 document.body

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './styles.css';

interface Props {
  /** 当前公共画布的名字（仅用于文案） */
  canvasName: string;
  /** 「复制为我的私人画布」按钮 */
  onCopyToPrivate: () => void;
  /** 「继续编辑公共画布」（仅在勾选 confirm checkbox 后启用） */
  onAckAndContinueEdit: () => void;
  /** 「只查看公共画布」（关弹窗保持 readOnly，不切走） */
  onViewOnly: () => void;
}

export function PublicEditWarningDialog({
  canvasName,
  onCopyToPrivate,
  onAckAndContinueEdit,
  onViewOnly,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 焦点 + ESC 不隐式关闭（与 BVE / CRD 同策略）
  // codex 末尾审 L3：document capture + stopPropagation = modal 独占键盘事件**有意设计**。
  // 弹窗显示期间页面其他 ESC 监听（如其他 dialog）不会收到事件。这与"必须显式选择 3 个动作"
  // 语义一致——若未来需要叠弹窗，应引入弹窗层级管理而不是多个 capture 监听互相抢事件。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const firstButton = dialog.querySelector<HTMLButtonElement>('button.pew-dialog-btn--primary');
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

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="pew-dialog-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="pew-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pew-dialog-title"
      >
        <h3 id="pew-dialog-title" className="pew-dialog-title">
          ⚠️ 你正在打开公共画布「{canvasName}」
        </h3>
        <div className="pew-dialog-body">
          <p>
            <strong>公共画布上的修改会立即对所有人可见</strong>，
            而且大部分内容（节点标题、字段、连线）一旦改动后无法删除。
          </p>
          <p>如果只是想试着改改、做个人草稿，建议先复制到你的私人画布上操作：</p>
        </div>
        <div className="pew-dialog-actions pew-dialog-actions--primary">
          <button
            type="button"
            className="pew-dialog-btn pew-dialog-btn--primary"
            onClick={onCopyToPrivate}
          >
            📋 复制为我的私人画布
          </button>
          <button
            type="button"
            className="pew-dialog-btn"
            onClick={onViewOnly}
          >
            👀 只查看公共画布
          </button>
        </div>

        <div className="pew-dialog-divider">或者</div>

        <div className="pew-dialog-confirm">
          <label className="pew-dialog-confirm-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              我了解修改会<strong>自动保存并对所有人可见</strong>，
              我确认要直接编辑公共画布
            </span>
          </label>
          <button
            type="button"
            className="pew-dialog-btn pew-dialog-btn--ghost"
            onClick={onAckAndContinueEdit}
            disabled={!confirmed}
            title={confirmed ? '继续编辑公共画布' : '请先勾选确认复选框'}
          >
            继续编辑公共画布
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
