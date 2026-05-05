// 共有画布管理 tab（P3F-3）
//
// 功能：
// - 列表：name / visibility / is_public_to_guest / owner / 创建时间 / 操作
// - 编辑元信息 dialog：name + description + is_public_to_guest
// - 归档 confirm（软删，archived=1 后从列表消失）
// - admin 视角：拉所有非归档画布（服务端 listCanvasesForAdmin）

import { useCallback, useState, type FormEvent } from 'react';
import { useAdminCanvases } from '../../hooks/useAdminCanvases';
import type { ApiError, CanvasListItem } from '../../api/canvases';

export function CanvasesTab() {
  const { canvases, loading, error, patchCanvas, archiveCanvas, refetch } = useAdminCanvases();

  const [editing, setEditing] = useState<{
    canvas: CanvasListItem;
    name: string;
    description: string;
    is_public_to_guest: boolean;
  } | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

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
        // 只发改动字段；description 空字符串当成清空（服务端按 PatchCanvasRequestSchema 处理）
        await patchCanvas(editing.canvas.id, {
          name: trimmedName,
          description: editing.description,
          is_public_to_guest: editing.is_public_to_guest,
        });
        setEditing(null);
      } catch (err) {
        setEditError(mapApiError(err as ApiError));
      } finally {
        setEditSubmitting(false);
      }
    },
    [editing, editSubmitting, patchCanvas],
  );

  const handleArchive = useCallback(
    async (target: CanvasListItem) => {
      setRowError(null);
      const ok = window.confirm(
        `确认归档画布 "${target.name}"？\n\n` +
          `归档后该画布不再出现在任何用户的列表中。\n` +
          `如需恢复需要 ssh 进 server 改 db（archived=0）。`,
      );
      if (!ok) return;
      try {
        await archiveCanvas(target.id);
      } catch (err) {
        setRowError({ id: target.id, message: mapApiError(err as ApiError) });
      }
    },
    [archiveCanvas],
  );

  return (
    <div className="users-tab">
      <section className="users-tab-section">
        <div className="users-tab-section-header">
          <h2 className="users-tab-section-title">所有画布（admin 视角，含他人 private）</h2>
          <button type="button" onClick={() => void refetch()} disabled={loading}>
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
        </div>
        <table className="users-table">
          <thead>
            <tr>
              <th>id</th>
              <th>名称</th>
              <th>可见性</th>
              <th>游客可见</th>
              <th>owner</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {canvases.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="users-table-empty">
                  暂无画布
                </td>
              </tr>
            ) : (
              canvases.map((c) => {
                const rowErr = rowError?.id === c.id ? rowError.message : null;
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
                    <td>{c.owner_id ?? '—'}</td>
                    <td>{formatDate(c.updated_at)}</td>
                    <td className="users-row-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({
                            canvas: c,
                            name: c.name,
                            description: c.description ?? '',
                            is_public_to_guest: c.is_public_to_guest,
                          })
                        }
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="users-action-danger"
                        onClick={() => void handleArchive(c)}
                      >
                        归档
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

      {editing && (
        <div
          className="users-dialog-backdrop"
          onClick={() => !editSubmitting && setEditing(null)}
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
                  onClick={() => setEditing(null)}
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

function mapApiError(err: ApiError): string {
  const e = err.error;
  const m = err.message;
  if (err.status === 0 || e === 'network_error') return '网络错误，请检查连接';
  if (err.status === 401) return '当前账号已失效，请重新登录';
  if (err.status === 403) return '需要 admin 权限（你的 admin 权限可能已被撤销）';
  if (err.status === 404) return '画布不存在';
  if (e === 'invalid_input') return '输入有误：画布名 1-100 字符 / 描述 ≤ 500 字符';
  return m || `操作失败（${e || err.status}）`;
}
