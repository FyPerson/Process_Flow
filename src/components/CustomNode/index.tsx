import { memo, useState, useCallback, useRef, useEffect, CSSProperties } from 'react';
import {
  Handle,
  Position,
  NodeProps,
  useReactFlow,
  NodeResizer,
  useUpdateNodeInternals,
} from '@xyflow/react';

import { FlowNodeData } from '../../types/flow';
import { getUniqueName } from '../../utils/uniqueName';
import './styles.css';

interface CustomNodeProps extends NodeProps {
  style?: CSSProperties;
}

export const CustomNode = memo(({ id, data, selected, style }: CustomNodeProps) => {
  const nodeData = data as unknown as FlowNodeData;
  const { setNodes, getNode, getNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // 编辑状态
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(nodeData.name);
  const [originalValue, setOriginalValue] = useState(nodeData.name); // 保存编辑前的原始值

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 用于节流连接线更新的 ref (虽然目前未在其他地方使用，但保留其声明以防未来扩展)
  const edgeUpdateFrameRef = useRef<number | null>(null);

  // 从节点对象中获取完整的 style（包括从 React Flow 传递的和节点本身的）
  const nodeStyle = style || getNode(id)?.style;

  // 获取背景色：
  // 对于判断节点和数据节点，从 data.backgroundColor 读取（不保存在 style 中，避免应用到外层容器）
  // 对于其他节点，从 style 中读取
  let backgroundColor: string | null = null;
  if (nodeData.type === 'decision' || nodeData.type === 'data') {
    backgroundColor = nodeData.backgroundColor || null;
  } else {
    backgroundColor =
      nodeStyle?.backgroundColor ||
      (typeof nodeStyle?.background === 'string' &&
        !nodeStyle.background.includes('gradient') &&
        !nodeStyle.background.includes('url')
        ? nodeStyle.background
        : null);
  }

  // 获取字号：从 style 中读取 fontSize
  const fontSize = nodeStyle?.fontSize
    ? typeof nodeStyle.fontSize === 'number'
      ? `${nodeStyle.fontSize}px`
      : nodeStyle.fontSize
    : undefined;

  // 获取字体颜色：从 style 中读取 color
  const fontColor = nodeStyle?.color as string | undefined;

  // 获取字体族：从 style 中读取 fontFamily
  const fontFamily = nodeStyle?.fontFamily as string | undefined;

  // 获取字体粗细：从 style 中读取 fontWeight
  // 确保返回数字类型，如果不是 300、400、600，则映射到最接近的值
  const rawFontWeight = nodeStyle?.fontWeight
    ? typeof nodeStyle.fontWeight === 'number'
      ? nodeStyle.fontWeight
      : typeof nodeStyle.fontWeight === 'string'
        ? nodeStyle.fontWeight === 'normal'
          ? 400
          : nodeStyle.fontWeight === 'bold'
            ? 600
            : parseInt(nodeStyle.fontWeight)
        : undefined
    : undefined;
  // 映射到允许的值：300、400、600
  const fontWeight =
    rawFontWeight !== undefined
      ? rawFontWeight <= 350
        ? 300
        : rawFontWeight <= 500
          ? 400
          : 600
      : undefined;

  // 如果设置了背景色，需要确保它能够覆盖CSS的默认背景
  // 通过在内层容器上应用样式来实现

  // 每次 data 变化时同步 editValue 和 originalValue
  // 每次 data 变化时同步 editValue 和 originalValue
  useEffect(() => {
    // 只有当值真正变化时才更新，避免不必要的重新渲染
    // 使用 requestAnimationFrame 避免同步 setState 导致的警告
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const timer = requestAnimationFrame(() => {
      setEditValue((prev) => {
        if (prev !== nodeData.name) return nodeData.name;
        return prev;
      });
      setOriginalValue((prev) => {
        if (prev !== nodeData.name) return nodeData.name;
        return prev;
      });
    });
    return () => cancelAnimationFrame(timer);
  }, [nodeData.name]);

  // 提交编辑
  const handleSubmit = useCallback(() => {
    setIsEditing(false);
    if (editValue.trim() !== nodeData.name) {
      // 检查并在必要时生成唯一名称
      const currentNodes = getNodes();
      // 获取除当前节点之外的所有节点名称和分组节点名称
      const existingNames = currentNodes
        .filter((n) => n.id !== id)
        .map((n) => {
          if (n.type === 'group') {
            return (n.data as any).label || (n.data as any).name;
          }
          return (n.data as any).name;
        })
        .filter(Boolean);

      const uniqueName = getUniqueName(editValue.trim(), existingNames);

      // 如果名称被修改了（因为不唯一），更新 UI 显示
      if (uniqueName !== editValue.trim()) {
        setEditValue(uniqueName);
      }

      // 触发自定义事件通知父组件更新
      // 统一通过 FlowCanvas 处理，以便记录历史
      const event = new CustomEvent('nodeLabelChange', {
        detail: { id, label: uniqueName }
      });
      window.dispatchEvent(event);
    }
  }, [id, editValue, nodeData.name, getNodes]);

  // 自动聚焦和全选
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      // 选中所有文本
      inputRef.current.select();
    }
  }, [isEditing]);

  // 键盘事件处理
  useEffect(() => {
    if (isEditing && inputRef.current) {
      const textarea = inputRef.current;

      const handleNativeKeyDown = (e: KeyboardEvent) => {
        // Ctrl+Enter: 插入换行符
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const value = textarea.value;
          const newValue = value.substring(0, start) + '\n' + value.substring(end);
          setEditValue(newValue);
          // 更新光标位置
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 1;
          }, 0);
          return;
        }

        // Enter (不带 Ctrl): 提交
        if (e.key === 'Enter' && !e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          handleSubmit();
          return;
        }

        // Escape: 取消编辑
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setEditValue(originalValue);
          setIsEditing(false);
          return;
        }
      };

      textarea.addEventListener('keydown', handleNativeKeyDown, true);

      return () => {
        textarea.removeEventListener('keydown', handleNativeKeyDown, true);
      };
    }
  }, [isEditing, originalValue, handleSubmit]);

  // 清理动画帧
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (edgeUpdateFrameRef.current !== null) {
        cancelAnimationFrame(edgeUpdateFrameRef.current);
      }
    };
  }, []);

  const getNodeClassName = () => {
    const baseClass = 'custom-flow-node';
    const typeClass = `node-${nodeData.type}`;
    const expandableClass = nodeData.expandable ? 'expandable' : '';
    const selectedClass = selected ? 'selected' : '';
    // 如果设置了自定义背景色，添加一个类名以覆盖默认背景
    const customBgClass = backgroundColor ? 'has-custom-bg' : '';
    // 如果有缩略图，添加一个类名
    const hasScreenshotsClass = hasScreenshots ? 'has-screenshots' : '';

    // 终止节点根据名称或 subType 判断是开始还是结束
    let subTypeClass = '';
    if (nodeData.type === 'terminator') {
      if (nodeData.subType === 'start') {
        subTypeClass = 'start';
      } else if (nodeData.subType === 'end') {
        subTypeClass = 'end';
      } else if (nodeData.name === '开始' || nodeData.name.toLowerCase().includes('start')) {
        subTypeClass = 'start';
      } else {
        subTypeClass = 'end';
      }
    }

    return `${baseClass} ${typeClass} ${subTypeClass} ${expandableClass} ${selectedClass} ${customBgClass} ${hasScreenshotsClass}`.trim();
  };

  const mergedStyle = {
    ...nodeStyle,
    ...(backgroundColor ? { backgroundColor } : {}),
  };

  // Handle 样式优化：白色填充，深色边框，稍微大一点
  // source handle 的 z-index 更高，确保在拖拽时优先被识别
  const sourceHandleStyle = {
    width: 10,
    height: 10,
    background: '#fff',
    border: '2px solid #64748b',
    zIndex: 11, // source handle 的 z-index 更高
  };

  const targetHandleStyle = {
    width: 10,
    height: 10,
    background: '#fff',
    border: '2px solid #64748b',
    zIndex: 10, // target handle 的 z-index 稍低
  };

  // 双击开始编辑
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发画布的双击事件
    setOriginalValue(nodeData.name); // 保存编辑前的原始值
    setEditValue(nodeData.name); // 重置编辑值为当前值
    setIsEditing(true);
  };



  // 处理文本变化时自动调整高度
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditValue(e.target.value);
  }, []);

  // 监听内容变化自动调整高度
  useEffect(() => {
    if (isEditing && inputRef.current) {
      const textarea = inputRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [editValue, isEditing]);

  // 键盘事件处理已经移到原生事件监听器中，这里不需要了

  // 检查是否有缩略图
  const hasScreenshots =
    nodeData.detailConfig?.screenshots && nodeData.detailConfig.screenshots.length > 0;

  // 渲染内容区域（文本或输入框）
  const renderContent = () => (
    <div className="node-content" onDoubleClick={handleDoubleClick}>
      {/* 缩略图标识图标 */}
      {hasScreenshots && (
        <span className="node-screenshot-icon" title="该节点包含缩略图">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </span>
      )}

      {/* 关联节点标识图标 */}
      {nodeData.relatedNodeIds && nodeData.relatedNodeIds.length > 0 && (
        <span className="node-link-icon" title={`已关联 ${nodeData.relatedNodeIds.length} 个节点`}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </span>
      )}
      {/* 仅在选中时显示调整大小控制器 */}
      <NodeResizer
        color="#3b82f6"
        isVisible={selected}
        minWidth={100}
        minHeight={40}
        // 增大控制手柄大小，使其更容易点击
        handleStyle={{ width: 12, height: 12, borderRadius: '50%', border: '1px solid #fff' }}
        lineStyle={{ borderWidth: 1, borderStyle: 'dashed' }}
        onResize={(_, params) => {
          const { width, height } = params;
          // 1. 更新节点样式
          setNodes((nodes) =>
            nodes.map((node) => {
              if (node.id === id) {
                return {
                  ...node,
                  style: {
                    ...node.style,
                    width,
                    height,
                  },
                };
              }
              return node;
            }),
          );

          // 2. 关键：通知 React Flow 更新节点内部状态（包括 Handle 位置），从而更新连线
          updateNodeInternals(id);
        }}
        onResizeEnd={(_, params) => {
          const { width, height } = params;
          // 确保最终状态被保存
          setNodes((nodes) =>
            nodes.map((node) => {
              if (node.id === id) {
                return {
                  ...node,
                  style: {
                    ...node.style,
                    width,
                    height,
                  },
                };
              }
              return node;
            }),
          );
          // 再次更新以确保最终位置正确
          updateNodeInternals(id);
        }}
      />
      {nodeData.type === 'decision' ? (
        <div className="diamond-shape">
          {/* SVG 菱形背景 */}
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 0,
              overflow: 'hidden',
              filter:
                'drop-shadow(0 4px 6px -1px rgba(0, 0, 0, 0.1)) drop-shadow(0 2px 4px -1px rgba(0, 0, 0, 0.06))',
            }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={`decisionGradient-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#FFFFFF" />
              </linearGradient>
            </defs>
            <polygon
              points="50,0 100,50 50,100 0,50"
              fill={backgroundColor || `url(#decisionGradient-${id})`}
              stroke={(nodeStyle?.borderColor as string) || '#cbd5e1'}
              strokeWidth={nodeStyle?.borderWidth ? `${nodeStyle.borderWidth}px` : '1px'}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {isEditing ? (
            <textarea
              ref={inputRef}
              className="node-label-input nodrag"
              style={{
                ...(fontSize ? { fontSize } : {}),
                ...(fontColor ? { color: fontColor } : {}),
                ...(fontFamily ? { fontFamily } : {}),
                ...(fontWeight
                  ? { fontWeight: fontWeight as React.CSSProperties['fontWeight'] }
                  : {}),
              }}
              value={editValue}
              onChange={handleTextareaChange}
              onBlur={handleSubmit}
              onClick={(e) => e.stopPropagation()}
              rows={1}
            />
          ) : (
            <span
              className={`node-label ${hasScreenshots ? 'has-screenshots-label' : ''}`}
              style={{
                ...(fontSize ? { fontSize } : {}),
                ...(fontColor ? { color: fontColor } : {}),
                ...(fontFamily ? { fontFamily } : {}),
                ...(fontWeight
                  ? { fontWeight: fontWeight as React.CSSProperties['fontWeight'] }
                  : {}),
              }}
            >
              {nodeData.name}
            </span>
          )}
        </div>
      ) : nodeData.type === 'data' ? (
        <div className="data-shape">
          {/* 数据节点：带两条垂直分割线的矩形 */}
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 0,
              overflow: 'hidden',
              filter:
                'drop-shadow(0 4px 6px -1px rgba(0, 0, 0, 0.1)) drop-shadow(0 2px 4px -1px rgba(0, 0, 0, 0.06))',
            }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              {/* 数据节点渐变背景，与流程节点风格一致 */}
              <linearGradient id={`dataGradient-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
            </defs>
            {/* 外框矩形 - 使用圆角，与流程节点一致，完全填充 viewBox */}
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8"
              ry="8"
              fill={backgroundColor || `url(#dataGradient-${id})`}
              stroke={(nodeStyle?.borderColor as string) || '#cbd5e1'}
              strokeWidth={nodeStyle?.borderWidth ? `${nodeStyle.borderWidth}px` : '1px'}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* 左侧垂直分割线 - 使用浅灰色，与边框颜色一致 */}
            <line
              x1="15"
              y1="0"
              x2="15"
              y2="100"
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeLinecap="round"
            />
            {/* 右侧垂直分割线 - 使用浅灰色，与边框颜色一致 */}
            <line
              x1="85"
              y1="0"
              x2="85"
              y2="100"
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>
          {isEditing ? (
            <textarea
              ref={inputRef}
              className="node-label-input nodrag"
              style={{
                ...(fontSize ? { fontSize } : {}),
                ...(fontColor ? { color: fontColor } : {}),
                ...(fontFamily ? { fontFamily } : {}),
                ...(fontWeight
                  ? { fontWeight: fontWeight as React.CSSProperties['fontWeight'] }
                  : {}),
              }}
              value={editValue}
              onChange={handleTextareaChange}
              onBlur={handleSubmit}
              onClick={(e) => e.stopPropagation()}
              rows={1}
            />
          ) : (
            <span
              className={`node-label ${hasScreenshots ? 'has-screenshots-label' : ''}`}
              style={{
                ...(fontSize ? { fontSize } : {}),
                ...(fontColor ? { color: fontColor } : {}),
                ...(fontFamily ? { fontFamily } : {}),
                ...(fontWeight
                  ? { fontWeight: fontWeight as React.CSSProperties['fontWeight'] }
                  : {}),
              }}
            >
              {nodeData.name}
            </span>
          )}
        </div>
      ) : (
        <>
          {isEditing ? (
            <textarea
              ref={inputRef}
              className="node-label-input nodrag"
              style={{
                ...(fontSize ? { fontSize } : {}),
                ...(fontColor ? { color: fontColor } : {}),
                ...(fontFamily ? { fontFamily } : {}),
                ...(fontWeight
                  ? { fontWeight: fontWeight as React.CSSProperties['fontWeight'] }
                  : {}),
              }}
              value={editValue}
              onChange={handleTextareaChange}
              onBlur={handleSubmit}
              onClick={(e) => e.stopPropagation()}
              rows={1}
            />
          ) : (
            <span
              className={`node-label ${hasScreenshots ? 'has-screenshots-label' : ''}`}
              style={{
                ...(fontSize ? { fontSize } : {}),
                ...(fontColor ? { color: fontColor } : {}),
                ...(fontFamily ? { fontFamily } : {}),
                ...(fontWeight
                  ? { fontWeight: fontWeight as React.CSSProperties['fontWeight'] }
                  : {}),
              }}
            >
              {nodeData.name}
            </span>
          )}
        </>
      )}
    </div>
  );

  // 判断节点需要特殊处理
  // 判断节点的外层容器应该保持透明，只有SVG的fill会改变
  if (nodeData.type === 'decision') {
    // 对于判断节点，不应用背景色到容器，只应用到SVG
    const decisionStyle = nodeStyle ? { ...nodeStyle } : {};
    // 移除背景色相关属性，保持容器透明
    delete decisionStyle.background;
    delete decisionStyle.backgroundColor;
    // 边框颜色和粗细会应用到SVG的stroke上，不需要在容器上应用

    return (
      <div className={getNodeClassName()} style={decisionStyle}>
        {/* Top - 定位到顶部顶点 */}
        {/* source handle 在前，确保在拖拽时优先被识别 */}
        <Handle id="top-source" type="source" position={Position.Top} style={sourceHandleStyle} />
        <Handle id="top-target" type="target" position={Position.Top} style={targetHandleStyle} />
        {/* Right - 定位到右侧顶点 */}
        <Handle id="right" type="source" position={Position.Right} style={sourceHandleStyle} />
        <Handle
          id="right-target"
          type="target"
          position={Position.Right}
          style={targetHandleStyle}
        />
        {/* Bottom - 定位到底部顶点 */}
        <Handle id="bottom" type="source" position={Position.Bottom} style={sourceHandleStyle} />
        <Handle
          id="bottom-target"
          type="target"
          position={Position.Bottom}
          style={targetHandleStyle}
        />
        {/* Left - 定位到左侧顶点 */}
        <Handle id="left" type="source" position={Position.Left} style={sourceHandleStyle} />
        <Handle id="left-target" type="target" position={Position.Left} style={targetHandleStyle} />

        {renderContent()}
      </div>
    );
  }

  // 数据节点需要特殊处理
  // 数据节点的外层容器应该保持透明，只有SVG的fill和线条会显示
  if (nodeData.type === 'data') {
    // 对于数据节点，不应用背景色到容器，只应用到SVG
    const dataStyle = nodeStyle ? { ...nodeStyle } : {};
    // 移除背景色相关属性，保持容器透明
    delete dataStyle.background;
    delete dataStyle.backgroundColor;
    // 边框颜色和粗细会应用到SVG的stroke上，不需要在容器上应用

    return (
      <div className={getNodeClassName()} style={dataStyle}>
        {/* Top */}
        <Handle id="top-source" type="source" position={Position.Top} style={sourceHandleStyle} />
        <Handle id="top-target" type="target" position={Position.Top} style={targetHandleStyle} />
        {/* Left */}
        <Handle id="left" type="source" position={Position.Left} style={sourceHandleStyle} />
        <Handle id="left-target" type="target" position={Position.Left} style={targetHandleStyle} />
        {/* Right */}
        <Handle id="right" type="source" position={Position.Right} style={sourceHandleStyle} />
        <Handle
          id="right-target"
          type="target"
          position={Position.Right}
          style={targetHandleStyle}
        />

        {renderContent()}

        {/* Bottom */}
        <Handle id="bottom" type="source" position={Position.Bottom} style={sourceHandleStyle} />
        <Handle
          id="bottom-target"
          type="target"
          position={Position.Bottom}
          style={targetHandleStyle}
        />
      </div>
    );
  }

  // 处理节点和终止节点
  return (
    <div className={getNodeClassName()} style={mergedStyle}>
      {/* Top */}
      {/* source handle 在前，确保在拖拽时优先被识别 */}
      <Handle id="top-source" type="source" position={Position.Top} style={sourceHandleStyle} />
      <Handle id="top-target" type="target" position={Position.Top} style={targetHandleStyle} />
      {/* Left */}
      <Handle id="left" type="source" position={Position.Left} style={sourceHandleStyle} />
      <Handle id="left-target" type="target" position={Position.Left} style={targetHandleStyle} />
      {/* Right */}
      <Handle id="right" type="source" position={Position.Right} style={sourceHandleStyle} />
      <Handle id="right-target" type="target" position={Position.Right} style={targetHandleStyle} />

      {renderContent()}

      {/* Bottom */}
      <Handle id="bottom" type="source" position={Position.Bottom} style={sourceHandleStyle} />
      <Handle
        id="bottom-target"
        type="target"
        position={Position.Bottom}
        style={targetHandleStyle}
      />
    </div>
  );
});

CustomNode.displayName = 'CustomNode';
