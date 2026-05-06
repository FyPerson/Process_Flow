// 共有画布管理 tab（P3F-3 + P3G + codex 04-审修法）
//
// 功能：
// - 列表：name / visibility / is_public_to_guest / 最近一次发布（人/时间/截断说明）/ owner / 更新时间 / 操作
// - 编辑元信息 dialog：name + description + is_public_to_guest
// - 归档 confirm（软删，archived=1 后从列表消失）
// - P3G 发布 dialog：private → public，必填 published_note 1-500 字（schema trim 后校验）
// - P3G 撤回 confirm：public → private，保留 published_* 历史不清空
// - 发布说明"查看"dialog（截断 50 字 + 点查看复用 view-only dialog）
// - admin 视角：拉所有非归档画布（服务端 listCanvasesForAdmin）
//
// codex 04-审修法：
// - dialog error 清理（open/close 时清；提交成功也清；防 dialog state 泄漏）
// - 行级 submitting guard（rowSubmitting）防止连续撤回/归档触发误导性 already_private
// - rowError 在刷新 / 任一成功 mutation 后清空
// - PublishedCell 逐字段 fallback（防御 partial-null 脏数据）
// - textarea 删 maxLength（trim 后长度作唯一业务边界）
// - mapApiError 优先展示 ApiError.issues[0].message

import { useCallback, useState, type FormEvent } from 'react';
import { useAdminCanvases } from '../../hooks/useAdminCanvases';
import type { ApiError, CanvasListItem, PatchCanvasInput } from '../../api/canvases';

type EditingState = {
  canvas: CanvasListItem;
  name: string;
  description: string;
  is_public_to_guest: boolean;
};
type PublishDialogState = { canvas: CanvasListItem; note: string };
type ViewNoteDialogState = { canvas: CanvasListItem };
/** 行级 submitting guard：codex 04-审 medium #2，防止连续点击触发误导性 409 */
type RowSubmittingState = { id: number; action: 'unpublish' | 'archive' } | null;

const NOTE_TRUNCATE_LIMIT = 50;
const NOTE_MAX = 500;

