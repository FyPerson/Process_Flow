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

import { FlowNodeData, NodeUpdateParams, EdgeUpdateParams } from '../../types/flow';
import { CustomNode } from '../CustomNode';
import { GroupNode } from '../GroupNode';
import DraggableEdge from '../DraggableEdge';
import { NodeDetailPanel, SelectedElement } from '../NodeDetailPanel';
import { useFlowHistory } from '../../hooks/useFlowHistory';
import { useFlowClipboard } from '../../hooks/useFlowClipboard';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useFlowHandlers } from '../../hooks/useFlowHandlers';
import { useFlowOperations } from '../../hooks/useFlowOperations';
import { useNodeAlignment } from '../../hooks/useNodeAlignment';
import { AlignmentToolbar } from './AlignmentToolbar';
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
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  onNodesChange?: (changes: NodeChange[]) => void;
  onEdgesChange?: (changes: EdgeChange[]) => void;
  showSubflows?: boolean;
  onToggleSubflows?: () => void;
}

import { OffscreenIndicators } from './OffscreenIndicators';

// 内部组件：使用 useReactFlow hook (使用 memo 优化性能)
const FlowCanvasContent = memo(function FlowCanvasContent({
  initialNodes,
  initialEdges,
  // These props are received but not currently used - prefixed with _ to satisfy ESLint
  showSubflows: _showSubflows,
  onToggleSubflows: _onToggleSubflows,
}: {
  initialNodes: Node<FlowNodeData>[];
  initialEdges: Edge[];
  showSubflows?: boolean;
  onToggleSubflows?: () => void;
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
  const { fitView, screenToFlowPosition, getNodes } = useReactFlow<Node<FlowNodeData>, Edge>();

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
  const { triggerAutoSave, getFlowData } = useAutoSave(
    nodes,
    edges,
    () => isUndoRedoRef.current,
    'saved-flow-data',
    2000  // 2秒延迟
  );

  // 使用节点对齐 Hook
  const { alignNodes } = useNodeAlignment({ setNodes, saveHistory });

  // 当初始数据变化时更新节点和边
  useEffect(() => {
    // 只有当传入有效的初始数据且当前 store 为空时才初始化
    if (initialNodes.length > 0 && nodes.length === 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges, nodes.length]);

  useEffect(() => {
    if (nodes.length > 0 || edges.length > 0) {
      initHistory(nodes, edges);
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
  const undo = useCallback(() => {
    historyUndo(setNodes, setEdges);
    setSelectedElement(null);
    setShowPanel(false);
  }, [historyUndo, setNodes, setEdges]);

  const redo = useCallback(() => {
    historyRedo(setNodes, setEdges);
    setSelectedElement(null);
    setShowPanel(false);
  }, [historyRedo, setNodes, setEdges]);

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
  });

  // 使用 useFlowOperations Hook
  const {
    onAddNode,
    onSave,
    onExport,
    onImport,
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
  });

  // 监听分组标签更改事件
  useEffect(() => {
    const handleGroupLabelChange = (e: CustomEvent<{ id: string; label: string }>) => {
      onUpdateGroupLabel(e.detail.id, e.detail.label);
    };

    window.addEventListener('groupLabelChange', handleGroupLabelChange as EventListener);
    return () => {
      window.removeEventListener('groupLabelChange', handleGroupLabelChange as EventListener);
    };
  }, [onUpdateGroupLabel]);



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
  const handleGroupChange = useCallback(
    (id: string, updates: { label?: string; color?: string; relatedNodeIds?: string[] }) => {
      setNodes((nds) =>
        nds.map((node) => {
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
        })
      );
      triggerAutoSave();
    },
    [setNodes, triggerAutoSave]
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
        e.preventDefault();
        pasteNodes();
        return;
      }

      // Ctrl+Z 或 Cmd+Z (Mac) - 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z 或 Cmd+Shift+Z (Mac) - 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+G 或 Cmd+G (Mac) - 创建分组
      if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        onCreateGroup();
        return;
      }

      // Ctrl+Shift+G 或 Cmd+Shift+G (Mac) - 解散分组
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        // 如果选中的是分组节点，则解散该分组
        if (selectedElement?.type === 'node' && selectedElement.node?.type === 'group') {
          // 使用 handleUngroup 确保面板关闭
          handleUngroup(selectedElement.data.id as string);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, copyNodes, pasteNodes, onCreateGroup, handleUngroup, selectedElement]); // Added handleUngroup dependency

  // Determine alignment toolbar visibility (when more than 1 node is selected)
  const showAlignmentToolbar = nodes.filter((n) => n.selected).length > 1;

  // 侧边栏折叠状态
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="flow-canvas-container">
      {/* Sidebar Area */}
      <div className={`flow-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <button
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "展开菜单" : "收起菜单"}
          >
            {isSidebarCollapsed ? '▶' : '◀'}
          </button>
        </div>

        <div className="flow-controls">
          <div className="control-section">
            <div className="section-title">{!isSidebarCollapsed && '文件'}</div>
            <button
              className="control-btn btn-save"
              onClick={onSave}
              title="保存到本地版本库 (Ctrl+S)"
            >
              <span className="btn-icon">💾</span>
              {!isSidebarCollapsed && <span className="btn-text">保存</span>}
            </button>
            <button
              className="control-btn btn-export"
              onClick={onExport}
              title="导出 JSON 文件"
            >
              <span className="btn-icon">📤</span>
              {!isSidebarCollapsed && <span className="btn-text">导出</span>}
            </button>
            <button
              className="control-btn btn-import"
              onClick={onImport}
              title="导入 JSON 文件"
            >
              <span className="btn-icon">📥</span>
              {!isSidebarCollapsed && <span className="btn-text">导入</span>}
            </button>
          </div>

          <div className="divider"></div>

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
              {!isSidebarCollapsed && <span className="btn-text">数据节点</span>}
            </button>
            <button
              className="control-btn btn-node"
              onClick={() => onAddNode('terminator')}
              title="添加开始节点"
            >
              <span className="btn-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="6" width="18" height="12" rx="6" />
                </svg>
              </span>
              {!isSidebarCollapsed && <span className="btn-text">开始节点</span>}
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
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="canvas-area">
        <AlignmentToolbar
          visible={showAlignmentToolbar}
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
          nodesDraggable={true}
          nodesConnectable={true} // 开启连线
          elementsSelectable={true}
          selectionOnDrag={false}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode="Shift" // 按住 Shift + 左键框选
          panOnDrag={true} // 左键拖拽平移画布
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
        />
      </div>
    </div>
  );
});

// 外部组件：提供 ReactFlowProvider
export function FlowCanvas({ nodes: initialNodes, edges: initialEdges }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasContent initialNodes={initialNodes} initialEdges={initialEdges} />
    </ReactFlowProvider>
  );
}
