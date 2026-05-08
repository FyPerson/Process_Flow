// 画布切换下拉（P3F-3 偿还债务 #16）
//
// 出现在 BFV 顶栏，点击展开下拉，列出当前用户可见的画布列表。
// - 游客：显示 public + is_public_to_guest=1 画布
// - 普通用户：显示所有 public + 自己 owner 的 private
// - admin：显示所有非归档画布
// 服务端 listCanvasesForGuest / listCanvasesForUser / listCanvasesForAdmin 已分流，前端只需 GET /api/canvases
//
// 点选 → setSearchParams({canvasId})；当前 canvasId 用 ✓ 标记
// 包含一个 "本地草稿" 入口（清 canvasId param）让用户回到 local 模式

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type ApiError, type CanvasListItem, listCanvases } from '../../api/canvases';
import { useAuth } from '../../auth/AuthContext';
import { formatCanvasLabel } from './formatCanvasLabel';
import './styles.css';

interface Props {
  /** 当前 canvasId（URL ?canvasId=N），null 表示本地草稿 */
  currentCanvasId: number | null;
  /** 当前画布是否有未保存改动；切换前用于 confirm 拦截（codex 03 一审 medium 2）*/
  dirty?: boolean;
  /** 当前是否在保存中；保存中切换会丢失 inflight 改动 */
  saving?: boolean;
}

export function CanvasSwitcher({ currentCanvasId, dirty = false, saving = false }: Props) {
  const [, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const [canvases, setCanvases] = useState<CanvasListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // mount 时拉一次列表（让 trigger 能立即显示选中画布的 name 而非 fallback）
  // open 时再 refetch（确保打开下拉看到最新；列表不大不需 cache 优化）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listCanvases()
      .then((list) => {
        if (alive) {
          setCanvases(list);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e as ApiError);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [open]); // open 变化时重拉；mount 时 open=false 也触发首次 fetch

  // 点外面关
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const handlePick = useCallback(
    (id: number | null) => {
      // 切到当前画布 → 直接关下拉，不导航
      if (id === currentCanvasId) {
        setOpen(false);
        return;
      }
      // codex 03 一审 medium 2：dirty/saving 时切换会丢未保存改动，二次确认
      // setSearchParams 是 SPA 内部跳转，不触发 beforeunload，需显式拦截
      if (dirty || saving) {
        const ok = window.confirm(
          saving
            ? '当前画布正在保存，切换会丢弃未完成的保存。确认切换？'
            : '当前画布有未保存改动，切换后会丢失。确认切换？',
        );
        if (!ok) return;
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === null) next.delete('canvasId');
          else next.set('canvasId', String(id));
          return next;
        },
        { replace: false },
      );
      setOpen(false);
    },
    [setSearchParams, currentCanvasId, dirty, saving],
  );

  // Trigger 标签：本地草稿走 📁 本地草稿；服务端画布按 formatCanvasLabel 规则拼前缀 + name
  const currentCanvas =
    currentCanvasId !== null
      ? canvases.find((c) => c.id === currentCanvasId) ?? null
      : null;
  const triggerLabel: { icon: string; text: string } = (() => {
    if (currentCanvasId === null) {
      return { icon: '📁', text: '本地草稿' };
    }
    if (!currentCanvas) {
      // 列表加载中或当前画布刚切换过来还没拉到列表
      return { icon: '📁', text: `画布 #${currentCanvasId}` };
    }
    const label = formatCanvasLabel({ canvas: currentCanvas, currentUserId });
    return { icon: label.icon, text: `${label.prefix}${label.name}` };
  })();

  return (
    <div className="canvas-switcher" ref={containerRef}>
      <button
        type="button"
        className="canvas-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        title="切换画布"
      >
        <span className="canvas-switcher-trigger-label">
          {triggerLabel.icon} {triggerLabel.text}
        </span>
        <span className="canvas-switcher-trigger-arrow">▼</span>
      </button>
      {open && (
        <div className="canvas-switcher-menu">
          <button
            type="button"
            className={`canvas-switcher-item ${
              currentCanvasId === null ? 'canvas-switcher-item-active' : ''
            }`}
            onClick={() => handlePick(null)}
          >
            <span className="canvas-switcher-item-icon">📝</span>
            <span className="canvas-switcher-item-name">本地草稿</span>
            {currentCanvasId === null && <span className="canvas-switcher-item-mark">✓</span>}
          </button>
          <div className="canvas-switcher-divider" />
          {loading && <div className="canvas-switcher-loading">加载中…</div>}
          {error && (
            <div className="canvas-switcher-error">
              加载失败：{error.message || error.error}
            </div>
          )}
          {!loading && !error && canvases.length === 0 && (
            <div className="canvas-switcher-empty">暂无可见画布</div>
          )}
          {!loading &&
            !error &&
            canvases.map((c) => {
              const active = c.id === currentCanvasId;
              const label = formatCanvasLabel({ canvas: c, currentUserId });
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`canvas-switcher-item ${
                    active ? 'canvas-switcher-item-active' : ''
                  }`}
                  onClick={() => handlePick(c.id)}
                >
                  <span className="canvas-switcher-item-icon">{label.icon}</span>
                  <span className="canvas-switcher-item-prefix">{label.prefix}</span>
                  <span className="canvas-switcher-item-name">{label.name}</span>
                  {(c.activeEditors ?? 0) > 0 && (
                    <span
                      className="canvas-switcher-item-editors"
                      title={`${c.activeEditors} 人在编辑`}
                    >
                      👥{c.activeEditors}
                    </span>
                  )}
                  {active && <span className="canvas-switcher-item-mark">✓</span>}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
