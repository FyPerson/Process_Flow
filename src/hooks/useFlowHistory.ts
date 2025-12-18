import { useRef, useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { safeDeepCopy } from '../utils/deepCopy';

import { FlowNodeData } from '../types/flow';

interface HistoryState {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

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
  const saveHistory = useCallback((nodes: Node<FlowNodeData>[], edges: Edge[]) => {
    // 如果正在执行撤销/重做操作，不保存历史
    if (isUndoRedoRef.current) {
      return;
    }

    try {
      // 删除当前索引之后的所有历史记录（分支）
      historyRef.current = historyRef.current.slice(0, currentIndexRef.current + 1);

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
  const undo = useCallback(
    (setNodes: (nodes: Node<FlowNodeData>[]) => void, setEdges: (edges: Edge[]) => void) => {
      if (currentIndexRef.current > 0) {
        isUndoRedoRef.current = true;
        currentIndexRef.current--;
        const state = historyRef.current[currentIndexRef.current];
        setNodes(safeDeepCopy(state.nodes));
        setEdges(safeDeepCopy(state.edges));

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
    (setNodes: (nodes: Node<FlowNodeData>[]) => void, setEdges: (edges: Edge[]) => void) => {
      if (currentIndexRef.current < historyRef.current.length - 1) {
        isUndoRedoRef.current = true;
        currentIndexRef.current++;
        const state = historyRef.current[currentIndexRef.current];
        setNodes(safeDeepCopy(state.nodes));
        setEdges(safeDeepCopy(state.edges));

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
