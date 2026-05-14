// DraftSandbox localStorage 持久化
//
// 设计：方案 §3.3 — localStorage 单 key，刷新页面恢复
//
// 关键约束：
//   - 数据仅在本设备本浏览器（不跨设备同步，不入服务端数据库）
//   - debounce 500ms 写入：避免拖动节点时频繁写 localStorage
//   - viewport 不持久化（2026-05-14 拍板）：刷新 fitView 重置视角，简化数据结构
//   - version 字段防未来 schema 升级（D-8 L1 拍板的迁移原则）：
//       破坏性变更（删字段/改语义）→ 升 version 数字 + 直接清空旧数据（同当前策略）
//       非破坏性变更（加可选字段）→ 不升 version，用 migrateDraft(raw) 补默认值
//     当前 MVP 不实现 migrateDraft，真正出现 v2 时再加
//   - 容错：localStorage 配额满 / 浏览器禁用 / JSON.parse 失败 → 不抛错，saveDraft
//     返回 SaveResult 让 caller 在 UI 上降级提示（D-8 M3）

import type { Edge, Node } from '@xyflow/react';
import type { DraftNodeData } from './DraftNode';

const STORAGE_KEY = 'business-flow:draft-sandbox:v1';
const STORAGE_VERSION = 1;

export interface DraftSandboxState {
  version: number;
  nodes: Node<DraftNodeData>[];
  edges: Edge[];
  updatedAt: number;
}

/**
 * 从 localStorage 读取草稿。失败 fallback null（caller 用空画布初始化）
 * 错误场景：(a) 无数据 (b) JSON.parse 失败 (c) version 不匹配 (d) localStorage 禁用
 */
export function loadDraft(): DraftSandboxState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftSandboxState>;
    if (parsed.version !== STORAGE_VERSION) {
      console.warn(
        `[draft-sandbox] localStorage version mismatch: expected ${STORAGE_VERSION}, got ${parsed.version}. Falling back to empty canvas.`,
      );
      return null;
    }
    // 最小 schema 校验：nodes / edges 必须是数组
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      console.warn('[draft-sandbox] localStorage payload malformed (nodes/edges not array)');
      return null;
    }
    return parsed as DraftSandboxState;
  } catch (err) {
    console.warn('[draft-sandbox] loadDraft failed:', err);
    return null;
  }
}

/**
 * 写入 localStorage。返回 SaveResult 让 caller 据此 UI 降级提示（D-8 M3）
 * 失败场景：localStorage 配额满 / 浏览器禁用 / JSON.stringify 失败
 * 失败时 console warn 不抛错（caller 继续工作）
 */
export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'quota_exceeded' | 'storage_disabled' | 'unknown'; message: string };

export function saveDraft(nodes: Node<DraftNodeData>[], edges: Edge[]): SaveResult {
  try {
    const payload: DraftSandboxState = {
      version: STORAGE_VERSION,
      nodes,
      edges,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    console.warn('[draft-sandbox] saveDraft failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    // 区分 quota / 禁用 / 其他
    const lower = message.toLowerCase();
    const reason: 'quota_exceeded' | 'storage_disabled' | 'unknown' =
      lower.includes('quota')
        ? 'quota_exceeded'
        : lower.includes('disable') || lower.includes('access') || lower.includes('secur')
          ? 'storage_disabled'
          : 'unknown';
    return { ok: false, reason, message };
  }
}

/**
 * 清空草稿（暂未挂 UI 入口；保留 export 以备未来"清空草稿"按钮使用）
 */
export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[draft-sandbox] clearDraft failed:', err);
  }
}
