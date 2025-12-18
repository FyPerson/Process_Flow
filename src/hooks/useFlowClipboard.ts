import { useRef, useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { safeDeepCopy } from '../utils/deepCopy';

import { FlowNodeData } from '../types/flow';

const OFFSET_X = 30; // 水平偏移
const OFFSET_Y = 30; // 垂直偏移

export function useFlowClipboard() {
  const clipboardRef = useRef<Node<FlowNodeData>[]>([]);

  // 复制节点
  const copyNodes = useCallback((selectedNodes: Node<FlowNodeData>[]) => {
    if (selectedNodes.length === 0) {
      return;
    }

    // 深拷贝选中的节点
    const copiedNodes = selectedNodes.map((node) => safeDeepCopy(node));

    // 存储到剪贴板
    clipboardRef.current = copiedNodes;
  }, []);

  // 粘贴节点
  const pasteNodes = useCallback(
    (
      setNodes: (updater: (nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[]) => void,
      edges: Edge[],
      saveHistory: () => void,
    ) => {
      if (!clipboardRef.current || clipboardRef.current.length === 0) {
        return;
      }

      // 生成新的节点 ID 映射
      const idMap = new Map<string, string>();

      // 创建新节点
      const newNodes = clipboardRef.current.map((node, index) => {
        // 生成新 ID
        const newId = `copied_${node.id}_${Date.now()}_${index}`;
        idMap.set(node.id, newId);

        return {
          ...safeDeepCopy(node),
          id: newId,
          position: {
            x: node.position.x + OFFSET_X,
            y: node.position.y + OFFSET_Y,
          },
          selected: true, // 选中新创建的节点
        };
      });

      // 添加新节点到画布
      setNodes((nodes) => {
        // 取消所有现有节点的选中状态
        const updatedNodes = nodes.map((node) => ({
          ...node,
          selected: false,
        }));

        // 添加新节点
        updatedNodes.push(...newNodes);

        // 保存历史记录（异步）
        setTimeout(() => {
          saveHistory();
        }, 0);

        return updatedNodes;
      });
    },
    [],
  );

  return {
    copyNodes,
    pasteNodes,
  };
}
