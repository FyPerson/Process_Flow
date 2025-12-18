import { useMemo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useInternalNode,
  Position,
  EdgeProps,
} from '@xyflow/react';
import { NodeInfo, EdgeData } from '../../types/flow';

// 默认节点尺寸
const DEFAULT_WIDTH = 150;
const DEFAULT_HEIGHT = 50;

// 字符串转 Position
function stringToPosition(str?: string): Position | undefined {
  if (!str) return undefined;
  const map: Record<string, Position> = {
    top: Position.Top,
    bottom: Position.Bottom,
    left: Position.Left,
    right: Position.Right,
  };
  return map[str.toLowerCase()];
}

// 安全获取节点信息
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNodeInfo(node: any): NodeInfo {
  const width = node?.measured?.width || node?.width || DEFAULT_WIDTH;
  const height = node?.measured?.height || node?.height || DEFAULT_HEIGHT;
  const x = node?.internals?.positionAbsolute?.x ?? node?.position?.x ?? 0;
  const y = node?.internals?.positionAbsolute?.y ?? node?.position?.y ?? 0;

  return {
    width,
    height,
    x,
    y,
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
}

// 计算最佳连接位置（自动模式）
function getBestPosition(
  sourceInfo: NodeInfo,
  targetInfo: NodeInfo,
): { sourcePos: Position; targetPos: Position } {
  const dx = targetInfo.centerX - sourceInfo.centerX;
  const dy = targetInfo.centerY - sourceInfo.centerY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // 优先使用垂直连接（流程图通常是从上到下）
  if (absDy > absDx * 0.3) {
    if (dy > 0) {
      return { sourcePos: Position.Bottom, targetPos: Position.Top };
    } else {
      return { sourcePos: Position.Top, targetPos: Position.Bottom };
    }
  } else {
    if (dx > 0) {
      return { sourcePos: Position.Right, targetPos: Position.Left };
    } else {
      return { sourcePos: Position.Left, targetPos: Position.Right };
    }
  }
}

// 根据位置获取坐标
function getCoords(info: NodeInfo, position: Position) {
  switch (position) {
    case Position.Top:
      return { x: info.centerX, y: info.y };
    case Position.Bottom:
      return { x: info.centerX, y: info.y + info.height };
    case Position.Left:
      return { x: info.x, y: info.centerY };
    case Position.Right:
      return { x: info.x + info.width, y: info.centerY };
  }
}

// 使用路径点生成自定义路径
function buildPathWithWaypoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  waypoints: Array<{ x: number; y: number }>,
  edgeType: 'straight' | 'smoothstep' | 'step' = 'smoothstep',
): string {
  const points = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }];

  if (edgeType === 'straight') {
    return `M ${sourceX},${sourceY} L ${targetX},${targetY} `;
  }

  // 构建折线路径
  let path = `M ${points[0].x},${points[0].y} `;
  for (let i = 1; i < points.length; i++) {
    if (edgeType === 'smoothstep' && i < points.length - 1) {
      // 平滑折线：在转折点添加圆角
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      const radius = 8;

      // 计算圆角路径
      if (prev.x === curr.x) {
        // 垂直转水平
        const dir = next.y > curr.y ? 1 : -1;
        path += ` L ${curr.x},${curr.y - radius * dir} `;
        path += ` Q ${curr.x},${curr.y} ${curr.x + radius * (next.x > curr.x ? 1 : -1)},${curr.y} `;
      } else {
        // 水平转垂直
        const dir = next.x > curr.x ? 1 : -1;
        path += ` L ${curr.x - radius * dir},${curr.y} `;
        path += ` Q ${curr.x},${curr.y} ${curr.x},${curr.y + radius * (next.y > curr.y ? 1 : -1)} `;
      }
    } else {
      path += ` L ${points[i].x},${points[i].y} `;
    }
  }

  return path;
}

export function FloatingEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  style,
  label,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const edgeData = useMemo(() => {
    if (!sourceNode || !targetNode) return null;

    const sourceInfo = getNodeInfo(sourceNode);
    const targetInfo = getNodeInfo(targetNode);

    // 支持手动指定 handle 位置，否则自动计算
    const edgeData = (data || {}) as EdgeData;
    const manualSourcePos = stringToPosition(sourceHandleId || edgeData.sourceHandle);
    const manualTargetPos = stringToPosition(targetHandleId || edgeData.targetHandle);

    let sourcePos: Position;
    let targetPos: Position;

    if (manualSourcePos && manualTargetPos) {
      sourcePos = manualSourcePos;
      targetPos = manualTargetPos;
    } else {
      const auto = getBestPosition(sourceInfo, targetInfo);
      sourcePos = manualSourcePos || auto.sourcePos;
      targetPos = manualTargetPos || auto.targetPos;
    }

    const sourceCoords = getCoords(sourceInfo, sourcePos);
    const targetCoords = getCoords(targetInfo, targetPos);

    // 如果指定了路径点，使用自定义路径
    const waypoints = edgeData.waypoints;
    const edgeType = edgeData.edgeType || 'smoothstep';

    let path: string;
    let labelX: number;
    let labelY: number;

    if (waypoints && waypoints.length > 0) {
      // 使用路径点构建自定义路径
      path = buildPathWithWaypoints(
        sourceCoords.x,
        sourceCoords.y,
        targetCoords.x,
        targetCoords.y,
        waypoints,
        edgeType,
      );
      // 标签位置：取中间路径点的位置
      const midIndex = Math.floor(waypoints.length / 2);
      const midPoint = waypoints[midIndex] || waypoints[0];
      labelX = midPoint.x;
      labelY = midPoint.y;
    } else {
      // 使用自动计算的路径
      [path, labelX, labelY] = getSmoothStepPath({
        sourceX: sourceCoords.x,
        sourceY: sourceCoords.y,
        sourcePosition: sourcePos,
        targetX: targetCoords.x,
        targetY: targetCoords.y,
        targetPosition: targetPos,
        borderRadius: 8,
      });
    }

    return { path, labelX, labelY };
  }, [sourceNode, targetNode, sourceHandleId, targetHandleId, data]);

  if (!edgeData) return null;

  return (
    <>
      <BaseEdge id={id} path={edgeData.path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50 %, -50 %) translate(${edgeData.labelX}px, ${edgeData.labelY}px)`,
              pointerEvents: 'all',
              padding: '3px 8px',
              borderRadius: 4,
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              fontSize: 12,
              fontWeight: 500,
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default FloatingEdge;
