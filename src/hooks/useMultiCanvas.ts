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

/** save() 返回值 —— discriminated union
 * caller 用 switch(result.status) 强制处理所有分支，避免漏处理 conflict/skipped/discarded */
export type SaveResult =
  | { status: 'saved' }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'skipped' }
  | { status: 'discarded' };

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

  /** 数据被"整体替换"的次数（fetch / discardAndReload / loadProject / canvasId 切换都递增）。
   * caller 把这个值拼进 FlowCanvas key 强制 remount，避免 React Flow 内部 state 缓存旧节点 */
  loadRevision: number;

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
  /** 把当前内存 project 推到服务端；canvasId=null 时报错（请先 createOnServer）
   * 返回值是 discriminated union（按 status 分）：
   * - 'saved'     正常保存成功
   * - 'conflict'  409，服务端比本地新；caller 应弹冲突 UI
   * - 'skipped'   有保存在飞行中，本次同步拦下；caller 通常静默
   * - 'discarded' 用户已切到别的 canvas，旧请求结果不再使用；caller 应静默
   *
   * 强制 caller 处理所有分支（switch 没 default 时 TS 会报 missing case）
   */
  save: () => Promise<SaveResult>;
  /** 把当前内存 project 当作新画布创建到服务端，成功后 canvasId 自动指向它
   * discarded=true 表示创建成功但用户已切到别的 canvas，caller 不应写 URL */
  createOnServer: (input: {
    name: string;
    description?: string;
    visibility: 'public' | 'private';
    is_public_to_guest?: boolean;
  }) => Promise<{ id: number; version: number; discarded: boolean }>;
  /** 用户在冲突弹框选"丢弃本地、重载服务端"时调用 */
  discardAndReload: () => Promise<void>;
}

// 过滤保存时不需要的字段
// readOnly 是 caller 注入到 node.data / edge.data 的运行时 UI 标记，不能被 storage 保存
// （否则 readOnly: true 会进数据库，下一个登录用户加载时这条边/节点会被错认为只读）
const autoSaveFilter = (key: string) => {
  return !key.startsWith('__')
    && key !== 'measured'
    && key !== 'internals'
    && key !== 'readOnly';
};

/** storage 层 deep equality —— 等价于 JSON.stringify 比较 + key-order 不敏感。
 * 关键：value === undefined 的 key 视同不存在（JSON 序列化时本来就被丢掉），
 * 否则 convertNodesToStorage 产生的 { description: undefined } 会和服务端反序列化后的
 * 缺失字段判不等，造成永久假 dirty。仅支持 JSON 可序列化值（原始/数组/普通对象） */
