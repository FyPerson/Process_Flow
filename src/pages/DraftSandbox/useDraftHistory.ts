// DraftSandbox 撤销/重做历史栈（D-5）
//
// 设计：方案 §5 D-5 — 基础历史栈，栈深度 20（2026-05-14 拍板）
//
// 跟主应用 useFlowHistory 的区别：
//   - 无权限合并（游客无权限概念）
//   - 无 setNodes/setEdges 闭包参数，hook 返回 undo/redo 直接调用
//   - 用 JSON.stringify 做快照（节点 + 边都是 plain object，无循环引用）
//
// 同款保护（从 P3D-2 step 9 + P5 Day 1 踩坑沉淀）：
//   - snapshotsEqual 幂等防 StrictMode 双调用导致同 snapshot 重复入栈
//
// D-8 R-M3：删除原 isUndoRedoRef + setTimeout(100) 时间窗机制
//   原因：固定 100ms 时间窗假设让用户 undo 后 100ms 内立即添加节点/连线/改名被
//   静默跳过；低端机器/并发渲染下相反竞态。
//   替代：applySnapshot 路径（DraftSandbox.handleUndo/handleRedo → setNodes/setEdges）
//   不会触发 wrappedOnNodesChange（React Flow useNodesState 的 setter 直接更新
//   state 不走 onNodesChange）—— 因此 history 不会被反向递推。
//   万一未来 React Flow 行为变化触发，由 snapshotsEqual 兜底拒重复入栈。
//
// 拖动场景边界（caller 在 onNodeDragStop 推快照，onNodesChange position+dragging=true 时不推）
// 详见 DraftSandbox/index.tsx caller 端集成。

import { useCallback, useRef } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { DraftNodeData } from './DraftNode';

const MAX_HISTORY = 20; // 2026-05-14 拍板栈深度 20

interface HistoryState {
  nodes: Node<DraftNodeData>[];
  edges: Edge[];
}

function snapshotsEqual(a: HistoryState, b: HistoryState): boolean {
  try {
    return (
      JSON.stringify(a.nodes) === JSON.stringify(b.nodes) &&
      JSON.stringify(a.edges) === JSON.stringify(b.edges)
    );
  } catch {
    return false;
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function useDraftHistory(initialNodes: Node<DraftNodeData>[], initialEdges: Edge[]) {
  // 首屏快照（loadDraft 或空画布）作为栈底，避免 undo 时栈空
  const historyRef = useRef<HistoryState[]>([
    { nodes: deepClone(initialNodes), edges: deepClone(initialEdges) },
  ]);
  const currentIndexRef = useRef(0);

  // push 新快照（caller 在节点/边的"结构性变化"时调用——见 caller 端 push 策略）
  // - 与栈顶实质相等不推（snapshotsEqual 兜底防 StrictMode 双调用 + applySnapshot
  //   后若意外触发 push 也会被拦下）
  // - 栈深超 20 截掉最早一条
  const pushSnapshot = useCallback(
    (nodes: Node<DraftNodeData>[], edges: Edge[]) => {
      const next: HistoryState = { nodes: deepClone(nodes), edges: deepClone(edges) };
      const branch = historyRef.current.slice(0, currentIndexRef.current + 1);
      const top = branch[branch.length - 1];
      if (top && snapshotsEqual(top, next)) {
        historyRef.current = branch;
        currentIndexRef.current = branch.length - 1;
        return;
      }
      branch.push(next);
      if (branch.length > MAX_HISTORY) {
        branch.splice(0, branch.length - MAX_HISTORY);
      }
      historyRef.current = branch;
      currentIndexRef.current = branch.length - 1;
    },
    [],
  );

  // undo：返回上一个快照（或 null 表示无前态）
  // caller 拿到 snapshot 后 setNodes/setEdges
  const undo = useCallback((): HistoryState | null => {
    if (currentIndexRef.current <= 0) return null;
    currentIndexRef.current--;
    const state = historyRef.current[currentIndexRef.current];
    return { nodes: deepClone(state.nodes), edges: deepClone(state.edges) };
  }, []);

  const redo = useCallback((): HistoryState | null => {
    if (currentIndexRef.current >= historyRef.current.length - 1) return null;
    currentIndexRef.current++;
    const state = historyRef.current[currentIndexRef.current];
    return { nodes: deepClone(state.nodes), edges: deepClone(state.edges) };
  }, []);

  return { pushSnapshot, undo, redo };
}
