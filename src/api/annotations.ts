// 前端 annotation API 客户端（与 server/routes/annotations.ts 契约对齐）
// 复用 src/api/canvases.ts 的 fetch 封装风格

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
  current?: number;
  max?: number;
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
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch (e) {
    const err: ApiError = {
      status: 0,
      error: 'network_error',
      message: e instanceof Error ? e.message : 'network unreachable',
    };
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  let body: unknown;
  try {
    body = ct.includes('application/json') ? await res.json() : await res.text();
  } catch (e) {
    const err: ApiError = {
      status: res.status,
      error: 'invalid_response',
      message: e instanceof Error ? e.message : 'failed to parse response',
    };
    throw err;
  }
  if (!res.ok) {
    const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
    const err: ApiError = {
      status: res.status,
      error: (obj?.error as string) || 'unknown',
      message: (obj?.message as string | undefined) ?? (typeof body === 'string' ? body : undefined),
      current: obj?.current as number | undefined,
      max: obj?.max as number | undefined,
      issues: obj?.issues as Array<{ path: string; message: string }> | undefined,
    };
    throw err;
  }
  return body as T;
}

// =====================================================================
// 类型（与 server/schemas/annotation.ts AnnotationResponse + services 对齐）
// =====================================================================

export interface Annotation {
  id: number;
  canvas_id: number;
  sheet_id: string;
  node_id: string;
  author_id: number;
  author_username: string | null;
  content: string;
  status: 'unresolved' | 'resolved';
  resolved_by: number | null;
  resolved_by_username: string | null;
  resolved_at: number | null;
  created_at: number;
}

// =====================================================================
// API
// =====================================================================

/** 列出某画布所有批注（整画布一次返，按 created_at 正序） */
export async function listAnnotations(canvasId: number): Promise<Annotation[]> {
  const r = await apiFetch<{ annotations: Annotation[] }>(
    `/api/canvases/${canvasId}/annotations`,
  );
  return r.annotations;
}

export interface CreateAnnotationInput {
  sheetId: string;
  nodeId: string;
  content: string;
}

/** 创建批注 */
export async function createAnnotation(
  canvasId: number,
  input: CreateAnnotationInput,
): Promise<Annotation> {
  const r = await apiFetch<{ annotation: Annotation }>(
    `/api/canvases/${canvasId}/annotations`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return r.annotation;
}

/** 标记 resolved */
export async function resolveAnnotation(id: number): Promise<Annotation> {
  const r = await apiFetch<{ annotation: Annotation }>(
    `/api/annotations/${id}/resolve`,
    { method: 'PATCH' },
  );
  return r.annotation;
}

/** 重开 */
export async function reopenAnnotation(id: number): Promise<Annotation> {
  const r = await apiFetch<{ annotation: Annotation }>(
    `/api/annotations/${id}/reopen`,
    { method: 'PATCH' },
  );
  return r.annotation;
}
