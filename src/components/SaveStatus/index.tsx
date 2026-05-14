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
// 导出能力（v1.18.5 / 债务 #38）：
//   「导出 ▾」二级菜单：📷 PNG + 📋 JSON（服务端版本，仅 canvasId != null）
//   「导出本地副本 ▾」二级菜单：📷 PNG + 📋 JSON（内存版本，仅冲突 / canvasId=null）
//   readOnly 态（游客 / 公共画布未 ack 等）：简化为单按钮「📷 导出 PNG」（产品红线 — 游客只能导出图片）
//
// 不依赖外部 UI 库；纯 React 文本节点渲染（XSS 安全）

import { useEffect, useRef, useState } from 'react';
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
  /** v1.18.5 #38：导出当前 React Flow 视图为 PNG。caller 负责 fitView */
  onExportImage?: () => void;
  /** v1.18.5 #38：导出图片是否进行中（loading 反馈，disable 按钮 + 文案改"正在生成..."） */
  exportingImage?: boolean;
  // 阶段 4 P4D：草稿自动保存状态（由 useDraftAutosave 提供）
  /** 草稿状态；undefined 表示未启用（如游客 / 本地草稿模式）*/
  draftStatus?: DraftStatus;
  /** 草稿上次成功时间戳（用于"草稿已保存 14:23"展示）*/
  draftSavedAt?: number | null;
  // === 公共画布"复制为私人副本" ===
  // codex 取舍审 M2：独立 prop，不绑定 canvasWritable / readOnly；
  // 即使 readOnly 分支也要显示，否则被动弹窗关闭后用户没有逃生口
  /** 是否显示「复制为我的私人画布」按钮（普通用户 + 公共画布 + 已挂接服务端） */
  canSaveAsPrivateCopy?: boolean;
  /** 「复制为我的私人画布」按钮回调 */
  onSaveAsPrivateCopy?: () => void;
  /** 外部 disable 主版本「保存」按钮（codex 取舍审 H1：未 ack 公共画布期间也禁手动 save） */
  saveDisabled?: boolean;
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

/**
 * 导出下拉菜单（v1.18.5 #38）
 * 点击主按钮展开 → 内含 📷 PNG + 📋 JSON 两个子项 → 点子项触发回调 + 自动收起
 * 点外面也自动收起（document mousedown listener）
 *
 * 单项时（如 readOnly 仅 PNG）退化为单按钮，不展开
 */
