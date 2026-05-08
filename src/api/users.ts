// 前端 user 管理 API 客户端（与 server/routes/users.ts 契约对齐）
// 复用 src/api/annotations.ts 的 apiFetch 风格

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
    };
    throw err;
  }
  return body as T;
}

// =====================================================================
// 类型（与 server/schemas/user.ts AdminUserResponse 对齐）
// =====================================================================

export type UserRole = 'user' | 'admin';

export interface AdminUser {
  id: number;
  username: string;
  nickname: string;  // 2026-05-08：空 nickname 已由服务端 fallback 到 username
  role: UserRole;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

// =====================================================================
// API（全部要求 admin，requireFreshAdmin 服务端兜底）
// =====================================================================

export async function listUsers(): Promise<AdminUser[]> {
  const r = await apiFetch<{ users: AdminUser[] }>('/api/users');
  return r.users;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
  nickname?: string;
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const r = await apiFetch<{ user: AdminUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return r.user;
}

export interface PatchUserInput {
  role?: UserRole;
  password?: string;
  nickname?: string;
}

export async function patchUser(id: number, input: PatchUserInput): Promise<AdminUser> {
  const r = await apiFetch<{ user: AdminUser }>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return r.user;
}

export async function deleteUser(id: number): Promise<AdminUser> {
  const r = await apiFetch<{ user: AdminUser }>(`/api/users/${id}`, {
    method: 'DELETE',
  });
  return r.user;
}
