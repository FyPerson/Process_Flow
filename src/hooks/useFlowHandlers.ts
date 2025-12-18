import { useCallback } from 'react';
import {
    Node,
    Edge,
    Connection,
    NodeChange,
    EdgeChange,
    NodeMouseHandler,
    addEdge,
    MarkerType,
    OnNodesChange,
    OnEdgesChange,
    OnConnect,
} from '@xyflow/react';
import { FlowNodeData } from '../types/flow';

interface UseFlowHandlersProps {
    nodes: Node<FlowNodeData>[];
    edges: Edge[];
    setNodes: React.Dispatch<React.SetStateAction<Node<FlowNodeData>[]>>;
    setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
    onNodesChange: OnNodesChange<Node<FlowNodeData>>;
    onEdgesChange: OnEdgesChange;
    selectedElement: { type: 'node'; data: FlowNodeData; node?: Node<FlowNodeData> } | { type: 'edge'; data: Edge } | null;
    setSelectedElement: React.Dispatch<React.SetStateAction<{ type: 'node'; data: FlowNodeData; node?: Node<FlowNodeData> } | { type: 'edge'; data: Edge } | null>>;
    showPanel: boolean;
    setShowPanel: React.Dispatch<React.SetStateAction<boolean>>;
    saveHistory: (nodes: Node<FlowNodeData>[], edges: Edge[]) => void;
    triggerAutoSave: (newNodes?: Node<FlowNodeData>[], newEdges?: Edge[]) => void;
    isUndoRedoRef: React.MutableRefObject<boolean>;
    isDraggingRef: React.MutableRefObject<boolean>;
    dragHistoryTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
}

