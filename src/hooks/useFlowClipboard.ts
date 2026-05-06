import { useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { safeDeepCopy } from '../utils/deepCopy';
import { newNodeId, newGroupId } from '../utils/ids';
import { getUniqueName } from '../utils/uniqueName';

import { FlowNodeData } from '../types/flow';

const OFFSET_X = 30; // 水平偏移
const OFFSET_Y = 30; // 垂直偏移
const CLIPBOARD_KEY = 'flow-clipboard'; // sessionStorage 键名

const META_KEYS_TO_RESET = [
  'creator_id', 'creator_username', 'created_at',
  'updated_by', 'updated_at',
  'is_deprecated', 'deprecated_by', 'deprecated_at', 'deprecated_by_username',
];

// P3B codex 二审/三审：把"生成新节点列表 + remap 引用"抽成纯函数，便于单测
// 行为约定：
//  - ID：group 节点用 newGroupId()（g_ 前缀）；其他用 newNodeId()（n_ 前缀）
//  - parentId / position：
//      a) parentId 命中 idMap（父节点也在剪贴板内）→ remap parentId；position **保持原值**
//         （React Flow 子节点 position 是相对父的；新 group 整体偏移后 child 不能再加 OFFSET，
//          否则组内布局错乱 —— 三审 Issue 1）
//      b) parentId 未命中（半组选区，父节点没在剪贴板里）→ 删 parentId/extent；
//         position 加 OFFSET 按"无父孤儿"降级处理（与 c 同款）；**不做绝对坐标转换**
//         （FlowCanvas.copyNodes 只 copy 选中节点，剪贴板里没有源父 position 上下文 ——
//          三审 Issue 2 修法选择 A）。视觉上半组复制出的孤儿子节点会以"父原相对坐标 + OFFSET"
//          出现在画布坐标系，可能偏左上，符合"不支持但不崩"的可预期降级。未来若产品明确
//          要支持，可改 copyNodes 把源父 position 写入剪贴板元信息再扩展此函数。
//      c) 无 parentId（根节点 / 普通节点）→ position + (OFFSET_X, OFFSET_Y) 让粘贴副本可见
//  - relatedNodeIds：只保留并 remap 剪贴板内命中的引用；全不命中则删整个字段
//  - data.id：同步到新 id（与 P3D-2 step 3 helper item.data.id===item.id 一致）
//  - meta：creator_*/updated_*/deprecated_* 全 strip + __localNew=true（当前用户的本地新节点）
//  - name/label 去重：通过 existingNames 走 getUniqueName 避免与画布现有名字冲突。
//    自然规则："Child1" 已存在 → "Child1_1"；连续粘贴 → "Child1_2"、"Child1_3"。
//    复制 "Child1_1" 再粘贴 → 命中 "Child1_1" 已存在 → "Child1_2"（不会累积成 "Child1_1_1"）
//    与 onAddNode/onCreateGroup 的去重规则一致：group 用 label，其他用 name
export function remapClipboardNodes(
  clipboardData: Node<FlowNodeData>[],
  existingNames: string[] = [],
): Node<FlowNodeData>[] {
  const idMap = new Map<string, string>();
  for (const node of clipboardData) {
    idMap.set(node.id, node.type === 'group' ? newGroupId() : newNodeId());
  }
  // 名称去重：用一个会随每次分配新名字而扩展的 Set，防止剪贴板内多个节点同名互撞
  // （比如剪贴板里两个都叫 "Child1"，第二个不能也叫 "Child1_1" 如果它已被第一个占了）
  const usedNames = new Set<string>(existingNames);
  return clipboardData.map((node) => {
    const newId = idMap.get(node.id)!;
    const copied = safeDeepCopy(node);
    const cleanData = { ...(copied.data || {}) } as Record<string, unknown>;
    for (const key of META_KEYS_TO_RESET) delete cleanData[key];
    cleanData.__localNew = true;
    cleanData.id = newId;
    // name/label 去重：group 用 label 作为显示名，其他用 name
    // （与 onAddNode/onCreateGroup 同口径，见 useFlowOperations.ts）
    const isGroup = node.type === 'group';
    const nameKey = isGroup ? 'label' : 'name';
    const baseName = typeof cleanData[nameKey] === 'string' ? (cleanData[nameKey] as string) : '';
    if (baseName) {
      const uniqueName = getUniqueName(baseName, usedNames);
      cleanData[nameKey] = uniqueName;
      usedNames.add(uniqueName);
      // group 的 name 字段（兜底显示）也同步，与 onCreateGroup 一致
      if (isGroup && typeof cleanData.name === 'string') {
        cleanData.name = uniqueName;
      }
    }
    const oldRelated = (copied.data as { relatedNodeIds?: unknown })?.relatedNodeIds;
    if (Array.isArray(oldRelated)) {
      const remapped = oldRelated
        .filter((rid): rid is string => typeof rid === 'string' && idMap.has(rid))
        .map((rid) => idMap.get(rid)!);
      if (remapped.length > 0) {
        cleanData.relatedNodeIds = remapped;
      } else {
        delete cleanData.relatedNodeIds;
      }
    }
    const oldParentId = copied.parentId;
    const parentRemapped = oldParentId ? idMap.get(oldParentId) : undefined;
    // 父被一起复制 → 保留相对坐标（不加 OFFSET）；其他场景（根节点 / 半组孤儿）→ 加 OFFSET
    const shouldOffset = parentRemapped === undefined;
    const result = {
      ...copied,
      id: newId,
      position: shouldOffset
        ? { x: node.position.x + OFFSET_X, y: node.position.y + OFFSET_Y }
        : { x: node.position.x, y: node.position.y },
      selected: true as const,
      data: cleanData as unknown as FlowNodeData,
    };
    if (parentRemapped !== undefined) {
      result.parentId = parentRemapped;
    } else {
      delete result.parentId;
      delete (result as { extent?: unknown }).extent;
    }
    return result as Node<FlowNodeData>;
  });
}

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

      // 添加新节点到画布
      // 把 remapClipboardNodes 调用挪进 setNodes 闭包，确保 existingNames 取的是最新画布快照
      // （连续粘贴 / 自动保存重入时避免 stale）
      setNodes((nodes) => {
        // 取消所有现有节点的选中状态（保留 selected 为可选，避免与 newNodes 类型冲突）
        const updatedNodes: Node<FlowNodeData>[] = nodes.map((node) => ({
          ...node,
          selected: false,
        }));

        // 收集现有 name/label 用于去重（与 onAddNode/onCreateGroup 同口径）
        const existingNames = nodes
          .map((n) => {
            if (n.type === 'group') {
              return ((n.data as { label?: string }).label) || ((n.data as { name?: string }).name);
            }
            return (n.data as { name?: string }).name;
          })
          .filter((s): s is string => typeof s === 'string' && s.length > 0);

        // P3B codex 二审：核心 remap 逻辑抽到 remapClipboardNodes 纯函数（便于单测）
        const newNodes = remapClipboardNodes(clipboardData, existingNames);
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
