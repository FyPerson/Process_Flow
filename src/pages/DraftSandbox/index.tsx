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
// D-2：裸 React Flow + 4 节点类型 + 左侧工具栏 ✅
// D-3：localStorage 持久化 ✅
// D-4：html-to-image PNG 导出 ✅
// D-5（当前）：撤销/重做（Ctrl+Z / Ctrl+Y）+ 容量保护提示（节点 > 100 黄字）

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  Edge,
  Node,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { newNodeId, newEdgeId } from '../../utils/ids';
import { exportCanvasAsPng } from '../../utils/export-image';
import { DraftNode, DraftNodeType, DraftNodeData, DraftNodeRenameContext } from './DraftNode';
import { loadDraft, saveDraft } from './persistence';
import { useDraftHistory } from './useDraftHistory';

const CAPACITY_WARNING_THRESHOLD = 100;

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
  // 显式设置 edge label SVG 样式（不依赖 React Flow CSS 变量）
  // 原因：html-to-image 截图时 CSS 变量可能解析不到，导致 label 渲染异常
  // labelStyle 控制 <text fill>；labelBgStyle 控制 <rect fill>；labelBgPadding 给 padding
  labelStyle: {
    fill: '#0f172a',
    fontSize: 12,
    fontWeight: 500,
  },
  labelBgStyle: {
    fill: '#ffffff',
    fillOpacity: 0.95,
    stroke: '#cbd5e1',
    strokeWidth: 1,
  },
  labelBgPadding: [6, 4] as [number, number],
  labelBgBorderRadius: 4,
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
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DraftNodeData>>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);
  const [exporting, setExporting] = useState(false);
  // D-8 M3：localStorage 写入失败时的降级提示状态
  // null = 正常 / 'quota_exceeded' = 配额满 / 'storage_disabled' = 隐身/禁用 / 'unknown' = 其他
  const [storageError, setStorageError] = useState<
    null | 'quota_exceeded' | 'storage_disabled' | 'unknown'
  >(null);

  // D-5：撤销/重做历史栈（栈深 20）
  // 推快照策略（caller 端集成）：
  //   - 节点 add（handleAddNode）/ 节点删（onNodesChange remove）/ 节点改名（DraftNode 双击）
  //     → 这些是"结构性变化"，立即推
  //   - 节点拖动（onNodesChange position dragging=true）→ 不推（每帧触发，会爆栈）
  //   - 拖动结束（onNodeDragStop）→ 推一次
  //   - 边 add（onConnect）/ 边删（onEdgesChange remove）/ 边 label 改 → 推
  // 但在 React Flow 函数式 setState 之后立即读 nodes/edges 闭包会拿旧值，
  // 用 ref 持续追当前值，pushSnapshot 时读 ref
  const history = useDraftHistory(INITIAL_NODES, INITIAL_EDGES);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // Undo/Redo 应用 snapshot 回 React Flow state
  const applySnapshot = useCallback(
    (snap: { nodes: Node<DraftNodeData>[]; edges: Edge[] } | null) => {
      if (!snap) return;
      setNodes(snap.nodes);
      setEdges(snap.edges);
    },
    [setNodes, setEdges],
  );
  const handleUndo = useCallback(() => applySnapshot(history.undo()), [history, applySnapshot]);
  const handleRedo = useCallback(() => applySnapshot(history.redo()), [history, applySnapshot]);

  // D-8 H2+M5：改名走 setNodes updater 同步合成 next + 推快照
  // 旧实现走 CustomEvent + queueMicrotask 读 nodesRef，存在异步竞态（H2）+ 全局事件
  // 隐式数据流（M5）。新实现通过 DraftNodeRenameContext 直接注入 callback。
  const handleRename = useCallback((nodeId: string, nextLabel: string) => {
    setNodes((prev) => {
      const next = prev.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, label: nextLabel } } : n,
      );
      history.pushSnapshot(next, edgesRef.current);
      return next;
    });
  }, [setNodes, history]);

  // 键盘监听 Ctrl+Z / Ctrl+Y（Mac 兼容 Meta）+ Ctrl+Shift+Z（redo 别名）
  // 跳过 input/textarea/contenteditable（避免抢用户编辑文字时的撤销）
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // D-4：导出当前画布为 PNG（复用 src/utils/export-image.ts）
  // - fitView 框入全部节点 + 等 1 帧 viewport transform 落地
  // - 文件名 "需求草稿-YYYYMMDD-HHmm.png"
  // - 防重复点击 + loading 反馈
  const handleExport = useCallback(async () => {
    if (exporting) return;
    if (nodes.length === 0) {
      window.alert('画布为空，请先添加节点');
      return;
    }
    setExporting(true);
    try {
      await exportCanvasAsPng('需求草稿', {
        beforeCapture: async () => {
          fitView({ padding: 0.2, duration: 0 });
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        },
      });
    } catch (err) {
      window.alert(`导出失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, nodes.length, fitView]);

  // localStorage 持久化：nodes/edges 变化 → debounce 500ms 写入
  // 方案 §3.3：避免拖动节点时频繁写 localStorage
  // 用 ref 持有 timer，组件卸载时 clear，避免 unmount 后还在写
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const result = saveDraft(nodes, edges);
      // D-8 M3：写入失败 → setStorageError 触发顶栏黄字降级提示
      // 成功后清掉 error（之前失败可能恢复，例如 quota 释放或浏览器恢复访问）
      setStorageError(result.ok ? null : result.reason);
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const next = addEdge({ ...params, id: newEdgeId() }, eds);
        // 推快照：用即将生效的 next + 当前 nodesRef 拍快照（避开 setState 异步闭包）
        history.pushSnapshot(nodesRef.current, next);
        return next;
      });
    },
    [setEdges, history],
  );

  // 双击边 → 弹 prompt 编辑 label（用于判断节点分支的"是/否"标注）
  // 清空 label 后传空串 → React Flow 自动隐藏 label 框
  const onEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const current = typeof edge.label === 'string' ? edge.label : '';
      const next = window.prompt('编辑连接线文字（如"是" / "否"，留空则清除）：', current);
      if (next === null) return; // 用户取消
      const trimmed = next.trim();
      setEdges((eds) => {
        const updated = eds.map((e) =>
          e.id === edge.id ? { ...e, label: trimmed || undefined } : e,
        );
        history.pushSnapshot(nodesRef.current, updated);
        return updated;
      });
    },
    [setEdges, history],
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
      setNodes((nds) => {
        const next = nds.concat(newNode);
        history.pushSnapshot(next, edgesRef.current);
        return next;
      });
    },
    [screenToFlowPosition, setNodes, history],
  );

  // D-5：拖动结束推快照（拖动过程每帧 onNodesChange 不推，避免爆栈）
  const onNodeDragStop = useCallback(() => {
    history.pushSnapshot(nodesRef.current, edgesRef.current);
  }, [history]);

  // D-5 + D-8 H1/R-H1/R-M2 修法：节点/边结构性变化时推快照
  // H1 修法：用 React Flow 的 applyNodeChanges/applyEdgeChanges 在 setNodes/setEdges
  //   函数式 updater 内同步计算 next，**同一 updater 内**推 snapshot —— 删除快照与
  //   实际状态原子一致。
  // R-H1 修法：节点 remove 时**同步过滤悬空 edge**（source/target 指向已删节点的
  //   边一起删 + 一起推快照），避免中间快照出现 dangling edge → undo 复活悬空边。
  // R-M2 修法：结构性判断扩展为 add/remove/replace（@xyflow/react NodeChange 三类
  //   都视为结构性，position/dimensions/select 仍走默认路径不推历史）。
  const wrappedOnNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const hasStructural = changes.some(
        (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace',
      );
      if (hasStructural) {
        // R-H1：节点 remove → 提取 removedIds → 同步过滤悬空 edge → 一并推完整快照
        const removedIds = new Set(
          changes.filter((c) => c.type === 'remove').map((c) => c.id),
        );
        setNodes((prevNodes) => {
          const nextNodes = applyNodeChanges(changes, prevNodes);
          if (removedIds.size > 0) {
            // 有节点被删 → 同步过滤悬空 edge
            setEdges((prevEdges) => {
              const nextEdges = prevEdges.filter(
                (e) => !removedIds.has(e.source) && !removedIds.has(e.target),
              );
              history.pushSnapshot(nextNodes, nextEdges);
              return nextEdges;
            });
          } else {
            // 纯 add/replace 无悬空 edge 风险，edges 不变
            history.pushSnapshot(nextNodes, edgesRef.current);
          }
          return nextNodes;
        });
      } else {
        // 非结构性变化（select/position/dimensions 等）走 React Flow 默认路径
        onNodesChange(changes);
      }
    },
    [onNodesChange, setNodes, setEdges, history],
  );
  const wrappedOnEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      const hasStructural = changes.some(
        (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace',
      );
      if (hasStructural) {
        setEdges((prev) => {
          const next = applyEdgeChanges(changes, prev);
          history.pushSnapshot(nodesRef.current, next);
          return next;
        });
      } else {
        onEdgesChange(changes);
      }
    },
    [onEdgesChange, setEdges, history],
  );

  // 用 useMemo 把 nodeTypes 稳定下来（React Flow 要求 nodeTypes 引用稳定）
  const stableNodeTypes = useMemo(() => nodeTypes, []);

  return (
    <DraftNodeRenameContext.Provider value={handleRename}>
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
          {nodes.length > CAPACITY_WARNING_THRESHOLD && (
            <span
              style={{ fontSize: 12, color: '#fde047' }}
              title={`当前节点数 ${nodes.length}，建议导出后清空再画`}
            >
              ⚠️ 节点较多（{nodes.length}），建议导出后清空
            </span>
          )}
          {/* D-8 M3：localStorage 写入失败降级提示 */}
          {storageError && (
            <span
              style={{ fontSize: 12, color: '#fde047', fontWeight: 600 }}
              title={
                storageError === 'quota_exceeded'
                  ? '本地存储已满 / 浏览器配额超限 — 当前改动可能在刷新后丢失，请立即点「📷 导出 PNG」'
                  : storageError === 'storage_disabled'
                    ? '浏览器禁用了 localStorage（如隐身模式 / 第三方 cookie 限制）— 当前画布不会自动保存，请立即点「📷 导出 PNG」'
                    : '本地保存失败 — 当前改动可能在刷新后丢失，请立即点「📷 导出 PNG」'
              }
            >
              ⚠️ 本地保存失败，请立即导出
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            style={{
              padding: '6px 12px',
              background: exporting ? '#1e40af55' : '#2563eb',
              border: '1px solid transparent',
              borderRadius: 4,
              color: '#ffffff',
              fontSize: 12,
              cursor: exporting ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
            title={exporting ? '正在生成图片，请稍候…' : '导出当前画布为 PNG 图片'}
          >
            {exporting ? '⏳ 正在生成…' : '📷 导出 PNG'}
          </button>
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
            title="返回登录页（不会清空本机草稿，刷新或下次回 /draft 仍能恢复）"
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
            onNodesChange={wrappedOnNodesChange}
            onEdgesChange={wrappedOnEdgesChange}
            onConnect={onConnect}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onNodeDragStop={onNodeDragStop}
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
    </DraftNodeRenameContext.Provider>
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
