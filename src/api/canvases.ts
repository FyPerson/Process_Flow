// 前端 canvas API 客户端
// 复用 src/auth/api.ts 的 fetch 封装风格（自动带 Authorization、ApiError 归一）

import type { MultiCanvasProject } from '../types/flow.ts';
import type { Conflict, SaveCanvasResultClient } from './canvases.types.ts';

const TOKEN_KEY = 'business-flow:jwt';

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export interface ApiError {
  status: number;
  error: string;
  message?: string;
  // PUT 冲突时携带
  currentVersion?: number;
  // 字段校验失败时携带
  issues?: Array<{ path: string; message: string }>;
  // PUT 409 conflict 真合并冲突时携带（Day 3 取舍审 high 风险 1 修法）
  // D-3 已建 canvases.types.ts Conflict 镜像，类型从 unknown[] 收紧到 Conflict[]
  conflicts?: Conflict[];
}

async function apiFetch<T>(path: string, init?: RequestInit & { authed?: boolean }): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getToken();
  if (token && init?.authed !== false) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // [DEBUG #15] 入口埋点
  console.log('[DEBUG#15 apiFetch] enter', { path, method: init?.method ?? 'GET' });

  // 网络层失败（断网、CORS、DNS）—— 归一为 ApiError 让上层用相同 try/catch 处理
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch (e) {
    // [DEBUG #15] 路径 A：fetch 本身抛异常
    console.error('[DEBUG#15 apiFetch] PATH-A fetch threw', { path, error: e });
    const err: ApiError = {
      status: 0,
      error: 'network_error',
      message: e instanceof Error ? e.message : 'network unreachable',
    };
    throw err;
  }

  // [DEBUG #15] fetch 成功后埋点
  console.log('[DEBUG#15 apiFetch] fetch ok', {
    path,
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type'),
  });

  const ct = res.headers.get('content-type') || '';
  // JSON 解析失败也归一（服务端可能返了 5xx HTML）
  let body: unknown;
  try {
    body = ct.includes('application/json') ? await res.json() : await res.text();
  } catch (e) {
    // [DEBUG #15] 路径 B：body 解析抛异常
    console.error('[DEBUG#15 apiFetch] PATH-B body parse threw', { path, status: res.status, error: e });
    const err: ApiError = {
      status: res.status,
      error: 'invalid_response',
      message: e instanceof Error ? e.message : 'failed to parse response',
    };
    throw err;
  }

  // [DEBUG #15] body 解析成功后埋点
  console.log('[DEBUG#15 apiFetch] body parsed', {
    path,
    status: res.status,
    bodyType: typeof body,
    bodyPreview: typeof body === 'string' ? body.slice(0, 100) : JSON.stringify(body).slice(0, 200),
  });

  if (!res.ok) {
    // [DEBUG #15] 路径 C：HTTP 非 2xx
    console.error('[DEBUG#15 apiFetch] PATH-C non-ok status', { path, status: res.status, body });
    const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
    const err: ApiError = {
      status: res.status,
      error: (obj?.error as string) || 'unknown',
      message:
        (obj?.message as string | undefined) ??
        (typeof body === 'string' ? body : undefined),
      currentVersion: obj?.currentVersion as number | undefined,
      issues: obj?.issues as Array<{ path: string; message: string }> | undefined,
      // Day 3 取舍审 high 风险 1：解析 409 conflict 的 conflicts 数组让 hook 拿到
      // 类型从服务端契约保证（详见 src/api/canvases.types.contract.test.ts）
      conflicts: Array.isArray(obj?.conflicts) ? (obj.conflicts as Conflict[]) : undefined,
    };
    throw err;
  }

  // [DEBUG #15] 正常返回路径
  console.log('[DEBUG#15 apiFetch] returning ok body', { path, status: res.status });
  return body as T;
}

// =====================================================================
// 类型（与后端 schemas/canvas.ts + services/canvases.ts 对齐）
// =====================================================================

export type Visibility = 'public' | 'private';

export interface CanvasListItem {
  id: number;
  name: string;
  description: string | null;
  visibility: Visibility;
  is_public_to_guest: boolean;
  owner_id: number | null;
  version: number;
  created_by: number;
  created_at: number;
  updated_by: number;
  updated_at: number;
  archived: boolean;
  // P3G 公共画布发布有摩擦治理（migration 0003）
  // - published_*：最近一次发布的元信息（"最近一次"语义，重复发布会覆盖）
  // - unpublished_*：最近一次撤回的元信息（撤回后保留 published_* 不清空）
  published_at: number | null;
  published_by: number | null;
  published_note: string | null;
  unpublished_at: number | null;
  unpublished_by: number | null;
  // 阶段 4 P4C：列表页"X 人在编辑"角标；服务端按 90s 心跳过滤注入；游客时为 0；不计自己
  activeEditors?: number;
}

