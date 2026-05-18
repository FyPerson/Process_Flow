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
import type { UserPublic } from '../auth/api';
import { newEdgeId } from '../utils/ids';
import {
    canApplyNodeUpdate,
    canDeleteNodeData,
    filterNodeChangesByPermission,
} from '../auth/canEditNode';

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
    /** 只读模式下，所有 mutation handler 直接 return（连线、节点变更、边双击删除等） */
    readOnly?: boolean;
    /** P3D-2 step 3：当前登录用户，给 canEditNodeData 算节点级权限用。
     *  null = 游客（与 readOnly=true 协同；按 readOnly 分支兜底）。
     *  P3D-2 step 3 codex 八审 M2：必传 prop（不允许 default null）。
     *  与 FlowCanvas user 必传同款约定，避免中间层重新 optional 化导致静默退化。
     *  调用方（FlowCanvas）必须显式传，游客场景显式传 null。 */
    user: UserPublic | null;
    /** v1.16.2：当前画布可见性。给 filterNodeChangesByPermission remove 分支用——
     *  公共画布上普通用户不能物删已保存节点。默认 'private' 向后兼容（私有画布行为不变）。 */
    canvasVisibility?: 'public' | 'private';
    /** v1.16.3：当节点删除被前端拦下时调用（用户点 Delete 但被 canDeleteNodeData 拒绝）。
     *  caller 通常用此回调发 Toast 解释"为什么按键无效"。
     *  也覆盖 edge 联动删被拦的场景（节点拦下 → 对应 edge remove 也拦下 → 调此回调）。 */
    onForbiddenRemove?: () => void;
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
    readOnly = false,
    user,
    canvasVisibility = 'private',
    onForbiddenRemove,
}: UseFlowHandlersProps) {
    // P3D-2 step 3 中心 mutation gate：canvasWritable = !readOnly。
    // BFV 派生 readOnly = !canvasWritable（src/pages/BusinessFlowVisualization/index.tsx 算的单一口径）
    // 这里反推回来供 canEditNodeData 用 —— 不要让此处再独立计算 canvasWritable，否则破坏单一口径。
    const canvasWritable = !readOnly;

    // 包装 onNodesChange 以检测删除和位置变化操作
    const wrappedOnNodesChange = useCallback(
        (changes: NodeChange<Node<FlowNodeData>>[]) => {
            // P3D-2 step 3 codex 二审必修 4：用 filterNodeChangesByPermission helper 过滤 changes
            // helper 已包含 fail-closed 逻辑：!canvasWritable 时 mutating change（position/
            // dimensions/remove）也会被过滤，避免外部异常 change 穿透中心层
            const filteredChanges = filterNodeChangesByPermission(
                changes,
                nodes,
                user,
                canvasWritable,
                canvasVisibility,
            );

            // v1.16.3：检测是否有 remove change 被过滤掉 → 调 onForbiddenRemove 让 caller 弹 Toast
            // （仅 remove 类型；replace/position/dimensions 被过滤是 fail-closed 不需提示）
            const inputRemoveCount = changes.filter((c) => c.type === 'remove').length;
            const outputRemoveCount = filteredChanges.filter((c) => c.type === 'remove').length;
            if (inputRemoveCount > outputRemoveCount && onForbiddenRemove) {
                onForbiddenRemove();
            }

            // 先应用变化
            onNodesChange(filteredChanges);

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
        [onNodesChange, setNodes, setEdges, saveHistory, triggerAutoSave, isUndoRedoRef, isDraggingRef, dragHistoryTimerRef, setSelectedElement, setShowPanel, nodes, user, canvasWritable, canvasVisibility, onForbiddenRemove],
    );

    // 包装 onEdgesChange 以检测删除操作
    // v1.16.3：拦截"指向被前端拦下节点"的 edge remove change
    // 场景：用户在公共画布选中已保存节点 + 按 Delete → React Flow 联动产生 EdgeChange remove + NodeChange remove
    // wrappedOnNodesChange 拦下 NodeChange remove；这里同步拦下对应 EdgeChange remove，
    // 避免"节点保留 + 连线消失"的"幽灵删除"
    //
    // 注意：用户**主动**删自己的连线（不联动 node remove）仍允许（A1 决策）
    // 仅当 edge.source 或 edge.target 节点本身在本批次也被尝试 remove 但被拦时，对应 edge remove 被拦
    const wrappedOnEdgesChange = useCallback(
        (changes: EdgeChange[]) => {
            // 找出本批次"被拦下"的节点 ID 集合（remove change 被 canDeleteNodeData 拒）
            const nodeIdsBlockedFromRemoval = new Set<string>();
            const isAdmin = !!user && user.role === 'admin';
            if (canvasWritable && !isAdmin) {
                // 与 wrappedOnNodesChange 同款判定逻辑（不复用 helper 因为这里只关心节点 ID）
                // 注：这里只检 canvasVisibility=='public' 时的限制；私有画布逻辑沿用旧行为
                if (canvasVisibility === 'public') {
                    for (const node of nodes) {
                        if (!canDeleteNodeData(node.data, user, canvasWritable, canvasVisibility)) {
                            nodeIdsBlockedFromRemoval.add(node.id);
                        }
                    }
                }
            }

            // 过滤 edge changes：source 或 target 在 blocked 集合 + change 是 remove → 拦
            let edgeBlockedCount = 0;
            const filteredChanges = changes.filter((change) => {
                if (change.type !== 'remove') return true;
                // edge remove change 含 id；找原 edge
                const edge = edges.find((e) => e.id === change.id);
                if (!edge) return true; // 找不到原 edge → 让 React Flow 内部处理（fail-open；理论上 edges state 应同步）
                if (
                    nodeIdsBlockedFromRemoval.has(edge.source)
                    || nodeIdsBlockedFromRemoval.has(edge.target)
                ) {
                    edgeBlockedCount++;
                    return false;
                }
                return true;
            });

            onEdgesChange(filteredChanges);

            // 联动通知：edge remove 被拦说明节点 remove 也被拦了（wrappedOnNodesChange 已发 onForbiddenRemove）
            // 这里**不重复**调 onForbiddenRemove —— 让节点路径作为唯一 toast 触发点，避免重复弹

            if (isUndoRedoRef.current) {
                return;
            }

            // 检测是否有删除操作（用过滤后的）
            const hasRemove = filteredChanges.some((change) => change.type === 'remove');
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
            // edge 全被拦时 edgeBlockedCount > 0 但 filteredChanges 仍可能含其他非 remove change，autosave 安全
            void edgeBlockedCount;
            triggerAutoSave();
        },
        [onEdgesChange, setNodes, setEdges, saveHistory, triggerAutoSave, isUndoRedoRef, setSelectedElement, setShowPanel, nodes, edges, user, canvasWritable, canvasVisibility],
    );

    // 节点点击处理
    const onNodeClick: NodeMouseHandler<Node<FlowNodeData>> = useCallback(
        (_event, node) => {
            const nodeData = node.data;
            // v1.20.3：canSelect 改为"按 node.type 白名单"，不再依赖 nodeData.expandable
            // 原因：历史上 expandable=true 是 UI 创建节点的隐式约定，但 API 创建 / 老数据 /
            //   脚本造的节点常忘传 → 命中 expandable=false 让节点点击无反应。
            // 修法：所有"业务语义节点"（process/decision/data/terminator/subprocess + group + text）
            //   都应能选中开面板，而不是依赖 expandable 字段。
            // 兼容：保留 nodeData.expandable 兜底 → 旧代码或未来新增节点 type 不在白名单
            //   但传了 expandable=true，仍能选中。
            const SELECTABLE_TYPES = new Set([
                'process', 'decision', 'data', 'terminator', 'subprocess', 'group', 'text',
            ]);
            const nodeType = node.type;
            const canSelect = SELECTABLE_TYPES.has(nodeType ?? '')
                || SELECTABLE_TYPES.has(nodeData.type ?? '')
                || nodeData.expandable === true;

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
            if (readOnly) return;
            if (!params.source || !params.target) {
                return;
            }

            const sourceHandle = params.sourceHandle;
            const targetHandle = params.targetHandle;

            setEdges((eds) => {
                const newEdge: Edge = {
                    id: newEdgeId(),
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
        [readOnly, setEdges, nodes, saveHistory, triggerAutoSave],
    );

    // 节点数据更新
    const onNodeUpdate = useCallback(
        (nodeId: string, dataUpdates: Partial<FlowNodeData>, updatedStyle?: React.CSSProperties) => {
            if (readOnly) return;
            // P3D-2 step 3 codex 二审必修 1+2 + 九审 Medium：在所有 setState 之前算 allowed
            // - 必修 1：拒绝时不能只 setNodes 吞掉 nds，否则 setSelectedElement 会污染面板状态
            //   导致用户看到"改成功了"的假象。allowed=false 必须**整个 onNodeUpdate 早退**
            // - 必修 2：标废弃判定改用 canApplyNodeUpdate 内部的 isPublicDeprecateUpdate
            //   精确为 is_deprecated === true && user !== null（取消废弃 false 走 canEditNode）
            // - 九审 Medium：ghost nodeId（targetNode 找不到）也必须 fail-closed 早退
            //   之前 `if (targetNode && !canApplyNodeUpdate)` 在 targetNode === undefined 时不进 if，
            //   会落到下面的 setNodes/setSelectedElement/saveHistory 副作用路径
            const targetNode = nodes.find((n) => n.id === nodeId);
            if (!targetNode) return; // 九审 Medium：ghost nodeId fail-closed
            if (!canApplyNodeUpdate(
                targetNode.data as Record<string, unknown>,
                dataUpdates as Record<string, unknown>,
                updatedStyle,
                user,
                canvasWritable,
            )) {
                // 默默吞掉，UI / 画布 / 面板状态都不动（防漏层）
                return;
            }
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
        [readOnly, user, canvasWritable, nodes, setNodes, edges, saveHistory, triggerAutoSave, setSelectedElement],
    );

    // 连线数据更新
    const onEdgeUpdate = useCallback(
        (newEdge: Edge) => {
            if (readOnly) return;
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
        [readOnly, setEdges, nodes, saveHistory, triggerAutoSave, setSelectedElement],
    );

    // 连线双击处理（删除连线）
    const onEdgeDoubleClick = useCallback(
        (_event: React.MouseEvent, edge: Edge) => {
            if (readOnly) return;
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
        [readOnly, setEdges, nodes, saveHistory, triggerAutoSave, setSelectedElement, setShowPanel],
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
