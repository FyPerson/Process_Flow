// admin 画布管理数据层 hook（P3F-3）
//
// 与 useUsers 同款简化模式：
// - 单页面消费 / mountedRef + fetchSeq 拦旧回包 / 乐观更新 + 失败回滚
// - 复用现有 src/api/canvases.ts 的 listCanvases / patchCanvas / archiveCanvas
// - admin 视角：listCanvases 走服务端 listCanvasesForAdmin（拉所有非归档）

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ApiError,
  type CanvasListItem,
  type PatchCanvasInput,
  archiveCanvas as apiArchiveCanvas,
  listCanvases as apiListCanvases,
  patchCanvas as apiPatchCanvas,
} from '../api/canvases';

export interface UseAdminCanvasesResult {
  canvases: CanvasListItem[];
  loading: boolean;
  error: ApiError | null;
  /** 改元信息（name/description/is_public_to_guest）；乐观更新；失败回滚 */
  patchCanvas: (id: number, patch: PatchCanvasInput) => Promise<void>;
  /** 归档（软删）；乐观从列表移除（archived=1 → 列表过滤）；失败回滚 */
  archiveCanvas: (id: number) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useAdminCanvases(): UseAdminCanvasesResult {
  const [canvases, setCanvases] = useState<CanvasListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const fetchSeqRef = useRef(0);
  const mountedRef = useRef(true);

  const performFetch = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const list = await apiListCanvases();
      if (!mountedRef.current) return;
      if (seq !== fetchSeqRef.current) return;
      // 排序服务端已按 updated_at DESC，保持
      setCanvases(list);
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

  useEffect(() => {
    mountedRef.current = true;
    void performFetch();
    return () => {
      mountedRef.current = false;
    };
  }, [performFetch]);

  const patchCanvasCb = useCallback(
    async (id: number, patch: PatchCanvasInput): Promise<void> => {
      // 乐观更新：在本地写新字段
      let snapshot: CanvasListItem | null = null;
      setCanvases((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          snapshot = c;
          return {
            ...c,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.is_public_to_guest !== undefined
              ? { is_public_to_guest: patch.is_public_to_guest }
              : {}),
            updated_at: Date.now(),
          };
        }),
      );
      try {
        await apiPatchCanvas(id, patch);
        if (!mountedRef.current) return;
        // 服务端无返回完整 row，refetch 拿权威值（name/desc/is_public_to_guest）
        // 不全量 refetch 避免列表抖动；本地 patch 已是最终态足够（下次 mount 再权威同步）
      } catch (e) {
        // 失败回滚
        if (mountedRef.current && snapshot !== null) {
          const snap: CanvasListItem = snapshot;
          setCanvases((prev) => prev.map((c) => (c.id === id ? snap : c)));
        }
        throw e;
      }
    },
    [],
  );

  const archiveCanvasCb = useCallback(
    async (id: number): Promise<void> => {
      // 乐观更新：从列表移除（archived=1 服务端过滤）
      let snapshot: CanvasListItem | null = null;
      let snapshotIdx: number = -1;
      setCanvases((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        if (idx >= 0) {
          snapshot = prev[idx];
          snapshotIdx = idx;
          return prev.filter((_, i) => i !== idx);
        }
        return prev;
      });
      try {
        await apiArchiveCanvas(id);
      } catch (e) {
        // 失败回滚（按原索引插回）
        if (mountedRef.current && snapshot !== null) {
          const snap: CanvasListItem = snapshot;
          const at: number = snapshotIdx;
          setCanvases((prev) => {
            const next = [...prev];
            next.splice(Math.min(at, next.length), 0, snap);
            return next;
          });
        }
        throw e;
      }
    },
    [],
  );

  return {
    canvases,
    loading,
    error,
    patchCanvas: patchCanvasCb,
    archiveCanvas: archiveCanvasCb,
    refetch: performFetch,
  };
}
