// SaveStatus —— 顶部画布工具栏的保存状态 + 操作按钮
//
// 状态机（互斥）：
//   - canvasId === null && project：    [另存到服务器]   （首次保存：弹 prompt 命名）
//   - saving:                            [保存中…]        （灰按钮）
//   - autoSaveDisabled && conflict:      ⚠️冲突 [立即保存] （手动点 → 弹 confirm）
//   - autoSaveDisabled && !conflict:     ⚠️失败 [重试]
//   - dirty:                             ● 未保存 [保存]
//   - 其他:                              ✓ 已保存 N 秒前
//
// 不依赖外部 UI 库；纯 React 文本节点渲染（XSS 安全）

import { useEffect, useState } from 'react';
import type { ApiError } from '../../api/canvases';
import './styles.css';

export interface SaveStatusProps {
  canvasId: number | null;
  hasProject: boolean;
  dirty: boolean;
  saving: boolean;
  autoSaveDisabled: boolean;
  conflict: { currentVersion: number } | null;
  serverError: ApiError | null;
  lastSavedAt: number | null;
  readOnly?: boolean;
  /** 已挂接画布 → 普通保存 */
  onSave: () => void;
  /** canvasId=null → 弹命名框 + createOnServer */
  onSaveAsNew: () => void;
  /** 冲突时点"丢弃本地、重载服务端" */
  onDiscardAndReload: () => void;
}

function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  return `${Math.floor(diff / 3600)} 小时前`;
}

export function SaveStatus(props: SaveStatusProps) {
  const {
    canvasId,
    hasProject,
    dirty,
    saving,
    autoSaveDisabled,
    conflict,
    serverError,
    lastSavedAt,
    readOnly,
    onSave,
    onSaveAsNew,
    onDiscardAndReload,
  } = props;

  // 让"X 秒前"自己刷新；只在 lastSavedAt 存在时跑定时器
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lastSavedAt) return;
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, [lastSavedAt]);

  if (readOnly) {
    return (
      <div className="save-status save-status--readonly" title="游客只读模式">
        只读
      </div>
    );
  }

  // 没项目数据时不显示
  if (!hasProject) {
    return null;
  }

  // 优先级 1：保存中
  if (saving) {
    return (
      <div className="save-status save-status--saving">
        <span className="save-status__dot save-status__dot--saving" />
        <span className="save-status__text">保存中…</span>
      </div>
    );
  }

  // 优先级 2：冲突
  if (autoSaveDisabled && conflict) {
    return (
      <div className="save-status save-status--conflict">
        <span className="save-status__icon">⚠️</span>
        <span className="save-status__text">
          有人改过了（服务端 v{conflict.currentVersion}）；本地改动暂未保存
        </span>
        <button
          type="button"
          className="save-status__btn save-status__btn--danger"
          onClick={onDiscardAndReload}
          title="丢弃本地改动，重新加载服务端版本（不可撤销）"
        >
          丢弃本地，重载服务端
        </button>
      </div>
    );
  }

  // 优先级 3：致命错误（非 409）
  if (autoSaveDisabled && serverError) {
    return (
      <div className="save-status save-status--error">
        <span className="save-status__icon">⚠️</span>
        <span
          className="save-status__text"
          title={serverError.message || serverError.error}
        >
          自动保存失败：{serverError.error}
        </span>
        <button
          type="button"
          className="save-status__btn save-status__btn--primary"
          onClick={onSave}
        >
          重试
        </button>
      </div>
    );
  }

  // 优先级 4：canvasId=null & 有改动 → 必须"另存到服务器"
  if (canvasId == null) {
    return (
      <div className="save-status save-status--unsaved">
        <span className="save-status__dot save-status__dot--dirty" />
        <span className="save-status__text">未保存到服务器</span>
        <button
          type="button"
          className="save-status__btn save-status__btn--primary"
          onClick={onSaveAsNew}
        >
          另存到服务器
        </button>
      </div>
    );
  }

  // 优先级 5：dirty
  if (dirty) {
    return (
      <div className="save-status save-status--unsaved">
        <span className="save-status__dot save-status__dot--dirty" />
        <span className="save-status__text">未保存</span>
        <button
          type="button"
          className="save-status__btn save-status__btn--primary"
          onClick={onSave}
        >
          保存
        </button>
      </div>
    );
  }

  // 优先级 6：已保存
  return (
    <div className="save-status save-status--saved">
      <span className="save-status__dot save-status__dot--saved" />
      <span className="save-status__text">
        已保存{lastSavedAt ? `（${formatRelative(lastSavedAt, now)}）` : ''}
      </span>
    </div>
  );
}
