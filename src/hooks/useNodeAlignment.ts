import { useCallback } from 'react';
import { Node, Edge, useReactFlow } from '@xyflow/react';
import { FlowNodeData } from '../types/flow';
import type { UserPublic } from '../auth/api';
import { canEditNodeData } from '../auth/canEditNode';

export interface UseNodeAlignmentProps {
    setNodes: (
        payload: Node<FlowNodeData>[] | ((nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[])
    ) => void;
    saveHistory: (nodes: Node<FlowNodeData>[], edges: Edge[]) => void;
    /** P3D-2 step 3 codex 六审 high2：改用 canEditNodeData 同源判权 */
    user: UserPublic | null;
    canvasWritable: boolean;
}

export function useNodeAlignment({ setNodes, saveHistory, user, canvasWritable }: UseNodeAlignmentProps) {
    const { getNodes, getEdges } = useReactFlow();

    const alignNodes = useCallback(
        (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-h' | 'distribute-v') => {
            const allNodes = getNodes() as Node<FlowNodeData>[];
            const selectedNodes = allNodes.filter((n) => n.selected);

            if (selectedNodes.length < 2) return;

            // P3D-2 step 3 codex 六审 high2：all-or-nothing，同源调 canEditNodeData
            // 之前用派生字段 __canEdit，但派生链路出问题（首屏未派生/缓存陈旧）会 fail-open
            // 与 handleDelete / useFlowOperations 同口径，不依赖派生字段
            // 七审 M2：这里只作为"快速早退"，最终校验 + saveHistory 必须放到 setNodes 闭包内
            // 同一份 currentNodes 语义下执行，避免竞态时写入无效历史快照
            const hasUneditable = selectedNodes.some(
                (n) => !canEditNodeData(n.data, user, canvasWritable),
            );
            if (hasUneditable) return;

            setNodes((currentNodes) => {
                // 二次校验：setNodes 闭包内 currentNodes 是 React Flow 最新状态
                // 防止异步竞态下选中态变化（拿到新 nodes 重新算权限）
                const targets = currentNodes.filter((n) => n.selected);
                const stillAllEditable = targets.every(
                    (n) => canEditNodeData(n.data, user, canvasWritable),
                );
                if (!stillAllEditable) return currentNodes;
                if (targets.length < 2) return currentNodes;
                // 七审 M2：最终校验通过后立即在同一份 currentNodes + 最新 edges 上 saveHistory
                // 不能放到入口 —— 入口拿的是 allNodes 快照，与闭包内 currentNodes 可能不一致
                saveHistory(currentNodes, getEdges());

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
        [getNodes, getEdges, setNodes, saveHistory, user, canvasWritable]
    );

    return { alignNodes };
}
