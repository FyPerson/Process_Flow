import React, { useMemo, useCallback } from 'react';
import { Node, Edge, useReactFlow, useStore, ReactFlowState } from '@xyflow/react';

// 类型定义
interface OffscreenIndicatorsProps {
    nodes: Node[];
    edges: Edge[];
    selectedNodeId: string | null;
}

interface IndicatorData {
    id: string;
    name: string;
    type: 'source' | 'target' | 'related';
    x: number; // 屏幕坐标 X
    y: number; // 屏幕坐标 Y
    rotation: number; // 箭头旋转角度
    targetNodeId: string;
}

export const OffscreenIndicators: React.FC<OffscreenIndicatorsProps> = ({
    nodes,
    edges,
    selectedNodeId,
}) => {
    const { setCenter, getNode, flowToScreenPosition } = useReactFlow();

    // 获取视口尺寸
    const { width, height, transform } = useStore((state: ReactFlowState) => ({
        width: state.width,
        height: state.height,
        transform: state.transform,
    }));

    // 辅助函数：计算节点的绝对坐标（处理 Group 嵌套）
    const getAbsolutePosition = useCallback((node: Node, allNodes: Node[]) => {
        // 扩展 Node 类型以包含 computed 属性 (React Flow v11/v12 差异)
        const typedNode = node as Node & { computed?: { absolutePosition?: { x: number; y: number } } };

        if (typedNode.computed?.absolutePosition) {
            return typedNode.computed.absolutePosition;
        }

        let x = node.position.x;
        let y = node.position.y;
        let currentParentId = node.parentId;

        while (currentParentId) {
            const parent = allNodes.find((n) => n.id === currentParentId);
            if (parent) {
                x += parent.position.x;
                y += parent.position.y;
                currentParentId = parent.parentId;
            } else {
                // Parent not found? Stop.
                break;
            }
        }
        return { x, y };
    }, []);

    // 计算需要显示的指示器
    const indicators = useMemo(() => {
        // 基础检查
        if (!selectedNodeId || !width || !height || width <= 0 || height <= 0) {
            console.log('[OffscreenIndicators] Skipped: Missing dependencies', { selectedNodeId, width, height });
            return [];
        }

        const selectedNode = nodes.find((n) => n.id === selectedNodeId);
        if (!selectedNode) {
            console.log('[OffscreenIndicators] Skipped: Selected node not found');
            return [];
        }

        // 收集所有关联节点 ID
        const targetNodeIds = new Set<string>();

        // 1. 基于 Edges 的物理连接
        const relatedEdges = edges.filter(
            (e) => e.source === selectedNodeId || e.target === selectedNodeId
        );
        relatedEdges.forEach(e => {
            if (e.source === selectedNodeId) targetNodeIds.add(e.target);
            if (e.target === selectedNodeId) targetNodeIds.add(e.source);
        });

        // 2. 基于 Data 的逻辑关联 (implicit attributes)
        // 2.1 正向关联 (Current -> Related)
        if (selectedNode.data?.relatedNodeIds && Array.isArray(selectedNode.data.relatedNodeIds)) {
            selectedNode.data.relatedNodeIds.forEach((id: string) => targetNodeIds.add(id));
        }

        // 2.2 反向关联 (Others -> Current)
        // 遍历所有节点，看谁关联了当前节点
        nodes.forEach(n => {
            if (n.id !== selectedNodeId && n.data?.relatedNodeIds && Array.isArray(n.data.relatedNodeIds)) {
                if ((n.data.relatedNodeIds as string[]).includes(selectedNodeId)) {
                    targetNodeIds.add(n.id);
                }
            }
        });

        const results: IndicatorData[] = [];
        const vpPadding = 40; // 边距

        console.log(`[OffscreenIndicators] Checking ${targetNodeIds.size} related nodes...`);

        targetNodeIds.forEach((targetId) => {
            const targetNode = nodes.find((n) => n.id === targetId);
            if (!targetNode) {
                console.warn('[OffscreenIndicators] Related node not found:', targetId);
                return;
            }

            // 2. 获取节点绝对中心点
            const { x: absX, y: absY } = getAbsolutePosition(targetNode, nodes);

            const nodeWidth = targetNode.measured?.width || targetNode.width || 150;
            const nodeHeight = targetNode.measured?.height || targetNode.height || 40;

            // 节点中心点 (Flow Coords - Absolute)
            const flowCenterX = absX + nodeWidth / 2;
            const flowCenterY = absY + nodeHeight / 2;

            // 3. 转换为屏幕坐标 (Screen Coords)
            const screenPos = flowToScreenPosition({ x: flowCenterX, y: flowCenterY });
            const screenX = screenPos.x;
            const screenY = screenPos.y;

            // Get transform for debug
            const t = transform;
            console.log(`[OffscreenIndicators] Debug: Transform=[x:${t[0]}, y:${t[1]}, z:${t[2]}] | Node(${flowCenterX}, ${flowCenterY}) -> Screen(${screenX}, ${screenY})`);

            // 4. 判断是否在视口内
            const margin = 0;
            const isInViewport =
                screenX > margin &&
                screenX < width - margin &&
                screenY > margin &&
                screenY < height - margin;

            console.log(`[OffscreenIndicators] Node ${targetId}: Flow(${Math.round(flowCenterX)},${Math.round(flowCenterY)}) -> Screen(${Math.round(screenX)},${Math.round(screenY)}) | Viewport: ${width}x${height} | InView: ${isInViewport}`);

            if (isInViewport) {
                return;
            }

            console.log(`[OffscreenIndicators] Node ${targetId} is OFF-SCREEN. Pos: (${Math.round(screenX)}, ${Math.round(screenY)})`);

            // 5. 计算交点 (视口中心 -> 目标屏幕坐标)
            const viewCenterX = width / 2;
            const viewCenterY = height / 2;

            const dx = screenX - viewCenterX;
            const dy = screenY - viewCenterY;
            const angle = Math.atan2(dy, dx);

            // 视口边界
            const minX = vpPadding;
            const maxX = width - vpPadding;
            const minY = vpPadding;
            const maxY = height - vpPadding;

            let intersectX = screenX;
            let intersectY = screenY;

            let tMin = Infinity;

            // 检查垂直边界
            if (dx !== 0) {
                const tRight = (maxX - viewCenterX) / dx;
                const tLeft = (minX - viewCenterX) / dx;
                if (tRight > 0) tMin = Math.min(tMin, tRight);
                if (tLeft > 0) tMin = Math.min(tMin, tLeft);
            }

            // 检查水平边界
            if (dy !== 0) {
                const tBottom = (maxY - viewCenterY) / dy;
                const tTop = (minY - viewCenterY) / dy;
                if (tBottom > 0) tMin = Math.min(tMin, tBottom);
                if (tTop > 0) tMin = Math.min(tMin, tTop);
            }

            if (tMin !== Infinity && tMin < 1) {
                intersectX = viewCenterX + dx * tMin;
                intersectY = viewCenterY + dy * tMin;
            }

            // 确定类型
            const isTarget = edges.some(e => e.source === selectedNodeId && e.target === targetId);
            const type = isTarget ? 'target' : 'source';

            results.push({
                id: targetId,
                name: targetNode.data?.name as string || targetId,
                type,
                x: intersectX,
                y: intersectY,
                rotation: angle * (180 / Math.PI),
                targetNodeId: targetId,
            });
        });

        return results;
    }, [selectedNodeId, nodes, edges, width, height, transform, flowToScreenPosition, getAbsolutePosition]);

    const handleJump = useCallback((targetId: string) => {
        const targetNode = getNode(targetId);
        if (targetNode) {
            const nodeWidth = targetNode.measured?.width || targetNode.width || 150;
            const nodeHeight = targetNode.measured?.height || targetNode.height || 40;

            const x = targetNode.position.x + nodeWidth / 2;
            const y = targetNode.position.y + nodeHeight / 2;

            setCenter(x, y, { zoom: 1, duration: 800 });
        }
    }, [getNode, setCenter]);

    if (indicators.length === 0) return null;

    return (
        <div
            className="offscreen-indicators-layer"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2000,
                overflow: 'hidden'
            }}
        >
            {indicators.map((indicator) => (
                <div
                    key={indicator.id}
                    className={`offscreen-indicator ${indicator.type}`}
                    style={{
                        position: 'absolute',
                        left: indicator.x,
                        top: indicator.y,
                        transform: `translate(-50%, -50%)`, // 居中定位
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        backgroundColor: indicator.type === 'target' ? '#f97316' : '#22c55e',
                        boxShadow: `0 2px 10px ${indicator.type === 'target' ? 'rgba(249, 115, 22, 0.4)' : 'rgba(34, 197, 94, 0.4)'}`,
                        transition: 'all 0.1s ease-out' // 更快的响应速度
                    }}
                    onClick={() => handleJump(indicator.targetNodeId)}
                    title={`点击跳转到: ${indicator.name}`}
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ transform: `rotate(${indicator.rotation}deg)` }}
                    >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                </div>
            ))}
        </div>
    );
};
