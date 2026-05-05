// 批注数据层 hook（P3E-2，方案 §4.4 + 26-取舍审 high 2 + 03+04 代码审两轮重构）
//
// === 状态机设计（codex 04-二审 4 high + 3 medium 全修）===
//
// 关键概念：
//
// 1. annotationsKey（稳定 key）= `${canvasId}:${userId}:${readReady}` | 'disabled'
//    - canvasId / user.id / readReady / enabled 任一变化 → key 变化
//    - state 与 key 绑死：state = { key, annotations }
//    - render 时同步过滤：state.key !== currentKey → 返回 []（不依赖 effect 后才清）
//
// 2. keyGenRef（key 代际）—— 跨 key 边界的代际，所有 mutation 校验
//    - key 变化 / unmount 都递增
//    - 同 key 内 refetch 不递增（mutation 不被同 key refetch 作废）
//
// 3. fetchSeqRef（GET 顺序号）—— 同 key 内多次 refetch 拦旧 GET
//    - 每次 GET 启动 ++
//    - GET 回包仅当 fetchSeq 仍最新 + key 匹配才落地
//
// 4. mutationsCounterRef（mutation 落地计数）—— 解决 "GET 后回包覆盖 mutation 成功"
//    - 每次 mutation 成功 commit 后 ++
//    - GET 启动时捕获 counter 快照；回包时对比，期间有 mutation → 跳过本次旧 list + 重新 refetch
//
// 5. pendingIdsRef（per-id 串行化）—— 同 id 不允许并发 mutation
//    - mutator 起手发现 id 已 pending → throw annotation_mutation_pending
//    - UI 应通过 isAnnotationPending(id) 禁用按钮
//    - 这是 high 4 的 B 方案补丁（B 方案 + per-id token）
//
// 6. mountedRef（unmount 守卫）—— 飞行回包不写已卸载组件 state
//    - cleanup 时设 false，所有 setState 前判断
//
// === 乐观更新（按 id 局部 + snapshot 单条）===
// resolve/reopen 起手 find 目标 annotation 单条 snapshot；失败时 prev.map 只翻该 id；
// 不快照整表，避免覆盖并发 create / 其他 id 操作的成功结果。
//
// === 上层语义 ===
// - canvasId=null（本地草稿）→ enabled=false → 空状态
// - user=null（游客）→ enabled=false → 空状态（取舍 4：游客不可见批注）
// - readReady=false → 空状态；caller 必须在 canvasMetaState.kind !== 'server' 时传 false（必填）
// - 所有 mutator 的 throw 必须由 P3E-3 调用方 try/catch，不要 fire-and-forget

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Annotation,
  type CreateAnnotationInput,
  type ApiError,
  createAnnotation as apiCreateAnnotation,
  listAnnotations as apiListAnnotations,
  reopenAnnotation as apiReopenAnnotation,
  resolveAnnotation as apiResolveAnnotation,
} from '../api/annotations';
import type { UserPublic } from '../auth/api';

/** 派生 key，用于按节点分组（与 service 层 nodes_meta 复合主键对齐）。
 *  ShortIdSchema 限制 ID 字符为字母/数字/下划线/短横线（不含冒号），无碰撞风险 */
export function annotationKey(sheetId: string, nodeId: string): string {
  return `${sheetId}:${nodeId}`;
}

/** 内部稳定 key，用于绑定 state 与"代际" */
type AnnotationsKey = string;

interface State {
  key: AnnotationsKey;
  annotations: Annotation[];
}

const DISABLED_KEY: AnnotationsKey = 'disabled';

