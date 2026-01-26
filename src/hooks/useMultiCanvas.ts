import { useState, useCallback, useEffect } from 'react';
import { Node, Edge } from '@xyflow/react';
import {
  MultiCanvasProject,
  CanvasSheet,
  FlowNodeData,
  FlowDefinition,
  FlowConnector,
  isMultiCanvasProject,
  migrateToMultiCanvas,
  createEmptyProject,
} from '../types/flow';

// 存储节点格式（用于保存）
interface StorageNode {
  id: string;
  name: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  expandable: boolean;
  style?: React.CSSProperties;
  parentId?: string;
  hidden?: boolean;
  // 分组节点专用
  label?: string;
  color?: string;
  collapsed?: boolean;
  expandedSize?: { width: number | string; height: number | string };
  relatedNodeIds?: string[];
  // 普通节点
  description?: string;
  detailConfig?: unknown;
  subType?: 'start' | 'end';
  backgroundColor?: string;
}

export interface UseMultiCanvasReturn {
  // 项目数据
  project: MultiCanvasProject | null;

  // 当前画布数据
  activeSheet: CanvasSheet | null;
  activeSheetId: string | null;

  // 画布操作
  setActiveSheet: (sheetId: string) => void;
  addSheet: () => string; // 返回新画布 ID
  deleteSheet: (sheetId: string) => boolean;
  renameSheet: (sheetId: string, newName: string) => void;
  duplicateSheet: (sheetId: string) => string | null; // 复制画布，返回新画布 ID

  // 数据操作
  updateSheetData: (
    sheetId: string,
    nodes: Node<FlowNodeData>[],
    edges: Edge[]
  ) => void;
  loadProject: (data: MultiCanvasProject | FlowDefinition) => void;
  getProjectData: () => MultiCanvasProject;

  // 状态标志
  isLoading: boolean;
}

// 过滤保存时不需要的字段
const autoSaveFilter = (key: string) => {
  return !key.startsWith('__') && key !== 'measured' && key !== 'internals';
};

// 安全深拷贝
function safeDeepCopy<T>(obj: T, filter?: (key: string) => boolean): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => safeDeepCopy(item, filter)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (!filter || filter(key)) {
        result[key] = safeDeepCopy((obj as Record<string, unknown>)[key], filter);
      }
    }
  }
  return result as T;
}

// 将 React Flow 节点转换为存储格式
function convertNodesToStorage(nodes: Node<FlowNodeData>[]): StorageNode[] {
  return nodes.map((node) => {
    if (node.type === 'group') {
      const groupData = node.data as unknown as Record<string, unknown>;
      const actualWidth =
        node.measured?.width ||
        (node as unknown as Record<string, unknown>).width ||
        (typeof node.style?.width === 'number' ? node.style.width : 200);
      const actualHeight =
        node.measured?.height ||
        (node as unknown as Record<string, unknown>).height ||
        (typeof node.style?.height === 'number' ? node.style.height : 150);

      return {
        id: node.id,
        name: (groupData.label as string) || '分组',
        type: 'group' as const,
        position: node.position,
        size: {
          width: actualWidth as number,
          height: actualHeight as number,
        },
        style: safeDeepCopy(node.style, autoSaveFilter),
        expandable: false,
        hidden: node.hidden,
        label: groupData.label as string,
        color: groupData.color as string,
        collapsed: groupData.collapsed as boolean,
        expandedSize: groupData.expandedSize as { width: number; height: number },
        relatedNodeIds: (groupData.relatedNodeIds as string[]) || [],
      };
    }

    // 普通节点
    return {
      id: node.id,
      name: node.data.name,
      description: node.data.description as string,
      type: node.data.type,
      position: node.position,
      size: {
        width:
          typeof node.style?.width === 'number'
            ? node.style.width
            : node.measured?.width || 150,
        height:
          typeof node.style?.height === 'number'
            ? node.style.height
            : node.measured?.height || 40,
      },
      style: safeDeepCopy(node.style, autoSaveFilter),
      expandable: node.data.expandable,
      hidden: node.hidden,
      detailConfig: safeDeepCopy(node.data.detailConfig, autoSaveFilter),
      subType: node.data.subType,
      backgroundColor: node.data.backgroundColor,
      parentId: node.parentId,
      relatedNodeIds: node.data.relatedNodeIds,
    };
  });
}

