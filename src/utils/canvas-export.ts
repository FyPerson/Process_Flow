// 画布导出工具：支持两种语义
//   1. downloadCanvasFromServer(id) —— 从服务端 GET /api/canvases/:id/export
//      用 fetch + Authorization header 请求，把 Blob 触发浏览器下载
//      （直接 window.location 不带 token，私有画布会 403）
//   2. downloadProjectAsLocal(project, suffix) —— 直接把当前内存 project 序列化下载
//      用于"冲突逃生口"：服务端比本地新，要保的是用户内存中的本地版本
//
// 两个函数共用一个 triggerDownload helper

import type { MultiCanvasProject } from '../types/flow';
import type { ApiError } from '../api/canvases';

const TOKEN_KEY = 'business-flow:jwt';

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * 从 Content-Disposition header 解析文件名
 * 优先 RFC 5987 filename*=UTF-8''<encoded>，fallback 到 filename="..."
 * 全部失败时返回 null（caller 用 default fallback）
 */
function parseFilenameFromHeader(disposition: string | null): string | null {
  if (!disposition) return null;
  // RFC 5987：filename*=UTF-8''<percent-encoded>
  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // 解码失败继续 fallback
    }
  }
  // 普通 filename="..."
  const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  if (plainMatch) {
    return plainMatch[1].trim();
  }
  return null;
}

/** 通用：触发浏览器下载一个 Blob（不在 DOM 里留 a 标签）*/
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 异步释放，避免下载没开始就 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 从服务端导出画布 JSON 并触发浏览器下载
 * 走 GET /api/canvases/:id/export，带 Authorization
 * 失败时抛 ApiError（与 src/api/canvases.ts 的 ApiError 兼容）
 */
export async function downloadCanvasFromServer(id: number): Promise<void> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`/api/canvases/${id}/export`, { headers });
  } catch (e) {
    const err: ApiError = {
      status: 0,
      error: 'network_error',
      message: e instanceof Error ? e.message : 'network unreachable',
    };
    throw err;
  }

  if (!res.ok) {
    // 错误响应是 JSON
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
    const err: ApiError = {
      status: res.status,
      error: (obj?.error as string) || 'unknown',
      message: obj?.message as string | undefined,
    };
    throw err;
  }

  const blob = await res.blob();
  const filename = parseFilenameFromHeader(res.headers.get('Content-Disposition'))
    ?? `canvas-${id}.json`;
  triggerDownload(blob, filename);
}

/**
 * 把当前内存中的 project 序列化成 JSON 触发下载（不经过服务端）
 * 用于冲突逃生口：服务端比本地新，本地的改动还没保存，需要保留下来
 *
 * @param suffix 文件名后缀（如 'local' / 'conflict'），加在 canvasId 和时间戳之间
 *               最终文件名格式：{name 或 canvas-{id}}-{suffix}-{yyyyMMdd-HHmmss}.json
 */
export function downloadProjectAsLocal(
  project: MultiCanvasProject,
  options: { canvasId?: number | null; suffix?: string } = {}
): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

  const safeName = (project.name || `canvas-${options.canvasId ?? 'untitled'}`)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .slice(0, 80);
  const ts = formatTimestamp(new Date());
  const suffix = options.suffix ? `-${options.suffix}` : '';
  const filename = `${safeName}${suffix}-${ts}.json`;

  triggerDownload(blob, filename);
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
