import { useRef, useCallback, useEffect } from 'react';
import { Node, Edge, EdgeMarkerType } from '@xyflow/react';
import { safeDeepCopy } from '../utils/deepCopy';
import { FlowNodeData, FlowDefinition, FlowConnector } from '../types/flow';


const autoSaveFilter = (key: string) => {
  return !key.startsWith('__') && key !== 'measured' && key !== 'internals';
};


export interface UseAutoSaveReturn {
  triggerAutoSave: (newNodes?: Node<FlowNodeData>[], newEdges?: Edge[]) => void;
  saveNow: () => void;
  getFlowData: () => FlowDefinition;
}

/**
 * 自定义 Hook：管理流程图数据的自动保存到 LocalStorage
 *
 * @param nodes 当前节点数组
 * @param edges 当前边数组
 * @param isUndoRedoActive 是否正在执行撤销/重做操作
 * @param storageKey LocalStorage 存储键名
 * @param debounceMs 防抖延迟时间（毫秒）
 * @returns 自动保存管理接口
 */
export function useAutoSave(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  isUndoRedoActive: () => boolean,
  storageKey: string = 'saved-flow-data',
  debounceMs: number = 1000,
): UseAutoSaveReturn {
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  // 更新 refs
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  // 转换为流程数据格式
  const convertToFlowData = useCallback((currentNodes: Node<FlowNodeData>[], currentEdges: Edge[]) => {
    // 1. 转换节点
    const exportNodes = currentNodes.map((node) => {
      // 分组节点特殊处理
      if (node.type === 'group') {
        const groupData = node.data as any;

        // 获取实际尺寸：优先使用 measured（调整大小后的值），其次是 width/height，最后是 style
        const actualWidth = node.measured?.width || (node as any).width || (typeof node.style?.width === 'number' ? node.style.width : 200);
        const actualHeight = node.measured?.height || (node as any).height || (typeof node.style?.height === 'number' ? node.style.height : 150);

        const savedGroupNode = {
          id: node.id,
          name: groupData.label || '分组',
          type: 'group' as const,
          position: node.position,
          size: {
            width: actualWidth,
            height: actualHeight,
          },
          style: safeDeepCopy(node.style, undefined, autoSaveFilter) as React.CSSProperties | undefined,
          expandable: false,
          hidden: node.hidden, // 保存显隐状态
          // 分组节点专用字段
          label: groupData.label,
          color: groupData.color,
          collapsed: groupData.collapsed, // 保存折叠状态
          expandedSize: groupData.expandedSize, // 保存折叠前尺寸
          relatedNodeIds: groupData.relatedNodeIds || [],  // 保存关联节点 ID
        };
        return savedGroupNode;
      }

      // 普通节点
      return {
        id: node.id,
        name: node.data.name,
        description: node.data.description,
        type: node.data.type,
        position: node.position,
        size: {
          width: typeof node.style?.width === 'number' ? node.style.width : (node.measured?.width || 150),
          height: typeof node.style?.height === 'number' ? node.style.height : (node.measured?.height || 40),
        },
        style: safeDeepCopy(node.style, undefined, autoSaveFilter) as React.CSSProperties | undefined,
        expandable: node.data.expandable,
        hidden: node.hidden, // 保存显隐状态
        detailConfig: safeDeepCopy(node.data.detailConfig, undefined, autoSaveFilter),
        subType: node.data.subType,
        backgroundColor: node.data.backgroundColor,
        parentId: node.parentId, // 保存父节点 ID
        relatedNodeIds: node.data.relatedNodeIds,
      };
    });

    // 2. 转换连线
    const exportEdges: FlowConnector[] = currentEdges.map((edge) => {
      const edgeData = edge.data || {};
      const exportEdge: FlowConnector = {
        id: edge.id,
        sourceID: edge.source,
        targetID: edge.target,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
        label: typeof edge.label === 'string' ? edge.label : undefined,
        style: {
          stroke: typeof edge.style?.stroke === 'string' ? edge.style.stroke : undefined,
          strokeWidth: typeof edge.style?.strokeWidth === 'number' ? edge.style.strokeWidth : undefined,
          strokeDasharray: typeof edge.style?.strokeDasharray === 'string' ? edge.style.strokeDasharray : undefined,
        },
        labelStyle: safeDeepCopy(edge.labelStyle, undefined, autoSaveFilter) as React.CSSProperties | undefined,
        labelBgStyle: safeDeepCopy(edge.labelBgStyle, undefined, autoSaveFilter) as React.CSSProperties | undefined,
        data: safeDeepCopy(edge.data, undefined, autoSaveFilter) as Record<string, unknown> | undefined,
      };

      if (edgeData.notImplemented !== undefined) {
        exportEdge.notImplemented = Boolean(edgeData.notImplemented);
      }

      if (edge.markerStart) {
        if (typeof edge.markerStart === 'string') {
          exportEdge.markerStart = edge.markerStart;
        } else {
          // Use type assertion to access specific properties of the marker object
          const marker = edge.markerStart as { type: string; color?: string; width?: number; height?: number };
          exportEdge.markerStart = {
            type: marker.type,
            color: marker.color,
            width: marker.width,
            height: marker.height
          };
        }
      }

      if (edge.markerEnd) {
        if (typeof edge.markerEnd === 'string') {
          exportEdge.markerEnd = edge.markerEnd;
        } else {
          // Use type assertion to access specific properties of the marker object
          const marker = edge.markerEnd as { type: string; color?: string; width?: number; height?: number };
          exportEdge.markerEnd = {
            type: marker.type,
            color: marker.color,
            width: marker.width,
            height: marker.height
          };
        }
      }

      return exportEdge;
    });

    return {
      id: 'business-flow-v1',
      name: '业务流程图',
      description: '自动保存时间: ' + new Date().toLocaleString(),
      nodes: exportNodes,
      connectors: exportEdges,
    };
  }, []);

  // 获取当前流程数据（供外部使用）
  const getFlowData = useCallback(() => {
    return convertToFlowData(nodesRef.current, edgesRef.current);
  }, [convertToFlowData]);

  // 保存到 LocalStorage
  const saveToStorage = useCallback(
    (flowData: FlowDefinition) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(flowData));
      } catch (e) {
        console.error('自动保存失败', e);
      }
    },
    [storageKey],
  );

  // 立即保存
  const saveNow = useCallback(() => {
    if (isUndoRedoActive()) {
      return;
    }
    const flowData = convertToFlowData(nodesRef.current, edgesRef.current);
    saveToStorage(flowData);
  }, [convertToFlowData, saveToStorage, isUndoRedoActive]);

  // 防抖自动保存
  const triggerAutoSave = useCallback((newNodes?: Node<FlowNodeData>[], newEdges?: Edge[]) => {
    // 如果正在执行撤销/重做，不触发自动保存
    if (isUndoRedoActive()) {
      return;
    }

    // 如果提供了最新的数据，立即更新 ref
    if (newNodes) nodesRef.current = newNodes;
    if (newEdges) edgesRef.current = newEdges;

    // 清除之前的定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // 设置新的定时器
    autoSaveTimerRef.current = setTimeout(() => {
      // 使用 ref 获取最新的数据
      const flowData = convertToFlowData(nodesRef.current, edgesRef.current);
      saveToStorage(flowData);
      autoSaveTimerRef.current = null;
    }, debounceMs);
  }, [isUndoRedoActive, debounceMs, convertToFlowData, saveToStorage]);

  // 保持最新的 saveNow 引用
  const saveNowRef = useRef(saveNow);
  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  // 清理定时器，并在卸载时检查是否有待保存的更改
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        // 如果有挂起的自动保存，组件卸载时立即保存
        saveNowRef.current();
      }
    };
  }, []);

  return {
    triggerAutoSave,
    saveNow,
    getFlowData,
  };
}
