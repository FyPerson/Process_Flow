// 游客草稿能力 —— 独立 /draft 路由的草稿沙箱页
//
// 设计原则（详见 docs/规划/游客草稿能力/方案.md）：
// - 完全独立于 AuthProvider（App.tsx 把 /draft 路由提到 AuthProvider 外）
// - 单向流转工具：进入 → 画图 → 导出 PNG → 发给开发/产品
// - 数据仅 localStorage 持久化，不入服务端数据库（D-3 接入）
// - 刻意不开"导入"入口（防数据搬运绕过权限漏洞）
// - 裸 React Flow，不复用 FlowCanvas（避免污染主组件）
//
// D-1：路由骨架 + 顶栏 + 返回登录按钮 ✅
// D-2（当前）：裸 React Flow + 4 节点类型 + 左侧工具栏
// D-3：localStorage 持久化 + 顶栏红字警告（已占位）
// D-4：html-to-image PNG 导出
// D-5：撤销/重做 + 容量保护

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { newNodeId, newEdgeId } from '../../utils/ids';
import { DraftNode, DraftNodeType, DraftNodeData } from './DraftNode';
import { loadDraft, saveDraft } from './persistence';

// 首屏读 localStorage 一次（mount 前同步执行，避免空画布闪烁后再恢复）
const INITIAL = loadDraft();
const INITIAL_NODES: Node<DraftNodeData>[] = INITIAL?.nodes ?? [];
const INITIAL_EDGES: Edge[] = INITIAL?.edges ?? [];

const nodeTypes = {
  start: DraftNode,
  step: DraftNode,
  decision: DraftNode,
  end: DraftNode,
};

const defaultEdgeOptions: Partial<Edge> = {
  animated: true,
  style: { stroke: '#64748b', strokeWidth: 1 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#64748b',
    width: 18,
    height: 18,
  },
};

const NODE_TYPE_LABELS: Record<DraftNodeType, string> = {
  start: '开始',
  step: '步骤',
  decision: '判断?',
  end: '结束',
};

const NODE_TYPE_TOOLBAR: { type: DraftNodeType; icon: string; text: string }[] = [
  { type: 'start', icon: '🟢', text: '开始' },
  { type: 'step', icon: '⬜', text: '步骤' },
  { type: 'decision', icon: '🟡', text: '判断' },
  { type: 'end', icon: '🔴', text: '结束' },
];

function DraftSandboxInner() {
  const navigate = useNavigate();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DraftNodeData>>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);

  // localStorage 持久化：nodes/edges 变化 → debounce 500ms 写入
  // 方案 §3.3：避免拖动节点时频繁写 localStorage
  // 用 ref 持有 timer，组件卸载时 clear，避免 unmount 后还在写
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft(nodes, edges);
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({ ...params, id: newEdgeId() }, eds)),
    [setEdges],
  );

  // 双击边 → 弹 prompt 编辑 label（用于判断节点分支的"是/否"标注）
  // 清空 label 后传空串 → React Flow 自动隐藏 label 框
  const onEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const current = typeof edge.label === 'string' ? edge.label : '';
      const next = window.prompt('编辑连接线文字（如"是" / "否"，留空则清除）：', current);
      if (next === null) return; // 用户取消
      const trimmed = next.trim();
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edge.id ? { ...e, label: trimmed || undefined } : e,
        ),
      );
    },
    [setEdges],
  );

  // 点击工具栏按钮 → 在画布中央 add node
  // 方案 §4.2：点击工具栏按钮 → 在画布中央生成对应类型节点（同主应用「添加节点」侧栏按钮的交互，不做拖动）
  const handleAddNode = useCallback(
    (type: DraftNodeType) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2 + Math.random() * 50,
        y: window.innerHeight / 2 + Math.random() * 50,
      });
      const newNode: Node<DraftNodeData> = {
        id: newNodeId(),
        type,
        position,
        data: { label: NODE_TYPE_LABELS[type] },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes],
  );

  // 用 useMemo 把 nodeTypes 稳定下来（React Flow 要求 nodeTypes 引用稳定）
  const stableNodeTypes = useMemo(() => nodeTypes, []);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#0f172a',
        color: '#e2e8f0',
      }}
    >
      {/* 顶栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          height: 48,
          background: '#1e293b',
          borderBottom: '1px solid #334155',
          flex: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>📝 需求草稿</span>
          <span style={{ fontSize: 12, color: '#fca5a5' }}>
            ⚠️ 仅本地保存，请及时导出
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid #475569',
              borderRadius: 4,
              color: '#cbd5e1',
              fontSize: 12,
              cursor: 'pointer',
            }}
            title="返回登录页"
          >
            🔙 返回登录
          </button>
        </div>
      </div>

      {/* 主体：左侧工具栏 + 画布 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左侧节点工具栏 */}
        <div
          style={{
            width: 88,
            background: '#1e293b',
            borderRight: '1px solid #334155',
            padding: '12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flex: 'none',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: '#64748b',
              textAlign: 'center',
              marginBottom: 4,
              userSelect: 'none',
            }}
          >
            节点
          </div>
          {NODE_TYPE_TOOLBAR.map(({ type, icon, text }) => (
            <button
              key={type}
              type="button"
              onClick={() => handleAddNode(type)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '8px 4px',
                background: '#334155',
                border: '1px solid #475569',
                borderRadius: 4,
                color: '#e2e8f0',
                fontSize: 11,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#475569')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#334155')}
              title={`添加${text}节点`}
            >
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span>{text}</span>
            </button>
          ))}
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, background: '#f1f5f9' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeDoubleClick={onEdgeDoubleClick}
            nodeTypes={stableNodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            connectionMode={ConnectionMode.Loose}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
            minZoom={0.5}
            maxZoom={2}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background color="#cbd5e1" gap={20} />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

export function DraftSandbox() {
  // ReactFlowProvider 包裹，让内部 useReactFlow() 能拿到实例
  return (
    <ReactFlowProvider>
      <DraftSandboxInner />
    </ReactFlowProvider>
  );
}
