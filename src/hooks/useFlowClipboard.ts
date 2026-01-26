import { useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { safeDeepCopy } from '../utils/deepCopy';

import { FlowNodeData } from '../types/flow';

const OFFSET_X = 30; // 水平偏移
const OFFSET_Y = 30; // 垂直偏移
const CLIPBOARD_KEY = 'flow-clipboard'; // sessionStorage 键名

// 从 sessionStorage 读取剪贴板数据
function getClipboardData(): Node<FlowNodeData>[] {
  try {
    const data = sessionStorage.getItem(CLIPBOARD_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('读取剪贴板数据失败', e);
  }
  return [];
}

// 保存剪贴板数据到 sessionStorage
function setClipboardData(nodes: Node<FlowNodeData>[]): void {
  try {
    sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify(nodes));
  } catch (e) {
    console.error('保存剪贴板数据失败', e);
  }
}

export function useFlowClipboard() {
  // 复制节点
  const copyNodes = useCallback((selectedNodes: Node<FlowNodeData>[]) => {
    if (selectedNodes.length === 0) {
      return;
    }

    // 深拷贝选中的节点
    const copiedNodes = selectedNodes.map((node) => safeDeepCopy(node));

    // 存储到 sessionStorage（支持跨画布）
    setClipboardData(copiedNodes);
  }, []);

  // 粘贴节点
  const pasteNodes = useCallback(
    (
      setNodes: (updater: (nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[]) => void,
      edges: Edge[],
      saveHistory: () => void,
    ) => {
      // 从 sessionStorage 读取剪贴板数据
      const clipboardData = getClipboardData();

      if (!clipboardData || clipboardData.length === 0) {
        return;
      }

      // 生成新的节点 ID 映射
      const idMap = new Map<string, string>();

      // 创建新节点
      const newNodes = clipboardData.map((node, index) => {
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
