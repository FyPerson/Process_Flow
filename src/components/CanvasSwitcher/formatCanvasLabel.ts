// CanvasSwitcher 文案前缀计算（2026-05-08 用户需求）
//
// 规则（与 codex spec-critique 推荐方案 B 一致）：
// - visibility==='public' → 「🌐 [公共画布] xxx」
// - visibility==='private' 且 owner_id===currentUserId → 「🔒 [个人] xxx」
// - visibility==='private' 且 owner_id!==currentUserId（admin 看别人的）→ 「🔒 [creator_nickname的] xxx」
// - 游客（currentUserId==null）只看到 public，不会触发"个人/别人"分支
// - creator_nickname 缺失（理论不会发生）兜底为 creator_username 或 'unknown'
//
// 纯函数：便于单测 + 三处调用方（trigger / 下拉项 / 未来其他位置）一致。
//
// 不在这里 strip emoji（图标）—— 调用方按需拼接 icon + label。

import type { CanvasListItem } from '../../api/canvases';

export interface CanvasLabelInput {
  canvas: Pick<CanvasListItem, 'name' | 'visibility' | 'owner_id' | 'creator_username' | 'creator_nickname'>;
  currentUserId: number | null;
}

export interface CanvasLabel {
  /** 不含 emoji 的标签前缀，已包含中括号，如 '[公共画布] '，'[个人] '，'[老王的] '。
   *  空字符串表示无前缀（保留兜底，正常 path 永远有前缀）。 */
  prefix: string;
  /** 原始 canvas name */
  name: string;
  /** 推荐使用的 emoji 图标：'🌐' | '🔒'；调用方自行决定是否渲染 */
  icon: '🌐' | '🔒';
}

export function formatCanvasLabel(input: CanvasLabelInput): CanvasLabel {
  const { canvas, currentUserId } = input;

  if (canvas.visibility === 'public') {
    return {
      prefix: '[公共画布] ',
      name: canvas.name,
      icon: '🌐',
    };
  }

  // visibility === 'private'
  if (currentUserId !== null && canvas.owner_id === currentUserId) {
    // 自己 owner 的 private 画布
    return {
      prefix: '[个人] ',
      name: canvas.name,
      icon: '🔒',
    };
  }

  // 别人的 private（仅 admin 视角能看到）
  // 兜底链：nickname → username → 'unknown'（理论不会，防御性）
  const ownerLabel =
    canvas.creator_nickname ?? canvas.creator_username ?? 'unknown';
  return {
    prefix: `[${ownerLabel}的] `,
    name: canvas.name,
    icon: '🔒',
  };
}
