import { useCallback, useState, useEffect, useRef, memo, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  // ... imports
  Controls,
  Background,
  // Panel, // Unused
  useNodesState,
  // ...
  useEdgesState,
  useReactFlow,
  Node,
  Edge,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  NodeChange,
  EdgeChange,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { FlowNodeData, NodeUpdateParams, EdgeUpdateParams, MultiCanvasProject, CanvasSheet } from '../../types/flow';
import type { UserPublic } from '../../auth/api';
import { canEditNodeData } from '../../auth/canEditNode';
import { CustomNode } from '../CustomNode';
import { GroupNode } from '../GroupNode';
import DraggableEdge from '../DraggableEdge';
import { NodeDetailPanel, SelectedElement, type AnnotationsBundle } from '../NodeDetailPanel';
import { AnnotationBadgeContext } from '../NodeDetailPanel/annotationBadgeContext';
import { useFlowHistory } from '../../hooks/useFlowHistory';
import { useFlowClipboard } from '../../hooks/useFlowClipboard';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useFlowHandlers } from '../../hooks/useFlowHandlers';
import { useFlowOperations } from '../../hooks/useFlowOperations';
import { useNodeAlignment } from '../../hooks/useNodeAlignment';
import { AlignmentToolbar } from './AlignmentToolbar';
import { CanvasTabBar } from '../CanvasTabBar';
import './styles.css';

// 自定义节点类型
const nodeTypes = {
  custom: CustomNode,
  group: GroupNode,
};

// 自定义边类型
const edgeTypes = {
  draggable: DraggableEdge,
};

interface FlowCanvasProps {
  sheetId?: string;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  onNodesChange?: (changes: NodeChange[]) => void;
  onEdgesChange?: (changes: EdgeChange[]) => void;
  showSubflows?: boolean;
  onToggleSubflows?: () => void;
  onDataChange?: (sheetId: string, nodes: Node<FlowNodeData>[], edges: Edge[]) => void;
  getProjectData?: () => MultiCanvasProject;
  // 多画布标签栏相关
  sheets?: CanvasSheet[];
  activeSheetId?: string;
  onSheetChange?: (sheetId: string) => void;
  onAddSheet?: () => void;
  onDeleteSheet?: (sheetId: string) => void;
  onRenameSheet?: (sheetId: string, newName: string) => void;
  onDuplicateSheet?: (sheetId: string) => void;
  /** 只读模式（游客 / 无写权限）—— 禁拖拽/连线/删除/sheet 增删改，但允许平移缩放选中查看 */
  readOnly?: boolean;
  /** P3D-2 step 3：当前登录用户。给 mutation gate（onNodeUpdate / handleGroupChange /
   *  wrappedOnNodesChange）算 canEditNodeData 用 —— 中心防漏层。
   *  null = 游客（与 readOnly=true 协同；按 readOnly 分支兜底）。
   *  P3D-2 step 3 codex 七审 H2：必传 prop（不允许 default null）。
   *  调用方必须显式传 user，避免登录用户被静默当游客而无法编辑自己的节点。
   *  游客场景显式传 null。 */
  user: UserPublic | null;
  /** v1.16.2：当前画布可见性。给 canDeleteNodeData 用——公共画布上普通用户不能删已保存节点。
   *  默认 'private' 向后兼容（本地草稿 / 私有画布走原有删节点行为）。
   *  caller 应该按 canvasMetaState.kind === 'server' ? meta.visibility : 'private' 传。 */
  canvasVisibility?: 'public' | 'private';
  /** P2I：从 JSON 文件导入为新画布。caller 实现文件选择 + apiImport + URL 跳新 canvasId */
  onImport?: () => void;
  /** P3E-3 批注 bundle（透传给 NodeDetailPanel） */
  annotationsBundle?: AnnotationsBundle | null;
}

import { OffscreenIndicators } from './OffscreenIndicators';