function deepEqualStorage(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualStorage(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // 收集"实际有值"（非 undefined）的 key，再比对 —— JSON.stringify 的等价语义
  const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (bo[k] === undefined) return false;
    if (!deepEqualStorage(ao[k], bo[k])) return false;
  }
  return true;
}

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
        // P3C：is_deprecated 必须传回服务端，让 deltaB 能识别 false→true。
        // deprecated_by/at/username 是服务端回填的元信息，不写回（autoSaveFilter 默认不会带，
        // 但服务端的 stripMeta 也会防御性地丢弃）。
        is_deprecated: groupData.is_deprecated as boolean | undefined,
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
      // P3C：is_deprecated 必须回传服务端（参见上方分组节点说明）
      is_deprecated: node.data.is_deprecated as boolean | undefined,
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
  const [loadRevision, setLoadRevision] = useState(0);
  const bumpLoadRevision = useCallback(() => {
    setLoadRevision((v) => v + 1);
  }, []);

  // 让 save()/自动保存 effect 始终拿到最新 project（避免闭包陈旧）
  const projectRef = useRef<MultiCanvasProject | null>(null);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // changeSeq：每次 markDirty 递增。save/createOnServer 发请求前捕获当前 seq，
  // 网络往返后只有 ref 仍等于捕获值才 setDirty(false)；否则保留 dirty，
  // 让下一个防抖周期把"网络期间产生的新改动"也存进去（防止用户改动被静默吞）
  const changeSeqRef = useRef(0);

  // canvasIdRef：同步反映当前 hook 已挂载的 canvas id（不依赖 React state 异步更新）
  // 用途：所有 async 操作（save/discardAndReload/loadFromServer）发请求前捕获 capturedCanvasId，
  // 回包前比对 ref；不一致说明用户已切到别的 canvas → 丢弃结果，避免污染新 canvas 状态
  const canvasIdRef = useRef<number | null>(null);
  // serverVersionRef：与上同理，让并发场景能拿到最新版本号
  const serverVersionRef = useRef<number | null>(null);
  // saveInFlightRef：同步并发拦截（React state 的 saving 异步，挡不住 timer + 手动同帧触发）
  const saveInFlightRef = useRef(false);

  // 同步 ref ←→ state（让 async 操作能在 await 之后拿到"当前最新值"，不依赖闭包）
  useEffect(() => {
    canvasIdRef.current = canvasId;
  }, [canvasId]);
  useEffect(() => {
    serverVersionRef.current = serverVersion;
  }, [serverVersion]);

  // 计算当前活动画布
  const activeSheet =
    project?.sheets.find((s) => s.id === project.activeSheetId) || null;
  const activeSheetId = project?.activeSheetId || null;

  // === 加载策略 ===
  // - canvasId 非空：从服务端拉
  // - canvasId 为空：从 localStorage 回退（兼容阶段 1 老数据）
  useEffect(() => {
    // 短路：当 hook 内部已经挂载在同一个 canvas 上（典型场景是 createOnServer 后
    // caller 把 id 写回 URL 触发的同 id 重入），不要 refetch 覆盖内存数据 ——
    // 否则会丢掉用户在 create 网络往返期间继续做的本地改动。
    if (
      canvasIdProp != null &&
      canvasIdRef.current === canvasIdProp &&
      serverVersionRef.current != null &&
      projectRef.current != null
    ) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setServerError(null);
    setConflict(null);
    setAutoSaveDisabled(false);
    // 切 canvasId 时也清掉 dirty / serverVersion，避免旧 canvas 的脏标记泄漏到新 canvas
    setDirty(false);
    setServerVersion(null);
    setCanvasId(canvasIdProp);
    canvasIdRef.current = canvasIdProp;
    serverVersionRef.current = null;

    if (canvasIdProp != null) {
      apiGetCanvas(canvasIdProp)
        .then((row) => {
          if (cancelled) return;
          // 用户在 fetch 期间又切走了 → 丢弃结果
          if (canvasIdRef.current !== canvasIdProp) return;
          // 真正 ref-first：先同步 ref，再 setState
          serverVersionRef.current = row.version;
          setProject(row.data);
          setCanvasId(row.id);
          setServerVersion(row.version);
          setDirty(false);
          setLastSavedAt(Date.now());
          bumpLoadRevision();
        })
        .catch((err: ApiError) => {
          if (cancelled) return;
          if (canvasIdRef.current !== canvasIdProp) return;
          setServerError(err);
          setProject(null);
        })
        .finally(() => {
          if (cancelled) return;
          // 身份校验：旧 fetch 的 finally 不该误关新 canvas 的 loading
          if (canvasIdRef.current === canvasIdProp) {
            setIsLoading(false);
          }
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
          bumpLoadRevision();
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
    changeSeqRef.current += 1;
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
      bumpLoadRevision();
      markDirty();
    },
    [markDirty, bumpLoadRevision]
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
    const newId = `sheet_${Date.now().toString(36)}`;

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

      const newId = `sheet_${Date.now().toString(36)}`;
      // base36 时间戳：缩短到 7-8 字符，对比原十进制 13 字符
      const ts = Date.now().toString(36);

      const nodeIdMap = new Map<string, string>();

      const newNodes = sourceSheet.nodes.map((node, index) => {
        // 不再 prefix 旧 ID，避免多次复制画布累积 _copy_copy_... 超 64 字符
        // 当前格式：n_<base36 时间戳>_<index>，约 12-15 字符
        const newNodeId = `n_${ts}_${index}`;
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
        // 同样不 prefix 旧 ID
        const newConnectorId = `e_${ts}_${index}`;
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
  // 关键：对比序列化结果，与当前 sheet 完全相同就不更新 project、不 markDirty。
  // 避免 React Flow 选中/拖拽中等 UI-only 变化反复触发自动保存（codex 必修 #5）
  const updateSheetData = useCallback(
    (sheetId: string, nodes: Node<FlowNodeData>[], edges: Edge[]) => {
      const storageNodes = convertNodesToStorage(nodes);
      const storageEdges = convertEdgesToStorage(edges);

      let changed = false;
      setProject((prev) => {
        if (!prev) return prev;
        const target = prev.sheets.find((s) => s.id === sheetId);
        if (!target) return prev;

        // 用 key-order 无关的 deepEqual，避免外部导入数据 / 老存档的字段顺序差异产生假 dirty
        const sameNodes = deepEqualStorage(target.nodes, storageNodes);
        const sameEdges = deepEqualStorage(target.connectors, storageEdges);
        if (sameNodes && sameEdges) {
          return prev;
        }
        changed = true;

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
      if (changed) {
        markDirty();
      }
    },
    [markDirty]
  );

  // 获取完整项目数据（用于导出等）
  const getProjectData = useCallback((): MultiCanvasProject => {
    return project || createEmptyProject();
  }, [project]);

  // === P2G 新增：服务端 IO ===

  const loadFromServer = useCallback(async (id: number) => {
    // 关键：ref + state 必须同步切换。否则 setIsLoading(true) 触发 render 后，
    // useEffect(() => { canvasIdRef.current = canvasId }) 会用旧 state 把 ref 改回去，
    // 然后这次 GET 的回包发现 ref !== id → 自己丢弃自己
    canvasIdRef.current = id;
    serverVersionRef.current = null;
    setCanvasId(id);
    setServerVersion(null);
    setIsLoading(true);
    setServerError(null);
    setConflict(null);
    setAutoSaveDisabled(false);
    try {
      const row = await apiGetCanvas(id);
      // 用户可能在 GET 期间又切走了
      if (canvasIdRef.current !== id) return;
      canvasIdRef.current = row.id;
      serverVersionRef.current = row.version;
      setProject(row.data);
      setCanvasId(row.id);
      setServerVersion(row.version);
      setDirty(false);
      setLastSavedAt(Date.now());
      bumpLoadRevision();
    } catch (err) {
      if (canvasIdRef.current !== id) return;
      setServerError(err as ApiError);
      throw err;
    } finally {
      // finally 里也校验身份：旧请求来收尾不该误关新 canvas 的 loading 状态
      if (canvasIdRef.current === id) {
        setIsLoading(false);
      }
    }
  }, [bumpLoadRevision]);

  const save = useCallback(async (): Promise<SaveResult> => {
    // 同步并发拦截：自动保存 timer 与手动点击可能同帧触发；React state 的 saving 异步挡不住
    if (saveInFlightRef.current) {
      return { status: 'skipped' };
    }

    const current = projectRef.current;
    if (!current) {
      throw new Error('no project to save');
    }
    // 用 ref 而非闭包变量，确保拿到此刻最新（callback deps 列表外更新的值也能看到）
    const capturedCanvasId = canvasIdRef.current;
    const capturedVersion = serverVersionRef.current;
    if (capturedCanvasId == null || capturedVersion == null) {
      throw new Error('no canvasId; call createOnServer first');
    }

    // 捕获发请求时的修改序号；网络往返期间用户继续改 → ref 会变大 → 不清 dirty
    const capturedSeq = changeSeqRef.current;

    saveInFlightRef.current = true;
    setSaving(true);
    setServerError(null);
    try {
      const result = await apiSaveCanvas(capturedCanvasId, capturedVersion, current);
      // 身份校验：用户在 PUT 期间可能切到别的 canvas，那回包不应污染当前 canvas 状态
      if (canvasIdRef.current !== capturedCanvasId) {
        return { status: 'discarded' };
      }
      // 真正 ref-first：先同步 ref，再 setState，避免极短窗口内二次 save 用旧 baseVersion
      serverVersionRef.current = result.version;
      setServerVersion(result.version);
      setLastSavedAt(Date.now());
      setConflict(null);
      setAutoSaveDisabled(false);
      // 关键：只在序号未变时才清 dirty，否则保留让下个 5s 防抖再保存
      if (changeSeqRef.current === capturedSeq) {
        setDirty(false);
      }
      return { status: 'saved' };
    } catch (err) {
      // 同样身份校验：旧 canvas 的网络错误不该写到新 canvas state
      if (canvasIdRef.current !== capturedCanvasId) {
        return { status: 'discarded' };
      }
      const apiErr = err as ApiError;
      setServerError(apiErr);
      // 任何保存失败都暂停自动保存，避免循环重试 / 用户感知不到
      setAutoSaveDisabled(true);
      if (apiErr.status === 409 && typeof apiErr.currentVersion === 'number') {
        setConflict({ currentVersion: apiErr.currentVersion });
        return { status: 'conflict', currentVersion: apiErr.currentVersion };
      }
      throw err;
    } finally {
      saveInFlightRef.current = false;
      // saving 是本次 operation 自己打开的全局 UI 状态，不按 canvas 身份关 ——
      // saveInFlightRef 已保证全局互斥，唯一的 owner 就是当前这次 save，无条件释放
      setSaving(false);
    }
  }, []);

  const discardAndReload = useCallback(async () => {
    const capturedCanvasId = canvasIdRef.current;
    if (capturedCanvasId == null) {
      throw new Error('no canvasId to reload');
    }
    setIsLoading(true);
    setServerError(null);
    try {
      const row = await apiGetCanvas(capturedCanvasId);
      // 用户在 GET 期间切走了，丢弃结果
      if (canvasIdRef.current !== capturedCanvasId) return;
      serverVersionRef.current = row.version;
      setProject(row.data);
      setServerVersion(row.version);
      setDirty(false);
      setConflict(null);
      setAutoSaveDisabled(false);
      setLastSavedAt(Date.now());
      bumpLoadRevision();
    } catch (err) {
      if (canvasIdRef.current !== capturedCanvasId) return;
      setServerError(err as ApiError);
      throw err;
    } finally {
      // 身份校验：旧 reload 不要误关新 canvas 的 loading
      if (canvasIdRef.current === capturedCanvasId) {
        setIsLoading(false);
      }
    }
  }, [bumpLoadRevision]);

  const createOnServer = useCallback(
    async (input: {
      name: string;
      description?: string;
      visibility: 'public' | 'private';
      is_public_to_guest?: boolean;
    }) => {
      // 同步并发拦截：避免双击"另存到服务器"创建两份
      if (saveInFlightRef.current) {
        throw new Error('another save in flight');
      }
      const current = projectRef.current;
      if (!current) {
        throw new Error('no project to create');
      }
      // 捕获"进入函数时挂载在哪个 canvas"。createOnServer 通常在 canvasIdRef=null 时调用，
      // 但用户也可能在已有 canvas 时点"另存到服务器"克隆一份。
      // POST 期间用户切到别的 canvas → 回包不能改 ref/state 也不能让 caller 写 URL
      const capturedCanvasId = canvasIdRef.current;
      const capturedSeq = changeSeqRef.current;
      saveInFlightRef.current = true;
      setSaving(true);
      setServerError(null);
      try {
        const result = await apiCreateCanvas({
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          is_public_to_guest: input.is_public_to_guest,
          // 同步 data.name 与外层 name，避免列表名和画布标题不一致
          data: { ...current, name: input.name },
        });
        // 身份校验：POST 期间用户切走了 → 不污染当前 canvas
        // discarded=true 让 caller 跳过 setSearchParams（不让 URL 飞到这个新建 id）
        if (canvasIdRef.current !== capturedCanvasId) {
          return { ...result, discarded: true as const };
        }
        // 关键：先同步更新 ref，再 setState。
        // 这样 caller 的 setSearchParams 触发 fetch effect 重跑时，
        // 短路条件（canvasIdRef===prop && serverVersionRef!=null && projectRef!=null）能命中，跳过 refetch
        canvasIdRef.current = result.id;
        serverVersionRef.current = result.version;
        setCanvasId(result.id);
        setServerVersion(result.version);
        setLastSavedAt(Date.now());
        setConflict(null);
        setAutoSaveDisabled(false);
        if (changeSeqRef.current === capturedSeq) {
          setDirty(false);
        }
        return { ...result, discarded: false as const };
      } catch (err) {
        if (canvasIdRef.current !== capturedCanvasId) {
          // 旧操作的错误不污染新 canvas state，但仍向 caller 透传错误
          throw err;
        }
        setServerError(err as ApiError);
        setAutoSaveDisabled(true);
        throw err;
      } finally {
        saveInFlightRef.current = false;
        // saving 是本次 operation 自己打开的全局 UI 状态，无条件释放
        // （之前按 canvas id 校验会导致首次 createOnServer 因 captured=null、ref=新id 永久卡 saving=true）
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
    loadRevision,
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
