import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { NodeProps, NodeResizer, useReactFlow, Position, Handle, useStore, type ReactFlowState } from '@xyflow/react';
import { GroupNodeData } from '../../types/flow';
import './styles.css';

export const GroupNode = memo(({ id, data, selected }: NodeProps) => {
  const groupData = data as unknown as GroupNodeData;
  const color = groupData.color || '#3b82f6';
  const { setNodes, getNodes } = useReactFlow();

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(groupData.label || '新分组');
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步外部数据变化
  useEffect(() => {
    setEditValue(groupData.label || '新分组');
  }, [groupData.label]);

  // 双击进入编辑模式
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  }, []);

  // 编辑模式时自动聚焦
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // 提交编辑
  const handleSubmit = useCallback(() => {
    setIsEditing(false);
    if (editValue.trim() && editValue !== groupData.label) {
      // 触发自定义事件通知父组件更新
      const event = new CustomEvent('groupLabelChange', {
        detail: { id, label: editValue.trim() }
      });
      window.dispatchEvent(event);
    }
  }, [id, editValue, groupData.label]);

  // 键盘事件处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(groupData.label || '新分组');
    }
  }, [handleSubmit, groupData.label]);

  // Handle 样式：与 CustomNode 保持一致
  const sourceHandleStyle = {
    width: 10,
    height: 10,
    background: '#fff',
    border: '2px solid #64748b',
    zIndex: 11,
  };

  const targetHandleStyle = {
    width: 10,
    height: 10,
    background: '#fff',
    border: '2px solid #64748b',
    zIndex: 10,
  };

  // 使用 useStore 实时监听子节点变化，计算最小尺寸
  const minSize = useStore((state: ReactFlowState) => {
    const childNodes = state.nodes.filter((n) => n.parentId === id);

    if (childNodes.length === 0) {
      return { minWidth: 200, minHeight: 80 };
    }

    let maxX = 0;
    let maxY = 0;

    childNodes.forEach((node) => {
      // 优先使用 measured 尺寸
      const nodeWidth = (node.measured?.width) || (node.style?.width as number) || 120;
      const nodeHeight = (node.measured?.height) || (node.style?.height as number) || 60;
      const rightEdge = node.position.x + nodeWidth;
      const bottomEdge = node.position.y + nodeHeight;

      if (rightEdge > maxX) maxX = rightEdge;
      if (bottomEdge > maxY) maxY = bottomEdge;
    });

    const padding = 5;

    return {
      minWidth: maxX + padding,
      minHeight: maxY + padding,
    };
  }, (prev: { minWidth: number; minHeight: number }, next: { minWidth: number; minHeight: number }) => prev.minWidth === next.minWidth && prev.minHeight === next.minHeight);

  return (
    <>
      {/* 可调整大小 - 仅在选中时可用 */}
      <NodeResizer
        minWidth={minSize.minWidth}
        minHeight={minSize.minHeight}
        isVisible={selected}
        lineStyle={{
          borderColor: color,
          borderWidth: 2,
        }}
        handleStyle={{
          backgroundColor: color,
          width: 10,
          height: 10,
          borderRadius: 2,
        }}
      />

      {/* 分组容器 */}
      <div
        className={`group-node ${selected ? 'selected' : ''}`}
        style={{
          '--group-color': color,
          '--group-bg-color': `${color}15`,
        } as React.CSSProperties}
        onDoubleClick={handleDoubleClick}
      >
        {/* Adds Handles for connecting to other nodes */}
        {/* Top Handle */}
        <Handle type="target" position={Position.Top} id="top" style={targetHandleStyle} />
        <Handle type="source" position={Position.Top} id="top-source" style={sourceHandleStyle} />

        {/* Right Handle */}
        <Handle type="source" position={Position.Right} id="right" style={sourceHandleStyle} />
        <Handle type="target" position={Position.Right} id="right-target" style={targetHandleStyle} />

        {/* Bottom Handle */}
        <Handle type="source" position={Position.Bottom} id="bottom" style={sourceHandleStyle} />
        <Handle type="target" position={Position.Bottom} id="bottom-target" style={targetHandleStyle} />

        {/* Left Handle */}
        <Handle type="target" position={Position.Left} id="left" style={targetHandleStyle} />
        <Handle type="source" position={Position.Left} id="left-source" style={sourceHandleStyle} />

        {/* 标题栏 */}
        <div
          className="group-header"
          style={{
            backgroundColor: color,
            height: 40, // 确保固定高度
          }}
        >
          <div className="group-label-container">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                className="group-label-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSubmit}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="group-label">{groupData.label || '新分组'}</span>
            )}
          </div>
        </div>

        {/* 内容区域（子节点会渲染在这里） */}
        <div className="group-content" />
      </div>
    </>
  );
});

GroupNode.displayName = 'GroupNode';