export function CanvasesTab() {
  const {
    canvases,
    loading,
    error,
    patchCanvas,
    archiveCanvas,
    publishCanvas,
    unpublishCanvas,
    refetch,
  } = useAdminCanvases();

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState<PublishDialogState | null>(null);
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [viewing, setViewing] = useState<ViewNoteDialogState | null>(null);

  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [rowSubmitting, setRowSubmitting] = useState<RowSubmittingState>(null);

  // ========== dialog open/close helpers（codex 04-审 medium #1：清错误状态） ==========
  const openEditing = useCallback((canvas: CanvasListItem) => {
    setEditError(null);
    setEditing({
      canvas,
      name: canvas.name,
      description: canvas.description ?? '',
      is_public_to_guest: canvas.is_public_to_guest,
    });
  }, []);

  const closeEditing = useCallback(() => {
    setEditing(null);
    setEditError(null);
  }, []);

  const openPublishing = useCallback((canvas: CanvasListItem) => {
    setPublishError(null);
    setPublishing({ canvas, note: '' });
  }, []);

  const closePublishing = useCallback(() => {
    setPublishing(null);
    setPublishError(null);
  }, []);

  const openViewing = useCallback((canvas: CanvasListItem) => {
    setViewing({ canvas });
  }, []);

  const closeViewing = useCallback(() => {
    setViewing(null);
  }, []);

  // ========== 表单提交流程 ==========
  const handleSaveEdit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!editing) return;
      if (editSubmitting) return;
      const trimmedName = editing.name.trim();
      if (!trimmedName) {
        setEditError('画布名不能为空');
        return;
      }
      setEditSubmitting(true);
      setEditError(null);
      try {
        const patch: PatchCanvasInput = {
          name: trimmedName,
          description: editing.description,
        };
        if (editing.canvas.visibility === 'public') {
          patch.is_public_to_guest = editing.is_public_to_guest;
        }
        await patchCanvas(editing.canvas.id, patch);
        // 成功：关 dialog + 清同行旧错误（codex 04-审 low #3 rowError 生命周期）
        closeEditing();
        setRowError((prev) => (prev?.id === editing.canvas.id ? null : prev));
      } catch (err) {
        setEditError(mapApiError(err as ApiError));
      } finally {
        setEditSubmitting(false);
      }
    },
    [editing, editSubmitting, patchCanvas, closeEditing],
  );

  const handlePublishSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!publishing) return;
      if (publishSubmitting) return;
      // 客户端预校验：trim 后非空 + ≤500 字（与服务端 schema 对齐）
      const trimmed = publishing.note.trim();
      if (trimmed.length === 0) {
        setPublishError('发布说明不能为空');
        return;
      }
      if (trimmed.length > NOTE_MAX) {
        setPublishError(`发布说明不能超过 ${NOTE_MAX} 字（去掉前后空格后）`);
        return;
      }
      setPublishSubmitting(true);
      setPublishError(null);
      try {
        await publishCanvas(publishing.canvas.id, trimmed);
        closePublishing();
        setRowError((prev) => (prev?.id === publishing.canvas.id ? null : prev));
      } catch (err) {
        setPublishError(mapApiError(err as ApiError));
      } finally {
        setPublishSubmitting(false);
      }
    },
    [publishing, publishSubmitting, publishCanvas, closePublishing],
  );

  const handleUnpublish = useCallback(
    async (target: CanvasListItem) => {
      // 行级 guard：同一行同一动作正在 submit 时拒绝重复触发
      if (rowSubmitting?.id === target.id && rowSubmitting.action === 'unpublish') return;
      setRowError(null);
      const ok = window.confirm(
        `确认撤回画布 "${target.name}" 为 private？\n\n` +
          `撤回后该画布只有 owner 和 admin 能看到；\n` +
          `历史发布记录（发布人/时间/说明）保留，归属（owner_id）不变。`,
      );
      if (!ok) return;
      setRowSubmitting({ id: target.id, action: 'unpublish' });
      try {
        await unpublishCanvas(target.id);
        // 成功：清同行旧错误
        setRowError((prev) => (prev?.id === target.id ? null : prev));
      } catch (err) {
        setRowError({ id: target.id, message: mapApiError(err as ApiError) });
      } finally {
        setRowSubmitting(null);
      }
    },
    [unpublishCanvas, rowSubmitting],
  );

  const handleArchive = useCallback(
    async (target: CanvasListItem) => {
      if (rowSubmitting?.id === target.id && rowSubmitting.action === 'archive') return;
      setRowError(null);
      const ok = window.confirm(
        `确认归档画布 "${target.name}"？\n\n` +
          `归档后该画布不再出现在任何用户的列表中。\n` +
          `如需恢复需要 ssh 进 server 改 db（archived=0）。`,
      );
      if (!ok) return;
      setRowSubmitting({ id: target.id, action: 'archive' });
      try {
        await archiveCanvas(target.id);
        setRowError((prev) => (prev?.id === target.id ? null : prev));
      } catch (err) {
        setRowError({ id: target.id, message: mapApiError(err as ApiError) });
      } finally {
        setRowSubmitting(null);
      }
    },
    [archiveCanvas, rowSubmitting],
  );

  const handleRefresh = useCallback(() => {
    // 刷新前清所有 rowError（codex 04-审 low #3：列表刷新后旧错误应消失）
    setRowError(null);
    void refetch();
  }, [refetch]);

  return (
    <div className="users-tab">
      <section className="users-tab-section">
        <div className="users-tab-section-header">
          <h2 className="users-tab-section-title">所有画布（admin 视角，含他人 private）</h2>
          <button type="button" onClick={handleRefresh} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
        {error && (
          <div className="users-tab-error">
            加载失败：{error.message || error.error}
          </div>
        )}
        <div className="users-tab-hint">
          注：本视图只列出**未归档**画布。已归档需要 SQL 直接查 db。
          归档动作不可逆 UI（恢复需 ssh + SQL）。
          public 画布的"最近一次发布"信息以"最近一次发布动作"为准——重复 publish 会覆盖说明。
        </div>
        <table className="users-table">
          <thead>
            <tr>
              <th>id</th>
              <th>名称</th>
              <th>可见性</th>
              <th>游客可见</th>
              <th>最近一次发布</th>
              <th>owner</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {canvases.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} className="users-table-empty">
                  暂无画布
                </td>
              </tr>
            ) : (
              canvases.map((c) => {
                const rowErr = rowError?.id === c.id ? rowError.message : null;
                const isUnpublishing =
                  rowSubmitting?.id === c.id && rowSubmitting.action === 'unpublish';
                const isArchiving =
                  rowSubmitting?.id === c.id && rowSubmitting.action === 'archive';
                return (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>
                      <a
                        href={`/?canvasId=${c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="新窗口打开此画布"
                        style={{ color: '#60a5fa', textDecoration: 'none' }}
                      >
                        {c.name}
                      </a>
                    </td>
                    <td>
                      <span
                        className={
                          c.visibility === 'public'
                            ? 'canvas-vis-public'
                            : 'canvas-vis-private'
                        }
                      >
                        {c.visibility}
                      </span>
                    </td>
                    <td>
                      {c.visibility === 'public'
                        ? c.is_public_to_guest
                          ? '是'
                          : '否'
                        : '—'}
                    </td>
                    <td>
                      {c.visibility === 'public' ? (
                        <PublishedCell canvas={c} onView={openViewing} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{c.owner_id ?? '—'}</td>
                    <td>{formatDate(c.updated_at)}</td>
                    <td className="users-row-actions">
                      <button type="button" onClick={() => openEditing(c)}>
                        编辑
                      </button>
                      {c.visibility === 'private' ? (
                        <button
                          type="button"
                          onClick={() => openPublishing(c)}
                          title="将 private 画布发布为 public（必填发布说明）"
                        >
                          发布
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleUnpublish(c)}
                          disabled={isUnpublishing}
                          title="将 public 画布撤回为 private（保留发布历史）"
                        >
                          {isUnpublishing ? '撤回中…' : '撤回'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="users-action-danger"
                        onClick={() => void handleArchive(c)}
                        disabled={isArchiving}
                      >
                        {isArchiving ? '归档中…' : '归档'}
                      </button>
                      {rowErr && (
                        <div className="users-tab-error users-row-error">{rowErr}</div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* === 编辑元信息 dialog === */}
      {editing && (
        <div
          className="users-dialog-backdrop"
          onClick={() => !editSubmitting && closeEditing()}
        >
          <div className="users-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>编辑画布 #{editing.canvas.id}</h3>
            <form onSubmit={handleSaveEdit}>
              <label className="canvas-edit-label">画布名</label>
              <input
                type="text"
                value={editing.name}
                onChange={(e) =>
                  setEditing((d) => (d ? { ...d, name: e.target.value } : d))
                }
                maxLength={100}
                required
                disabled={editSubmitting}
              />
              <label className="canvas-edit-label">描述（可选）</label>
              <textarea
                value={editing.description}
                onChange={(e) =>
                  setEditing((d) => (d ? { ...d, description: e.target.value } : d))
                }
                maxLength={500}
                rows={3}
                disabled={editSubmitting}
                className="canvas-edit-textarea"
              />
              {editing.canvas.visibility === 'public' && (
                <label className="canvas-edit-checkbox">
                  <input
                    type="checkbox"
                    checked={editing.is_public_to_guest}
                    onChange={(e) =>
                      setEditing((d) => (d ? { ...d, is_public_to_guest: e.target.checked } : d))
                    }
                    disabled={editSubmitting}
                  />
                  允许游客查看（is_public_to_guest）
                </label>
              )}
              {editError && <div className="users-tab-error">{editError}</div>}
              <div className="users-dialog-actions">
                <button
                  type="button"
                  onClick={closeEditing}
                  disabled={editSubmitting}
                >
                  取消
                </button>
                <button type="submit" disabled={editSubmitting}>
                  {editSubmitting ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* === P3G 发布 dialog === */}
      {publishing && (
        <div
          className="users-dialog-backdrop"
          onClick={() => !publishSubmitting && closePublishing()}
        >
          <div className="users-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>发布画布 #{publishing.canvas.id}</h3>
            <form onSubmit={handlePublishSubmit}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8' }}>
                将「{publishing.canvas.name}」由 private 发布为 public。
                <br />
                所有登录用户都能看到并编辑这个画布。
                <br />
                发布后游客不可见（is_public_to_guest 默认置 0；如需游客可见，发布后单独编辑）。
              </p>
              <label className="canvas-edit-label">
                发布说明 <span style={{ color: '#ef4444' }}>*</span>
                <span style={{ color: '#64748b', marginLeft: 8, fontWeight: 400 }}>
                  （1-500 字，会显示在公开画布列表）
                </span>
              </label>
              {/* codex 04-审 low #5：删 maxLength；用 trim 后长度作唯一业务边界 */}
              <textarea
                value={publishing.note}
                onChange={(e) =>
                  setPublishing((d) => (d ? { ...d, note: e.target.value } : d))
                }
                rows={4}
                required
                disabled={publishSubmitting}
                className="canvas-edit-textarea"
                placeholder="例：v1.0 上线，文博业务流程图初版"
              />
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'right' }}>
                {publishing.note.trim().length} / {NOTE_MAX} 字（去前后空格后）
              </div>
              {publishError && <div className="users-tab-error">{publishError}</div>}
              <div className="users-dialog-actions">
                <button
                  type="button"
                  onClick={closePublishing}
                  disabled={publishSubmitting}
                >
                  取消
                </button>
                <button type="submit" disabled={publishSubmitting}>
                  {publishSubmitting ? '发布中…' : '发布'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* === 查看完整发布说明 dialog（view-only） === */}
      {viewing && (
        <div className="users-dialog-backdrop" onClick={closeViewing}>
          <div className="users-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>发布说明 — 画布 #{viewing.canvas.id}「{viewing.canvas.name}」</h3>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
              发布人：{viewing.canvas.published_by != null ? `#${viewing.canvas.published_by}` : '#?'}
              {' · '}
              发布时间：{viewing.canvas.published_at ? formatDate(viewing.canvas.published_at) : '时间缺失'}
            </div>
            <div
              style={{
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 4,
                padding: '12px 14px',
                color: '#e2e8f0',
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 320,
                overflow: 'auto',
              }}
            >
              {viewing.canvas.published_note ?? '（无说明）'}
            </div>
            <div className="users-dialog-actions">
              <button type="button" onClick={closeViewing}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "最近一次发布"列：发布人 / 截断 50 字说明 / 点"查看"打开 view-only dialog
 *
 * codex 04-审 low #4：逐字段 fallback 防御 partial-null 脏数据：
 *   - 三个字段全 NULL → "—"
 *   - 时间缺失 → "时间缺失"
 *   - 发布人缺失 → "#?"
 *   - 说明缺失或空 → "（无说明）"
 */
function PublishedCell({
  canvas,
  onView,
}: {
  canvas: CanvasListItem;
  onView: (canvas: CanvasListItem) => void;
}) {
  const allNull =
    canvas.published_at == null && canvas.published_by == null && canvas.published_note == null;
  if (allNull) return <>—</>;

  const note = canvas.published_note ?? '';
  const truncated =
    note.length > NOTE_TRUNCATE_LIMIT ? `${note.slice(0, NOTE_TRUNCATE_LIMIT)}…` : note;

  const byLabel = canvas.published_by != null ? `#${canvas.published_by}` : '#?';
  const dateLabel = canvas.published_at ? formatDateShort(canvas.published_at) : '时间缺失';

  return (
    <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span>{`${byLabel} / ${dateLabel}`}</span>
      <span style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
        <span style={{ color: '#cbd5e1' }}>{truncated || '（无说明）'}</span>
        {note.length > NOTE_TRUNCATE_LIMIT && (
          <button
            type="button"
            onClick={() => onView(canvas)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#60a5fa',
              padding: 0,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            查看
          </button>
        )}
      </span>
    </div>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/** 列表行内紧凑日期格式：MM-dd HH:mm（无年份，节省宽度） */
function formatDateShort(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

/**
 * 错误映射（codex 04-审 low #6）：
 * - 已知 error code 走专用文案
 * - invalid_input 优先展示 ApiError.issues[0]?.message 让用户看到具体字段错误
 * - 兜底：服务端 message 或 error code
 */
function mapApiError(err: ApiError): string {
  const e = err.error;
  const m = err.message;
  if (err.status === 0 || e === 'network_error') return '网络错误，请检查连接';
  if (err.status === 401) return '当前账号已失效，请重新登录';
  if (err.status === 403) return '需要 admin 权限（你的 admin 权限可能已被撤销）';
  if (err.status === 404) return '画布不存在';
  if (e === 'already_public') return '该画布已经是 public，无法重复发布';
  if (e === 'already_private') return '该画布已经是 private，无法撤回';
  if (e === 'archived_canvas') return '已归档画布无法发布或撤回';
  if (e === 'invalid_input') {
    const first = err.issues?.[0]?.message;
    if (first) return `输入有误：${first}`;
    return '输入有误：发布说明 1-500 字符（去前后空格）/ 画布名 1-100 字符';
  }
  return m || `操作失败（${e || err.status}）`;
}
