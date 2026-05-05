// 用户列表数据层 hook（P3F-2）
//
// 设计简化（vs useAnnotations）：
// - admin 后台单页面消费，无跨 key 切换 / 无游客场景 → 不需要 annotationsKey + keyGen
// - mutation 量小（admin 单人操作），无并发 race → 不需要 per-id pendingIdsRef
// - 仅 admin 进得来（路由 guard + requireFreshAdmin 服务端兜底）→ 假设 user.role === 'admin'
//
// 保留：
// - mountedRef（unmount 守卫，避免飞行回包写已卸载）
// - fetchSeqRef（refetch 多次时拦旧回包）
// - 乐观更新 + snapshot 单条回滚（patch / delete 失败时局部还原）
// - 错误结构化暴露（ApiError，UI 自己映射文案）

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AdminUser,
  type ApiError,
  type CreateUserInput,
  type PatchUserInput,
  createUser as apiCreateUser,
  deleteUser as apiDeleteUser,
  listUsers as apiListUsers,
  patchUser as apiPatchUser,
} from '../api/users';

export interface UseUsersResult {
  users: AdminUser[];
  loading: boolean;
  error: ApiError | null;
  /** 创建用户；成功返回新建对象；失败 throw ApiError。
   *  调用方应在提交期间禁用按钮防重复提交。 */
  createUser: (input: CreateUserInput) => Promise<AdminUser>;
  /** 改 role / 重置密码（乐观更新；失败局部回滚） */
  patchUser: (id: number, input: PatchUserInput) => Promise<AdminUser>;
  /** 软删（乐观更新写 deleted_at；失败回滚） */
  deleteUser: (id: number) => Promise<AdminUser>;
  /** 强制重新拉列表 */
  refetch: () => Promise<void>;
}

export function useUsers(): UseUsersResult {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const fetchSeqRef = useRef(0);
  const mountedRef = useRef(true);

  const performFetch = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const list = await apiListUsers();
      if (!mountedRef.current) return;
      if (seq !== fetchSeqRef.current) return;
      // 排序：未软删在前，软删在后；同组按 id 正序
      list.sort((a, b) => {
        const aDeleted = a.deleted_at !== null ? 1 : 0;
        const bDeleted = b.deleted_at !== null ? 1 : 0;
        if (aDeleted !== bDeleted) return aDeleted - bDeleted;
        return a.id - b.id;
      });
      setUsers(list);
    } catch (e) {
      if (!mountedRef.current) return;
      if (seq !== fetchSeqRef.current) return;
      setError(e as ApiError);
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // 首次加载
  useEffect(() => {
    mountedRef.current = true;
    void performFetch();
    return () => {
      mountedRef.current = false;
    };
  }, [performFetch]);

  const createUserCb = useCallback(
    async (input: CreateUserInput): Promise<AdminUser> => {
      // 不做乐观更新（创建后 id 由服务端分配，乐观插入要 placeholder id 增加复杂度）
      // 直接 POST → 成功后局部 push
      const created = await apiCreateUser(input);
      if (!mountedRef.current) return created;
      setUsers((prev) => {
        const next = [...prev, created];
        next.sort((a, b) => {
          const aDeleted = a.deleted_at !== null ? 1 : 0;
          const bDeleted = b.deleted_at !== null ? 1 : 0;
          if (aDeleted !== bDeleted) return aDeleted - bDeleted;
          return a.id - b.id;
        });
        return next;
      });
      return created;
    },
    [],
  );

  const patchUserCb = useCallback(
    async (id: number, input: PatchUserInput): Promise<AdminUser> => {
      // 乐观更新：先在本地写新 role（密码不在 list 显示，patch 密码无需乐观）
      let snapshot: AdminUser | null = null;
      if (input.role !== undefined) {
        setUsers((prev) =>
          prev.map((u) => {
            if (u.id !== id) return u;
            snapshot = u;
            return { ...u, role: input.role!, updated_at: Date.now() };
          }),
        );
      }
      try {
        const updated = await apiPatchUser(id, input);
        if (!mountedRef.current) return updated;
        // 服务端权威：用真返回值替换
        setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
        return updated;
      } catch (e) {
        // 失败回滚
        if (mountedRef.current && snapshot !== null) {
          const snap: AdminUser = snapshot;
          setUsers((prev) => prev.map((u) => (u.id === id ? snap : u)));
        }
        throw e;
      }
    },
    [],
  );

  const deleteUserCb = useCallback(
    async (id: number): Promise<AdminUser> => {
      // 乐观更新：先标 deleted_at = now
      let snapshot: AdminUser | null = null;
      const optimisticDeletedAt = Date.now();
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== id) return u;
          snapshot = u;
          return { ...u, deleted_at: optimisticDeletedAt };
        }),
      );
      try {
        const updated = await apiDeleteUser(id);
        if (!mountedRef.current) return updated;
        setUsers((prev) => {
          const next = prev.map((u) => (u.id === id ? updated : u));
          // 重排序（软删落后）
          next.sort((a, b) => {
            const aDeleted = a.deleted_at !== null ? 1 : 0;
            const bDeleted = b.deleted_at !== null ? 1 : 0;
            if (aDeleted !== bDeleted) return aDeleted - bDeleted;
            return a.id - b.id;
          });
          return next;
        });
        return updated;
      } catch (e) {
        if (mountedRef.current && snapshot !== null) {
          const snap: AdminUser = snapshot;
          setUsers((prev) => prev.map((u) => (u.id === id ? snap : u)));
        }
        throw e;
      }
    },
    [],
  );

  return {
    users,
    loading,
    error,
    createUser: createUserCb,
    patchUser: patchUserCb,
    deleteUser: deleteUserCb,
    refetch: performFetch,
  };
}
