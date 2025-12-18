import { useCallback } from 'react';
import { Node, Edge, useReactFlow } from '@xyflow/react';
import { FlowNodeData } from '../types/flow';

export interface UseNodeAlignmentProps {
    setNodes: (
        payload: Node<FlowNodeData>[] | ((nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[])
    ) => void;
    saveHistory: (nodes: Node<FlowNodeData>[], edges: Edge[]) => void;
}

export function useNodeAlignment({ setNodes, saveHistory }: UseNodeAlignmentProps) {
    const { getNodes, getEdges } = useReactFlow();

    const alignNodes = useCallback(
        (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-h' | 'distribute-v') => {
            const allNodes = getNodes() as Node<FlowNodeData>[];
            const allEdges = getEdges();
            const selectedNodes = allNodes.filter((n) => n.selected);

            if (selectedNodes.length < 2) return;

            // 保存历史记录（在修改前）
            saveHistory(allNodes, allEdges);

            setNodes((currentNodes) => {
                // 创建节点映射以便快速查找
                const nodeMap = new Map(currentNodes.map((n) => [n.id, n]));
                const targets = currentNodes.filter((n) => n.selected);

                if (targets.length < 2) return currentNodes;

                let newNodes = [...currentNodes];
                let hasChanges = false;

                // 计算边界
                let minX = Infinity;
                let maxX = -Infinity;
                let minY = Infinity;
                let maxY = -Infinity;
                let avgX = 0;
                let avgY = 0;

                targets.forEach((n) => {
                    const w = n.measured?.width || n.width || 0;
                    const h = n.measured?.height || n.height || 0;
                    const x = n.position.x;
                    const y = n.position.y;

                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x + w);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y + h);

                    // Center points
                    avgX += x + w / 2;
                    avgY += y + h / 2;
                });

                avgX /= targets.length;
                avgY /= targets.length;

                // 执行对齐
                switch (type) {
                    case 'left':
                        newNodes = newNodes.map((n) => {
                            if (n.selected) {
                                if (n.position.x !== minX) {
                                    hasChanges = true;
                                    return { ...n, position: { ...n.position, x: minX } };
                                }
                            }
                            return n;
                        });
                        break;
                    case 'right':
                        newNodes = newNodes.map((n) => {
                            if (n.selected) {
                                const w = n.measured?.width || n.width || 0;
                                const newX = maxX - w;
                                if (n.position.x !== newX) {
                                    hasChanges = true;
                                    return { ...n, position: { ...n.position, x: newX } };
                                }
                            }
                            return n;
                        });
                        break;
                    case 'center': // 水平居中
                        newNodes = newNodes.map((n) => {
                            if (n.selected) {
                                const w = n.measured?.width || n.width || 0;
                                const newX = avgX - w / 2;
                                if (n.position.x !== newX) {
                                    hasChanges = true;
                                    return { ...n, position: { ...n.position, x: newX } };
                                }
                            }
                            return n;
                        });
                        break;

                    case 'top':
                        newNodes = newNodes.map((n) => {
                            if (n.selected) {
                                if (n.position.y !== minY) {
                                    hasChanges = true;
                                    return { ...n, position: { ...n.position, y: minY } };
                                }
                            }
                            return n;
                        });
                        break;
                    case 'bottom':
                        newNodes = newNodes.map((n) => {
                            if (n.selected) {
                                const h = n.measured?.height || n.height || 0;
                                const newY = maxY - h;
                                if (n.position.y !== newY) {
                                    hasChanges = true;
                                    return { ...n, position: { ...n.position, y: newY } };
                                }
                            }
                            return n;
                        });
                        break;
                    case 'middle': // 垂直居中
                        newNodes = newNodes.map((n) => {
                            if (n.selected) {
                                const h = n.measured?.height || n.height || 0;
                                const newY = avgY - h / 2;
                                if (n.position.y !== newY) {
                                    hasChanges = true;
                                    return { ...n, position: { ...n.position, y: newY } };
                                }
                            }
                            return n;
                        });
                        break;

                    case 'distribute-h': // 水平等间距
                        {
                            // 按 x 坐标排序
                            const sorted = [...targets].sort((a, b) => a.position.x - b.position.x);
                            if (sorted.length < 3) break; // 至少3个点才有多余空隙

                            const first = sorted[0];
                            const last = sorted[sorted.length - 1];
                            const totalDist = last.position.x - first.position.x;
                            const interval = totalDist / (sorted.length - 1);

                            const newPositions = new Map<string, number>();
                            sorted.forEach((n, i) => {
                                newPositions.set(n.id, first.position.x + interval * i);
                            });

                            newNodes = newNodes.map(n => {
                                if (newPositions.has(n.id)) {
                                    const newX = newPositions.get(n.id)!;
                                    if (Math.abs(n.position.x - newX) > 0.1) {
                                        hasChanges = true;
                                        return { ...n, position: { ...n.position, x: newX } };
                                    }
                                }
                                return n;
                            });
                        }
                        break;

                    case 'distribute-v': // 垂直等间距
                        {
                            // 按 y 坐标排序
                            const sorted = [...targets].sort((a, b) => a.position.y - b.position.y);
                            if (sorted.length < 3) break;

                            const first = sorted[0];
                            const last = sorted[sorted.length - 1];
                            const totalDist = last.position.y - first.position.y;
                            const interval = totalDist / (sorted.length - 1);

                            const newPositions = new Map<string, number>();
                            sorted.forEach((n, i) => {
                                newPositions.set(n.id, first.position.y + interval * i);
                            });

                            newNodes = newNodes.map(n => {
                                if (newPositions.has(n.id)) {
                                    const newY = newPositions.get(n.id)!;
                                    if (Math.abs(n.position.y - newY) > 0.1) {
                                        hasChanges = true;
                                        return { ...n, position: { ...n.position, y: newY } };
                                    }
                                }
                                return n;
                            });
                        }
                        break;
                }

                return hasChanges ? newNodes : currentNodes;
            });
        },
        [getNodes, getEdges, setNodes, saveHistory]
    );

    return { alignNodes };
}