export interface UseAnnotationsResult {
  /** 整画布批注列表（按 created_at 正序，与服务端 ORDER BY 一致）。
   *  state.key !== currentKey 时返 [] —— 切换 key 后第一次 render 不会拿到旧数据 */
  annotations: Annotation[];
  /** 派生：unresolved 计数按 sheet:node 分组（节点徽章直接读这个 Map） */
  unresolvedCountByNodeKey: Map<string, number>;
  /** 派生：按节点分组的全部批注（详情面板批注 tab 渲染用） */
  annotationsByNodeKey: Map<string, Annotation[]>;
  /** loading：当前 key 下的 GET 在飞行 */
  loading: boolean;
  /** 上次请求的错误（如有），新请求成功后清掉 */
  error: ApiError | null;
  /** 创建批注；成功返回新建对象；失败 throw ApiError。
   *  注意：hook 不做 create 级串行化（create 没有 id 概念）；
   *  调用方应在提交期间禁用按钮防误点重复提交；服务端容量限制（unresolved ≤100/total ≤500）兜底。 */
  createAnnotation: (input: CreateAnnotationInput) => Promise<Annotation>;
  /** 标记 resolved（乐观；按 id 局部回滚；同 id 串行化） */
  resolveAnnotation: (id: number) => Promise<void>;
  /** 重开（乐观；按 id 局部回滚；同 id 串行化） */
  reopenAnnotation: (id: number) => Promise<void>;
  /** 同 id 是否在 pending（UI 禁用按钮判定） */
  isAnnotationPending: (id: number) => boolean;
  /** 强制重新拉取（手动刷新场景；不会作废飞行中的 mutation） */
  refetch: () => Promise<void>;
}

/**
 * useAnnotations({ canvasId, user, readReady })
 *
 * @param canvasId 当前画布 id；本地草稿 / 未挂接服务端时传 null
 * @param user 当前登录用户；游客传 null
 * @param readReady **必填**：caller 应在 canvasMetaState.kind === 'server' 时传 true，否则传 false。
 *                   传 false 期间 hook 不发任何请求，所有 mutator throw not_ready。
 *                   防止画布元信息加载中提前请求批注产生 403/404。
 */
