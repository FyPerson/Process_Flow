import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlowCanvas } from '../../components/FlowCanvas';
import { SaveStatus } from '../../components/SaveStatus';
import { Node, Edge } from '@xyflow/react';
import {
  FlowDefinition,
  FlowNodeData,
  createEmptyProject,
} from '../../types/flow';
import { useMultiCanvas } from '../../hooks/useMultiCanvas';
import { useAuth } from '../../auth/AuthContext';
import type { ApiError } from '../../api/canvases';
import './styles.css';

export function BusinessFlowVisualization() {
  const [showSubflows, setShowSubflows] = useState(false);
  const [loading, setLoading] = useState(true);

  // URL ?canvasId=12 → 挂接服务端画布；缺省时回退本地 localStorage（阶段 1 老数据）
  const [searchParams, setSearchParams] = useSearchParams();
  const canvasIdRaw = searchParams.get('canvasId');
  const canvasIdFromUrl = useMemo(() => {
    if (!canvasIdRaw) return null;
    const n = Number(canvasIdRaw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [canvasIdRaw]);

  const { readOnly } = useAuth();

  // 使用多画布 Hook
  const {
    project,
    activeSheet,
    activeSheetId,
    setActiveSheet,
    addSheet,
    deleteSheet,
    renameSheet,
    duplicateSheet,
    updateSheetData,
    loadProject,
    getProjectData,
    isLoading: isProjectLoading,
    canvasId,
    dirty,
    saving,
    autoSaveDisabled,
    conflict,
    serverError,
    lastSavedAt,
    save,
    createOnServer,
    discardAndReload,
  } = useMultiCanvas({ canvasId: canvasIdFromUrl, storageKey: 'saved-flow-data' });

  // canvasId 从 createOnServer 拿到值后，把 URL 同步过去（让刷新还能定位）
  useEffect(() => {
    if (canvasId != null && canvasId !== canvasIdFromUrl) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('canvasId', String(canvasId));
          return next;
        },
        { replace: true }
      );
    }
  }, [canvasId, canvasIdFromUrl, setSearchParams]);

  // beforeunload：dirty 或 saving 时拦截关闭
  useEffect(() => {
    if (!dirty && !saving) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 现代浏览器忽略自定义文本，但 returnValue 仍是触发提示的"开关"
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, saving]);

  // 保存按钮：已挂接服务端画布
  const handleSave = useCallback(async () => {
    try {
      const result = await save();
      if (!result.ok && result.conflict) {
        const ok = window.confirm(
          `检测到服务端有更新（v${result.conflict.currentVersion}）。\n\n` +
            `选择"确定"丢弃本地改动并重载服务端版本；\n` +
            `选择"取消"保留本地改动（稍后可手动处理）。`
        );
        if (ok) {
          await discardAndReload();
        }
      }
    } catch (err) {
      const apiErr = err as ApiError;
      window.alert(
        `保存失败：${apiErr?.error || apiErr?.message || '未知错误'}`
      );
    }
  }, [save, discardAndReload]);

  // 另存到服务器（首次创建）
  const handleSaveAsNew = useCallback(async () => {
    const defaultName = project?.name || '未命名画布';
    const name = window.prompt('给这个画布起个名字：', defaultName);
    if (!name || !name.trim()) return;
    try {
      await createOnServer({
        name: name.trim(),
        visibility: 'private',
      });
    } catch (err) {
      const apiErr = err as ApiError;
      window.alert(
        `创建失败：${apiErr?.error || apiErr?.message || '未知错误'}`
      );
    }
  }, [project?.name, createOnServer]);

  const handleDiscardAndReload = useCallback(async () => {
    try {
      await discardAndReload();
    } catch (err) {
      const apiErr = err as ApiError;
      window.alert(
        `重载失败：${apiErr?.error || apiErr?.message || '未知错误'}`
      );
    }
  }, [discardAndReload]);

  // 过滤显示节点和边
  const filterElements = useCallback(
    (currentNodes: Node<FlowNodeData>[], currentEdges: Edge[], show: boolean) => {
      if (show) {
        return { nodes: currentNodes, edges: currentEdges };
      } else {
        // 隐藏子流程节点 (type === 'subprocess')
        const visibleNodes = currentNodes.filter((n) => n.data.type !== 'subprocess');
        const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

        const visibleEdges = currentEdges.filter(
          (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
        );

        return { nodes: visibleNodes, edges: visibleEdges };
      }
    },
    []
  );

  // 使用 useMemo 直接从 activeSheet 计算节点和边，避免状态更新延迟问题
  const { processedNodes, processedEdges } = useMemo(() => {
    if (!activeSheet) {
      return { processedNodes: [], processedEdges: [] };
    }

    // 转换节点
    const flowNodes: Node<FlowNodeData>[] = activeSheet.nodes.map((node) => {
      // 分组节点特殊处理
      if (node.type === 'group') {
        const width = node.size?.width || 200;
        const height = node.size?.height || 150;

        return {
          id: node.id,
          type: 'group',
          position: node.position,
          style: {
            ...node.style,
            width,
            height,
          },
          hidden: (node as any).hidden,
          data: {
            id: node.id,
            label: node.label || node.name,
            color: node.color || '#3b82f6',
            collapsed: (node as any).collapsed,
            expandedSize: (node as any).expandedSize,
            relatedNodeIds: node.relatedNodeIds || [],
          } as any,
          zIndex: -1,
        };
      }

      // 普通节点
      return {
        id: node.id,
        type: 'custom',
        position: node.position,
        style: node.style,
        hidden: (node as any).hidden,
        parentId: node.parentId,
        extent: node.parentId ? ('parent' as 'parent') : undefined,
        data: {
          id: node.id,
          name: node.name,
          description: (node as any).description,
          type: node.type,
          expandable: node.expandable,
          detailConfig: node.detailConfig,
          subType: node.subType,
          backgroundColor: node.backgroundColor,
          relatedNodeIds: node.relatedNodeIds,
        },
      };
    });

    // 确保分组节点在前面
    flowNodes.sort((a, b) => {
      if (a.type === 'group' && b.type !== 'group') return -1;
      if (a.type !== 'group' && b.type === 'group') return 1;
      return 0;
    });

    // 转换连接线
    const flowEdges: Edge[] = activeSheet.connectors
      .filter((conn) => {
        const sourceNode = flowNodes.find((n) => n.id === conn.sourceID);
        const targetNode = flowNodes.find((n) => n.id === conn.targetID);
        return sourceNode && targetNode;
      })
      .map((conn) => {
        let markerEnd = undefined;
        let markerStart = undefined;

        if (conn.markerEnd !== undefined && conn.markerEnd !== null) {
          markerEnd = conn.markerEnd;
        }
        if (conn.markerStart !== undefined && conn.markerStart !== null) {
          markerStart = conn.markerStart;
        }

        if (markerEnd === undefined && markerStart === undefined) {
          markerEnd = {
            type: 'arrowclosed' as const,
            color: conn.style?.stroke || '#64748b',
            width: 16,
            height: 16,
          };
        }

        let sourceHandle = conn.sourceHandle;
        if (sourceHandle === 'top') {
          sourceHandle = 'top-source';
        }

        let targetHandle = conn.targetHandle;
        if (targetHandle === 'top') {
          targetHandle = 'top-target';
        }

        return {
          id: conn.id,
          source: conn.sourceID,
          target: conn.targetID,
          sourceHandle: sourceHandle,
          targetHandle: targetHandle,
          label: conn.label,
          type: 'draggable',
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
            fillOpacity: 1,
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

    // 应用子流程过滤
    const { nodes: visibleNodes, edges: visibleEdges } = filterElements(
      flowNodes,
      flowEdges,
      showSubflows
    );

    return { processedNodes: visibleNodes, processedEdges: visibleEdges };
  }, [activeSheet, filterElements, showSubflows]);

  // 初始加载
  useEffect(() => {
    const initializeProject = async () => {
      // 如果 useMultiCanvas 已经加载了数据，直接使用
      if (!isProjectLoading && project) {
        setLoading(false);
        return;
      }

      // 如果没有项目数据，尝试加载默认数据
      if (!isProjectLoading && !project) {
        try {
          console.log('加载默认流程数据');
          const response = await fetch('/data/complete-business-flow.json');
          const flowDef: FlowDefinition = await response.json();
          loadProject(flowDef); // 会自动迁移为多画布格式
        } catch (error) {
          console.error('加载默认数据失败:', error);
          // 创建空项目
          loadProject(createEmptyProject());
        }
        setLoading(false);
      }
    };

    initializeProject();
  }, [isProjectLoading, project, loadProject]);

  // 处理画布数据变更（从 FlowCanvas 回调）
  // sheetId 由 FlowCanvas 组件传入，确保数据保存到正确的画布
  const handleDataChange = useCallback(
    (sheetId: string, nodes: Node<FlowNodeData>[], edges: Edge[]) => {
      updateSheetData(sheetId, nodes, edges);
    },
    [updateSheetData]
  );

  const toggleSubflows = () => {
    setShowSubflows(!showSubflows);
  };

  if (loading || isProjectLoading) {
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
          <h1 className="flow-title">{project?.name || '业务流程图'}</h1>
          <p className="flow-subtitle">
            {activeSheet?.name || '画布'} - 从线索管理到项目执行的完整流程
          </p>
        </div>
        <div className="flow-info">
          <span className="info-item">
            <span className="info-icon">📑</span>
            画布: {project?.sheets.length || 0}
          </span>
          <span className="info-item">
            <span className="info-icon">📊</span>
            节点: {processedNodes.length}
          </span>
          <span className="info-item">
            <span className="info-icon">🔗</span>
            连接: {processedEdges.length}
          </span>
          <SaveStatus
            canvasId={canvasId}
            hasProject={!!project}
            dirty={dirty}
            saving={saving}
            autoSaveDisabled={autoSaveDisabled}
            conflict={conflict}
            serverError={serverError}
            lastSavedAt={lastSavedAt}
            readOnly={readOnly}
            onSave={handleSave}
            onSaveAsNew={handleSaveAsNew}
            onDiscardAndReload={handleDiscardAndReload}
          />
        </div>
      </div>
      <div className="flow-content">
        {activeSheet && activeSheetId && (
          <FlowCanvas
            key={activeSheetId} // 关键：切换画布时强制重新挂载
            sheetId={activeSheetId}
            nodes={processedNodes}
            edges={processedEdges}
            showSubflows={showSubflows}
            onToggleSubflows={toggleSubflows}
            onDataChange={handleDataChange}
            getProjectData={getProjectData}
            // 多画布标签栏
            sheets={project?.sheets || []}
            activeSheetId={activeSheetId}
            onSheetChange={setActiveSheet}
            onAddSheet={addSheet}
            onDeleteSheet={deleteSheet}
            onRenameSheet={renameSheet}
            onDuplicateSheet={duplicateSheet}
          />
        )}
      </div>
    </div>
  );
}
