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
import type { DraftStatus } from '../../hooks/useDraftAutosave';
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
  /** 导出服务端版本（GET /api/canvases/:id/export）；canvasId=null 时不应可见 */
  onExportServer?: () => void;
  /** 导出当前内存版本（冲突逃生口；用 hook 内的 project 序列化）*/
  onExportLocal?: () => void;
  // 阶段 4 P4D：草稿自动保存状态（由 useDraftAutosave 提供）
  /** 草稿状态；undefined 表示未启用（如游客 / 本地草稿模式）*/
  draftStatus?: DraftStatus;
  /** 草稿上次成功时间戳（用于"草稿已保存 14:23"展示）*/
  draftSavedAt?: number | null;
}

function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  return `${Math.floor(diff / 3600)} 小时前`;
}

/** 草稿状态的对外文案（判断点 4：UI 语义和主版本 dirty 拆开）*/
function formatDraftStatus(
  status: DraftStatus,
  draftSavedAt: number | null,
): string | null {
  switch (status) {
    case 'saving':
      return '正在保存草稿…';
    case 'saved':
      if (!draftSavedAt) return '草稿已保存';
      const d = new Date(draftSavedAt);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `草稿已保存 ${hh}:${mm}`;
    case 'failed':
      return '草稿保存失败（重试中）';
    case 'too_large':
      return '草稿过大（超 2MB），请简化画布';
    case 'quota':
      return '草稿数已达上限（200），请清理';
    case 'no_changes':
    case 'idle':
    default:
      return null;
  }
}

/** 把 ApiError.error 字面量映射成对用户可行动的中文文案 */
function formatServerError(err: ApiError): string {
  switch (err.error) {
    case 'network_error':
      return '网络连接失败，请检查网络后重试';
    case 'invalid_response':
      return '服务器返回异常，请稍后重试';
    case 'forbidden':
      return '没有权限保存此画布';
    case 'unauthorized':
      return '登录已过期，请重新登录';
    case 'not_found':
      return '画布已被删除或归档';
    case 'invalid_input':
      return '内容校验失败，请检查';
    default:
      return `保存失败：${err.error}${err.message ? `（${err.message}）` : ''}`;
  }
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
    onExportServer,
    onExportLocal,
    draftStatus,
    draftSavedAt,
  } = props;

  // 草稿状态文案（判断点 4：与主版本 dirty 拆开）
  const draftText = draftStatus ? formatDraftStatus(draftStatus, draftSavedAt ?? null) : null;
  const draftStatusElement = draftText ? (
    <span
      className={`save-status__draft save-status__draft--${draftStatus}`}
      title={
        draftStatus === 'failed'
          ? '草稿 PUT 失败；下个 30s 周期重试'
          : draftStatus === 'too_large'
            ? '单画布草稿不能超过 2MB'
            : draftStatus === 'quota'
              ? '当前用户草稿数已达 200 上限；请通过删除画布或主动保存来清理'
              : undefined
      }
    >
      {draftText}
    </span>
  ) : null;

  // 导出按钮：在所有状态都可见的复用片段（包括 readOnly）。
  // 仅当已挂接服务端画布时显示（canvasId != null）—— 没挂接时没什么可"导出服务端版本"
  const exportServerButton = canvasId != null && onExportServer ? (
    <button
      type="button"
      className="save-status__btn"
      onClick={onExportServer}
      title="下载当前画布的服务端 JSON 副本"
    >
      导出
    </button>
  ) : null;

  // 让"X 秒前"自己刷新；只在 lastSavedAt 存在时跑定时器
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lastSavedAt) return;
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, [lastSavedAt]);

  if (readOnly) {
    // 当前画布只读：保留导出能力（导出仅需 canRead 权限，不需要写权限）
    // P3D-2 step 2 codex 二审建议：原文案"游客只读模式"已不准确——
    // 只读现在可能源自 游客 / 归档画布 / 私有画布非 owner / 加载中 等多种原因
    return (
      <div className="save-status save-status--readonly" title="当前画布只读">
        <span>只读</span>
        {exportServerButton}
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
        {exportServerButton}
      </div>
    );
  }

  // 优先级 2：冲突
  // 这里两个导出按钮都给：
  //   - "导出本地副本"用内存数据（用户改动还没保存的版本，要保的就是这份）
  //   - "导出服务端版本"才是 server 当前 JSON（用户也可能想存一份做对比）
  if (autoSaveDisabled && conflict) {
    return (
      <div className="save-status save-status--conflict">
        <span className="save-status__icon">⚠️</span>
        <span className="save-status__text">
          有人改过了（服务端 v{conflict.currentVersion}）；本地改动暂未保存
        </span>
        {onExportLocal && (
          <button
            type="button"
            className="save-status__btn"
            onClick={onExportLocal}
            title="下载当前内存中的本地版本（含未保存改动）作为备份"
          >
            导出本地副本
          </button>
        )}
        {exportServerButton}
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
          title={`${serverError.error}${serverError.message ? ` - ${serverError.message}` : ''}`}
        >
          {formatServerError(serverError)}
        </span>
        <button
          type="button"
          className="save-status__btn save-status__btn--primary"
          onClick={onSave}
        >
          重试
        </button>
        {exportServerButton}
      </div>
    );
  }

  // 优先级 4：canvasId=null & 有改动 → 必须"另存到服务器"
  // 这种状态下没有 canvasId，没法导出服务端版本；但可以导出本地副本（如果 caller 提供了 onExportLocal）
  if (canvasId == null) {
    return (
      <div className="save-status save-status--unsaved">
        <span className="save-status__dot save-status__dot--dirty" />
        <span className="save-status__text">未保存到服务器</span>
        {onExportLocal && (
          <button
            type="button"
            className="save-status__btn"
            onClick={onExportLocal}
            title="下载当前内存中的画布副本"
          >
            导出本地副本
          </button>
        )}
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
        {draftStatusElement}
        <button
          type="button"
          className="save-status__btn save-status__btn--primary"
          onClick={onSave}
        >
          保存
        </button>
        {exportServerButton}
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
      {draftStatusElement}
      {exportServerButton}
    </div>
  );
}
