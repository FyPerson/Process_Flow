// P3E-3 节点徽章点击上下文
//
// 设计：徽章在 CustomNode/GroupNode 内部渲染但触发动作要在 BFV 顶层（选中节点 +
// 设 pendingPanelTab）。用 React Context 注入回调，避免事件总线和 prop drilling。
// codex 06-取舍审 high 2 要求 nodeId 绑定，由 BFV onBadgeClick(nodeId) 实现。

import { createContext, useContext } from 'react';

export interface AnnotationBadgeContextValue {
  /** 徽章点击：选中节点 + 请求切批注 tab（含 nodeId 防时序错位） */
  onBadgeClick: (nodeId: string) => void;
}

export const AnnotationBadgeContext = createContext<AnnotationBadgeContextValue | null>(null);

/** 节点组件内消费 */
export function useAnnotationBadge(): AnnotationBadgeContextValue | null {
  return useContext(AnnotationBadgeContext);
}
