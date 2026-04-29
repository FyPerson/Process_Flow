import { useState, useCallback, useEffect, useRef } from 'react';
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
import {
  type ApiError,
  createCanvas as apiCreateCanvas,
  getCanvas as apiGetCanvas,
  saveCanvas as apiSaveCanvas,
} from '../api/canvases';

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

export interface UseMultiCanvasOptions {
  // 已选中的画布 id；null 表示尚未挂接服务端画布（兼容老 localStorage 数据）
  canvasId?: number | null;
  // 兼容旧 caller：仅作 localStorage 回退键
  storageKey?: string;
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

  // 状态标志（兼容旧调用方）
  isLoading: boolean;

  // === 服务端协作字段（P2G + P2H）===
  canvasId: number | null;
  serverVersion: number | null;
  dirty: boolean;
  saving: boolean;
  serverError: ApiError | null;
  /** 出现 409 冲突时记录服务端 currentVersion；用户重载或手动覆盖后清零 */
  conflict: { currentVersion: number } | null;
  /** 冲突期间 / 致命错误期间，自动保存被禁用（红字提示用户手动处理） */
  autoSaveDisabled: boolean;
  /** 最近一次成功保存的时间戳（用于显示"X 秒前已保存"） */
  lastSavedAt: number | null;
  /** 拉取服务端画布到内存（覆盖当前 project） */
  loadFromServer: (id: number) => Promise<void>;
  /** 把当前内存 project 推到服务端；canvasId=null 时报错（请先 createOnServer） */
  save: () => Promise<{ ok: boolean; conflict?: { currentVersion: number } }>;
  /** 把当前内存 project 当作新画布创建到服务端，成功后 canvasId 自动指向它 */
  createOnServer: (input: {
    name: string;
    description?: string;
    visibility: 'public' | 'private';
    is_public_to_guest?: boolean;
  }) => Promise<{ id: number; version: number }>;
  /** 用户在冲突弹框选"丢弃本地、重载服务端"时调用 */
  discardAndReload: () => Promise<void>;
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

/**
 * 兼容签名：
 *   useMultiCanvas('saved-flow-data')  // 旧调用方，无服务端 canvasId
 *   useMultiCanvas({ canvasId: 12 })   // 新模式，挂接服务端画布
 *   useMultiCanvas({ canvasId: null, storageKey: 'saved-flow-data' })  // 显式回退
 *
 * 与旧版的关键差异：
 * - mutation 不再自动写 localStorage；mutation 改内存 + 标 dirty
 * - 服务端持久化由 save() 触发（P2H 加保存按钮调用）
 * - 旧 localStorage 数据仅在 canvasId=null 时作为初始数据加载（用于过渡）
 */
export function useMultiCanvas(
  optionsOrStorageKey: UseMultiCanvasOptions | string = {}
): UseMultiCanvasReturn {
  const opts: UseMultiCanvasOptions =
    typeof optionsOrStorageKey === 'string'
      ? { storageKey: optionsOrStorageKey, canvasId: null }
      : optionsOrStorageKey;

  const canvasIdProp = opts.canvasId ?? null;
  const storageKey = opts.storageKey ?? 'saved-flow-data';

  const [project, setProject] = useState<MultiCanvasProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [canvasId, setCanvasId] = useState<number | null>(canvasIdProp);
  const [serverVersion, setServerVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState<{ currentVersion: number } | null>(null);
  const [autoSaveDisabled, setAutoSaveDisabled] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // 让 save()/自动保存 effect 始终拿到最新 project（避免闭包陈旧）
  const projectRef = useRef<MultiCanvasProject | null>(null);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // 计算当前活动画布
  const activeSheet =
    project?.sheets.find((s) => s.id === project.activeSheetId) || null;
  const activeSheetId = project?.activeSheetId || null;

  // === 加载策略 ===
  // - canvasId 非空：从服务端拉
  // - canvasId 为空：从 localStorage 回退（兼容阶段 1 老数据）
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setServerError(null);
    setConflict(null);
    setAutoSaveDisabled(false);

    if (canvasIdProp != null) {
      apiGetCanvas(canvasIdProp)
        .then((row) => {
          if (cancelled) return;
          setProject(row.data);
          setCanvasId(row.id);
          setServerVersion(row.version);
          setDirty(false);
          setLastSavedAt(Date.now());
        })
        .catch((err: ApiError) => {
          if (cancelled) return;
          setServerError(err);
          setProject(null);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    } else {
      // localStorage 回退（旧逻辑保留，但不再写回）
      try {
        const savedData = localStorage.getItem(storageKey);
        if (savedData) {
          const parsed = JSON.parse(savedData);
          if (isMultiCanvasProject(parsed)) {
            setProject(parsed);
          } else {
            setProject(migrateToMultiCanvas(parsed as FlowDefinition));
          }
        } else {
          setProject(null);
        }
      } catch (err) {
        console.error('加载本地项目数据失败:', err);
        setProject(null);
      } finally {
        setIsLoading(false);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [canvasIdProp, storageKey]);

  const markDirty = useCallback(() => {
    setDirty(true);
  }, []);

  // 加载项目（支持自动迁移）—— 不再写 localStorage，仅改内存 + 标 dirty
  const loadProject = useCallback(
    (data: MultiCanvasProject | FlowDefinition) => {
      const projectData: MultiCanvasProject = isMultiCanvasProject(data)
        ? data
        : migrateToMultiCanvas(data);
      setProject(projectData);
      setIsLoading(false);
      markDirty();
    },
    [markDirty]
  );

  // 切换画布
  const setActiveSheet = useCallback(
    (sheetId: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        const sheet = prev.sheets.find((s) => s.id === sheetId);
        if (!sheet) return prev;
        return {
          ...prev,
          activeSheetId: sheetId,
          updatedAt: Date.now(),
        };
      });
      markDirty();
    },
    [markDirty]
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

      return {
        ...currentProject,
        sheets: [...currentProject.sheets, newSheet],
        activeSheetId: newId,
        updatedAt: Date.now(),
      };
    });
    markDirty();

    return newId;
  }, [markDirty]);

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

