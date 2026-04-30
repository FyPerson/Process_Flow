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
      const baseTs = Date.now().toString(36); // base36 缩短时间戳
      const newNodes = clipboardData.map((node, index) => {
        // 生成新 ID —— 不再 prefix 旧 ID，避免 copied_copied_copied... 累积超 64 字符
        // 后端 ShortIdSchema 限制 1-64 字符 [A-Za-z0-9_-]
        // 当前格式：n_<base36 时间戳>_<index>，如 'n_lz3y4k_0'，约 12-15 字符
        const newId = `n_${baseTs}_${index}`;
        idMap.set(node.id, newId);

        const copied = safeDeepCopy(node);
        // P3D-1 codex 必修 5：粘贴 = 当前用户的本地新节点。
        // 必须清掉源节点的 creator_*/updated_*/deprecated_*（否则用户复制别人的节点
        // 粘贴出来会"短暂继承别人 creator"，UX 反直觉），并打 __localNew
        // 让 canEditNodeData 立刻放行。is_deprecated 同理重置 ——
        // 粘贴出的副本是新节点，不应继承废弃状态。
        const cleanData = { ...(copied.data || {}) } as Record<string, unknown>;
        const META_KEYS_TO_RESET = [
          'creator_id', 'creator_username', 'created_at',
          'updated_by', 'updated_at',
          'is_deprecated', 'deprecated_by', 'deprecated_at', 'deprecated_by_username',
        ];
        for (const key of META_KEYS_TO_RESET) {
          delete cleanData[key];
        }
        cleanData.__localNew = true;

        return {
          ...copied,
          id: newId,
          position: {
            x: node.position.x + OFFSET_X,
            y: node.position.y + OFFSET_Y,
          },
          selected: true, // 选中新创建的节点
          data: cleanData as unknown as FlowNodeData,
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