// 将 React Flow 边转换为存储格式
function convertEdgesToStorage(edges: Edge[]): FlowConnector[] {
  return edges.map((edge) => {
    const edgeData = edge.data || {};
    const connector: FlowConnector = {
      id: edge.id,
      sourceID: edge.source,
      targetID: edge.target,
      sourceHandle: edge.sourceHandle || undefined,
      targetHandle: edge.targetHandle || undefined,
      label: typeof edge.label === 'string' ? edge.label : undefined,
      style: {
        stroke:
          typeof edge.style?.stroke === 'string' ? edge.style.stroke : undefined,
        strokeWidth:
          typeof edge.style?.strokeWidth === 'number'
            ? edge.style.strokeWidth
            : undefined,
        strokeDasharray:
          typeof edge.style?.strokeDasharray === 'string'
            ? edge.style.strokeDasharray
            : undefined,
      },
      labelStyle: safeDeepCopy(edge.labelStyle, autoSaveFilter),
      labelBgStyle: safeDeepCopy(edge.labelBgStyle, autoSaveFilter),
      data: safeDeepCopy(edge.data, autoSaveFilter) as Record<string, unknown>,
    };

    if (edgeData.notImplemented !== undefined) {
      connector.notImplemented = Boolean(edgeData.notImplemented);
    }

    // 处理箭头标记
    if (edge.markerStart) {
      if (typeof edge.markerStart === 'string') {
        connector.markerStart = edge.markerStart;
      } else {
        const marker = edge.markerStart as {
          type: string;
          color?: string;
          width?: number;
          height?: number;
        };
        connector.markerStart = {
          type: marker.type,
          color: marker.color,
          width: marker.width,
          height: marker.height,
        };
      }
    }

    if (edge.markerEnd) {
      if (typeof edge.markerEnd === 'string') {
        connector.markerEnd = edge.markerEnd;
      } else {
        const marker = edge.markerEnd as {
          type: string;
          color?: string;
          width?: number;
          height?: number;
        };
        connector.markerEnd = {
          type: marker.type,
          color: marker.color,
          width: marker.width,
          height: marker.height,
        };
      }
    }

    return connector;
  });
}

