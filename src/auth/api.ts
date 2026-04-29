// 前端 auth API 客户端 + 通用 fetch 封装
//
// 注意：所有 user 输入（用户名、密码）以普通字符串传给 server，由 server 端 Zod 校验。
// JWT 存 localStorage（方案 §1.2 + 安全前提：禁 dangerouslySetInnerHTML / 用户输入纯文本渲染 / helmet CSP）。

const TOKEN_KEY = 'business-flow:jwt';

export type Role = 'user' | 'admin';

export interface UserPublic {
  id: number;
  username: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  user: UserPublic;
}

export interface ApiError {
  status: number;
  error: string;
  message?: string;
}

/** 持久化 token 到 localStorage（也可配合 sessionStorage 做"勾不记住"） */
export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage 被禁用时静默失败（页面刷新后回到未登录）
  }
}

/** 通用 fetch：自动带 Authorization、解析 JSON、错误归一为 ApiError */
async function apiFetch<T>(path: string, init?: RequestInit & { authed?: boolean }): Promise<T> {
  const headers = new Headers(init?.headers || {});
  headers.set('Content-Type', 'application/json');

  const token = getStoredToken();
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
    };
    throw err;
  }
  return body as T;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    authed: false, // 登录本身不带旧 token
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchMe(): Promise<UserPublic> {
  const r = await apiFetch<{ user: UserPublic }>('/api/auth/me');
  return r.user;
}

export async function refreshToken(): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/auth/refresh', { method: 'POST' });
}

export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  await apiFetch<{ ok: true }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}