        return {
          ...prev,
          sheets: newSheets,
          activeSheetId: newActiveId,
          updatedAt: Date.now(),
        };
      });
      markDirty();

      return true;
    },
    [project, markDirty]
  );

  // 重命名画布
  const renameSheet = useCallback(
    (sheetId: string, newName: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sheets: prev.sheets.map((s) =>
            s.id === sheetId ? { ...s, name: newName } : s
          ),
          updatedAt: Date.now(),
        };
      });
      markDirty();
    },
    [markDirty]
  );

  // 复制画布
  const duplicateSheet = useCallback(
    (sheetId: string): string | null => {
      if (!project) return null;

      const sourceSheet = project.sheets.find((s) => s.id === sheetId);
      if (!sourceSheet) return null;

      const newId = `sheet_${Date.now()}`;
      const timestamp = Date.now();

      const nodeIdMap = new Map<string, string>();

      const newNodes = sourceSheet.nodes.map((node, index) => {
        const newNodeId = `${node.id}_copy_${timestamp}_${index}`;
        nodeIdMap.set(node.id, newNodeId);

        const copiedNode = safeDeepCopy(node, autoSaveFilter);
        return {
          ...copiedNode,
          id: newNodeId,
        };
      });

      newNodes.forEach((node) => {
        if (node.parentId && nodeIdMap.has(node.parentId)) {
          node.parentId = nodeIdMap.get(node.parentId);
        }
        if (node.relatedNodeIds && Array.isArray(node.relatedNodeIds)) {
          node.relatedNodeIds = node.relatedNodeIds.map((id: string) =>
            nodeIdMap.get(id) || id
          );
        }
      });

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

        const sourceIndex = prev.sheets.findIndex((s) => s.id === sheetId);
        const newSheets = [...prev.sheets];
        newSheets.splice(sourceIndex + 1, 0, newSheet);

        return {
          ...prev,
          sheets: newSheets,
          activeSheetId: newId,
          updatedAt: Date.now(),
        };
      });
      markDirty();

      return newId;
    },
    [project, markDirty]
  );

  // 更新画布数据（由 FlowCanvasContent 调用）
  const updateSheetData = useCallback(
    (sheetId: string, nodes: Node<FlowNodeData>[], edges: Edge[]) => {
      setProject((prev) => {
        if (!prev) return prev;

        const storageNodes = convertNodesToStorage(nodes);
        const storageEdges = convertEdgesToStorage(edges);

        return {
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
      });
      markDirty();
    },
    [markDirty]
  );

  // 获取完整项目数据（用于导出等）
  const getProjectData = useCallback((): MultiCanvasProject => {
    return project || createEmptyProject();
  }, [project]);

  // === P2G 新增：服务端 IO ===

  const loadFromServer = useCallback(async (id: number) => {
    setIsLoading(true);
    setServerError(null);
    setConflict(null);
    setAutoSaveDisabled(false);
    try {
      const row = await apiGetCanvas(id);
      setProject(row.data);
      setCanvasId(row.id);
      setServerVersion(row.version);
      setDirty(false);
      setLastSavedAt(Date.now());
    } catch (err) {
      setServerError(err as ApiError);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const save = useCallback(async () => {
    const current = projectRef.current;
    if (!current) {
      throw new Error('no project to save');
    }
    if (canvasId == null || serverVersion == null) {
      throw new Error('no canvasId; call createOnServer first');
    }

    setSaving(true);
    setServerError(null);
    try {
      const result = await apiSaveCanvas(canvasId, serverVersion, current);
      setServerVersion(result.version);
      setDirty(false);
      setLastSavedAt(Date.now());
      setConflict(null);
      setAutoSaveDisabled(false);
      return { ok: true as const };
    } catch (err) {
      const apiErr = err as ApiError;
      setServerError(apiErr);
      // 任何保存失败都暂停自动保存，避免循环重试 / 用户感知不到
      setAutoSaveDisabled(true);
      if (apiErr.status === 409 && typeof apiErr.currentVersion === 'number') {
        setConflict({ currentVersion: apiErr.currentVersion });
        return {
          ok: false as const,
          conflict: { currentVersion: apiErr.currentVersion },
        };
      }
      throw err;
    } finally {
      setSaving(false);
    }
  }, [canvasId, serverVersion]);

  const discardAndReload = useCallback(async () => {
    if (canvasId == null) {
      throw new Error('no canvasId to reload');
    }
    setIsLoading(true);
    setServerError(null);
    try {
      const row = await apiGetCanvas(canvasId);
      setProject(row.data);
      setServerVersion(row.version);
      setDirty(false);
      setConflict(null);
      setAutoSaveDisabled(false);
      setLastSavedAt(Date.now());
    } catch (err) {
      setServerError(err as ApiError);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [canvasId]);

  const createOnServer = useCallback(
    async (input: {
      name: string;
      description?: string;
      visibility: 'public' | 'private';
      is_public_to_guest?: boolean;
    }) => {
      const current = projectRef.current;
      if (!current) {
        throw new Error('no project to create');
      }
      setSaving(true);
      setServerError(null);
      try {
        const result = await apiCreateCanvas({
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          is_public_to_guest: input.is_public_to_guest,
          data: current,
        });
        setCanvasId(result.id);
        setServerVersion(result.version);
        setDirty(false);
        setLastSavedAt(Date.now());
        setConflict(null);
        setAutoSaveDisabled(false);
        return result;
      } catch (err) {
        setServerError(err as ApiError);
        setAutoSaveDisabled(true);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // === 自动保存：dirty + canvasId + 未冲突 + 未保存中 → 5s 防抖触发 save() ===
  const AUTOSAVE_DEBOUNCE_MS = 5000;
  // saveRef：让定时器拿到最新 save 闭包；不把 save 直接放进 effect deps，避免每次 save 重建定时器
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (!dirty) return;
    if (canvasId == null) return; // 未挂接服务端 → 必须用户手动"另存到服务器"
    if (saving) return;
    if (autoSaveDisabled) return;

    const timer = setTimeout(() => {
      // catch 必须有：避免未挂接 promise 错误飞到 window.onerror
      saveRef.current().catch((err) => {
        console.error('自动保存失败:', err);
      });
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [dirty, canvasId, saving, autoSaveDisabled, project]);

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
    canvasId,
    serverVersion,
    dirty,
    saving,
    serverError,
    conflict,
    autoSaveDisabled,
    lastSavedAt,
    loadFromServer,
    save,
    createOnServer,
    discardAndReload,
  };
}
