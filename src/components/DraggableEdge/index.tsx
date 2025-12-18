import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  Position,
} from '@xyflow/react';
import './styles.css';

// 这个组件将替代默认的 Edge
export default function DraggableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  markerStart, // 接收 markerStart
  data,
  label,
  labelStyle,
  labelBgStyle,
}: EdgeProps) {
  const { setEdges, getZoom, getEdge } = useReactFlow();
  const [isHovered, setIsHovered] = useState(false);
  const [isSelected, setIsSelected] = useState(false);

  // 从 React Flow 获取完整的 edge 对象，确保获取到 labelStyle 和 labelBgStyle
  // React Flow 可能不会自动将 labelStyle 和 labelBgStyle 作为 props 传递
  // 每次渲染时都获取最新的 edge 对象
  const fullEdge = getEdge(id);

  // 检查当前 edge 是否被选中 - 使用 fullEdge 的 selected 属性
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSelected(fullEdge?.selected || false);
  }, [fullEdge?.selected]);

  // ...



  // 从 data 中读取偏移量，如果没有则默认为 0
  const offset = (data?.offset as number) || 0;


  // 计算两个节点之间的实际距离
  const dx = Math.abs(targetX - sourceX);
  const dy = Math.abs(targetY - sourceY);
  const distance = Math.sqrt(dx * dx + dy * dy);

  // 根据距离动态计算路径，避免节点距离过近时路径重叠
  // 路径正常从 source 到 target，markerEnd 会在路径终点（target 位置），markerStart 会在路径起点（source 位置）
  const { edgePath, labelX, labelY } = useMemo(() => {
    // 如果距离非常近（小于 30px），使用直线路径
    if (distance < 30) {
      const [path, labelX, labelY] = getStraightPath({
        sourceX: sourceX,
        sourceY: sourceY,
        targetX: targetX,
        targetY: targetY,
      });
      return { edgePath: path, labelX, labelY };
    }

    // 根据距离动态调整 offset
    let dynamicOffset = 20 + offset;
    if (distance < 50) {
      // 距离较近，减小 offset，避免路径重叠
      dynamicOffset = Math.max(5, Math.min(distance / 2.5, 20 + offset));
    }

    // 使用平滑路径
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX: sourceX, // 从 source 开始
      sourceY: sourceY,
      sourcePosition: sourcePosition,
      targetX: targetX, // 到 target 结束
      targetY: targetY,
      targetPosition: targetPosition,
      borderRadius: 0,
      offset: dynamicOffset,
    });
    return { edgePath: path, labelX, labelY };
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, offset, distance]);

  // 直接从 fullEdge 读取样式，确保获取最新值
  // 优先使用 props，然后使用 edge 对象中的值
  const currentLabelStyle = labelStyle || fullEdge?.labelStyle;
  const currentLabelBgStyle = labelBgStyle || fullEdge?.labelBgStyle;

  // 计算背景透明度：从 labelBgStyle.fillOpacity 读取
  const bgOpacity =
    typeof currentLabelBgStyle?.fillOpacity === 'number' ? currentLabelBgStyle.fillOpacity : 1; // 默认完全不透明

  // 将十六进制颜色转换为 rgba 格式，应用透明度
  const hexToRgba = (hex: string, opacity: number): string => {
    // 移除 # 号
    const cleanHex = hex.replace('#', '');
    // 解析 RGB 值
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  // 获取背景色
  const bgColor = (currentLabelBgStyle?.fill ||
    currentLabelStyle?.background ||
    '#E0E0E0') as string;
  // 将背景色转换为 rgba 格式，应用透明度
  const backgroundColorWithOpacity = bgColor.startsWith('#')
    ? hexToRgba(bgColor, bgOpacity)
    : bgColor; // 如果已经是 rgba 格式，直接使用

  // 读取背景大小
  const bgWidth = currentLabelBgStyle?.width;
  const bgHeight = currentLabelBgStyle?.height;
  // 读取是否为自动模式（如果标记存在且为 true，则为自动模式）
  const widthAuto = currentLabelBgStyle?.widthAuto === true;
  const heightAuto = currentLabelBgStyle?.heightAuto === true;

  // 解析 padding 值，计算可用空间
  const parsePadding = (
    paddingStr: string,
  ): { top: number; right: number; bottom: number; left: number } => {
    // 默认 padding: '6px 12px' (上下 6px, 左右 12px)
    const parts = paddingStr.trim().split(/\s+/);
    if (parts.length === 2) {
      // '6px 12px' -> 上下 6px, 左右 12px
      const vertical = parseFloat(parts[0]) || 6;
      const horizontal = parseFloat(parts[1]) || 12;
      return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
    } else if (parts.length === 4) {
      // '6px 12px 6px 12px' -> 上 右 下 左
      return {
        top: parseFloat(parts[0]) || 6,
        right: parseFloat(parts[1]) || 12,
        bottom: parseFloat(parts[2]) || 6,
        left: parseFloat(parts[3]) || 12,
      };
    }
    // 默认值
    return { top: 6, right: 12, bottom: 6, left: 12 };
  };

  const paddingStr = (currentLabelStyle?.padding || '6px 12px') as string;
  const padding = parsePadding(paddingStr);

  // 获取原始字体大小
  const originalFontSize =
    typeof currentLabelStyle?.fontSize === 'number'
      ? currentLabelStyle.fontSize
      : typeof currentLabelStyle?.fontSize === 'string'
        ? parseFloat(currentLabelStyle.fontSize) || 9
        : 9;

  // 计算动态字体大小（只有当用户手动设置背景大小时才约束字体大小）
  // 如果是 auto 模式，背景会自动适应字体大小，不需要约束字体
  let calculatedFontSize = originalFontSize;
  const MIN_FONT_SIZE = 6; // 最小字体大小

  // 只有当宽度或高度是手动设置的（非 auto 模式）时，才进行字体大小约束
  const hasManualWidth = bgWidth !== undefined && !widthAuto;
  const hasManualHeight = bgHeight !== undefined && !heightAuto;

  if (hasManualWidth || hasManualHeight) {
    // 计算可用空间（只对手动设置的维度进行约束）
    const availableWidth = hasManualWidth
      ? (typeof bgWidth === 'number' ? bgWidth : parseFloat(String(bgWidth))) -
      padding.left -
      padding.right
      : Infinity;
    const availableHeight = hasManualHeight
      ? (typeof bgHeight === 'number' ? bgHeight : parseFloat(String(bgHeight))) -
      padding.top -
      padding.bottom
      : Infinity;

    // 根据文字长度估算所需宽度（中文字符约等于字体大小的 1.2 倍，英文字符约等于字体大小的 0.6 倍）
    const labelText = typeof label === 'string' ? label : '';
    const chineseCharCount = (labelText.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishCharCount = labelText.length - chineseCharCount;

    // 估算每个字符的平均宽度（基于原始字体大小）
    const avgCharWidthRatio =
      chineseCharCount > 0
        ? (chineseCharCount * 1.2 + englishCharCount * 0.6) / labelText.length
        : 0.6;

    // 根据宽度计算字体大小（只对手动设置宽度时计算）
    let fontSizeByWidth = originalFontSize;
    if (hasManualWidth && availableWidth !== Infinity && labelText.length > 0) {
      fontSizeByWidth = availableWidth / (labelText.length * avgCharWidthRatio);
    }

    // 根据高度计算字体大小（只对手动设置高度时计算）
    let fontSizeByHeight = originalFontSize;
    if (hasManualHeight && availableHeight !== Infinity) {
      fontSizeByHeight = availableHeight / 1.2;
    }

    // 取两者中的较小值，确保文字能完全显示
    calculatedFontSize = Math.min(fontSizeByWidth, fontSizeByHeight, originalFontSize);

    // 确保不小于最小字体大小
    calculatedFontSize = Math.max(calculatedFontSize, MIN_FONT_SIZE);
  }

  // 计算最终的标签样式
  const labelStyles: React.CSSProperties = {
    color: (currentLabelStyle?.fill || currentLabelStyle?.color || '#000000') as string,
    fontSize: `${calculatedFontSize}px`,
    fontWeight: (() => {
      // 读取字体粗细，如果不是 300、400、600，则映射到最接近的值
      const rawFontWeight =
        typeof currentLabelStyle?.fontWeight === 'number'
          ? currentLabelStyle.fontWeight
          : typeof currentLabelStyle?.fontWeight === 'string'
            ? parseInt(currentLabelStyle.fontWeight) || 300
            : 300;
      // 映射到允许的值：300、400、600
      return rawFontWeight <= 350 ? 300 : rawFontWeight <= 500 ? 400 : 600;
    })(),
    fontFamily: (currentLabelStyle?.fontFamily || '微软雅黑') as string,
    backgroundColor: backgroundColorWithOpacity, // 应用透明度的背景色
    padding: paddingStr,
    borderRadius:
      typeof currentLabelStyle?.borderRadius === 'number'
        ? `${currentLabelStyle.borderRadius}px`
        : typeof currentLabelStyle?.borderRadius === 'string'
          ? currentLabelStyle.borderRadius.includes('px')
            ? currentLabelStyle.borderRadius
            : `${currentLabelStyle.borderRadius}px`
          : '6px',
    // 确保文字不超出背景
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // 如果设置了背景大小，应用到样式
  // 使用 width 和 height 而不是 minWidth/minHeight，确保设置的值能够生效
  if (bgWidth !== undefined) {
    labelStyles.width = typeof bgWidth === 'number' ? `${bgWidth}px` : bgWidth;
    // 同时设置 box-sizing 为 border-box，确保 width 包含 padding
    labelStyles.boxSizing = 'border-box';
  }
  if (bgHeight !== undefined) {
    labelStyles.height = typeof bgHeight === 'number' ? `${bgHeight}px` : bgHeight;
    // 同时设置 box-sizing 为 border-box，确保 height 包含 padding
    labelStyles.boxSizing = 'border-box';
  }

  // 判断连线的主要方向
  const isHorizontalFlow = sourcePosition === Position.Left || sourcePosition === Position.Right;

  // 拖拽逻辑 - 使用 useState 来追踪拖拽状态以便在渲染中使用
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const lastPosRef = useRef(0);

  const onMouseDown = useCallback(
    (evt: React.MouseEvent) => {
      // 阻止冒泡，防止画布拖拽
      evt.stopPropagation();
      // 阻止默认行为
      evt.preventDefault();

      // 1. 手动选中当前连线（实现点击即选中）
      setEdges((edges) =>
        edges.map((e) => ({
          ...e,
          selected: e.id === id,
        })),
      );

      // 2. 立即开始拖拽
      draggingRef.current = true;
      setIsDragging(true); // 触发重渲染以更新样式
      // 记录初始鼠标位置
      lastPosRef.current = isHorizontalFlow ? evt.clientX : evt.clientY;

      // 添加拖拽中的视觉反馈
      const handleElement = evt.currentTarget as HTMLElement;
      const originalTransform = handleElement.style.transform;

      const onMouseMove = (moveEvt: MouseEvent) => {
        if (!draggingRef.current) return;

        const currentPos = isHorizontalFlow ? moveEvt.clientX : moveEvt.clientY;
        const zoom = getZoom();
        // 计算移动距离，除以缩放比例以保持一致
        const diff = (currentPos - lastPosRef.current) / zoom;

        lastPosRef.current = currentPos;

        // 使用 requestAnimationFrame 优化性能，使拖拽更流畅
        requestAnimationFrame(() => {
          setEdges((edges) =>
            edges.map((e) => {
              if (e.id === id) {
                const currentOffset = (e.data?.offset as number) || 0;
                return {
                  ...e,
                  data: { ...e.data, offset: currentOffset + diff },
                };
              }
              return e;
            }),
          );
        });
      };

      const onMouseUp = () => {
        draggingRef.current = false;
        setIsDragging(false);
        // 恢复拖拽手柄的样式
        if (handleElement) {
          handleElement.style.transform = originalTransform;
        }
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [id, setEdges, getZoom, isHorizontalFlow],
  );

  // 判断箭头方向，用于反转动画
  const hasOnlyStartMarker = markerStart && !markerEnd;

  // 悬停或选中时加粗线条并改变颜色
  // 如果未实现，使用虚线样式
  const edgeStyle = {
    ...style,
    ...(hasOnlyStartMarker ? { animationDirection: 'reverse' as const } : {}),
    strokeWidth: isSelected
      ? ((style.strokeWidth as number) || 1) * 2
      : isHovered
        ? ((style.strokeWidth as number) || 1) * 1.5
        : style.strokeWidth || 1,
    stroke: isSelected ? '#3b82f6' : isHovered ? '#60a5fa' : style.stroke || '#64748b',
    strokeDasharray: style.strokeDasharray,
    transition: 'stroke 0.2s, stroke-width 0.2s',
  };

  return (
    <g
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={onMouseDown}
      className={hasOnlyStartMarker ? 'edge-reverse-animation' : ''}
    >
      {/* 实际显示的连线，传入 markerStart 和 markerEnd */}
      <BaseEdge path={edgePath} markerEnd={markerEnd} markerStart={markerStart} style={edgeStyle} />

      <EdgeLabelRenderer>
        {/* 连线文字 (如果存在) - 放在拖拽手柄前面，确保文字在上层 */}
        {label && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              ...labelStyles,
              pointerEvents: 'all',
              zIndex: 20, // 确保标签在拖拽手柄之上
            }}
            className="nodrag nopan edge-label"
          >
            {label}
          </div>
        )}
      </EdgeLabelRenderer>
    </g>
  );
}
