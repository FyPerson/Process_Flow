import { useRef, useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { safeDeepCopy } from '../utils/deepCopy';

import { FlowNodeData } from '../types/flow';
import { mergeSnapshotByPermission, mergeEdgesForMergedNodes } from '../auth/canEditNode';
import type { UserPublic } from '../auth/api';

interface HistoryState {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

/**
 * P3D-2 step 9：snapshot 实质相等判定（用于 saveHistory 幂等）。
 * 简单 JSON.stringify 对比 —— snapshot 已 deepCopy 为 plain object，可序列化。
 * 50 节点级画布每次 stringify 仅几 KB，saveHistory 触发频次低（每次操作一次），可接受。
 */
function snapshotsEqual(a: HistoryState, b: HistoryState): boolean {
  try {
    return JSON.stringify(a.nodes) === JSON.stringify(b.nodes)
      && JSON.stringify(a.edges) === JSON.stringify(b.edges);
  } catch {
    // 序列化异常（理论上 snapshot 已 safeDeepCopy 不会含循环引用）→ fail-closed 走 push
    return false;
  }
}

export function useFlowHistory() {
  const historyRef = useRef<HistoryState[]>([]);
  const currentIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const isInitializedRef = useRef(false);

  // 初始化历史记录（仅在首次加载时调用）
  const initHistory = useCallback((nodes: Node<FlowNodeData>[], edges: Edge[]) => {
    if (isInitializedRef.current) {
      return;
    }

    try {
      historyRef.current = [
        {
          nodes: safeDeepCopy(nodes),
          edges: safeDeepCopy(edges),
        },
      ];
      currentIndexRef.current = 0;
      isInitializedRef.current = true;
    } catch (error) {
      console.error('初始化历史记录失败:', error);
    }
  }, []);

  // 保存历史记录
  // P3D-2 step 9 / 八审 + 九审 Low 1：React 18 StrictMode 双调用下 saveHistory 不幂等
  // → 同一 snapshot 会重复入栈，undo 需要按多次才能跨过去。
  // 修法：与栈顶 snapshot 序列化对比，相同则跳过。
  const saveHistory = useCallback((nodes: Node<FlowNodeData>[], edges: Edge[]) => {
    // 如果正在执行撤销/重做操作，不保存历史
    if (isUndoRedoRef.current) {
      return;
    }

    try {
      // 与栈顶（截断后即将 push 之前的最后一项）对比 snapshot 是否实质变化
      // 仅在 currentIndex 指向真实历史项时比较；初始 -1 直接走 push
      const branchTrimmed = historyRef.current.slice(0, currentIndexRef.current + 1);
      const top = branchTrimmed[branchTrimmed.length - 1];
      if (top && snapshotsEqual(top, { nodes, edges })) {
        // 幂等：栈顶已是同一 snapshot，不重复入栈，仅维持 branch 截断
        historyRef.current = branchTrimmed;
        currentIndexRef.current = branchTrimmed.length - 1;
        return;
      }

      // 删除当前索引之后的所有历史记录（分支）
      historyRef.current = branchTrimmed;

      // 添加新的历史记录
      historyRef.current.push({
        nodes: safeDeepCopy(nodes),
        edges: safeDeepCopy(edges),
      });

      // 限制历史记录数量
      if (historyRef.current.length > MAX_HISTORY) {
        historyRef.current = historyRef.current.slice(-MAX_HISTORY);
      }

      // 更新当前索引
      currentIndexRef.current = historyRef.current.length - 1;
    } catch (error) {
      console.error('保存历史记录失败:', error);
    }
  }, []);

  // 撤销
  // P3D-2 step 9 / 12-二审 必修 3：snapshot 整份 setNodes 会绕过中心 gate
  // （撤销/重做时不可编辑节点会被 snapshot 旧版本覆盖、ghost 还魂等）。
  // 修法：
  //   - 节点：mergeSnapshotByPermission 按节点级权限合并 + parentId 归一化（防孤儿）
  //   - 边：mergeEdgesForMergedNodes 按 mergedNodes 过滤 snapshot 边，并补回涉及保护节点
  //         （他人节点）的 current 边，避免 undo 抹除别人的连边
  // canvasWritable=false 时整个 undo 已被外层 readOnly 短路在 FlowCanvas 之外。
  const undo = useCallback(
    (
      setNodes: (nodes: Node<FlowNodeData>[]) => void,
      setEdges: (edges: Edge[]) => void,
      currentNodes: Node<FlowNodeData>[],
      currentEdges: Edge[],
      user: UserPublic | null,
      canvasWritable: boolean,
    ) => {
      if (currentIndexRef.current > 0) {
        isUndoRedoRef.current = true;
        currentIndexRef.current--;
        const state = historyRef.current[currentIndexRef.current];
        const snapshotNodes = safeDeepCopy(state.nodes);
        const snapshotEdges = safeDeepCopy(state.edges);
        const mergedNodes = mergeSnapshotByPermission(snapshotNodes, currentNodes, user, canvasWritable);
        const mergedEdges = mergeEdgesForMergedNodes(
          snapshotEdges,
          currentEdges,
          mergedNodes,
          currentNodes,
          user,
          canvasWritable,
        );
        setNodes(mergedNodes);
        setEdges(mergedEdges);

        // 延迟重置标志，确保状态更新完成
        setTimeout(() => {
          isUndoRedoRef.current = false;
        }, 100);
      }
    },
    [],
  );

  // 重做
  const redo = useCallback(
    (
      setNodes: (nodes: Node<FlowNodeData>[]) => void,
      setEdges: (edges: Edge[]) => void,
      currentNodes: Node<FlowNodeData>[],
      currentEdges: Edge[],
      user: UserPublic | null,
      canvasWritable: boolean,
    ) => {
      if (currentIndexRef.current < historyRef.current.length - 1) {
        isUndoRedoRef.current = true;
        currentIndexRef.current++;
        const state = historyRef.current[currentIndexRef.current];
        const snapshotNodes = safeDeepCopy(state.nodes);
        const snapshotEdges = safeDeepCopy(state.edges);
        const mergedNodes = mergeSnapshotByPermission(snapshotNodes, currentNodes, user, canvasWritable);
        const mergedEdges = mergeEdgesForMergedNodes(
          snapshotEdges,
          currentEdges,
          mergedNodes,
          currentNodes,
          user,
          canvasWritable,
        );
        setNodes(mergedNodes);
        setEdges(mergedEdges);

        // 延迟重置标志，确保状态更新完成
        setTimeout(() => {
          isUndoRedoRef.current = false;
        }, 100);
      }
    },
    [],
  );

  return {
    initHistory,
    saveHistory,
    undo,
    redo,
    isUndoRedoRef,
  };
}
