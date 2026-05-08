// 用户管理 tab（P3F-2）
//
// 功能：
// - 列表表格：username / role / created_at / 操作（改密 / 改 role / 软删）
// - 创建表单：username + password + role
// - 改密 dialog：仅 password 字段
// - 软删 confirm：alert + 二次确认
//
// admin 鉴权前提：路由 guard 拦掉非 admin；本组件 useAuth 拿当前 admin 做 self-* 拦截 UI 提示
//
// codex P3F-1 一审 medium 1 文档锁定：UI 文案需诚实展示"另一 admin 仍可降你权限"
//   实际实现：admin 列表行的"改 role"按钮在"目标=自己"时禁用 + tooltip"不能改自己 role"；
//             "另一 admin 误操作"由文案提示用户"系统不防其他 admin 误操作，请协调"

import { useCallback, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import type { AdminUser, ApiError, UserRole } from '../../api/users';

export function UsersTab() {
  const { user: currentUser } = useAuth();
  const { users, loading, error, createUser, patchUser, deleteUser, refetch } = useUsers();

  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    role: 'user' as UserRole,
    nickname: '',  // 2026-05-08：可选；空字符串表示走默认（service 层用 username）
  });
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pwDialog, setPwDialog] = useState<{ user: AdminUser; password: string } | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  // 2026-05-08：admin 改任意用户昵称的弹窗
  const [nickDialog, setNickDialog] = useState<{ user: AdminUser; nickname: string } | null>(null);
  const [nickSubmitting, setNickSubmitting] = useState(false);
  const [nickError, setNickError] = useState<string | null>(null);

  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  const handleCreate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (createSubmitting) return;
      const { username, password, role, nickname } = createForm;
      if (!username.trim() || !password) return;
      setCreateSubmitting(true);
      setCreateError(null);
      try {
        const trimmedNick = nickname.trim();
        await createUser({
          username: username.trim(),
          password,
          role,
          // nickname 留空 → 不传 → service 层默认填 username
          ...(trimmedNick.length > 0 ? { nickname: trimmedNick } : {}),
        });
        setCreateForm({ username: '', password: '', role: 'user', nickname: '' });
      } catch (err) {
        setCreateError(mapApiError(err as ApiError, 'create'));
      } finally {
        setCreateSubmitting(false);
      }
    },
    [createForm, createSubmitting, createUser],
  );

  // 2026-05-08：admin 改任意用户昵称
  const handleSubmitNickname = useCallback(async () => {
    if (!nickDialog) return;
    if (nickSubmitting) return;
    const trimmed = nickDialog.nickname.trim();
    if (trimmed.length < 1 || trimmed.length > 30) {
      setNickError('昵称需 1-30 字符（trim 后非空）');
      return;
    }
    setNickSubmitting(true);
    setNickError(null);
    try {
      await patchUser(nickDialog.user.id, { nickname: trimmed });
      setNickDialog(null);
    } catch (err) {
      setNickError(mapApiError(err as ApiError, 'patch'));
    } finally {
      setNickSubmitting(false);
    }
  }, [nickDialog, nickSubmitting, patchUser]);

  const handleChangeRole = useCallback(
    async (target: AdminUser, nextRole: UserRole) => {
      setRowError(null);
      try {
        await patchUser(target.id, { role: nextRole });
      } catch (err) {
        setRowError({ id: target.id, message: mapApiError(err as ApiError, 'patch') });
      }
    },
    [patchUser],
  );

  const handleResetPassword = useCallback(async () => {
    if (!pwDialog) return;
    if (pwSubmitting) return;
    if (pwDialog.password.length < 8) {
      setPwError('密码至少 8 位');
      return;
    }
    setPwSubmitting(true);
    setPwError(null);
    try {
      await patchUser(pwDialog.user.id, { password: pwDialog.password });
      setPwDialog(null);
    } catch (err) {
      setPwError(mapApiError(err as ApiError, 'patch'));
    } finally {
      setPwSubmitting(false);
    }
  }, [pwDialog, pwSubmitting, patchUser]);

  const handleSoftDelete = useCallback(
    async (target: AdminUser) => {
      setRowError(null);
      const ok = window.confirm(
        `确认软删用户 "${target.username}"？\n\n` +
          `软删后该用户不能登录，且 username 不可重用（外键引用保留）。\n` +
          `如需恢复需要 ssh 进 server 改 db。`,
      );
      if (!ok) return;
      try {
        await deleteUser(target.id);
      } catch (err) {
        setRowError({ id: target.id, message: mapApiError(err as ApiError, 'delete') });
      }
    },
    [deleteUser],
  );

  return (
    <div className="users-tab">
      <section className="users-tab-section">
        <h2 className="users-tab-section-title">创建用户</h2>
        <form className="users-create-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="用户名（字母/数字/下划线/中文，1-20 字符）"
            value={createForm.username}
            onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
            maxLength={20}
            required
            disabled={createSubmitting}
            autoComplete="off"
          />
          <input
            type="password"
            placeholder="密码（≥ 8 位）"
            value={createForm.password}
            onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
            minLength={8}
            maxLength={200}
            required
            disabled={createSubmitting}
            autoComplete="new-password"
          />
          <select
            value={createForm.role}
            onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as UserRole }))}
            disabled={createSubmitting}
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <input
            type="text"
            placeholder="昵称（选填，1-30 字符；留空 = 用户名）"
            value={createForm.nickname}
            onChange={(e) => setCreateForm((f) => ({ ...f, nickname: e.target.value }))}
            maxLength={30}
            disabled={createSubmitting}
            autoComplete="off"
          />
          <button type="submit" disabled={createSubmitting}>
            {createSubmitting ? '创建中…' : '创建'}
          </button>
        </form>
        {createError && <div className="users-tab-error">{createError}</div>}
      </section>

      <section className="users-tab-section">
        <div className="users-tab-section-header">
          <h2 className="users-tab-section-title">用户列表</h2>
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
          注：本系统**不防** admin 之间互相误操作（admin1 可降 admin2 权限）。如需协调请直接沟通。
          只防"admin 改自己 role / 软删自己"——避免误操作锁死系统。
        </div>
        <table className="users-table">
          <thead>
            <tr>
              <th>id</th>
              <th>用户名</th>
              <th>昵称</th>
              <th>角色</th>
              <th>创建时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="users-table-empty">
                  暂无用户
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = currentUser !== null && u.id === currentUser.id;
                const isDeleted = u.deleted_at !== null;
                const rowErr = rowError?.id === u.id ? rowError.message : null;
                return (
                  <tr key={u.id} className={isDeleted ? 'users-row-deleted' : ''}>
                    <td>{u.id}</td>
                    <td>{u.username}</td>
                    <td>{u.nickname}</td>
                    <td>
                      {u.role}
                      {isSelf && <span className="users-self-tag">（你）</span>}
                    </td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>{isDeleted ? `已软删 ${formatDate(u.deleted_at!)}` : '正常'}</td>
                    <td className="users-row-actions">
                      {isDeleted ? (
                        <span className="users-row-actions-disabled">—</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setNickDialog({ user: u, nickname: u.nickname })}
                            title="修改昵称"
                          >
                            改昵称
                          </button>
                          <button
                            type="button"
                            onClick={() => setPwDialog({ user: u, password: '' })}
                          >
                            重置密码
                          </button>
                          {u.role === 'user' ? (
                            <button
                              type="button"
                              onClick={() => void handleChangeRole(u, 'admin')}
                              title="升为 admin"
                            >
                              升 admin
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isSelf}
                              title={isSelf ? '不能改自己 role 为 user' : '降为 user'}
                              onClick={() => void handleChangeRole(u, 'user')}
                            >
                              降 user
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isSelf}
                            title={isSelf ? '不能软删自己' : '软删'}
                            className="users-action-danger"
                            onClick={() => void handleSoftDelete(u)}
                          >
                            软删
                          </button>
                        </>
                      )}
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

      {nickDialog && (
        <div className="users-dialog-backdrop" onClick={() => !nickSubmitting && setNickDialog(null)}>
          <div className="users-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>修改 {nickDialog.user.username} 的昵称</h3>
            <input
              type="text"
              placeholder="昵称（1-30 字符，trim 后非空）"
              value={nickDialog.nickname}
              onChange={(e) =>
                setNickDialog((d) => (d ? { ...d, nickname: e.target.value } : d))
              }
              maxLength={30}
              autoFocus
              disabled={nickSubmitting}
              autoComplete="off"
            />
            {nickError && <div className="users-tab-error">{nickError}</div>}
            <div className="users-dialog-actions">
              <button
                type="button"
                onClick={() => setNickDialog(null)}
                disabled={nickSubmitting}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSubmitNickname()}
                disabled={nickSubmitting || nickDialog.nickname.trim().length < 1}
              >
                {nickSubmitting ? '提交中…' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pwDialog && (
        <div className="users-dialog-backdrop" onClick={() => !pwSubmitting && setPwDialog(null)}>
          <div className="users-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>重置 {pwDialog.user.username} 的密码</h3>
            <input
              type="password"
              placeholder="新密码（≥ 8 位）"
              value={pwDialog.password}
              onChange={(e) =>
                setPwDialog((d) => (d ? { ...d, password: e.target.value } : d))
              }
              minLength={8}
              maxLength={200}
              autoFocus
              disabled={pwSubmitting}
              autoComplete="new-password"
            />
            {pwError && <div className="users-tab-error">{pwError}</div>}
            <div className="users-dialog-actions">
              <button
                type="button"
                onClick={() => setPwDialog(null)}
                disabled={pwSubmitting}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleResetPassword()}
                disabled={pwSubmitting || pwDialog.password.length < 8}
              >
                {pwSubmitting ? '提交中…' : '确认重置'}
              </button>
            </div>
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

function mapApiError(err: ApiError, action: 'create' | 'patch' | 'delete'): string {
  // 根据服务端错误码 + action 给中文友好文案
  const e = err.error;
  const m = err.message;
  if (err.status === 0 || e === 'network_error') return '网络错误，请检查连接';
  if (err.status === 401) return '当前账号已失效，请重新登录';
  if (err.status === 403) return '需要 admin 权限（你的 admin 权限可能已被撤销）';
  if (err.status === 404) return '目标用户不存在';
  if (err.status === 410) return '目标用户已软删';
  if (e === 'self_demote_forbidden') return '不能改自己的 role 为 user（防误操作锁死）';
  if (e === 'self_delete_forbidden') return '不能软删自己（防误操作锁死）';
  if (e === 'conflict') {
    if (action === 'create') {
      return m?.includes('soft-deleted')
        ? '该用户名曾被软删，不可重用'
        : '用户名已存在';
    }
    return m || '冲突';
  }
  if (e === 'invalid_input') {
    if (action === 'create') return '输入有误：用户名 1-20 字符（字母/数字/下划线/中文）/ 密码 ≥ 8 位 / 角色 user 或 admin';
    if (action === 'patch') return '输入有误：role 或 password 至少传一个';
  }
  return m || `操作失败（${e || err.status}）`;
}