export interface CanvasFull extends CanvasListItem {
  data: MultiCanvasProject;
}

// =====================================================================
// API
// =====================================================================

export async function listCanvases(): Promise<CanvasListItem[]> {
  const r = await apiFetch<{ canvases: CanvasListItem[] }>('/api/canvases');
  return r.canvases;
}

export async function getCanvas(id: number): Promise<CanvasFull> {
  const r = await apiFetch<{ canvas: CanvasFull }>(`/api/canvases/${id}`);
  return r.canvas;
}

export interface CreateCanvasInput {
  name: string;
  description?: string;
  visibility: Visibility;
  is_public_to_guest?: boolean;
  data: MultiCanvasProject;
}

export async function createCanvas(input: CreateCanvasInput): Promise<{ id: number; version: number }> {
  return apiFetch<{ id: number; version: number }>('/api/canvases', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// SaveCanvasResult re-export — Day 3 D-3 收紧为 SaveCanvasResultClient（含 merged=true 路径）
export type SaveCanvasResult = SaveCanvasResultClient;

/**
 * 保存画布（PUT，乐观锁）
 * - 成功：返回 SaveCanvasResult（merged=false 直接保存 / merged=true 服务端真合并 mergedData 含双方）
 * - 冲突：抛 ApiError，status=409，含 currentVersion + 可能的 conflicts 数组（真合并冲突）
 */
export async function saveCanvas(
  id: number,
  baseVersion: number,
  data: MultiCanvasProject
): Promise<SaveCanvasResult> {
  return apiFetch<SaveCanvasResult>(`/api/canvases/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ baseVersion, data }),
  });
}

export interface PatchCanvasInput {
  name?: string;
  description?: string;
  is_public_to_guest?: boolean;
  archived?: boolean;
  owner_id?: number | null;
}

export async function patchCanvas(id: number, patch: PatchCanvasInput): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/canvases/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function archiveCanvas(id: number): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/canvases/${id}`, { method: 'DELETE' });
}

/** 导出画布 JSON（直接走浏览器下载；可游客）*/
export function exportCanvasUrl(id: number): string {
  return `/api/canvases/${id}/export`;
}

export async function importCanvas(input: {
  name?: string;
  description?: string;
  data: MultiCanvasProject;
}): Promise<{ id: number; version: number }> {
  return apiFetch<{ id: number; version: number }>('/api/canvases/import', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// =====================================================================
// P3G publish/unpublish
// =====================================================================

/** 发布画布（private → public）。published_note 1-500 字非空。
 *  失败时抛 ApiError（status=403/409/400/404）。 */
export async function publishCanvas(id: number, published_note: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/canvases/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ published_note }),
  });
}

/** 撤回画布（public → private）。当前不需要参数。
 *  失败时抛 ApiError（status=403/409/404）。 */
export async function unpublishCanvas(id: number): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/canvases/${id}/unpublish`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// =====================================================================
// 阶段 4 P4A 心跳 + P4B 草稿
// =====================================================================

export interface ActiveEditor {
  userId: number;
  username: string;
  lastSeenAt: number;
}

/** 上报心跳；返回除自己外的活跃编辑者列表。30s 一次，document.hidden 时暂停（判断点 6） */
export async function postHeartbeat(canvasId: number): Promise<ActiveEditor[]> {
  const r = await apiFetch<{ otherEditors: ActiveEditor[] }>(
    `/api/canvases/${canvasId}/heartbeat`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return r.otherEditors;
}

export interface DraftPayload {
  canvasId: number;
  data: string; // JSON 字符串（FlowDefinition / MultiCanvasProject 序列化）
  baseVersion: number;
  savedAt: number;
}

/** 取草稿；不存在抛 ApiError status=404 + error="no_draft" */
export async function getDraft(canvasId: number): Promise<DraftPayload> {
  const r = await apiFetch<{ draft: DraftPayload }>(
    `/api/canvases/${canvasId}/draft`,
  );
  return r.draft;
}

/** 上传草稿；413 too large / 429 quota 通过 ApiError 抛出。
 *  keepalive=true 在 visibilitychange/pagehide 兜底场景下使用（判断点 5）。 */
export async function putDraft(
  canvasId: number,
  data: string,
  baseVersion: number,
  options?: { keepalive?: boolean },
): Promise<{ ok: true; savedAt: number }> {
  return apiFetch<{ ok: true; savedAt: number }>(
    `/api/canvases/${canvasId}/draft`,
    {
      method: 'PUT',
      body: JSON.stringify({ data, baseVersion }),
      keepalive: options?.keepalive,
    },
  );
}

/** 删草稿（幂等） */
export async function deleteDraft(canvasId: number): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/canvases/${canvasId}/draft`, {
    method: 'DELETE',
  });
}