export function useMultiCanvas(
  storageKey: string = 'saved-flow-data'
): UseMultiCanvasReturn {
  const [project, setProject] = useState<MultiCanvasProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 计算当前活动画布
  const activeSheet =
    project?.sheets.find((s) => s.id === project.activeSheetId) || null;
  const activeSheetId = project?.activeSheetId || null;

  // 从 LocalStorage 加载数据
  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const savedData = localStorage.getItem(storageKey);
        if (savedData) {
          const parsed = JSON.parse(savedData);
          if (isMultiCanvasProject(parsed)) {
            setProject(parsed);
          } else {
            // 迁移旧数据
            const migrated = migrateToMultiCanvas(parsed as FlowDefinition);
            setProject(migrated);
            // 立即保存迁移后的数据
            localStorage.setItem(storageKey, JSON.stringify(migrated));
          }
        } else {
          // 没有保存的数据，尝试加载默认数据
          setProject(null);
        }
      } catch (error) {
        console.error('加载项目数据失败:', error);
        setProject(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadFromStorage();
  }, [storageKey]);

  // 保存到 LocalStorage
  const saveToStorage = useCallback(
    (data: MultiCanvasProject) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(data));
      } catch (error) {
        console.error('保存项目数据失败:', error);
      }
    },
    [storageKey]
  );

  // 加载项目（支持自动迁移）
  const loadProject = useCallback(
    (data: MultiCanvasProject | FlowDefinition) => {
      let projectData: MultiCanvasProject;
      if (isMultiCanvasProject(data)) {
        projectData = data;
      } else {
        // 迁移旧数据
        projectData = migrateToMultiCanvas(data);
      }
      setProject(projectData);
      saveToStorage(projectData);
      setIsLoading(false);
    },
    [saveToStorage]
  );

  // 切换画布
  const setActiveSheet = useCallback(
    (sheetId: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        const sheet = prev.sheets.find((s) => s.id === sheetId);
        if (!sheet) return prev;
        const updated = {
          ...prev,
          activeSheetId: sheetId,
          updatedAt: Date.now(),
        };
        saveToStorage(updated);
        return updated;
      });
    },
    [saveToStorage]
  );

  // 添加新画布
  const addSheet = useCallback(() => {
    const newId = `sheet_${Date.now()}`;

    setProject((prev) => {
      const currentProject = prev || createEmptyProject();
      const newSheetNumber = currentProject.sheets.length + 1;

      const newSheet: CanvasSheet = {
        id: newId,
        name: `画布 ${newSheetNumber}`,
        nodes: [],
        connectors: [],
      };

      const updated = {
        ...currentProject,
        sheets: [...currentProject.sheets, newSheet],
        activeSheetId: newId,
        updatedAt: Date.now(),
      };

      saveToStorage(updated);
      return updated;
    });

    return newId;
  }, [saveToStorage]);

  // 删除画布
  const deleteSheet = useCallback(
    (sheetId: string) => {
      if (!project || project.sheets.length <= 1) {
        return false;
      }

      setProject((prev) => {
        if (!prev) return prev;
        const newSheets = prev.sheets.filter((s) => s.id !== sheetId);
        const newActiveId =
          prev.activeSheetId === sheetId
            ? newSheets[0].id
            : prev.activeSheetId;

        const updated = {
          ...prev,
          sheets: newSheets,
          activeSheetId: newActiveId,
          updatedAt: Date.now(),
        };

        saveToStorage(updated);
        return updated;
      });

      return true;
    },
    [project, saveToStorage]
  );

  // 重命名画布
  const renameSheet = useCallback(
    (sheetId: string, newName: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          sheets: prev.sheets.map((s) =>
            s.id === sheetId ? { ...s, name: newName } : s
          ),
          updatedAt: Date.now(),
        };
        saveToStorage(updated);
        return updated;
      });
    },
    [saveToStorage]
  );

  // 复制画布
  const duplicateSheet = useCallback(
    (sheetId: string): string | null => {
      if (!project) return null;

      const sourceSheet = project.sheets.find((s) => s.id === sheetId);
      if (!sourceSheet) return null;

      const newId = `sheet_${Date.now()}`;
      const timestamp = Date.now();

      // 创建节点 ID 映射表（旧 ID -> 新 ID）
      const nodeIdMap = new Map<string, string>();

      // 深拷贝节点并生成新 ID
      const newNodes = sourceSheet.nodes.map((node, index) => {
        const newNodeId = `${node.id}_copy_${timestamp}_${index}`;
        nodeIdMap.set(node.id, newNodeId);

        const copiedNode = safeDeepCopy(node, autoSaveFilter);
        return {
          ...copiedNode,
          id: newNodeId,
        };
      });

      // 更新节点的 parentId 引用（分组子节点）
      newNodes.forEach((node) => {
        if (node.parentId && nodeIdMap.has(node.parentId)) {
          node.parentId = nodeIdMap.get(node.parentId);
        }
        // 更新 relatedNodeIds 引用
        if (node.relatedNodeIds && Array.isArray(node.relatedNodeIds)) {
          node.relatedNodeIds = node.relatedNodeIds.map((id: string) =>
            nodeIdMap.get(id) || id
          );
        }
      });

      // 深拷贝连线并更新引用
      const newConnectors = sourceSheet.connectors.map((connector, index) => {
        const newConnectorId = `${connector.id}_copy_${timestamp}_${index}`;
        const copiedConnector = safeDeepCopy(connector, autoSaveFilter);

        return {
          ...copiedConnector,
          id: newConnectorId,
          sourceID: nodeIdMap.get(connector.sourceID) || connector.sourceID,
          targetID: nodeIdMap.get(connector.targetID) || connector.targetID,
        };
      });

      const newSheet: CanvasSheet = {
        id: newId,
        name: `${sourceSheet.name} - 副本`,
        nodes: newNodes as FlowDefinition['nodes'],
        connectors: newConnectors,
      };

      setProject((prev) => {
        if (!prev) return prev;

        // 在源画布后面插入新画布
        const sourceIndex = prev.sheets.findIndex((s) => s.id === sheetId);
        const newSheets = [...prev.sheets];
        newSheets.splice(sourceIndex + 1, 0, newSheet);

        const updated = {
          ...prev,
          sheets: newSheets,
          activeSheetId: newId, // 自动切换到新画布
          updatedAt: Date.now(),
        };

        saveToStorage(updated);
        return updated;
      });

      return newId;
    },
    [project, saveToStorage]
  );

  // 更新画布数据（由 FlowCanvasContent 调用）
  const updateSheetData = useCallback(
    (sheetId: string, nodes: Node<FlowNodeData>[], edges: Edge[]) => {
      setProject((prev) => {
        if (!prev) return prev;

        const storageNodes = convertNodesToStorage(nodes);
        const storageEdges = convertEdgesToStorage(edges);

        const updated = {
          ...prev,
          sheets: prev.sheets.map((sheet) => {
            if (sheet.id !== sheetId) return sheet;
            return {
              ...sheet,
              nodes: storageNodes as FlowDefinition['nodes'],
              connectors: storageEdges,
            };
          }),
          updatedAt: Date.now(),
        };

        saveToStorage(updated);
        return updated;
      });
    },
    [saveToStorage]
  );

  // 获取完整项目数据（用于导出等）
  const getProjectData = useCallback((): MultiCanvasProject => {
    return project || createEmptyProject();
  }, [project]);

  return {
    project,
    activeSheet,
    activeSheetId,
    setActiveSheet,
    addSheet,
    deleteSheet,
    renameSheet,
    duplicateSheet,
    updateSheetData,
    loadProject,
    getProjectData,
    isLoading,
  };
}
