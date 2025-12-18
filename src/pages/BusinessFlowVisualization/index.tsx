import { useState, useEffect } from 'react';
import { FlowCanvas } from '../../components/FlowCanvas';
import { Node, Edge } from '@xyflow/react';
import { FlowDefinition, FlowNodeData } from '../../types/flow';
import './styles.css';

export function BusinessFlowVisualization() {
  const [allNodes, setAllNodes] = useState<Node<FlowNodeData>[]>([]);
  const [allEdges, setAllEdges] = useState<Edge[]>([]);
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showSubflows, setShowSubflows] = useState(false);
  const [loading, setLoading] = useState(true);

  // 过滤显示节点和边
  const filterElements = (currentNodes: Node<FlowNodeData>[], currentEdges: Edge[], show: boolean) => {
    if (show) {
      return { nodes: currentNodes, edges: currentEdges };
    } else {
      // 隐藏子流程节点 (type === 'subprocess')
      const visibleNodes = currentNodes.filter((n) => n.data.type !== 'subprocess');
      const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

      const visibleEdges = currentEdges.filter(
        (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target),
      );

      return { nodes: visibleNodes, edges: visibleEdges };
    }
  };

  // 监听 showSubflows 变化，更新可见节点
  useEffect(() => {
    if (allNodes.length > 0) {
      const { nodes: visibleNodes, edges: visibleEdges } = filterElements(
        allNodes,
        allEdges,
        showSubflows,
      );
      setNodes(visibleNodes);
      setEdges(visibleEdges);
    }
  }, [showSubflows, allNodes, allEdges]);

  // 加载流程数据
  useEffect(() => {
    loadFlowData();
  }, []);

  // 处理流程数据
  const processFlowData = (flowDef: FlowDefinition) => {
    // 转换节点
    const flowNodes: Node<FlowNodeData>[] = flowDef.nodes.map((node) => {
      // 分组节点特殊处理
      if (node.type === 'group') {
        // 优先使用 size 中的尺寸，确保加载正确的调整后尺寸
        const width = node.size?.width || 200;
        const height = node.size?.height || 150;

        return {
          id: node.id,
          type: 'group',
          position: node.position,
          style: {
            ...node.style,  // 保留其他样式
            width,  // 使用 size 中的宽度
            height, // 使用 size 中的高度
          },
          data: {
            id: node.id,
            label: node.label || node.name,
            color: node.color || '#3b82f6',
            relatedNodeIds: node.relatedNodeIds || [],  // 加载关联节点 ID
          } as any,
          zIndex: -1, // 分组在底层
        };
      }

      // 普通节点
      return {
        id: node.id,
        type: 'custom',
        position: node.position,
        style: node.style,
        parentId: node.parentId, // 加载父节点 ID
        extent: node.parentId ? ('parent' as 'parent') : undefined, // 如果有 parentId，设置 extent 为 'parent'
        data: {
          id: node.id,
          name: node.name,
          description: (node as any).description, // 加载节点描述
          type: node.type,
          expandable: node.expandable,
          detailConfig: node.detailConfig,
          subType: node.subType, // 加载起止节点的子类型
          backgroundColor: node.backgroundColor, // 加载节点背景色（特别是判断节点）
          relatedNodeIds: node.relatedNodeIds, // 加载关联节点 ID
        },
      };
    });

    // 确保分组节点在前面（React Flow 要求父节点在子节点前面）
    flowNodes.sort((a, b) => {
      if (a.type === 'group' && b.type !== 'group') return -1;
      if (a.type !== 'group' && b.type === 'group') return 1;
      return 0;
    });

    // 转换连接线
    // 简化加载逻辑：直接使用保存的 handle ID，不做复杂的映射
    // 这样可以支持任意两个 handle 之间的连接
    const flowEdges: Edge[] = flowDef.connectors
      .filter((conn) => {
        // 过滤掉源节点或目标节点不存在的连接线
        const sourceNode = flowNodes.find((n) => n.id === conn.sourceID);
        const targetNode = flowNodes.find((n) => n.id === conn.targetID);
        if (!sourceNode || !targetNode) {
          // console.warn(`连接线 ${conn.id} 的源节点或目标节点不存在，已跳过`);
          return false;
        }
        return true;
      })
      .map((conn) => {
        // 正确处理箭头方向：
        // - 如果保存的数据中有 markerEnd，使用它
        // - 如果保存的数据中有 markerStart，使用它
        // - 如果两者都没有，默认使用 markerEnd（正向箭头）
        // - 如果只有 markerStart，不使用 markerEnd（反向箭头）
        // - 如果两者都有，使用两者（双向箭头）
        let markerEnd = undefined;
        let markerStart = undefined;

        if (conn.markerEnd !== undefined && conn.markerEnd !== null) {
          markerEnd = conn.markerEnd;
        }
        if (conn.markerStart !== undefined && conn.markerStart !== null) {
          markerStart = conn.markerStart;
        }

        // 如果两者都没有，默认使用正向箭头（markerEnd）
        if (markerEnd === undefined && markerStart === undefined) {
          markerEnd = {
            type: 'arrowclosed' as const,
            color: conn.style?.stroke || '#64748b',
            width: 16,
            height: 16,
          };
        }

        // 兼容旧的 "top" handle ID，转换为正确的 ID
        let sourceHandle = conn.sourceHandle;
        if (sourceHandle === 'top') {
          sourceHandle = 'top-source'; // "top" 作为 source 应该使用 "top-source"
        }

        let targetHandle = conn.targetHandle;
        if (targetHandle === 'top') {
          targetHandle = 'top-target'; // "top" 作为 target 应该使用 "top-target"
        }

        return {
          id: conn.id,
          source: conn.sourceID,
          target: conn.targetID,
          sourceHandle: sourceHandle, // 兼容旧的 "top" sourceHandle
          targetHandle: targetHandle, // 兼容旧的 "top" targetHandle
          label: conn.label,
          type: 'draggable', // 将默认的 smoothstep 改为 draggable
          animated: true,
          style: {
            stroke: conn.style?.stroke || '#64748b',
            strokeWidth: conn.style?.strokeWidth || 1,
            strokeDasharray: conn.style?.strokeDasharray,
          },
          labelStyle: conn.labelStyle || {
            fill: '#000000',
            fontSize: 9,
            fontWeight: 300,
            fontFamily: '微软雅黑',
            background: '#E0E0E0',
            padding: '6px 12px',
            borderRadius: '6px',
          },
          labelBgStyle: conn.labelBgStyle || {
            fill: '#E0E0E0',
            fillOpacity: 1, // 默认完全不透明
          },
          labelBgPadding: [8, 12] as [number, number],
          labelBgBorderRadius: 8,
          markerEnd: markerEnd,
          markerStart: markerStart,
          data: {
            ...conn.data,
            notImplemented: conn.notImplemented || false,
          },
        } as Edge;
      });

    setAllNodes(flowNodes);
    setAllEdges(flowEdges);

    // 初始化显示
    const { nodes: visibleNodes, edges: visibleEdges } = filterElements(
      flowNodes,
      flowEdges,
      showSubflows,
    );
    setNodes(visibleNodes);
    setEdges(visibleEdges);
  };

  const loadFlowData = async () => {
    try {
      // 1. 尝试从 LocalStorage 加载
      const savedData = localStorage.getItem('saved-flow-data');
      if (savedData) {
        try {
          const flowDef: FlowDefinition = JSON.parse(savedData);
          if (flowDef && flowDef.nodes && flowDef.connectors) {
            console.log('从 LocalStorage 加载流程数据');
            processFlowData(flowDef);
            setLoading(false);
            return;
          }
        } catch (e) {
          console.warn('LocalStorage 数据解析失败，将加载默认数据', e);
        }
      }

      // 2. 如果 LocalStorage 没有数据或解析失败，加载默认数据
      console.log('加载默认流程数据');
      const response = await fetch('/data/complete-business-flow.json');
      const flowDef: FlowDefinition = await response.json();
      processFlowData(flowDef);

      setLoading(false);
    } catch (error) {
      console.error('加载流程数据失败:', error);
      setLoading(false);
    }
  };

  const toggleSubflows = () => {
    setShowSubflows(!showSubflows);
    // TODO: 实现子流程的显示/隐藏逻辑
  };

  if (loading) {
    return (
      <div className="flow-visualization-loading">
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  return (
    <div className="business-flow-visualization">
      <div className="flow-header">
        <div className="header-left">
          <h1 className="flow-title">完整业务流程</h1>
          <p className="flow-subtitle">从线索管理到项目执行的完整流程</p>
        </div>
        <div className="flow-info">
          <span className="info-item">
            <span className="info-icon">📊</span>
            节点: {nodes.length}
          </span>
          <span className="info-item">
            <span className="info-icon">🔗</span>
            连接: {edges.length}
          </span>
        </div>
      </div>
      <div className="flow-content">
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          showSubflows={showSubflows}
          onToggleSubflows={toggleSubflows}
        />
      </div>
    </div>
  );
}
