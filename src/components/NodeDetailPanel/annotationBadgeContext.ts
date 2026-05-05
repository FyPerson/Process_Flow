// P3E-3 节点徽章点击 + 计数上下文
//
// 设计：徽章在 CustomNode/GroupNode 内部渲染但触发动作要在 BFV 顶层（选中节点 +
// 设 pendingPanelTab）。用 React Context 注入回调，避免事件总线和 prop drilling。
// codex 06-取舍审 high 2 要求 nodeId 绑定，由 BFV onBadgeClick(nodeId) 实现。
//
// 修法（P3E-4 部署后发现）：unresolved 计数也通过 Context 注入而非 node.data 字段。
// 原因：FlowCanvas useNodesState(initialNodes) 把 BFV 传的 processedNodes 作为
// 内部 state 初始值，之后外部 props 变化不响应（React Flow 12 行为）。BFV 派生
// data.__annotationUnresolvedCount 后 FlowCanvas 内部 nodes state 锁住旧值，徽章
// 永远显示 0。改为 CustomNode/GroupNode 通过 Context 直接读最新计数。

import { createContext, useContext } from 'react';

export interface AnnotationBadgeContextValue {
  /** 徽章点击：选中节点 + 请求切批注 tab（含 nodeId 防时序错位） */
  onBadgeClick: (nodeId: string) => void;
  /** 读取节点的 unresolved 计数（按 sheetId+nodeId 复合定位）。
   *  返回 0 = 不显示徽章；> 99 在 UI 层展示为 "99+"。 */
  getUnresolvedCount: (sheetId: string, nodeId: string) => number;
  /** 当前激活的 sheet id（CustomNode/GroupNode 不知道自己在哪个 sheet，从这里读）。
   *  null = 无激活 sheet（理论不应出现）。 */
  activeSheetId: string | null;
}

export const AnnotationBadgeContext = createContext<AnnotationBadgeContextValue | null>(null);

/** 节点组件内消费 */
export function useAnnotationBadge(): AnnotationBadgeContextValue | null {
  return useContext(AnnotationBadgeContext);
}