export function useFlowHandlers({
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
}: UseFlowHandlersProps) {

    // 包装 onNodesChange 以检测删除和位置变化操作
    const wrappedOnNodesChange = useCallback(
        (changes: NodeChange<Node<FlowNodeData>>[]) => {
            // 先应用变化
            onNodesChange(changes);

            if (isUndoRedoRef.current) {
                return;
            }

            // 检测是否有删除操作
            const hasRemove = changes.some((change) => change.type === 'remove');
            if (hasRemove) {
                // 关闭详情面板并清除选中元素
                setSelectedElement(null);
                setShowPanel(false);

                // 延迟保存，等待状态更新完成
                setTimeout(() => {
                    setNodes((currentNodes) => {
                        setEdges((currentEdges) => {
                            if (!isUndoRedoRef.current) {
                                saveHistory(currentNodes, currentEdges);
                            }
                            return currentEdges;
                        });
                        return currentNodes;
                    });
                }, 100);
            }

            // 检测是否有位置变化（拖动开始/结束）
            const hasDragStart = changes.some(
                (change) => change.type === 'position' && change.dragging === true,
            );
            const hasDragEnd = changes.some(
                (change) => change.type === 'position' && change.dragging === false,
            );

            // 拖动开始时标记
            if (hasDragStart) {
                isDraggingRef.current = true;
            }

            // 拖动结束时保存历史（防抖）
            if (hasDragEnd && isDraggingRef.current) {
                isDraggingRef.current = false;

                // 清除之前的定时器
                if (dragHistoryTimerRef.current) {
                    clearTimeout(dragHistoryTimerRef.current);
                }

                // 延迟保存，确保位置更新完成
                dragHistoryTimerRef.current = setTimeout(() => {
                    setNodes((currentNodes) => {
                        setEdges((currentEdges) => {
                            if (!isUndoRedoRef.current) {
                                saveHistory(currentNodes, currentEdges);
                            }
                            return currentEdges;
                        });
                        return currentNodes;
                    });
                    dragHistoryTimerRef.current = null;
                }, 150);
            }

            // 触发自动保存（延迟保存，确保状态已更新）
            setTimeout(() => {
                triggerAutoSave();
            }, 0);
        },
        [onNodesChange, setNodes, setEdges, saveHistory, triggerAutoSave, isUndoRedoRef, isDraggingRef, dragHistoryTimerRef, setSelectedElement, setShowPanel],
    );

    // 包装 onEdgesChange 以检测删除操作
    const wrappedOnEdgesChange = useCallback(
        (changes: EdgeChange[]) => {
            onEdgesChange(changes);

            if (isUndoRedoRef.current) {
                return;
            }

            // 检测是否有删除操作
            const hasRemove = changes.some((change) => change.type === 'remove');
            if (hasRemove) {
                // 关闭详情面板并清除选中元素
                setSelectedElement(null);
                setShowPanel(false);

                // 延迟保存，等待状态更新完成
                setTimeout(() => {
                    setNodes((currentNodes) => {
                        setEdges((currentEdges) => {
                            if (!isUndoRedoRef.current) {
                                saveHistory(currentNodes, currentEdges);
                            }
                            return currentEdges;
                        });
                        return currentNodes;
                    });
                }, 100);
            }

            // 触发自动保存（延迟保存）
            triggerAutoSave();
        },
        [onEdgesChange, setNodes, setEdges, saveHistory, triggerAutoSave, isUndoRedoRef, setSelectedElement, setShowPanel],
    );

    // 节点点击处理
    const onNodeClick: NodeMouseHandler<Node<FlowNodeData>> = useCallback(
        (_event, node) => {
            const nodeData = node.data;
            // 分组节点或可展开节点都可以选中
            const isGroupNode = node.type === 'group';
            const canSelect = nodeData.expandable || isGroupNode;

            if (canSelect) {
                // 如果点击的是已选中的节点，则关闭面板
                if (
                    selectedElement?.type === 'node' &&
                    selectedElement.data.id === nodeData.id &&
                    showPanel
                ) {
                    setShowPanel(false);
                    setSelectedElement(null);
                } else {
                    // 否则打开或切换面板
                    setSelectedElement({ type: 'node', data: nodeData, node: node });
                    // 分组节点和普通节点都显示面板
                    setShowPanel(true);
                }
            }
        },
        [selectedElement, showPanel, setSelectedElement, setShowPanel],
    );

    // 连线点击处理
    const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
        setSelectedElement({ type: 'edge', data: edge });
        setShowPanel(true);
    }, [setSelectedElement, setShowPanel]);

    // 关闭面板
    const closePanel = useCallback(() => {
        setShowPanel(false);
        setSelectedElement(null);
    }, [setShowPanel, setSelectedElement]);

    // 点击画布空白处关闭面板
    const onPaneClick = useCallback(() => {
        if (showPanel) {
            setShowPanel(false);
            setSelectedElement(null);
        }
    }, [showPanel, setShowPanel, setSelectedElement]);

    // 验证连接是否有效
    const isValidConnection = useCallback(
        (connection: Connection | Edge) => {
            if (!connection.source || !connection.target) {
                return false;
            }

            // 不允许节点连接到自身
            if (connection.source === connection.target) {
                return false;
            }

            // 获取源节点和目标节点
            const sourceNode = nodes.find((n) => n.id === connection.source);
            const targetNode = nodes.find((n) => n.id === connection.target);

            if (!sourceNode || !targetNode) {
                return false;
            }

            // 如果指定了 sourceHandle，检查它是否存在且类型正确
            if (connection.sourceHandle) {
                const sourceHandleId = connection.sourceHandle;
                // 以 -target 结尾的是 target，不能作为源
                if (sourceHandleId.endsWith('-target')) {
                    return false;
                }
            }

            // 允许所有有效的连接
            return true;
        },
        [nodes],
    );

    // 处理连线
    const onConnect: OnConnect = useCallback(
        (params: Connection) => {
            if (!params.source || !params.target) {
                return;
            }

            const sourceHandle = params.sourceHandle;
            const targetHandle = params.targetHandle;

            setEdges((eds) => {
                const newEdge: Edge = {
                    id: `edge-${params.source}-${params.target}-${Date.now()}`,
                    source: params.source!,
                    target: params.target!,
                    sourceHandle: sourceHandle ?? null,
                    targetHandle: targetHandle ?? null,
                    type: 'draggable' as const,
                    animated: true,
                    style: { stroke: '#64748b', strokeWidth: 1 },
                    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.8, width: 'auto', height: 'auto' },
                    data: { bgWidth: 'auto', bgHeight: 'auto' },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: '#64748b',
                        width: 16,
                        height: 16,
                    },
                    markerStart: undefined,
                };

                const newEdges = addEdge(newEdge, eds);
                setTimeout(() => {
                    saveHistory(nodes, newEdges);
                }, 0);
                setTimeout(() => {
                    triggerAutoSave(nodes, newEdges);
                }, 0);
                return newEdges;
            });
        },
        [setEdges, nodes, saveHistory, triggerAutoSave],
    );

    // 节点数据更新
    const onNodeUpdate = useCallback(
        (nodeId: string, dataUpdates: Partial<FlowNodeData>, updatedStyle?: React.CSSProperties) => {
            setNodes((nds) => {
                const newNodes = nds.map((node) => {
                    if (node.id === nodeId) {
                        let mergedData = { ...node.data, ...dataUpdates };
                        let mergedStyle = updatedStyle
                            ? { ...(node.style || {}), ...updatedStyle }
                            : node.style;

                        if ((mergedData.type === 'decision' || mergedData.type === 'data') && mergedStyle) {
                            mergedStyle = { ...mergedStyle };
                            // 如果样式中有背景色，将其移动到 data 中以便 CustomNode 正确渲染 SVG
                            if (mergedStyle.backgroundColor || mergedStyle.background) {
                                const bgColor = (mergedStyle.backgroundColor || mergedStyle.background) as string;
                                if (bgColor && !bgColor.includes('gradient') && !bgColor.includes('url')) {
                                    mergedData = { ...mergedData, backgroundColor: bgColor };
                                }
                            }
                            delete mergedStyle.background;
                            delete mergedStyle.backgroundColor;
                        }

                        if (mergedData.type === 'terminator' && mergedStyle) {
                            mergedStyle = { ...mergedStyle };
                            if (mergedData.subType === 'start') {
                                mergedStyle.background = '#dcfce7';
                                mergedStyle.backgroundColor = '#dcfce7';
                            } else if (mergedData.subType === 'end') {
                                mergedStyle.background = '#fee2e2';
                                mergedStyle.backgroundColor = '#fee2e2';
                            } else {
                                const name = mergedData.name || '';
                                if (name === '开始' || name.toLowerCase().includes('start')) {
                                    mergedStyle.background = '#dcfce7';
                                    mergedStyle.backgroundColor = '#dcfce7';
                                } else {
                                    mergedStyle.background = '#fee2e2';
                                    mergedStyle.backgroundColor = '#fee2e2';
                                }
                            }
                        }

                        return {
                            ...node,
                            data: mergedData,
                            style: mergedStyle,
                        };
                    }
                    return node;
                });

                // Synchronous updates without setTimeout
                saveHistory(newNodes, edges);
                triggerAutoSave(newNodes, edges);

                return newNodes;
            });

            setSelectedElement((prev) => {
                if (prev?.type === 'node' && prev.data.id === nodeId) {
                    return {
                        ...prev,
                        data: { ...prev.data, ...dataUpdates },
                        node: {
                            ...prev.node!,
                            data: { ...prev.data, ...dataUpdates },
                            style: updatedStyle ? { ...(prev.node?.style || {}), ...updatedStyle } : prev.node?.style
                        },
                    };
                }
                return prev;
            });
        },
        [setNodes, edges, saveHistory, triggerAutoSave, setSelectedElement],
    );

    // 连线数据更新
    const onEdgeUpdate = useCallback(
        (newEdge: Edge) => {
            setEdges((eds) => {
                const newEdges = eds.map((edge) => {
                    if (edge.id === newEdge.id) {
                        return newEdge;
                    }
                    return edge;
                });

                // Synchronous updates without setTimeout
                saveHistory(nodes, newEdges);
                triggerAutoSave(nodes, newEdges);

                return newEdges;
            });
            setSelectedElement({ type: 'edge', data: newEdge });
        },
        [setEdges, nodes, saveHistory, triggerAutoSave, setSelectedElement],
    );

    // 连线双击处理（删除连线）
    const onEdgeDoubleClick = useCallback(
        (_event: React.MouseEvent, edge: Edge) => {
            if (window.confirm('确认删除这条连线吗？')) {
                setEdges((eds) => {
                    const newEdges = eds.filter((e) => e.id !== edge.id);

                    // Synchronous updates without setTimeout
                    saveHistory(nodes, newEdges);
                    triggerAutoSave(nodes, newEdges);

                    return newEdges;
                });
                setSelectedElement(null);
                setShowPanel(false);
            }
        },
        [setEdges, nodes, saveHistory, triggerAutoSave, setSelectedElement, setShowPanel],
    );

    return {
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
    };
}
