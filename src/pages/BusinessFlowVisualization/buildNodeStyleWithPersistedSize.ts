// #35 修法（codex spec-critique 2026-05-08 推荐方案 B / confidence=high）
//
// 把服务端持久化的 node.size 注入 React Flow 普通节点的 style.width/height，
// 避免加载时 React Flow 没拿到初始尺寸 → 测量 DOM → 反向同步 → convertNodesToStorage
// 用 measured/default 重算 size → updateSheetData markDirty → 5s autosave 推主版本 +1
// （这是公共画布上 user01 加载 admin 创节点时被 validateDeltaBPermissions 403 的源头）
//
// 与 BFV group 节点 L656-660 已有的 style 注入对称。
//
// codex M2 修法：用 number guard 而非 `||`，否则合法的 0 会被吞（虽然 schema 应禁止 0，
// 但容忍历史数据与未来 schema 变化）。size 缺失或非 number 时不注入 style，由 React Flow
// 自然测量 fallback（与现有行为等价）。
//
// 纯函数无副作用，便于单测覆盖"加载即 dirty"回归路径。

import type React from 'react';

/** 接受服务端 storage 节点的 size + style，返回合并后的 React Flow style 对象。
 * - 持久化 size 是 number → 注入 style.width/height（覆盖 style 上原有同名字段）
 * - 持久化 size 缺失/非 number → 不注入对应字段，保留 style 原值或由 React Flow 测量 fallback
 *
 * 使用方：BFV processedNodes useMemo 中的普通节点构造（type='custom'）。
 * group 节点保持已有内联实现不动（语义对称但行为已验证）。 */
export function buildNodeStyleWithPersistedSize(
  inlineStyle: React.CSSProperties | undefined,
  size: { width?: number | string | undefined; height?: number | string | undefined } | undefined,
): React.CSSProperties {
  const persistedW = typeof size?.width === 'number' ? size.width : undefined;
  const persistedH = typeof size?.height === 'number' ? size.height : undefined;
  return {
    ...inlineStyle,
    ...(persistedW !== undefined ? { width: persistedW } : {}),
    ...(persistedH !== undefined ? { height: persistedH } : {}),
  };
}