function ExportDropdown({
  label,
  title,
  onExportImage,
  onExportJson,
  jsonLabel,
  jsonTitle,
  exportingImage,
}: {
  label: string;
  title: string;
  onExportImage?: () => void;
  onExportJson?: () => void;
  jsonLabel: string;
  jsonTitle: string;
  exportingImage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // 单项退化：只有 image 没有 json → 直接当单按钮，不展开
  if (onExportImage && !onExportJson) {
    return (
      <button
        type="button"
        className="save-status__btn"
        onClick={onExportImage}
        disabled={exportingImage}
        title={exportingImage ? '正在生成图片，请稍候…' : '导出当前画布为 PNG 图片'}
      >
        {exportingImage ? '⏳ 正在生成…' : '📷 导出 PNG'}
      </button>
    );
  }
  // 单项退化：只有 json 没有 image → 直接当单按钮（保留旧行为兜底）
  if (!onExportImage && onExportJson) {
    return (
      <button
        type="button"
        className="save-status__btn"
        onClick={onExportJson}
        title={jsonTitle}
      >
        {jsonLabel}
      </button>
    );
  }
  // 都没有 → 不渲染
  if (!onExportImage && !onExportJson) return null;

  return (
    <div className="save-status__dropdown" ref={wrapperRef}>
      <button
        type="button"
        className="save-status__btn"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {label} ▾
      </button>
      {open && (
        <div className="save-status__dropdown-menu" role="menu">
          {onExportImage && (
            <button
              type="button"
              className="save-status__dropdown-item"
              onClick={() => {
                setOpen(false);
                onExportImage();
              }}
              disabled={exportingImage}
              role="menuitem"
            >
              {exportingImage ? '⏳ 正在生成图片…' : '📷 导出 PNG 图片'}
            </button>
          )}
          {onExportJson && (
            <button
              type="button"
              className="save-status__dropdown-item"
              onClick={() => {
                setOpen(false);
                onExportJson();
              }}
              role="menuitem"
              title={jsonTitle}
            >
              {jsonLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
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
    onExportImage,
    exportingImage,
    draftStatus,
    draftSavedAt,
    canSaveAsPrivateCopy,
    onSaveAsPrivateCopy,
    saveDisabled,
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

  // 「导出 ▾」下拉：服务端 JSON + PNG 图片
  // - canvasId != null 时显示（已挂接服务端 → JSON 可走 GET export endpoint）
  // - readOnly 态下仅图片项（产品红线，游客不导出 JSON）
  // - readOnly 单项退化为单按钮「📷 导出 PNG」（ExportDropdown 内部处理）
  const exportServerDropdown = canvasId != null ? (
    <ExportDropdown
      label="导出"
      title="导出当前画布"
      onExportImage={onExportImage}
      onExportJson={readOnly ? undefined : onExportServer}
      jsonLabel="📋 导出 JSON"
      jsonTitle="下载当前画布的服务端 JSON 副本"
      exportingImage={exportingImage}
    />
  ) : null;

  // 「导出本地副本 ▾」下拉：内存 JSON + PNG 图片
  // - 用于冲突逃生口 + canvasId=null 草稿备份
  // - 不考虑 readOnly 态（readOnly 时不会进入 conflict/canvasId=null 分支）
  const exportLocalDropdown = onExportLocal ? (
    <ExportDropdown
      label="导出本地副本"
      title="下载当前内存版本（含未保存改动）"
      onExportImage={onExportImage}
      onExportJson={onExportLocal}
      jsonLabel="📋 导出本地 JSON"
      jsonTitle="下载当前内存中的本地版本（含未保存改动）作为备份"
      exportingImage={exportingImage}
    />
  ) : null;

  // 主动复制入口（codex 取舍审 M2 + L2）：独立于 readOnly/saved/dirty 状态。
  // 在 readOnly、conflict、saved、dirty 任意态都需要可见 —— 因此抽成共享片段。
  // saving 中不显示（避免点击触发并发 createOnServer 与正在跑的 save 竞态）
  const saveAsPrivateCopyButton =
    canSaveAsPrivateCopy && onSaveAsPrivateCopy && !saving ? (
      <button
        type="button"
        className="save-status__btn"
        onClick={onSaveAsPrivateCopy}
        title="把当前画布复制到你的私人空间（不影响公共画布）"
      >
        📋 复制为私人
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
    // 只读现在可能源自 游客 / 归档画布 / 私有画布非 owner / 加载中 / 未 ack 公共画布 等多种原因
    // codex 取舍审 M2：未 ack 公共画布触发 readOnly，主动复制入口必须出现在这里
    // v1.18.5 #38：readOnly 下「导出」退化为单按钮「📷 导出 PNG」（游客不导出 JSON 产品红线）
    return (
      <div className="save-status save-status--readonly" title="当前画布只读">
        <span>只读</span>
        {saveAsPrivateCopyButton}
        {exportServerDropdown}
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
        {exportServerDropdown}
      </div>
    );
  }

  // 优先级 2：冲突
  // 这里两个导出下拉都给：
  //   - 「导出本地副本」用内存数据（用户改动还没保存的版本，要保的就是这份）
  //   - 「导出」服务端版本才是 server 当前 JSON（用户也可能想存一份做对比）
  if (autoSaveDisabled && conflict) {
    return (
      <div className="save-status save-status--conflict">
        <span className="save-status__icon">⚠️</span>
        <span className="save-status__text">
          有人改过了（服务端 v{conflict.currentVersion}）；本地改动暂未保存
        </span>
        {exportLocalDropdown}
        {saveAsPrivateCopyButton}
        {exportServerDropdown}
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
          disabled={saveDisabled}
          title={saveDisabled ? '当前不允许写入此画布' : undefined}
        >
          重试
        </button>
        {saveAsPrivateCopyButton}
        {exportServerDropdown}
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
        {exportLocalDropdown}
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
          disabled={saveDisabled}
          title={saveDisabled ? '当前不允许写入此画布；可点「复制为私人」转到自己的副本' : undefined}
        >
          保存
        </button>
        {saveAsPrivateCopyButton}
        {exportServerDropdown}
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
      {saveAsPrivateCopyButton}
      {exportServerDropdown}
    </div>
  );
}
