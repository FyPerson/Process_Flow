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
    loadRevision,
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
      switch (result.status) {
        case 'saved':
          // 顶栏徽标会显示"已保存（刚刚）"
          break;
        case 'conflict': {
          const ok = window.confirm(
            `检测到服务端有更新（v${result.currentVersion}）。\n\n` +
              `选择"确定"丢弃本地改动并重载服务端版本；\n` +
              `选择"取消"保留本地改动（稍后可手动处理）。`
          );
          if (ok) {
            await discardAndReload();
          }
          break;
        }
        case 'skipped':
          // 已有保存在飞行中（自动保存 timer 撞手动点击）；顶栏正在显示"保存中…"
          break;
        case 'discarded':
          // 用户已切到别的 canvas，旧请求结果丢弃；UI 已经在新 canvas 上
          break;
      }
    } catch (err) {
      const apiErr = err as ApiError;
      window.alert(
        `保存失败：${apiErr?.error || apiErr?.message || '未知错误'}`
      );
    }
  }, [save, discardAndReload]);

  // 另存到服务器（首次创建）—— 成功后用返回的 id 显式写 URL（单向同步）
  const handleSaveAsNew = useCallback(async () => {
    const defaultName = project?.name || '未命名画布';
    const name = window.prompt('给这个画布起个名字：', defaultName);
    if (!name || !name.trim()) return;
    try {
      const result = await createOnServer({
        name: name.trim(),
        visibility: 'private',
      });
      // discarded=true 说明创建成功但用户已切到别的 canvas（极端竞态）
      // 不要让 URL 飞到这个新建 id，否则会把用户从他正在看的 canvas 拽走
      if (result.discarded) {
        console.warn(`[saveAsNew] created canvas ${result.id} but user has navigated away; skip URL update`);
        return;
      }
      // URL 写在创建回调里，避免之前"hook canvasId 变 → URL 变 → fetch effect 重跑覆盖内存"的循环
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('canvasId', String(result.id));
          return next;
        },
        { replace: true }
      );
    } catch (err) {
      const apiErr = err as ApiError;
      window.alert(
        `创建失败：${apiErr?.error || apiErr?.message || '未知错误'}`
      );
    }
  }, [project?.name, createOnServer, setSearchParams]);

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
  // 默认数据只用于"无 URL canvasId 且 hook 也没拉到本地数据"的场景；
  // 如果 URL 指定了 canvasId（哪怕拉失败），不要静默回退到默认流程把错误掩盖掉
  useEffect(() => {
    const initializeProject = async () => {
      if (isProjectLoading) return;

      if (project) {
        setLoading(false);
        return;
      }

      // canvasId 存在 → fetch 失败也应该让用户看到错误，不能用默认数据糊弄
      if (canvasIdFromUrl != null || serverError) {
        setLoading(false);
        return;
      }

      // 真正的"全新空场景"才加载默认流程
      try {
        console.log('加载默认流程数据');
        const response = await fetch('/data/complete-business-flow.json');
        const flowDef: FlowDefinition = await response.json();
        loadProject(flowDef);
      } catch (error) {
        console.error('加载默认数据失败:', error);
        loadProject(createEmptyProject());
      }
      setLoading(false);
    };

    initializeProject();
  }, [isProjectLoading, project, canvasIdFromUrl, serverError, loadProject]);

  // 处理画布数据变更（从 FlowCanvas 回调）
  // sheetId 由 FlowCanvas 组件传入，确保数据保存到正确的画布
  // readOnly（游客）下吞掉所有 mutation —— 避免 dirty/autosave/beforeunload 被误触发
  const handleDataChange = useCallback(
    (sheetId: string, nodes: Node<FlowNodeData>[], edges: Edge[]) => {
      if (readOnly) return;
      updateSheetData(sheetId, nodes, edges);
    },
    [readOnly, updateSheetData]
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

  // canvasId 指定但拉失败 / 拉到 null：显式错误页，不静默回退到默认流程
  if (canvasIdFromUrl != null && (serverError || !project)) {
    return (
      <div className="flow-visualization-loading">
        <div className="loading-spinner" style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 16, color: '#fecaca', marginBottom: 12 }}>
            画布加载失败
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
            {serverError?.error === 'not_found'
              ? `画布 #${canvasIdFromUrl} 不存在或已删除`
              : serverError?.error === 'forbidden'
                ? '没有权限查看此画布'
                : `${serverError?.error || '未知错误'}${serverError?.message ? `：${serverError.message}` : ''}`}
          </div>
          <button
            type="button"
            onClick={() => {
              setSearchParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.delete('canvasId');
                  return next;
                },
                { replace: true }
              );
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            返回首页
          </button>
        </div>
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
            // 关键：切换画布或 hook 整体替换 project（fetch / discardAndReload / loadProject）
            // 时强制重新挂载，避免 React Flow 内部 useNodesState 缓存旧节点
            key={`${canvasId ?? 'local'}:${activeSheetId}:${loadRevision}`}
            sheetId={activeSheetId}
            nodes={processedNodes}
            edges={processedEdges}
            showSubflows={showSubflows}
            onToggleSubflows={toggleSubflows}
            onDataChange={handleDataChange}
            getProjectData={getProjectData}
            readOnly={readOnly}
            // 多画布标签栏 —— readOnly 时所有 mutation 走 no-op，避免游客误以为能改
            sheets={project?.sheets || []}
            activeSheetId={activeSheetId}
            onSheetChange={setActiveSheet}
            onAddSheet={readOnly ? () => undefined : addSheet}
            onDeleteSheet={readOnly ? () => undefined : deleteSheet}
            onRenameSheet={readOnly ? () => undefined : renameSheet}
            onDuplicateSheet={readOnly ? undefined : duplicateSheet}
          />
        )}
      </div>
    </div>
  );
}
