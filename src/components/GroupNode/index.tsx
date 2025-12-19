import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { NodeProps, NodeResizer, useReactFlow, Position, Handle, useStore, type ReactFlowState, useUpdateNodeInternals } from '@xyflow/react';
import { GroupNodeData } from '../../types/flow';
import { getUniqueName } from '../../utils/uniqueName';
import './styles.css';

export const GroupNode = memo(({ id, data, selected }: NodeProps) => {
  const groupData = data as unknown as GroupNodeData;
  const color = groupData.color || '#3b82f6';
  const { setNodes, getNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals(); // Add this to update handles if needed, though mainly for size changes

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(groupData.label || '新分组');
  const [isCollapsed, setIsCollapsed] = useState(!!groupData.collapsed);
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步外部数据变化
  useEffect(() => {
    setEditValue(groupData.label || '新分组');
  }, [groupData.label]);

  // Sync collapsed state from data
  useEffect(() => {
    setIsCollapsed(!!groupData.collapsed);
  }, [groupData.collapsed]);

  // 双击进入编辑模式
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(groupData.label || '新分组');
    setIsEditing(true);
  }, [groupData.label]);

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
      // 检查并在必要时生成唯一名称
      const currentNodes = getNodes();

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

      if (uniqueName !== editValue.trim()) {
        setEditValue(uniqueName);
      }

      // 触发自定义事件通知父组件更新
      const event = new CustomEvent('groupLabelChange', {
        detail: { id, label: uniqueName }
      });
      window.dispatchEvent(event);
    }
  }, [id, editValue, groupData.label, getNodes]);

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

  // 处理折叠/展开
  const handleCollapseToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const newCollapsedState = !isCollapsed;
    setIsCollapsed(newCollapsedState);

    // 更新当前节点数据
    setNodes((nodes) => nodes.map((n) => {
      if (n.id === id) {
        const currentData = n.data as unknown as GroupNodeData;
        let newStyle = { ...n.style };
        let newData: GroupNodeData = { ...(n.data as unknown as GroupNodeData), collapsed: newCollapsedState };

        if (newCollapsedState) {
          // 折叠：保存当前尺寸
          newData = {
            ...newData,
            expandedSize: {
              width: n.style?.width ?? n.measured?.width ?? 'auto',
              height: n.style?.height ?? n.measured?.height ?? 'auto',
            }
          };
          // 设置折叠后尺寸
          newStyle = {
            ...newStyle,
            width: 150,
            height: 60,
          };
        } else {
          // 展开：恢复尺寸
          if (currentData.expandedSize) {
            newStyle = {
              ...newStyle,
              width: currentData.expandedSize.width,
              height: currentData.expandedSize.height,
            };
          } else {
            // 如果没有保存尺寸，则清除固定尺寸，利用 React Flow 的自适应或 minSize
            newStyle.width = undefined; // 或者是之前的 minSize 计算值
            newStyle.height = undefined;
          }
        }

        return {
          ...n,
          data: newData,
          style: newStyle
        };
      }
      return n;
    }));

    // 更新子节点可见性
    setNodes((nodes) => {
      // 1. 找到所有属于该分组的子节点
      const childIds = new Set<string>();
      nodes.forEach(n => {
        if (n.parentId === id) {
          childIds.add(n.id);
        }
      });

      return nodes.map((n) => {
        // 如果是子节点，设置 hidden 属性
        if (n.parentId === id) {
          return {
            ...n,
            hidden: newCollapsedState,
          };
        }
        return n;
      });
    });
  }, [id, isCollapsed, setNodes]);

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
  // 使用 useStore 实时监听子节点变化，计算最小尺寸
  const minSize = useStore((state: ReactFlowState) => {
    if (isCollapsed) {
      return { minWidth: 150, minHeight: 60 };
    }

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

    const padding = 20; // 增加 padding 以容纳标题栏

    return {
      minWidth: Math.max(maxX + padding, 200),
      minHeight: Math.max(maxY + padding, 80),
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
        className={`group-node ${selected ? 'selected' : ''} ${isCollapsed ? 'collapsed' : ''}`}
        style={{
          '--group-color': color,
          '--group-bg-color': isCollapsed ? color : `${color}15`,
          ...(isCollapsed ? {
            width: '100%',
            height: '100%',
            minWidth: 'unset',
            minHeight: 'unset',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${color}`,
            backgroundColor: color, // 折叠时使用实色背景
            color: '#fff', // 折叠时文字为白色
            borderRadius: 8,
            padding: 0,
          } : {})
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
            backgroundColor: isCollapsed ? 'transparent' : color,
            height: isCollapsed ? '100%' : 40, // 确保固定高度
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            padding: isCollapsed ? '0' : '0 10px',
            boxSizing: 'border-box',
          }}
        >
          {/* 折叠/展开按钮 */}
          <button
            className="group-collapse-btn"
            onClick={handleCollapseToggle}
            style={{
              marginRight: 8,
              background: 'rgba(255, 255, 255, 0.3)',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              cursor: 'pointer',
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
              flexShrink: 0,
            }}
          >
            {isCollapsed ? '+' : '-'}
          </button>

          <div className="group-label-container" style={{ flexGrow: 1, textAlign: isCollapsed ? 'center' : 'left', overflow: 'hidden' }}>
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                className="group-label-input"
                style={{
                  color: isCollapsed ? '#fff' : 'inherit',
                  textAlign: isCollapsed ? 'center' : 'left',
                }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSubmit}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="group-label" style={{ color: isCollapsed ? '#fff' : '#fff', fontWeight: 500 }}>{groupData.label || '新分组'}</span>
            )}
          </div>
        </div>

        {/* 内容区域（子节点会渲染在这里） */}
        {!isCollapsed && <div className="group-content" />}
      </div>
    </>
  );
});

GroupNode.displayName = 'GroupNode';