export function useAnnotations(opts: {
  canvasId: number | null;
  user: UserPublic | null;
  readReady: boolean;
}): UseAnnotationsResult {
  const { canvasId, user, readReady } = opts;
  const userId = user?.id ?? null;
  const enabled = canvasId !== null && user !== null && readReady;

  // 稳定 key：所有跨界判定都基于此
  const currentKey: AnnotationsKey = useMemo(
    () => (enabled ? `${canvasId}:${userId}:${readReady ? 1 : 0}` : DISABLED_KEY),
    [canvasId, userId, readReady, enabled],
  );

  // state 与 key 绑死：render 时同步过滤
  const [state, setState] = useState<State>(() => ({ key: currentKey, annotations: [] }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // 跨 key 代际（mutation 校验）
  const keyGenRef = useRef(0);
  // 同 key 内 GET 顺序号（拦旧 GET 回包）
  const fetchSeqRef = useRef(0);
  // mutation 落地计数（GET 检测期间是否有 mutation 落地）
  const mutationsCounterRef = useRef(0);
  // per-id 串行化
  const pendingIdsRef = useRef<Set<number>>(new Set());
  // unmount 守卫
  const mountedRef = useRef(true);

  // refetch 内部逻辑（接受 explicit key 避免闭包陈旧）
  const performFetch = useCallback(
    async (keyAtStart: AnnotationsKey, genAtStart: number): Promise<void> => {
      const seq = ++fetchSeqRef.current;
      const counterAtStart = mutationsCounterRef.current;

      if (keyAtStart === DISABLED_KEY) {
        // 不发请求；state 由 useEffect 直接 setState 清空
        // codex 05-三审 medium 1：必须显式清 loading，否则旧 GET 飞行中切 disabled 后，
        // 旧 GET 的 finally 因 seq 过期不会再清 loading → 永久 loading=true
        if (mountedRef.current) setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const list = await apiListAnnotations(canvasId!);
        if (!mountedRef.current) return;
        // 校验：旧 GET / key 已变 → 丢弃
        if (seq !== fetchSeqRef.current) return;
        if (genAtStart !== keyGenRef.current) return;
        // 检测：飞行期间有 mutation 落地 → 旧 list 已过期，跳过 + 重新 refetch
        if (mutationsCounterRef.current !== counterAtStart) {
          // 用最新代际再发一次（这次没有 mutation 干扰）
          void performFetch(keyAtStart, genAtStart);
          return;
        }
        setState({ key: keyAtStart, annotations: list });
      } catch (e) {
        if (!mountedRef.current) return;
        if (seq !== fetchSeqRef.current) return;
        if (genAtStart !== keyGenRef.current) return;
        setError(e as ApiError);
      } finally {
        if (mountedRef.current && seq === fetchSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [canvasId],
  );

  // 暴露给外部的 refetch（不递增 keyGen，避免作废同 key 的 mutation）
  const refetch = useCallback(async () => {
    await performFetch(currentKey, keyGenRef.current);
  }, [currentKey, performFetch]);

  // key 变化时：递增 keyGen（让飞行 mutation 全部丢弃）+ 立即同步 setState 重置 + 拉新 list
  useEffect(() => {
    const gen = ++keyGenRef.current;
    setState({ key: currentKey, annotations: [] }); // 同 key 改写 state 不会闪烁，跨 key 立即重置
    setError(null);
    void performFetch(currentKey, gen);
  }, [currentKey, performFetch]);

  // unmount cleanup（独立 effect 避免 key 变化误触发）
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 递增 keyGen 让飞行回包失效
      ++keyGenRef.current;
    };
  }, []);

  // ===== Render-time 输出过滤（不依赖 effect）=====
  const visibleAnnotations = state.key === currentKey ? state.annotations : [];

  // 派生计数（依赖 visibleAnnotations，跨 key 时直接为 []）
  const unresolvedCountByNodeKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of visibleAnnotations) {
      if (a.status !== 'unresolved') continue;
      const k = annotationKey(a.sheet_id, a.node_id);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [visibleAnnotations]);

  const annotationsByNodeKey = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of visibleAnnotations) {
      const k = annotationKey(a.sheet_id, a.node_id);
      const list = map.get(k);
      if (list) list.push(a);
      else map.set(k, [a]);
    }
    return map;
  }, [visibleAnnotations]);

  // ===== Mutators =====

  /** 内部：mutation 成功后 commit state 的辅助（保证 keyGen 校验 + counter 递增） */
  const commitMutation = useCallback(
    (genAtStart: number, updater: (prev: Annotation[]) => Annotation[]): boolean => {
      if (!mountedRef.current) return false;
      if (genAtStart !== keyGenRef.current) return false;
      setState((prev) => {
        if (prev.key !== currentKey) return prev; // 防御：key 已变，不动旧 state
        return { key: prev.key, annotations: updater(prev.annotations) };
      });
      mutationsCounterRef.current++;
      return true;
    },
    [currentKey],
  );

  const createAnnotationCb = useCallback(
    async (input: CreateAnnotationInput): Promise<Annotation> => {
      if (!enabled) {
        throw {
          status: 0,
          error: 'not_ready',
          message: '画布尚未连接到服务端，无法创建批注',
        } as ApiError;
      }
      // codex 05-三审 medium 2：mutator 内部 key guard，与 render 输出层语义一致
      if (state.key !== currentKey) {
        throw { status: 0, error: 'not_ready', message: '画布切换中' } as ApiError;
      }
      const gen = keyGenRef.current;
      const created = await apiCreateAnnotation(canvasId!, input);
      // 代际过期 → 丢弃结果（不写 state）但仍返回 created 给调用方（让 caller 知道服务端已建）
      commitMutation(gen, (prev) => [...prev, created]);
      return created;
    },
    [canvasId, enabled, commitMutation, state.key, currentKey],
  );

  const resolveAnnotationCb = useCallback(
    async (id: number): Promise<void> => {
      if (!enabled) {
        throw { status: 0, error: 'not_ready' } as ApiError;
      }
      // codex 05-三审 medium 2：mutator 内部数据隔离须与 render 输出层一致
      // 避免基于"隐藏的旧缓存"操作（state 已是新 key 的空集；旧 state.annotations 不应被 find 到）
      if (state.key !== currentKey) {
        throw { status: 0, error: 'not_ready', message: '画布切换中' } as ApiError;
      }
      if (pendingIdsRef.current.has(id)) {
        throw {
          status: 0,
          error: 'annotation_mutation_pending',
          message: '该批注上一个操作还在进行中',
        } as ApiError;
      }
      const gen = keyGenRef.current;
      const snapshot = state.annotations.find((a) => a.id === id);
      if (!snapshot) {
        throw {
          status: 0,
          error: 'annotation_not_in_cache',
          message: '该批注不在本地缓存中（可能已被刷新移除）',
        } as ApiError;
      }
      pendingIdsRef.current.add(id);
      // 乐观：本地立刻翻 resolved（仅此一条）
      setState((prev) => {
        if (prev.key !== currentKey) return prev;
        return {
          key: prev.key,
          annotations: prev.annotations.map((a) =>
            a.id === id && a.status === 'unresolved'
              ? {
                  ...a,
                  status: 'resolved',
                  resolved_by: user?.id ?? null,
                  resolved_at: Date.now(),
                }
              : a,
          ),
        };
      });
      try {
        const updated = await apiResolveAnnotation(id);
        commitMutation(gen, (prevList) => prevList.map((a) => (a.id === id ? updated : a)));
      } catch (e) {
        // B 方案：用 snapshot 还原目标条目（不动其他 id 的并发变化）
        commitMutation(gen, (prevList) => prevList.map((a) => (a.id === id ? snapshot : a)));
        throw e;
      } finally {
        pendingIdsRef.current.delete(id);
      }
    },
    [state.annotations, user, enabled, commitMutation, currentKey],
  );

  const reopenAnnotationCb = useCallback(
    async (id: number): Promise<void> => {
      if (!enabled) {
        throw { status: 0, error: 'not_ready' } as ApiError;
      }
      // codex 05-三审 medium 2：同 resolve，mutator 内部加 key guard
      if (state.key !== currentKey) {
        throw { status: 0, error: 'not_ready', message: '画布切换中' } as ApiError;
      }
      if (pendingIdsRef.current.has(id)) {
        throw {
          status: 0,
          error: 'annotation_mutation_pending',
          message: '该批注上一个操作还在进行中',
        } as ApiError;
      }
      const gen = keyGenRef.current;
      const snapshot = state.annotations.find((a) => a.id === id);
      if (!snapshot) {
        throw {
          status: 0,
          error: 'annotation_not_in_cache',
        } as ApiError;
      }
      pendingIdsRef.current.add(id);
      setState((prev) => {
        if (prev.key !== currentKey) return prev;
        return {
          key: prev.key,
          annotations: prev.annotations.map((a) =>
            a.id === id && a.status === 'resolved'
              ? {
                  ...a,
                  status: 'unresolved',
                  resolved_by: null,
                  resolved_at: null,
                  resolved_by_username: null,
                }
              : a,
          ),
        };
      });
      try {
        const updated = await apiReopenAnnotation(id);
        commitMutation(gen, (prevList) => prevList.map((a) => (a.id === id ? updated : a)));
      } catch (e) {
        commitMutation(gen, (prevList) => prevList.map((a) => (a.id === id ? snapshot : a)));
        throw e;
      } finally {
        pendingIdsRef.current.delete(id);
      }
    },
    [state.annotations, enabled, commitMutation, currentKey],
  );

  const isAnnotationPending = useCallback(
    (id: number): boolean => pendingIdsRef.current.has(id),
    [],
  );

  return {
    annotations: visibleAnnotations,
    unresolvedCountByNodeKey,
    annotationsByNodeKey,
    loading,
    error,
    createAnnotation: createAnnotationCb,
    resolveAnnotation: resolveAnnotationCb,
    reopenAnnotation: reopenAnnotationCb,
    isAnnotationPending,
    refetch,
  };
}
