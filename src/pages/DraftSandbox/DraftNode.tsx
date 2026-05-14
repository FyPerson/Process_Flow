// DraftSandbox 4 节点类型组件
//
// 设计：方案 §2.3 + §3.2 — 简单 React 组件，不复用 CustomNode（避免污染主组件）
//
// 4 种类型：
//   - start：圆角矩形 / 绿底 #dcfce7
//   - step：矩形 / 白底
//   - decision：菱形 / 黄底 #fef3c7（用 clip-path 真菱形，Handle 在 4 个顶点）
//   - end：圆角矩形 / 红底 #fee2e2
//
// 编辑：双击节点弹原生 prompt 改名
// 连线：每个节点暴露 Top/Right/Bottom/Left 4 个 Handle
//   - 配合 ReactFlow connectionMode="loose"，任意 handle 都能作为 source 或 target
//   - 决策节点 Handle 落在菱形 4 个顶点

import { memo, useCallback } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';

export type DraftNodeType = 'start' | 'step' | 'decision' | 'end';

export interface DraftNodeData {
  label: string;
  [key: string]: unknown;
}

// 通用节点尺寸
const NODE_WIDTH = 120;
const NODE_HEIGHT = 48;
const DIAMOND_SIZE = 100; // 决策节点正方形容器，clip-path 切成菱形

const HANDLE_STYLE: React.CSSProperties = {
  width: 8,
  height: 8,
  background: '#3b82f6',
  border: '2px solid #ffffff',
  borderRadius: '50%',
};

function DraftNodeImpl({ id, data, type }: NodeProps) {
  const nodeType = (type ?? 'step') as DraftNodeType;
  const nodeData = data as DraftNodeData;
  const { setNodes } = useReactFlow();

  const handleDoubleClick = useCallback(() => {
    const next = window.prompt('编辑节点文字：', nodeData.label);
    if (next === null) return; // 用户取消
    const trimmed = next.trim();
    if (!trimmed) return; // 空文字不接受
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label: trimmed } } : n,
      ),
    );
  }, [id, nodeData.label, setNodes]);

  // 4 个 Handle 都设 source —— connectionMode="loose" 时 React Flow 允许 source<->source 互连
  // id 给 't/r/b/l' 让 edge 持久化能记住具体哪个端点
  const handles = (
    <>
      <Handle id="t" type="source" position={Position.Top} style={HANDLE_STYLE} />
      <Handle id="r" type="source" position={Position.Right} style={HANDLE_STYLE} />
      <Handle id="b" type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      <Handle id="l" type="source" position={Position.Left} style={HANDLE_STYLE} />
    </>
  );

  if (nodeType === 'decision') {
    // 决策节点：正方形容器 + clip-path 切菱形
    // React Flow 按容器矩形定位 Handle（Top 中点 / Right 中点 / Bottom 中点 / Left 中点）
    // —— 这正好是菱形的 4 个顶点 ✅
    return (
      <div
        onDoubleClick={handleDoubleClick}
        style={{
          width: DIAMOND_SIZE,
          height: DIAMOND_SIZE,
          position: 'relative',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        title="双击编辑文字"
      >
        {/* 菱形背景层（clip-path） */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#fef3c7',
            border: '2px solid #d97706',
            clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
            boxSizing: 'border-box',
          }}
        />
        {/* 文字层（不切，正常水平显示） */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 500,
            color: '#78350f',
            padding: '0 20px',
            textAlign: 'center',
            wordBreak: 'break-word',
          }}
        >
          {nodeData.label}
        </div>
        {handles}
      </div>
    );
  }

  // start / step / end：圆角矩形 or 矩形
  const styleByType: Record<Exclude<DraftNodeType, 'decision'>, React.CSSProperties> = {
    start: {
      background: '#dcfce7',
      border: '2px solid #16a34a',
      borderRadius: 9999,
      color: '#14532d',
    },
    step: {
      background: '#ffffff',
      border: '2px solid #475569',
      borderRadius: 6,
      color: '#0f172a',
    },
    end: {
      background: '#fee2e2',
      border: '2px solid #dc2626',
      borderRadius: 9999,
      color: '#7f1d1d',
    },
  };

  return (
    <div
      onDoubleClick={handleDoubleClick}
      style={{
        ...styleByType[nodeType as Exclude<DraftNodeType, 'decision'>],
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        userSelect: 'none',
        boxSizing: 'border-box',
        padding: '0 12px',
        textAlign: 'center',
      }}
      title="双击编辑文字"
    >
      <span style={{ wordBreak: 'break-word' }}>{nodeData.label}</span>
      {handles}
    </div>
  );
}

export const DraftNode = memo(DraftNodeImpl);
