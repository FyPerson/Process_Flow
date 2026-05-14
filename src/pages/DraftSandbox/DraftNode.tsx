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

// D-5：双击改名后通知父组件推历史快照
// 不用 prop（NodeProps 由 React Flow 注入，扩展接口有点麻烦）
// 改用 window CustomEvent 通信——简单可靠，DraftSandbox 监听即可
export const DRAFT_NODE_LABEL_CHANGED_EVENT = 'draft-node-label-changed';

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
    // D-5：通知父组件推历史快照（让 Ctrl+Z 能撤销改名）
    window.dispatchEvent(new CustomEvent(DRAFT_NODE_LABEL_CHANGED_EVENT));
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
    // 决策节点：正方形容器 + SVG 画菱形（带 stroke 描边）
    // React Flow 按容器矩形定位 Handle（Top 中点 / Right 中点 / Bottom 中点 / Left 中点）
    // —— 这正好是菱形的 4 个顶点 ✅
    // 用 SVG <polygon> 替代 clip-path 切矩形 —— clip-path 会把 border 一起裁掉
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
        {/* SVG 菱形（fill + stroke 都可控） */}
        <svg
          width={DIAMOND_SIZE}
          height={DIAMOND_SIZE}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <polygon
            points={`${DIAMOND_SIZE / 2},2 ${DIAMOND_SIZE - 2},${DIAMOND_SIZE / 2} ${DIAMOND_SIZE / 2},${DIAMOND_SIZE - 2} 2,${DIAMOND_SIZE / 2}`}
            fill="#fef3c7"
            stroke="#d97706"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </svg>
        {/* 文字层 */}
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
