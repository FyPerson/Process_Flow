// 前端 canvas API 客户端
// 复用 src/auth/api.ts 的 fetch 封装风格（自动带 Authorization、ApiError 归一）

import type { MultiCanvasProject } from '../types/flow.ts';

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

  const res = await fetch(path, { ...init, headers });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      error: typeof body === 'object' && body !== null ? body.error || 'unknown' : 'unknown',
      message:
        typeof body === 'object' && body !== null
          ? body.message
          : typeof body === 'string'
            ? body
            : undefined,
      currentVersion:
        typeof body === 'object' && body !== null ? body.currentVersion : undefined,
      issues: typeof body === 'object' && body !== null ? body.issues : undefined,
    };
    throw err;
  }
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

export interface SaveCanvasResult {
  ok: true;
  version: number;
  merged: false;
}

/**
 * 保存画布（PUT，乐观锁）
 * - 成功：返回 SaveCanvasResult
 * - 冲突：抛 ApiError，status=409，含 currentVersion
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
