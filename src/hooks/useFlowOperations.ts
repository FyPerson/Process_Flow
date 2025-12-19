import { useCallback } from 'react';
import { Node, Edge, MarkerType, XYPosition, FitView, useReactFlow } from '@xyflow/react';
import { FlowNodeData, FlowDefinition } from '../types/flow';
import { getLayoutedNodes } from '../utils/layout';
import {
    saveVersion,
    exportToFile,
    importFromFile,
    isFileSystemAccessSupported,
    saveToLocalFolder,
    getSavedDirectoryHandle,
} from '../utils/flowVersionStorage';
import { getUniqueName } from '../utils/uniqueName';

interface UseFlowOperationsProps {
    nodes: Node<FlowNodeData>[];
    edges: Edge[];
    setNodes: React.Dispatch<React.SetStateAction<Node<FlowNodeData>[]>>;
    setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
    screenToFlowPosition: (position: XYPosition) => XYPosition;
    saveHistory: (nodes: Node<FlowNodeData>[], edges: Edge[]) => void;
    triggerAutoSave: () => void;
    getFlowData: () => FlowDefinition;
    fitView: FitView<Node<FlowNodeData>>;
}

export function useFlowOperations({
    nodes,
    edges,
    setNodes,
    setEdges,
    screenToFlowPosition,
    saveHistory,
    triggerAutoSave,
    getFlowData,
    fitView,
}: UseFlowOperationsProps) {

    // 添加节点
    const onAddNode = useCallback(
        (type: 'process' | 'decision' | 'terminator' | 'data') => {
            const id = `new_node_${Date.now()}`;
            const name =
                type === 'process'
                    ? '新流程节点'
                    : type === 'decision'
                        ? '新判断节点'
                        : type === 'data'
                            ? '新数据节点'
                            : '新开始节点';

            // 确保名称唯一
            const currentNodes = setNodes instanceof Function ? [] : []; // Hack to get types right, actually we need getNodes or passed nodes
            // But wait, we have `nodes` in props!

            const existingNames = nodes.map((n) => {
                if (n.type === 'group') {
                    return (n.data as any).label || (n.data as any).name;
                }
                return (n.data as any).name;
            }).filter(Boolean);

            const uniqueName = getUniqueName(name, existingNames);

            const defaultDetailConfig = {
                description: '请点击此处编辑描述...',
                databaseTables: [],
            };

            const position = screenToFlowPosition({
                x: window.innerWidth / 2 + Math.random() * 50,
                y: window.innerHeight / 2 + Math.random() * 50,
            });

            const defaultSize = { width: 120, height: 60 };

            const isTerminator = type === 'terminator';
            const isProcess = type === 'process';
            const isDecision = type === 'decision';
            const defaultBorderColor = '#cbd5e1';
            const defaultBackgroundColor = isTerminator
                ? '#dcfce7'
                : isProcess || isDecision
                    ? '#FFFFFF'
                    : undefined;

            const newNode: Node<FlowNodeData> = {
                id,
                type: 'custom',
                position,
                style: {
                    width: defaultSize.width,
                    height: defaultSize.height,
                    fontSize: 9,
                    borderColor: defaultBorderColor,
                    ...(defaultBackgroundColor
                        ? { background: defaultBackgroundColor, backgroundColor: defaultBackgroundColor }
                        : {}),
                },
                data: {
                    id,
                    name: uniqueName,
                    type,
                    expandable: true,
                    detailConfig: defaultDetailConfig,
                    ...(isDecision ? { backgroundColor: '#FFFFFF' } : {}),
                    ...(isTerminator ? { subType: 'start' as const } : {}),
                },
            };

            setNodes((nds) => {
                const newNodes = nds.concat(newNode);
                setTimeout(() => {
                    saveHistory(newNodes, edges);
                }, 0);
                setTimeout(() => {
                    triggerAutoSave();
                }, 0);
                return newNodes;
            });
        },
        [setNodes, screenToFlowPosition, edges, saveHistory, triggerAutoSave],
    );

    // 自动布局
    const onLayout = useCallback(
        async (direction: 'TB' | 'LR' = 'TB') => {
            try {
                const layoutedNodes = await getLayoutedNodes(nodes, edges, direction);
                setNodes([...layoutedNodes]);

                setTimeout(() => {
                    fitView({ padding: 0.2, duration: 400 });
                }, 100);
            } catch (error) {
                console.error('布局失败:', error);
            }
        },
        [nodes, edges, setNodes, fitView],
    );

    // 保存功能
    const onSave = useCallback(async () => {
        const flowData = getFlowData();

        if (isFileSystemAccessSupported()) {
            try {
                const existingHandle = getSavedDirectoryHandle();
                const isFirstTime = !existingHandle;

                const result = await saveToLocalFolder(flowData);
                const saveTime = new Date(result.timestamp).toLocaleString();

                alert(
                    `保存成功！\n\n` +
                    `存储位置：${result.folderName}/\n` +
                    `文件名：${result.filename}\n` +
                    `保存时间：${saveTime}\n` +
                    `当前文件数：${result.fileCount} 个\n\n` +
                    (isFirstTime
                        ? `提示：后续点击保存将自动保存到此文件夹。\n如需更换文件夹，请刷新页面后重新保存。`
                        : `文件已保存到本地磁盘，可直接在文件夹中查看。`),
                );
            } catch (error: any) {
                if (error.message === '未选择保存目录') {
                    return;
                }
                console.error('保存失败:', error);
                alert('保存失败：' + error.message);
            }
        } else {
            try {
                const result = await saveVersion(flowData);
                const saveTime = new Date(result.timestamp).toLocaleString();
                alert(
                    `保存成功！\n\n` +
                    `存储位置：浏览器 IndexedDB\n` +
                    `数据库名：flow-versions-db\n` +
                    `版本名称：${result.name}\n` +
                    `保存时间：${saveTime}\n` +
                    `当前版本数：${result.currentCount}/${result.maxVersions}\n\n` +
                    `注意：您的浏览器不支持本地文件夹保存，数据存储在浏览器中。\n` +
                    `清除浏览器站点数据会导致版本丢失。\n` +
                    `如需永久保存，请使用"导出"功能下载 JSON 文件。`,
                );
            } catch (error) {
                console.error('保存失败:', error);
                alert('保存失败，请检查控制台日志。');
            }
        }
    }, [getFlowData]);

    // 导出功能
    const onExport = useCallback(() => {
        const flowData = getFlowData();
        exportToFile(flowData);
    }, [getFlowData]);

    // 导入功能
    const onImport = useCallback(async () => {
        try {
            const data = await importFromFile();

            if (!data.nodes || !data.connectors) {
                alert('无效的流程图文件格式');
                return;
            }

            const importedNodes: Node<FlowNodeData>[] = data.nodes.map((node: any) => {
                // 分组节点特殊处理
                if (node.type === 'group') {
                    return {
                        id: node.id,
                        type: 'group',
                        position: node.position || { x: 0, y: 0 },
                        style: node.style || {
                            width: node.size?.width || 200,
                            height: node.size?.height || 150,
                        },
                        data: {
                            id: node.id,
                            label: node.label || node.name,
                            color: node.color || '#3b82f6',
                            // FlowNodeData 必需字段
                            name: node.label || node.name || '分组',
                            type: 'group' as const,
                            expandable: false,
                        },
                        zIndex: -1,
                    };
                }

                // 普通节点
                return {
                    id: node.id,
                    type: 'custom',
                    position: node.position || { x: 0, y: 0 },
                    style: node.style,
                    parentId: node.parentId,
                    extent: undefined, // 不设置 extent，由动态计算接管
                    data: {
                        id: node.id,
                        name: node.name,
                        type: node.type,
                        expandable: node.expandable,
                        detailConfig: node.detailConfig,
                        subType: node.subType,
                        backgroundColor: node.backgroundColor,
                        relatedNodeIds: node.relatedNodeIds,
                    },
                };
            });

            // 确保分组节点在前面
            importedNodes.sort((a, b) => {
                if (a.type === 'group' && b.type !== 'group') return -1;
                if (a.type !== 'group' && b.type === 'group') return 1;
                return 0;
            });

            const importedEdges: Edge[] = data.connectors.map((connector: any) => ({
                id: connector.id,
                source: connector.sourceID,
                target: connector.targetID,
                sourceHandle: connector.sourceHandle,
                targetHandle: connector.targetHandle,
                type: 'draggable',
                label: connector.label,
                style: connector.style,
                labelStyle: connector.labelStyle,
                labelBgStyle: connector.labelBgStyle,
                data: connector.data,
                markerStart: connector.markerStart,
                markerEnd: connector.markerEnd || {
                    type: MarkerType.ArrowClosed,
                    color: connector.style?.stroke || '#64748b',
                    width: 16,
                    height: 16,
                },
            }));

            setNodes(importedNodes);
            setEdges(importedEdges);
            saveHistory(importedNodes, importedEdges);

            alert('导入成功！');
        } catch (error) {
            console.error('导入失败:', error);
            alert('导入失败：' + (error as Error).message);
        }
    }, [setNodes, setEdges, saveHistory]);

    const { addNodes, getNodes, getNodesBounds } = useReactFlow();

    // 创建分组（将选中节点打包成分组）
    const onCreateGroup = useCallback(() => {
        // 获取当前最新节点状态，而非依赖闭包
        const currentNodes = getNodes();
        const selectedNodes = currentNodes.filter((n) => n.selected && n.type !== 'group' && !n.parentId);

        if (selectedNodes.length < 1) {
            alert('请先选择至少 1 个节点来创建分组');
            return;
        }

        // 使用 React Flow 提供的工具计算准确的包围盒
        const bounds = getNodesBounds(selectedNodes);

        const padding = 20;
        const headerHeight = 40;

        // 创建分组节点
        const groupId = `group_${Date.now()}`;

        const existingNames = currentNodes.map((n) => {
            if (n.type === 'group') {
                return (n.data as any).label || (n.data as any).name;
            }
            return (n.data as any).name;
        }).filter(Boolean);
        const uniqueLabel = getUniqueName('新分组', existingNames);

        const groupNode: Node<FlowNodeData> = {
            id: groupId,
            type: 'group',
            position: {
                x: bounds.x - padding,
                y: bounds.y - padding - headerHeight,
            },
            style: {
                width: bounds.width + padding * 2,
                height: bounds.height + padding * 2 + headerHeight,
            },
            data: {
                id: groupId,
                label: uniqueLabel,
                color: '#3b82f6',
                name: uniqueLabel,
                type: 'group',
                expandable: false,
            },
            zIndex: -1,
        };

        const selectedNodeIds = new Set(selectedNodes.map(n => n.id));

        // 单次原子更新：同时添加分组节点和更新子节点
        // 关键：将分组节点放在数组开头，确保 React Flow 能正确识别父子关系
        setNodes((currentNodes) => {
            // 更新所有节点
            const updatedNodes = currentNodes.map((node) => {
                if (selectedNodeIds.has(node.id)) {
                    const relativePos = {
                        x: node.position.x - groupNode.position.x,
                        y: node.position.y - groupNode.position.y,
                    };

                    // 验证：计算渲染后的绝对位置
                    const finalAbsolutePos = {
                        x: groupNode.position.x + relativePos.x,
                        y: groupNode.position.y + relativePos.y,
                    };

                    // 更新被选中的节点：设置 parentId、相对坐标和 extent
                    return {
                        ...node,
                        parentId: groupId,
                        extent: 'parent' as 'parent', // 类型断言：告诉 TypeScript 这是字面量类型
                        position: relativePos,
                        selected: false,
                    };
                }
                // 清除其他节点的选中状态
                return { ...node, selected: false };
            });

            // 将分组节点插入到数组开头，确保在子节点之前
            // 这是 React Flow 的要求：父节点必须在子节点之前
            const finalNodes = [groupNode, ...updatedNodes];

            return finalNodes;
        });

        // 触发自动保存
        setTimeout(() => {
            triggerAutoSave();
        }, 0);

    }, [getNodes, setNodes, triggerAutoSave, getNodesBounds]);

    // 解散分组
    const onUngroup = useCallback(
        (groupId: string) => {
            // 获取最新状态，不依赖闭包中的 nodes
            const currentNodes = getNodes();

            const groupNode = currentNodes.find((n) => n.id === groupId);
            if (!groupNode) return; // 分组不存在

            const groupX = groupNode.position.x || 0;
            const groupY = groupNode.position.y || 0;

            const updatedNodes = currentNodes
                .filter((n) => n.id !== groupId) // 移除分组节点
                .map((node) => {
                    if (node.parentId === groupId) {
                        // 创建新对象，彻底移除 parentId
                        const newNode = {
                            ...node,
                            extent: undefined,
                            position: {
                                x: node.position.x + groupX,
                                y: node.position.y + groupY,
                            },
                        };
                        delete newNode.parentId; // 彻底删除属性
                        return newNode;
                    }
                    return node;
                }) as Node<FlowNodeData>[];

            // 更新状态
            setNodes(updatedNodes);

            // 保存历史
            // 此时 updatedNodes 是我们可以直接使用的最新状态
            // 不需要 setTimeout，因为我们已经有了计算结果
            // 但为了确保 React Update Cycle 完成，保留短暂延迟也无妨，或者直接保存
            // 考虑到 React 批处理，直接保存数据对象是可以的
            saveHistory(updatedNodes, edges);
            triggerAutoSave();
        },
        [getNodes, setNodes, edges, saveHistory, triggerAutoSave]
    );

    // 添加节点到分组
    const onAddToGroup = useCallback(
        (nodeIds: string[], groupId: string) => {
            const groupNode = nodes.find((n) => n.id === groupId);
            if (!groupNode) return;

            const updatedNodes = nodes.map((node) => {
                if (nodeIds.includes(node.id) && node.type === 'custom') {
                    return {
                        ...node,
                        parentId: groupId,
                        extent: undefined, // 不设置 extent，由动态计算接管
                        position: {
                            x: node.position.x - groupNode.position.x,
                            y: node.position.y - groupNode.position.y,
                        },
                    };
                }
                return node;
            });

            setNodes(updatedNodes);
            saveHistory(updatedNodes, edges);
            triggerAutoSave();
        },
        [nodes, edges, setNodes, saveHistory, triggerAutoSave]
    );

    // 从分组移除节点
    const onRemoveFromGroup = useCallback(
        (nodeId: string) => {
            const node = nodes.find((n) => n.id === nodeId);
            if (!node?.parentId) return;

            const groupNode = nodes.find((n) => n.id === node.parentId);
            if (!groupNode) return;

            const updatedNodes = nodes.map((n) => {
                if (n.id === nodeId) {
                    return {
                        ...n,
                        parentId: undefined,
                        extent: undefined,
                        position: {
                            x: n.position.x + groupNode.position.x,
                            y: n.position.y + groupNode.position.y,
                        },
                    };
                }
                return n;
            });

            setNodes(updatedNodes);
            saveHistory(updatedNodes, edges);
            triggerAutoSave();
        },
        [nodes, edges, setNodes, saveHistory, triggerAutoSave]
    );

    // 更新分组标签
    const onUpdateGroupLabel = useCallback(
        (groupId: string, label: string) => {
            setNodes((nds) => {
                // Ensure new label is unique (excluding current group itself if it hasn't changed, but here we are updating)
                // Actually this is called by window event, which we already checked in component?
                // Yes, onUpdateGroupLabel is called by FlowCanvas event listener which receives data from GroupNode.
                // In GroupNode we already checked uniqueness and passed the unique name.
                // So we might NOT need to check here again if we trust the event detail.
                // However, to be safe or if called from other places...
                // But wait, the previous logic in GroupNode ALREADY generated a unique name.
                // So we can just trust 'label' here.
                // But let's verify if `onCreateGroup` needs it.

                return nds.map((node) => {
                    if (node.id === groupId && node.type === 'group') {
                        return {
                            ...node,
                            data: {
                                ...node.data,
                                label,
                            },
                        };
                    }
                    return node;
                });
            });
            triggerAutoSave();
        },
        [setNodes, triggerAutoSave]
    );

    return {
        onAddNode,
        onLayout,
        onSave,
        onExport,
        onImport,
        onCreateGroup,
        onUngroup,
        onAddToGroup,
        onRemoveFromGroup,
        onUpdateGroupLabel,
    };
}