// 内部组件：使用 useReactFlow hook (使用 memo 优化性能)
const FlowCanvasContent = memo(function FlowCanvasContent({
  sheetId,
  initialNodes,
  initialEdges,
  // These props are received but not currently used - prefixed with _ to satisfy ESLint
  showSubflows: _showSubflows,
  onToggleSubflows: _onToggleSubflows,
  onDataChange,
  getProjectData: _getProjectData,
  // 多画布标签栏相关
  sheets,
  activeSheetId,
  onSheetChange,
  onAddSheet,
  onDeleteSheet,
  onRenameSheet,
  onDuplicateSheet,
  readOnly = false,
  user,
  canvasVisibility = 'private',
  onImport,
  annotationsBundle,
}: {
  sheetId?: string;
  initialNodes: Node<FlowNodeData>[];
  initialEdges: Edge[];
  showSubflows?: boolean;
  onToggleSubflows?: () => void;
  onDataChange?: (sheetId: string, nodes: Node<FlowNodeData>[], edges: Edge[]) => void;
  getProjectData?: () => MultiCanvasProject;
  // 多画布标签栏相关
  sheets?: CanvasSheet[];
  activeSheetId?: string;
  onSheetChange?: (sheetId: string) => void;
  onAddSheet?: () => void;
  onDeleteSheet?: (sheetId: string) => void;
  onRenameSheet?: (sheetId: string, newName: string) => void;
  onDuplicateSheet?: (sheetId: string) => void;
  readOnly?: boolean;
  user: UserPublic | null;
  canvasVisibility?: 'public' | 'private';
  onImport?: () => void;
  /** P3E-3 批注 bundle（由 BFV 接 useAnnotations + 派生）；不传 = 不显示批注 tab/徽章 */
  annotationsBundle?: AnnotationsBundle | null;
}) {
  // 迁移旧的 edge handle ID
  const migratedEdges = initialEdges.map((edge) => {
    let sourceHandle = edge.sourceHandle;
    let targetHandle = edge.targetHandle;

    // 将旧的 "top" handle ID 转换为正确的 ID
    if (sourceHandle === 'top') {
      sourceHandle = 'top-source'; // "top" 作为 source 应该使用 "top-source"
    }
    if (targetHandle === 'top') {
      targetHandle = 'top-target'; // "top" 作为 target 应该使用 "top-target"
    }

    // 批量更新：统一连线标签样式
    const labelBgStyle = edge.labelBgStyle || { fill: '#ffffff' };
    const newLabelBgStyle = {
      ...labelBgStyle,
      fillOpacity: 0.8,
    };

    // 确保 data 中也有对应的值
    const data = edge.data || {};
    const newData = {
      ...data,
    };

    return {
      ...edge,
      sourceHandle,
      targetHandle,
      labelBgStyle: newLabelBgStyle,
      data: newData,
    } as Edge;
  });
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(migratedEdges);
  // Use shared type
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const { fitView, screenToFlowPosition, getNodes, getEdges, deleteElements } = useReactFlow<Node<FlowNodeData>, Edge>();

  // 使用自定义 Hooks
  const {
    initHistory,
    saveHistory,
    undo: historyUndo,
    redo: historyRedo,
    isUndoRedoRef,
  } = useFlowHistory();

  // 用于节点拖动防抖保存历史的 ref
  const dragHistoryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDraggingRef = useRef(false);

  const { copyNodes: clipboardCopyNodes, pasteNodes: clipboardPasteNodes } = useFlowClipboard();

  // 使用自动保存 Hook（2秒后自动保存）
  // 注意：disableLocalStorage=true，因为多画布模式下保存由 useMultiCanvas 处理
  const { triggerAutoSave, getFlowData } = useAutoSave(
    nodes,
    edges,
    () => isUndoRedoRef.current,
    'saved-flow-data',
    2000,  // 2秒延迟
    true   // 禁用 LocalStorage 保存，由多画布系统处理
  );

  // 使用节点对齐 Hook
  // P3D-2 step 3 codex 六审 high2：传 user/canvasWritable 让 alignNodes 同源调 canEditNodeData
  const { alignNodes } = useNodeAlignment({ setNodes, saveHistory, user, canvasWritable: !readOnly });

  // 当 nodes/edges 变化时通知父组件（用于多画布数据同步）
  const onDataChangeRef = useRef(onDataChange);
  onDataChangeRef.current = onDataChange;

  // 保存当前组件的 sheetId，确保数据同步到正确的画布
  const currentSheetIdRef = useRef(sheetId);
  currentSheetIdRef.current = sheetId;

  // 数据同步：始终将当前画布的数据同步到父组件
  // 由于 onDataChange 接收 sheetId 参数，数据会保存到正确的画布
  useEffect(() => {
    if (onDataChangeRef.current && currentSheetIdRef.current) {
      onDataChangeRef.current(currentSheetIdRef.current, nodes, edges);
    }
  }, [nodes, edges]);

  // 初始化历史记录（仅在首次加载时）
  const historyInitialized = useRef(false);
  useEffect(() => {
    if (!historyInitialized.current) {
      initHistory(nodes, edges);
      historyInitialized.current = true;
    }
  }, [nodes, edges, initHistory]);

  // 动态更新子节点的 extent（边界限制）
  useEffect(() => {
    // 检查是否有需要更新 extent 的节点
    const childNodes = nodes.filter(n => n.parentId);
    if (childNodes.length === 0) return;

    setNodes((currentNodes) => {
      let hasChanges = false;
      const updatedNodes = currentNodes.map((node) => {
        if (!node.parentId) return node;

        const parentNode = currentNodes.find((n) => n.id === node.parentId);

        // 自愈机制：如果父节点不存在，清除 parentId
        if (!parentNode) {
          return { ...node, parentId: undefined, extent: undefined };
        }

        // 如果 extent 已经设置为 'parent'，保持不变
        if (node.extent === 'parent') {
          return node;
        }

        // 辅助函数：安全获取尺寸
        const getSize = (val: any) => {
          if (typeof val === 'number') return val;
          if (typeof val === 'string') return parseFloat(val);
          return undefined;
        };

        // 获取实际尺寸
        // 子节点优先使用 measured (自适应)，父节点优先使用 style (因为可能被 Resize)
        const nodeWidth = getSize(node.measured?.width) || getSize(node.style?.width) || 120;
        const nodeHeight = getSize(node.measured?.height) || getSize(node.style?.height) || 60;
        const parentWidth = getSize(parentNode.style?.width) || getSize(parentNode.measured?.width) || 200;
        const parentHeight = getSize(parentNode.style?.height) || getSize(parentNode.measured?.height) || 150;

        // 计算边界 - 减小 padding 允许节点更靠近边缘
        const padding = 5; // 减小到 5px
        const headerHeight = 40;
        const minX = padding;
        const minY = headerHeight + padding;
        let maxX = Math.max(minX, parentWidth - nodeWidth - padding);
        let maxY = Math.max(minY, parentHeight - nodeHeight - padding);

        const newExtent: [[number, number], [number, number]] = [
          [minX, minY],
          [maxX, maxY]
        ];

        // 检查是否需要更新
        const currentExtent = node.extent;
        const needsUpdate = !currentExtent ||
          !Array.isArray(currentExtent) ||
          currentExtent[0][0] !== newExtent[0][0] ||
          currentExtent[0][1] !== newExtent[0][1] ||
          currentExtent[1][0] !== newExtent[1][0] ||
          currentExtent[1][1] !== newExtent[1][1];

        if (needsUpdate) {
          hasChanges = true;
          return { ...node, extent: newExtent };
        }

        return node;
      });

      return hasChanges ? updatedNodes : currentNodes;
    });
  }, [nodes.map(n => `${n.id} -${n.measured?.width} -${n.measured?.height} -${n.style?.width} -${n.style?.height} -${n.parentId} `).join(','), setNodes]);


  // 渲染层防御：在传递给 ReactFlow 之前，确保数据合法且有序
  // 1. 过滤无效 parentId
  // 2. 排序：父节点必须在子节点前面（React Flow 要求）
  const safeNodes = useMemo(() => {
    const parentIds = new Set(nodes.map(n => n.id));

    // 清洗数据：移除无效的 parentId
    const sanitizedNodes = nodes.map(node => {
      if (node.parentId && !parentIds.has(node.parentId)) {
        return { ...node, parentId: undefined, extent: undefined };
      }
      return node;
    });

    // 检查是否已经正确排序（分组节点在前）
    let needsSort = false;
    for (let i = 0; i < sanitizedNodes.length - 1; i++) {
      // 如果发现非分组节点在分组节点之前，需要排序
      if (sanitizedNodes[i].type !== 'group' && sanitizedNodes[i + 1].type === 'group') {
        needsSort = true;
        break;
      }
    }

    // 只在需要时排序，避免创建不必要的新数组
    if (needsSort) {
      return sanitizedNodes.sort((a, b) => {
        if (a.type === 'group' && b.type !== 'group') return -1;
        if (a.type !== 'group' && b.type === 'group') return 1;
        return 0;
      });
    }

    return sanitizedNodes;
  }, [nodes]);

  // Sync selectedElement when nodes or edges change (e.g. resize or data update from other sources)
  // 使用 setTimeout 延迟 setState，避免同步调用导致的级联渲染警告
  useEffect(() => {
    if (!selectedElement) return;

    // 比较当前选中的元素与 store 中的选中状态
    const selectedNode = nodes.find((n) => n.selected);
    const selectedEdge = edges.find((e) => e.selected);

    let newSelectedElement: SelectedElement | null = null;
    if (selectedNode) {
      newSelectedElement = {
        type: 'node',
        data: selectedNode.data,
        node: selectedNode,
      };
    } else if (selectedEdge) {
      newSelectedElement = {
        type: 'edge',
        data: selectedEdge,
      };
    }

    // 只有当选中的元素真正发生变化时才更新状态
    // 如果之前没有选中且现在也没有选中，不更新
    if (!selectedElement && !newSelectedElement) {
      return;
    }

    // 如果类型不同，或者 ID 不同，则更新
    const currentId = selectedElement?.type === 'node' ? selectedElement.node?.id : selectedElement?.data.id;
    const newId = newSelectedElement?.type === 'node' ? newSelectedElement.node?.id : newSelectedElement?.data.id;

    const isDifferentId = currentId !== newId;

    // 深度比较 data 是否变化（可选，但通常 ID 变化就足够了）
    // 这里我们主要关注 ID 和类型的变化
    if (
      isDifferentId ||
      selectedElement?.type !== newSelectedElement?.type ||
      (!selectedElement && newSelectedElement) ||
      (selectedElement && !newSelectedElement)
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedElement(newSelectedElement);
    }
  }, [nodes, edges, selectedElement]);

  // 监听选中节点变化，高亮关联节点（正向）和引用源节点（反向）
  useEffect(() => {
    // 辅助函数：清理高亮类名
    const removeHighlight = (cls: string = '') =>
      cls.replace('related-node-highlight', '').replace('source-node-highlight', '').trim();
    const removeEdgeHighlight = (cls: string = '') =>
      cls.replace('related-edge-highlight', '').replace('source-edge-highlight', '').trim();

    if (selectedElement?.type === 'node') {
      const selectedId = selectedElement.data.id;
      // 1. 正向关联
      const relatedIds = selectedElement.data.relatedNodeIds || [];

      // 2. 反向关联：使用 getNodes() 获取最新节点列表，避免依赖 nodes 导致循环引用
      const currentNodes = getNodes();
      const sourceIds = currentNodes
        .filter(n => n.data.relatedNodeIds?.includes(selectedId))
        .map(n => n.id);

      const hasRelated = relatedIds.length > 0;
      const hasSource = sourceIds.length > 0;

      if (hasRelated || hasSource) {
        // Highlight Nodes
        setNodes((nds) => {
          let hasChanges = false;
          const newNodes = nds.map(node => {
            const isRelated = relatedIds.includes(node.id);
            const isSource = sourceIds.includes(node.id);
            const originalClass = node.className || '';

            // Remove old highlights first to compare cleanly
            let newClass = removeHighlight(originalClass);

            if (isRelated) {
              newClass = `${newClass} related-node-highlight`;
            }
            if (isSource) {
              newClass = `${newClass} source-node-highlight`;
            }
            newClass = newClass.trim();

            if (newClass !== originalClass) {
              hasChanges = true;
              return { ...node, className: newClass };
            }
            return node;
          });
          return hasChanges ? newNodes : nds;
        });

        // Highlight Edges
        setEdges((eds) => {
          let hasChanges = false;
          const newEdges = eds.map(edge => {
            const isConnectedToRelated = (edge.source === selectedId && relatedIds.includes(edge.target)) ||
              (edge.target === selectedId && relatedIds.includes(edge.source));

            const isConnectedToSource = (edge.source === selectedId && sourceIds.includes(edge.target)) ||
              (edge.target === selectedId && sourceIds.includes(edge.source));

            const originalClass = edge.className || '';
            let newClass = removeEdgeHighlight(originalClass);
            let newAnimated = edge.animated;

            // Restore animated default if it was modified (we assume default is true or false? 
            // Actually existing logic assumed we set it to true if highlighted.
            // Let's preserve original animation state if not highlighted? 
            // Standard DraggableEdge isn't animated by default in some configs, but user asked to restore "flowing". 
            // Let's set animated=true if highlighted or restoring.

            if (isConnectedToRelated) {
              newClass = `${newClass} related-edge-highlight`;
              newAnimated = true;
            } else if (isConnectedToSource) {
              newClass = `${newClass} source-edge-highlight`;
              newAnimated = true;
            } else if ((edge.className || '').includes('related-edge-highlight') || (edge.className || '').includes('source-edge-highlight')) {
              // Was highlighted, now removing. Restore animation to true per user request
              newAnimated = true;
            }

            newClass = newClass.trim();

            if (newClass !== originalClass || newAnimated !== edge.animated) {
              hasChanges = true;
              return { ...edge, className: newClass, animated: newAnimated };
            }
            return edge;
          });
          return hasChanges ? newEdges : eds;
        });
      } else {
        // Clear if no relations found
        setNodes((nds) => {
          let hasChanges = false;
          const newNodes = nds.map(node => {
            // Only update if it HAS the class
            if (node.className?.includes('related-node-highlight') || node.className?.includes('source-node-highlight')) {
              hasChanges = true;
              return { ...node, className: removeHighlight(node.className) };
            }
            return node;
          });
          return hasChanges ? newNodes : nds;
        });

        setEdges((eds) => {
          let hasChanges = false;
          const newEdges = eds.map(edge => {
            if (edge.className?.includes('related-edge-highlight') || edge.className?.includes('source-edge-highlight')) {
              hasChanges = true;
              return { ...edge, className: removeEdgeHighlight(edge.className), animated: true };
            }
            return edge;
          });
          return hasChanges ? newEdges : eds;
        });
      }

    } else {
      // 没有任何选中节点，清除所有高亮
      setNodes((nds) => {
        let hasChanges = false;
        const newNodes = nds.map(node => {
          if (node.className?.includes('related-node-highlight') || node.className?.includes('source-node-highlight')) {
            hasChanges = true;
            return { ...node, className: removeHighlight(node.className) };
          }
          return node;
        });
        return hasChanges ? newNodes : nds;
      });

      setEdges((eds) => {
        let hasChanges = false;
        const newEdges = eds.map(edge => {
          if (edge.className?.includes('related-edge-highlight') || edge.className?.includes('source-edge-highlight')) {
            hasChanges = true;
            return { ...edge, className: removeEdgeHighlight(edge.className), animated: true };
          }
          return edge;
        });
        return hasChanges ? newEdges : eds;
      });
    }
  }, [selectedElement, setNodes, setEdges, getNodes]); // Removed 'nodes' dependency

  // 包装 undo/redo 函数以关闭详情面板
  // P3D-2 step 9：传 nodes/user/canvasWritable，让 useFlowHistory 内部按权限合并 snapshot
  // 防御 12-二审 必修 3：撤销/重做整份覆盖会绕过中心 gate
  const undo = useCallback(() => {
    historyUndo(setNodes, setEdges, nodes, edges, user, !readOnly);
    setSelectedElement(null);
    setShowPanel(false);
  }, [historyUndo, setNodes, setEdges, nodes, edges, user, readOnly]);

  const redo = useCallback(() => {
    historyRedo(setNodes, setEdges, nodes, edges, user, !readOnly);
    setSelectedElement(null);
    setShowPanel(false);
  }, [historyRedo, setNodes, setEdges, nodes, edges, user, readOnly]);

  // 包装 copyNodes 以获取选中的节点
  const copyNodes = useCallback(() => {
    const selectedNodes = getNodes().filter((node) => node.selected);
    clipboardCopyNodes(selectedNodes);
  }, [getNodes, clipboardCopyNodes]);

  // 包装 pasteNodes 以传入需要的参数
  const pasteNodes = useCallback(() => {
    clipboardPasteNodes(setNodes, edges, () => {
      saveHistory(nodes, edges);
    });
    // 触发自动保存
    setTimeout(() => {
      triggerAutoSave();
    }, 0);
  }, [clipboardPasteNodes, setNodes, edges, saveHistory, nodes, triggerAutoSave]);

  // 使用 useFlowHandlers Hook
  const {
    wrappedOnNodesChange,
    wrappedOnEdgesChange,
    onNodeClick,
    onEdgeClick,
    closePanel,
    onPaneClick,
    isValidConnection,
    onConnect,
    onNodeUpdate,
    onEdgeUpdate,
    onEdgeDoubleClick,
  } = useFlowHandlers({
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    selectedElement,
    setSelectedElement,
    showPanel,
    setShowPanel,
    saveHistory,
    triggerAutoSave,
    isUndoRedoRef,
    isDraggingRef,
    dragHistoryTimerRef,
    readOnly,
    user,
    canvasVisibility,
  });

  // 使用 useFlowOperations Hook
  // 注意：onSave/onExport/onImport 阶段 2 P2H 起不再使用（左侧旧按钮已删）
  const {
    onAddNode,
    onCreateGroup,
    onUngroup,
    onRemoveFromGroup,
    onUpdateGroupLabel,
  } = useFlowOperations({
    nodes,
    edges,
    setNodes,
    setEdges,
    screenToFlowPosition,
    saveHistory,
    triggerAutoSave,
    getFlowData,
    fitView,
    user,
    canvasWritable: !readOnly,
  });

  // 监听标签更改事件（分组和普通节点）
  // P3D-2 step 3 codex 二审 Blocker 1：事件层 gate
  // - readOnly = !canvasWritable，作为粗粒度第一层
  // - __canEdit === false 作为节点级第二层（非 creator 也要拦）
  // onUpdateGroupLabel / onNodeUpdate 内部已有兜底 gate，这里早退避免 setNodes 抖动
  useEffect(() => {
    const handleGroupLabelChange = (e: CustomEvent<{ id: string; label: string }>) => {
      if (readOnly) return;
      const target = getNodes().find((n) => n.id === e.detail.id);
      if (!target) return;
      if ((target.data as { __canEdit?: boolean }).__canEdit === false) return;
      onUpdateGroupLabel(e.detail.id, e.detail.label);
    };

    const handleNodeLabelChange = (e: CustomEvent<{ id: string; label: string }>) => {
      if (readOnly) return;
      const target = getNodes().find((n) => n.id === e.detail.id);
      if (!target) return;
      if ((target.data as { __canEdit?: boolean }).__canEdit === false) return;
      onNodeUpdate(e.detail.id, { name: e.detail.label });
    };

    window.addEventListener('groupLabelChange', handleGroupLabelChange as EventListener);
    window.addEventListener('nodeLabelChange', handleNodeLabelChange as EventListener);

    return () => {
      window.removeEventListener('groupLabelChange', handleGroupLabelChange as EventListener);
      window.removeEventListener('nodeLabelChange', handleNodeLabelChange as EventListener);
    };
  }, [readOnly, onUpdateGroupLabel, onNodeUpdate, getNodes]);



  // 适配 NodeDetailPanel 的更新回调
  const handleNodeDetailChange: (id: string, updates: NodeUpdateParams) => void = useCallback(
    (id: string, updates: NodeUpdateParams) => {
      // Direct pass-through of ID and updates to onNodeUpdate which now handles merging atomically
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onNodeUpdate(id, (updates.data || {}) as any, updates.style);
    },
    [onNodeUpdate]
  );

  const handleEdgeDetailChange: (id: string, updates: EdgeUpdateParams) => void = useCallback(
    (id: string, updates: EdgeUpdateParams) => {
      const edge = edges.find((e) => e.id === id);
      if (!edge) return;

      const newEdge = { ...edge, ...updates } as Edge;
      onEdgeUpdate(newEdge);
    },
    [edges, onEdgeUpdate]
  );

  // 分组属性更新回调
  // P3D-2 step 3 codex 二审必修 1：拒绝路径必须在所有 setState 之前（与 onNodeUpdate 同模式）
  // 否则 triggerAutoSave 会被触发，导致空白保存。
  //
  // 标废弃路径不走这里（DeprecateNodeSection 通过 onNodeUpdate 直接改 is_deprecated），
  // 所以这里**不需要** is_deprecated 例外，全程按 canEditNodeData 判定。
  const handleGroupChange = useCallback(
    (id: string, updates: { label?: string; color?: string; relatedNodeIds?: string[] }) => {
      if (readOnly) return;
      // 提前从 React Flow 实例拿当前 nodes（拒绝路径不能进 setNodes）
      const currentNodes = getNodes();
      const targetNode = currentNodes.find((n) => n.id === id && n.type === 'group');
      // target 不存在 → 无效 id，直接早退（避免无意义 setNodes + triggerAutoSave）
      if (!targetNode) return;
      // target 存在但无权 → 默默吞掉，不进 setNodes 也不 triggerAutoSave
      if (!canEditNodeData(
        targetNode.data as unknown as FlowNodeData,
        user,
        !readOnly,
      )) {
        return;
      }
      setNodes((nds) => nds.map((node) => {
        if (node.id === id && node.type === 'group') {
          const newData = { ...node.data };
          if (updates.label !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (newData as any).label = updates.label;
          }
          if (updates.color !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (newData as any).color = updates.color;
          }
          if (updates.relatedNodeIds !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (newData as any).relatedNodeIds = updates.relatedNodeIds;
          }
          return { ...node, data: newData };
        }
        return node;
      }));
      triggerAutoSave();
    },
    [setNodes, triggerAutoSave, readOnly, user, getNodes]
  );

  // 解散分组时关闭面板
  const handleUngroup = useCallback(
    (groupId: string) => {
      onUngroup(groupId);
      setSelectedElement(null);
      setShowPanel(false);
    },
    [onUngroup, setSelectedElement, setShowPanel]
  );

  // 从分组移除节点时更新面板
  const handleRemoveFromGroup = useCallback(
    (nodeId: string) => {
      onRemoveFromGroup(nodeId);
    },
    [onRemoveFromGroup]
  );

  // 删除处理函数
  const handleDelete = useCallback(() => {
    if (readOnly) return; // 只读模式下直接吞 Backspace 等触发的删除
    // 检查是否有选中的元素 - 使用 getter 获取最新状态，避免依赖变化导致重渲染
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const selectedNodes = currentNodes.filter((n) => n.selected);
    const selectedEdges = currentEdges.filter((e) => e.selected);

    if (selectedNodes.length === 0 && selectedEdges.length === 0) {
      return;
    }

    // P3D-2 step 3+7：节点级权限按"边/节点拆分"处理（06-范围审查必修 6）
    // - 边没有 creator 语义，按 canvasWritable 即可删（已通过 readOnly 早退）
    // - 节点必须 canEditNodeData（admin / creator / __localNew），不可编辑节点要跳过而不是整体拒
    //
    // 老版本（step 3）：all-or-nothing 整体拒，确认弹窗都不弹 → 用户体验"按 Backspace 没反应"
    // 新版本（step 7）：拆分处理 —— 可编辑节点 + 所有边走删除流程；不可编辑节点跳过并提示
    //                 边的"相连节点不存在"问题不用前端管（React Flow / 服务端 § 5.6 兜底）
    const editableNodes = selectedNodes.filter((n) => canEditNodeData(n.data, user, !readOnly));
    const uneditableNodes = selectedNodes.filter((n) => !canEditNodeData(n.data, user, !readOnly));

    // 全部不可编辑（且无边选中）→ 友好提示"用标废弃"
    if (editableNodes.length === 0 && selectedEdges.length === 0 && uneditableNodes.length > 0) {
      alert('选中的节点你不是创建者（仅作者或管理员可删除）。\n如需停用节点请使用详情面板的"标记废弃"按钮——废弃节点对所有用户可见但视觉上半透明。');
      return;
    }

    // 部分不可编辑：只删可删的（编辑节点 + 边），跳过不可编辑节点
    // 弹出确认框（含跳过提示）
    let confirmMessage: string;
    if (editableNodes.length > 0 && selectedEdges.length > 0) {
      confirmMessage = `确定要删除选中的 ${editableNodes.length} 个节点和 ${selectedEdges.length} 条连线吗？`;
    } else if (editableNodes.length > 0) {
      confirmMessage = `确定要删除选中的 ${editableNodes.length} 个节点吗？\n注意：删除节点也会删除相连的连线。`;
    } else {
      // 仅边
      confirmMessage = `确定要删除选中的 ${selectedEdges.length} 条连线吗？`;
    }
    if (uneditableNodes.length > 0) {
      // 一审 Low 2：明确说"边仍删" —— 用户可能以为跳过节点的相关连线也保留
      confirmMessage += `\n\n${uneditableNodes.length} 个不可编辑节点将被跳过（非作者创建，请用"标废弃"代替）。\n注意：选中的连线仍会删除，即使连接到被跳过的节点。`;
    }

    if (window.confirm(confirmMessage)) {
      deleteElements({ nodes: editableNodes, edges: selectedEdges });
      setSelectedElement(null);
      setShowPanel(false);
    }
  }, [getNodes, getEdges, deleteElements, setSelectedElement, setShowPanel, readOnly, user]);

  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框或文本域中，不拦截快捷键，让浏览器原生功能生效
      const target = e.target as HTMLElement;
      const isInputElement =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isInputElement) {
        // 在输入框中，不拦截，让浏览器原生功能工作
        return;
      }

      // Ctrl+C 或 Cmd+C (Mac) - 复制
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copyNodes();
        return;
      }

      // Ctrl+V 或 Cmd+V (Mac) - 粘贴
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (readOnly) { e.preventDefault(); return; }
        e.preventDefault();
        pasteNodes();
        return;
      }

      // Ctrl+Z 或 Cmd+Z (Mac) - 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (readOnly) { e.preventDefault(); return; }
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z 或 Cmd+Shift+Z (Mac) - 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        if (readOnly) { e.preventDefault(); return; }
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+G 或 Cmd+G (Mac) - 创建分组
      // P3D-2 step 6：所有选中节点必须可编辑才能创建分组（与 onCreateGroup 数据层 gate 同口径）
      // 一审 Low 1：UI 层同源调 canEditNodeData（不依赖 BFV 派生 __canEdit），与 handleDelete 同口径
      // 派生字段只是 fast path，真正可信边界是 canEditNodeData / 数据层 gate
      if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey) {
        if (readOnly) { e.preventDefault(); return; }
        e.preventDefault();
        const selectedNodes = getNodes().filter((n) => n.selected && n.type !== 'group' && !n.parentId);
        if (selectedNodes.length === 0) {
          alert('请先选择至少 1 个节点来创建分组');
          return;
        }
        const hasUneditable = selectedNodes.some(
          (n) => !canEditNodeData(n.data, user, !readOnly),
        );
        if (hasUneditable) {
          alert('选中的节点中包含不可编辑的节点（非作者创建），无法创建分组。\n请只选中你自己创建的节点重试。');
          return;
        }
        onCreateGroup();
        return;
      }

      // Ctrl+Shift+G 或 Cmd+Shift+G (Mac) - 解散分组
      // P3D-2 step 6 + 一审 H2：解散分组 admin-only（与 useFlowOperations.onUngroup 数据层 gate 同口径）
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G') {
        if (readOnly) { e.preventDefault(); return; }
        e.preventDefault();
        // 如果选中的是分组节点，则解散该分组
        if (selectedElement?.type === 'node' && selectedElement.node?.type === 'group') {
          // 提前 admin-only 检查 + 友好提示
          if (!user || user.role !== 'admin') {
            alert('解散分组仅管理员可操作。\n如需调整分组成员，请使用详情面板的"移出分组"按钮。');
            return;
          }
          // 使用 handleUngroup 确保面板关闭
          handleUngroup(selectedElement.data.id as string);
        }
        return;
      }

      // Ctrl+Shift+D 或 Cmd+Shift+D (Mac) - 复制当前画布
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        if (readOnly) { e.preventDefault(); return; }
        e.preventDefault();
        if (onDuplicateSheet && activeSheetId) {
          onDuplicateSheet(activeSheetId);
        }
        return;
      }

      // Backspace - 删除 (带确认；handleDelete 内部也会再次拦 readOnly)
      if (e.key === 'Backspace') {
        if (readOnly) { e.preventDefault(); return; }
        const target = e.target as HTMLElement;
        const isInputElement =
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        if (!isInputElement) {
          e.preventDefault();
          handleDelete();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, undo, redo, copyNodes, pasteNodes, onCreateGroup, handleUngroup, selectedElement, handleDelete, onDuplicateSheet, activeSheetId, getNodes, user]);

  // Determine alignment toolbar visibility (when more than 1 node is selected)
  const showAlignmentToolbar = nodes.filter((n) => n.selected).length > 1;

  // 侧边栏折叠状态
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // P3E-3 一审 high 1：徽章点击下沉到 FlowCanvas 内部实现
  // 显式选中目标节点（setNodes selected） + 打开详情面板（setSelectedElement + setShowPanel）
  // + 通过 annotationsBundle.requestPanelTab 通知 BFV 切到批注 tab
  // 这样无论用户点哪个节点的徽章（已选中 / 未选中 / 在另一个 sheet），都能正确导航到批注
  const onAnnotationBadgeClick = useCallback(
    (nodeId: string) => {
      const targetNode = nodes.find((n) => n.id === nodeId);
      if (!targetNode) return; // 节点不存在 fail-closed
      // 1. 标记 React Flow 选中态（其他节点取消选中）
      setNodes((prev) =>
        prev.map((n) => (n.selected !== (n.id === nodeId) ? { ...n, selected: n.id === nodeId } : n)),
      );
      // 2. 同步 NodeDetailPanel 选中
      setSelectedElement({
        type: 'node',
        data: targetNode.data as FlowNodeData,
        node: targetNode,
      });
      setShowPanel(true);
      // 3. 通知 BFV 切到批注 tab（NodeDetailPanel pendingPanelTab effect 消费时校验 nodeId 匹配）
      annotationsBundle?.requestPanelTab(nodeId, 'annotations');
    },
    [nodes, setNodes, annotationsBundle],
  );

  // 修法：getUnresolvedCount + activeSheetId 也通过 Context 注入（避免 node.data 锁状态）
  // 详见 annotationBadgeContext.ts 注释：FlowCanvas useNodesState(initialNodes) 锁内部 state，
  // 外部 BFV 派生 data.__annotationUnresolvedCount 不会同步进 React Flow 内部
  const getUnresolvedCount = useCallback(
    (sheetId: string, nodeId: string): number => {
      if (!annotationsBundle) return 0;
      // bundle.getAnnotationsForNode 已派生（依赖 annotations.annotationsByNodeKey 响应式）
      const list = annotationsBundle.getAnnotationsForNode(sheetId, nodeId);
      return list.filter((a) => a.status === 'unresolved').length;
    },
    [annotationsBundle],
  );

  const annotationBadgeContextValue = useMemo(
    () => ({
      onBadgeClick: onAnnotationBadgeClick,
      getUnresolvedCount,
      activeSheetId: activeSheetId ?? null,
    }),
    [onAnnotationBadgeClick, getUnresolvedCount, activeSheetId],
  );

  return (
    <AnnotationBadgeContext.Provider value={annotationBadgeContextValue}>
    <div className={`flow-canvas-container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar Area */}
      <div className={`flow-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          {!isSidebarCollapsed && <span className="sidebar-title">功能面板</span>}
          <button
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "展开菜单" : "收起菜单"}
          >
            {isSidebarCollapsed ? '▶' : '◀'}
          </button>
        </div>

        <div className="flow-controls">
          {/*
            阶段 2 P2H 整改：删除"保存到本地版本库 / 导出 / 导入"三个旧按钮。
            - 服务端保存由顶栏 SaveStatus 接管（自动保存 + 手动保存按钮）
            - 阶段 2 P2I：
              · 导出按钮回归到顶栏 SaveStatus（不在这里），原因是导出仅需 canRead，
                游客只读模式（左侧工具栏整段隐藏）下也应能导出
              · 导入按钮放在这里 —— 必须登录用户才能创建新画布，readOnly 时整段隐藏正符合预期
          */}
          {/* 只读模式下整段"文件/操作/节点/分组"工具组隐藏 */}
          {!readOnly && (
            <>
              {onImport && (
                <div className="control-section">
                  <div className="section-title">{!isSidebarCollapsed && '文件'}</div>
                  <button
                    className="control-btn btn-import"
                    onClick={onImport}
                    title="从 JSON 文件导入为新画布（创建一份私有副本）"
                  >
                    <span className="btn-icon">📥</span>
                    {!isSidebarCollapsed && <span className="btn-text">导入</span>}
                  </button>
                </div>
              )}

              {onImport && <div className="divider"></div>}
            </>
          )}
          {!readOnly && (
            <>
              <div className="control-section">
                <div className="section-title">{!isSidebarCollapsed && '操作'}</div>
                <button className="control-btn" onClick={undo} title="撤销 (Ctrl+Z)">
                  <span className="btn-icon">↶</span>
                  {!isSidebarCollapsed && <span className="btn-text">撤销</span>}
                </button>
                <button className="control-btn" onClick={redo} title="重做 (Ctrl+Y)">
                  <span className="btn-icon">↷</span>
                  {!isSidebarCollapsed && <span className="btn-text">重做</span>}
                </button>
                <button className="control-btn" onClick={handleDelete} title="删除选中元素 (Backspace)；非作者节点会被跳过，请用详情面板的标记废弃按钮">
                  <span className="btn-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M3 6H5H21" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M8 6V4C8 2.89543 8.89543 2 10 2H14C15.1046 2 16 2.89543 16 4V6M19 6V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V6H19Z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {!isSidebarCollapsed && <span className="btn-text">删除</span>}
                </button>
              </div>

              <div className="divider"></div>

              <div className="control-section">
                <div className="section-title">{!isSidebarCollapsed && '节点'}</div>
                <button
                  className="control-btn btn-node"
                  onClick={() => onAddNode('process')}
                  title="添加流程节点"
                >
                  <span className="btn-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="3" y="6" width="18" height="12" rx="2" />
                    </svg>
                  </span>
                  {!isSidebarCollapsed && <span className="btn-text">流程节点</span>}
                </button>
                <button
                  className="control-btn btn-node"
                  onClick={() => onAddNode('decision')}
                  title="添加判断节点"
                >
                  <span className="btn-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 3L21 12L12 21L3 12L12 3Z" />
                    </svg>
                  </span>
                  {!isSidebarCollapsed && <span className="btn-text">判断节点</span>}
                </button>
                <button className="control-btn btn-node" onClick={() => onAddNode('data')} title="添加数据节点">
                  <span className="btn-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 19H19L21 5H7L5 19Z" />
                    </svg>
                  </span>
                  {!isSidebarCollapsed && <span className="btn-text">审批节点</span>}
                </button>
                <button
                  className="control-btn btn-node"
                  onClick={() => onAddNode('terminator')}
                  title="添加起止节点"
                >
                  <span className="btn-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="3" y="6" width="18" height="12" rx="6" />
                    </svg>
                  </span>
                  {!isSidebarCollapsed && <span className="btn-text">起止节点</span>}
                </button>
              </div>

              <div className="divider"></div>

              <div className="control-section">
                <div className="section-title">{!isSidebarCollapsed && '分组'}</div>
                <button
                  className="control-btn btn-group"
                  onClick={onCreateGroup}
                  title="将选中节点创建为分组 (Ctrl+G)"
                >
                  <span className="btn-icon">📁</span>
                  {!isSidebarCollapsed && <span className="btn-text">创建分组</span>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="canvas-area">
        <AlignmentToolbar
          visible={!readOnly && showAlignmentToolbar}
          onAlign={alignNodes}
        />
        <ReactFlow
          nodes={safeNodes}
          edges={edges}
          onNodesChange={wrappedOnNodesChange}
          onEdgesChange={wrappedOnEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          connectionMode={ConnectionMode.Loose}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
          minZoom={0.5}
          maxZoom={2}
          defaultEdgeOptions={{
            type: 'draggable', // 默认使用可拖拽 Edge
            animated: true,
            style: { stroke: '#64748b', strokeWidth: 1 },
            // 默认箭头指向目标节点（target）
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#64748b',
              width: 16,
              height: 16,
            },
            // 确保不设置 markerStart，避免箭头指向错误的方向
            markerStart: undefined,
          }}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={true}
          edgesReconnectable={!readOnly}
          selectionOnDrag={false}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode="Shift" // 按住 Shift + 左键框选
          deleteKeyCode={null} // 禁用默认删除键，使用自定义 Backspace 处理（readOnly 时 handleDelete 也会拦）
          panOnDrag={true} // 平移和缩放只读用户也可用
          zoomOnScroll={true}
          style={{ width: '100%', height: '100%' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.5}
            color="#475569"
            style={{ opacity: 0.4 }}
          />

          <Controls />
          {/* Controls used to be here, now moved out */}
        </ReactFlow>

        {/* 指示器层 - 移到 ReactFlow 外部以避免随画布缩放平移 */}
        <OffscreenIndicators
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedElement?.type === 'node' ? selectedElement.data.id : null}
        />

        {/* 节点详情面板 */}
        <NodeDetailPanel
          selectedElement={selectedElement}
          visible={showPanel}
          onClose={closePanel}
          onNodeChange={handleNodeDetailChange}
          onEdgeChange={handleEdgeDetailChange}
          onGroupChange={handleGroupChange}
          onUngroup={handleUngroup}
          onRemoveFromGroup={handleRemoveFromGroup}
          allNodes={nodes}
          readOnly={readOnly}
          user={user}
          annotationsBundle={annotationsBundle ?? null}
        />
      </div>

      {/* 底部标签栏 - 多画布切换 */}
      {sheets && sheets.length > 0 && onSheetChange && onAddSheet && onDeleteSheet && onRenameSheet && (
        <CanvasTabBar
          sheets={sheets}
          activeSheetId={activeSheetId || ''}
          onSheetChange={onSheetChange}
          onAddSheet={onAddSheet}
          onDeleteSheet={onDeleteSheet}
          onRenameSheet={onRenameSheet}
          onDuplicateSheet={onDuplicateSheet}
          readOnly={readOnly}
        />
      )}
    </div>
    </AnnotationBadgeContext.Provider>
  );
});

// 外部组件：提供 ReactFlowProvider
export function FlowCanvas({
  sheetId,
  nodes: initialNodes,
  edges: initialEdges,
  onDataChange,
  getProjectData,
  sheets,
  activeSheetId,
  onSheetChange,
  onAddSheet,
  onDeleteSheet,
  onRenameSheet,
  onDuplicateSheet,
  readOnly = false,
  user,
  canvasVisibility,
  onImport,
  annotationsBundle,
}: FlowCanvasProps) {
  // 使用 sheetId 作为 key 确保 ReactFlowProvider 和 FlowCanvasContent 都重新挂载
  return (
    <ReactFlowProvider key={sheetId}>
      <FlowCanvasContent
        sheetId={sheetId}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        onDataChange={onDataChange}
        getProjectData={getProjectData}
        sheets={sheets}
        activeSheetId={activeSheetId}
        onSheetChange={onSheetChange}
        onAddSheet={onAddSheet}
        onDeleteSheet={onDeleteSheet}
        onRenameSheet={onRenameSheet}
        onDuplicateSheet={onDuplicateSheet}
        readOnly={readOnly}
        user={user}
        canvasVisibility={canvasVisibility}
        onImport={onImport}
        annotationsBundle={annotationsBundle}
      />
    </ReactFlowProvider>
  );
}
