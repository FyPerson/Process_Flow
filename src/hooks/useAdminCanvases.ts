// admin 画布管理数据层 hook（P3F-3）
//
// 简化模式（vs useUsers 的乐观更新）：
// - 单页面消费 / mountedRef + fetchSeq 拦旧回包
// - 不做乐观更新：每次 patch/archive 完成后 refetch 权威列表（codex 03 一审 high 2 修法）
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
  publishCanvas as apiPublishCanvas,
  unpublishCanvas as apiUnpublishCanvas,
} from '../api/canvases';

export interface UseAdminCanvasesResult {
  canvases: CanvasListItem[];
  loading: boolean;
  error: ApiError | null;
  /** 改元信息（name/description/is_public_to_guest）；成功/失败均 refetch 权威列表 */
  patchCanvas: (id: number, patch: PatchCanvasInput) => Promise<void>;
  /** 归档（软删）；archived=1 后服务端列表过滤；成功/失败均 refetch */
  archiveCanvas: (id: number) => Promise<void>;
  /** P3G publish：private → public + 写 published_*；refetch 拉新元信息 */
  publishCanvas: (id: number, published_note: string) => Promise<void>;
  /** P3G unpublish：public → private + 写 unpublished_*；refetch 拉新元信息 */
  unpublishCanvas: (id: number) => Promise<void>;
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

  // codex 03 一审 high 2 + medium 3 修法（codex 04 四审 medium 注释精确化）：
  // 不做乐观更新；成功路径 await 完整 refetch；失败路径 throw 后异步 refetch（不阻塞错误回传）。
  // 理由（内部 5 人项目 admin 单人操作场景）：
  // - admin 同时操作多个画布的并发概率低
  // - 简单 refetch 比"mutation 序号 + closure snapshot 回滚"代码量少且不会展示错误中间态
  // - 同时治 medium 3：updated_at 排序与服务端一致（之前用 Date.now() 估算偏差）
  // - 失败路径"异步 refetch"语义：调用方先拿到 throw 立刻显示错误，列表 refetch 在后台跑；
  //   可能短时间错误条与旧列表并存（内网 < 100ms 可接受）
  // 代价：操作完成到列表更新有 1 个 fetch 往返延迟（内网 < 100ms 用户感知不明显）

  const patchCanvasCb = useCallback(
    async (id: number, patch: PatchCanvasInput): Promise<void> => {
      try {
        await apiPatchCanvas(id, patch);
        if (!mountedRef.current) return;
        await performFetch();
      } catch (e) {
        // 失败也 refetch（防本地有过期状态或 race 残留）
        if (mountedRef.current) void performFetch();
        throw e;
      }
    },
    [performFetch],
  );

  const archiveCanvasCb = useCallback(
    async (id: number): Promise<void> => {
      try {
        await apiArchiveCanvas(id);
        if (!mountedRef.current) return;
        await performFetch();
      } catch (e) {
        if (mountedRef.current) void performFetch();
        throw e;
      }
    },
    [performFetch],
  );

  const publishCanvasCb = useCallback(
    async (id: number, published_note: string): Promise<void> => {
      try {
        await apiPublishCanvas(id, published_note);
        if (!mountedRef.current) return;
        await performFetch();
      } catch (e) {
        if (mountedRef.current) void performFetch();
        throw e;
      }
    },
    [performFetch],
  );

  const unpublishCanvasCb = useCallback(
    async (id: number): Promise<void> => {
      try {
        await apiUnpublishCanvas(id);
        if (!mountedRef.current) return;
        await performFetch();
      } catch (e) {
        if (mountedRef.current) void performFetch();
        throw e;
      }
    },
    [performFetch],
  );

  return {
    canvases,
    loading,
    error,
    patchCanvas: patchCanvasCb,
    archiveCanvas: archiveCanvasCb,
    publishCanvas: publishCanvasCb,
    unpublishCanvas: unpublishCanvasCb,
    refetch: performFetch,
  };
}
