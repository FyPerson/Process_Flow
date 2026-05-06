import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CanvasSwitcher } from '../../components/CanvasSwitcher';
import { FlowCanvas } from '../../components/FlowCanvas';
import { OtherEditorsBadge } from '../../components/OtherEditorsBadge';
import { SaveStatus } from '../../components/SaveStatus';
import { downloadCanvasFromServer, downloadProjectAsLocal } from '../../utils/canvas-export';
import { importCanvas } from '../../api/canvases';
import { Node, Edge } from '@xyflow/react';
import {
  FlowDefinition,
  FlowNodeData,
  MultiCanvasProject,
  createEmptyProject,
} from '../../types/flow';
import { useMultiCanvas } from '../../hooks/useMultiCanvas';
import { useHeartbeat } from '../../hooks/useHeartbeat';
import { useDraftAutosave } from '../../hooks/useDraftAutosave';
import { useDraftRecovery } from '../../hooks/useDraftRecovery';
import { DraftRecoveryDialog } from '../../components/DraftRecoveryDialog';
import { useAnnotations, annotationKey } from '../../hooks/useAnnotations';
import { useAuth } from '../../auth/AuthContext';
import { canWriteCanvas } from '../../auth/canWriteCanvas';
import { canEditNodeData } from '../../auth/canEditNode';
import type { ApiError } from '../../api/canvases';
import type { AnnotationsBundle, PendingPanelTabRequest } from '../../components/NodeDetailPanel';
import './styles.css';

/** 把导入接口的 ApiError 翻译成对用户可行动的中文文案 */
function formatImportError(err: ApiError): string {
  switch (err.error) {
    case 'invalid_input': {
      const issues = err.issues ?? [];
      if (issues.length === 0) {
        return '导入失败：文件内容格式不符合画布 schema';
      }
      // 列前 5 条 issue，避免 alert 过长
      const lines = issues.slice(0, 5).map((it) => `  · ${it.path}: ${it.message}`);
      const tail = issues.length > 5 ? `\n  ...（还有 ${issues.length - 5} 条问题）` : '';
      return `导入失败：文件内容格式问题\n${lines.join('\n')}${tail}`;
    }
    case 'unauthorized':
      return '导入失败：登录已过期，请重新登录';
    case 'forbidden':
      return '导入失败：没有创建画布的权限';
    case 'network_error':
      return '导入失败：网络连接失败，请检查网络后重试';
    case 'invalid_response':
      return '导入失败：服务器返回异常，请稍后重试';
    default:
      return `导入失败：${err.error}${err.message ? `（${err.message}）` : ''}`;
  }
}

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

  const { user } = useAuth();

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
    serverVersion,
    dirty,
    saving,
    autoSaveDisabled,
    conflict,
    serverError,
    lastSavedAt,
    canvasMetaState,
    save,
    createOnServer,
    discardAndReload,
  } = useMultiCanvas({ canvasId: canvasIdFromUrl, storageKey: 'saved-flow-data' });

  // 阶段 4 P4C：心跳——只在登录 + 服务端画布场景上报
  // 游客 / 本地草稿（canvasIdFromUrl=null）模式不上报，因为没有"在编辑哪张画布"的语义
  const { otherEditors } = useHeartbeat({
    canvasId: canvasIdFromUrl,
    enabled: user !== null && canvasIdFromUrl !== null,
  });

  // 阶段 4 P4E：草稿恢复弹窗（服务端 GET draft + legacy localStorage）
  // 必须先于 useDraftAutosave 声明，因为 onLegacyLocalStorageDetected 需要 markLegacyDraft
  const handleRestoreDraft = useCallback(
    (restored: MultiCanvasProject) => {
      // 直接 loadProject 替换当前内存 project（与"导入"语义一致）
      loadProject(restored);
    },
    [loadProject],
  );
  const {
    recoveryInfo,
    handleRestore,
    handleDiscard,
    handleKeep,
    markLegacyDraft,
  } = useDraftRecovery({
    canvasId: canvasIdFromUrl,
    currentVersion: serverVersion,
    enabled: user !== null,
    onRestore: handleRestoreDraft,
  });

  // 阶段 4 P4D：草稿 30s auto-save（与主版本 PUT canvases 双轨）
  const { status: draftStatus, lastSavedAt: draftSavedAt } = useDraftAutosave({
    canvasId: canvasIdFromUrl,
    baseVersion: serverVersion,
    project: project ?? null,
    enabled: user !== null && canvasIdFromUrl !== null,
    onLegacyLocalStorageDetected: markLegacyDraft,
  });

  // P3D-2 step 2：单一口径的"画布可写"判定
  // 替代之前散乱的 useAuth().readOnly = (status==='guest')。
  // canWriteCanvas 矩阵覆盖 user + canvasMeta 全部分支（详见 src/auth/canWriteCanvas.ts）：
  // - 游客 → 不可写
  // - 登录 + 本地草稿（canvasMeta=null）→ 可写（保持当前行为兼容）
  // - admin → 全可写（含归档）
  // - 普通用户 + 归档 → 不可写（修正 bug：之前能改但保存 403）
  // - 普通用户 + 公共未归档 → 可写
  // - 普通用户 + 私有未归档 + 是 owner → 可写
  // - 普通用户 + 私有未归档 + 非 owner → 不可写（route canRead 已兜底，前端 fail-closed）
  const canvasWritable = useMemo(
    () => canWriteCanvas(canvasMetaState, user),
    [canvasMetaState, user],
  );
  // readOnly 保留作为派生量供下游使用，与 P3D-2 之前的 prop 形态兼容
  const readOnly = !canvasWritable;

  // P3E-2/3：批注数据层（hook 内部按 canvasId/userId/readReady 派生 stable key）
  // readReady 必填（codex 04-二审 medium 3）：caller 在 canvasMetaState.kind === 'server' 时才传 true
  // canvasMetaState.kind === 'loading' 时传 false → enabled=false → hook 不发请求 + 显示禁用文案
  // canvasMetaState.kind === 'local' 时传 false（本地草稿无服务端 canvasId 也走 disabled 路径）
  const annotationsReadReady = canvasMetaState.kind === 'server';
  const annotations = useAnnotations({
    canvasId,
    user,
    readReady: annotationsReadReady,
  });

  // P3E-3 pendingPanelTab：徽章点击 / 其他外部触发 → 选中节点 + 切到批注 tab
  // codex 06-取舍审 high 2：必须含 nodeId 防时序错位（NodeDetailPanel 消费时校验 selectedElement.data.id 匹配）
  // 07-代码审 high 1：徽章点击的"显式选中节点 + 打开面板"由 FlowCanvas 内部实现
  //   （需要 reactFlowInstance + setNodes/setSelectedElement/setShowPanel 闭包，BFV 拿不到）
  //   BFV 只负责 pendingPanelTab state；FlowCanvas 通过 bundle.requestPanelTab(nodeId, tab) 请求切 tab
  const [pendingPanelTab, setPendingPanelTab] = useState<PendingPanelTabRequest | null>(null);

  const requestPanelTab = useCallback((nodeId: string, tab: 'details' | 'annotations') => {
    setPendingPanelTab({ nodeId, tab });
  }, []);

  const onPendingPanelTabConsumed = useCallback(() => {
    setPendingPanelTab(null);
  }, []);

  // 批注 bundle（透传给 FlowCanvas → NodeDetailPanel）
  const annotationsBundle: AnnotationsBundle = useMemo(
    () => ({
      sheetId: activeSheetId ?? null,
      getAnnotationsForNode: (sheetId: string, nodeId: string) =>
        annotations.annotationsByNodeKey.get(annotationKey(sheetId, nodeId)) ?? [],
      // P3E-3 节点 creator id 来源：activeSheet 当前节点的 creator_id（与 useAnnotations.getNodeCreatorId 同款语义）
      // 这里复用前端已 hydrate 的 creator_id，无需额外 API
      getNodeCreatorId: (sheetId: string, nodeId: string) => {
        if (sheetId !== activeSheetId) return undefined;
        const n = activeSheet?.nodes.find((nn) => nn.id === nodeId);
        return n?.creator_id;
      },
      loading: annotations.loading,
      fetchError: annotations.error,
      enabled: annotationsReadReady && canvasId !== null && user !== null,
      isAnnotationPending: annotations.isAnnotationPending,
      onCreateAnnotation: annotations.createAnnotation,
      onResolveAnnotation: annotations.resolveAnnotation,
      onReopenAnnotation: annotations.reopenAnnotation,
      pendingPanelTab,
      onPendingPanelTabConsumed,
      requestPanelTab,
    }),
    [
      activeSheetId,
      activeSheet,
      annotations.annotationsByNodeKey,
      annotations.loading,
      annotations.error,
      annotations.isAnnotationPending,
      annotations.createAnnotation,
      annotations.resolveAnnotation,
      annotations.reopenAnnotation,
      annotationsReadReady,
      canvasId,
      user,
      pendingPanelTab,
      onPendingPanelTabConsumed,
      requestPanelTab,
    ],
  );

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
        default: {
          // exhaustive check：SaveResult 加新分支时 TS 会在这里编译报错，强制 caller 处理
          const _exhaustive: never = result;
          throw new Error(`unhandled save result: ${JSON.stringify(_exhaustive)}`);
        }
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
    if (!user) {
      window.alert('请先登录后再另存到服务器');
      return;
    }
    // [DEBUG #15] handleSaveAsNew enter
    console.log('[DEBUG#15 handleSaveAsNew] enter', { name: name.trim(), userId: user.id });
    try {
      const result = await createOnServer({
        name: name.trim(),
        visibility: 'private',
        currentUserId: user.id,
      });
      // [DEBUG #15] createOnServer 返回成功
      console.log('[DEBUG#15 handleSaveAsNew] createOnServer returned', { result });
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
      // [DEBUG #15] handleSaveAsNew catch（alert 来源）
      console.error('[DEBUG#15 handleSaveAsNew] catch (alert source)', {
        err,
        errStringified: JSON.stringify(err),
        errType: typeof err,
        errIsError: err instanceof Error,
      });
      const apiErr = err as ApiError;
      window.alert(
        `创建失败：${apiErr?.error || apiErr?.message || '未知错误'}`
      );
    }
  }, [project?.name, createOnServer, setSearchParams, user]);

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

  // 导出服务端版本（GET /api/canvases/:id/export，带 Authorization）
  const handleExportServer = useCallback(async () => {
    if (canvasId == null) return;
    try {
      await downloadCanvasFromServer(canvasId);
    } catch (err) {
      const apiErr = err as ApiError;
      window.alert(
        `导出失败：${apiErr?.error || apiErr?.message || '未知错误'}`
      );
    }
  }, [canvasId]);

  // 导出本地副本（用当前内存 project，不经过服务端）
  // 用途：冲突逃生口（服务端比本地新，要保的就是本地未保存的改动）+ canvasId=null 时的初始数据备份
  const handleExportLocal = useCallback(() => {
    const current = getProjectData();
    if (!current) return;
    downloadProjectAsLocal(current, {
      canvasId,
      // 冲突时打 conflict 标，已挂接服务端但未保存时打 local 标，未挂接画布时打 local
      suffix: conflict ? 'conflict' : 'local',
    });
  }, [getProjectData, canvasId, conflict]);

  // 导入：用户选 JSON 文件 → 上传到 /api/canvases/import → URL 跳到新 canvasId
  //
  // 关键边界（codex 八审 P2I 必修）：
  // 1) setSearchParams 是 SPA 内部路由变化，**不触发 beforeunload**；
  //    所以 dirty/saving/conflict 时必须**显式 confirm**，否则用户的未保存改动会静默丢
  // 2) 重复点击保护：用 ref 同步拦，避免文件选择器/上传过程中再次进入
  const importInFlightRef = useRef(false);
  const handleImport = useCallback(() => {
    if (importInFlightRef.current) return;

    // 1) 未保存/保存中/冲突保护：跳走前显式 confirm
    if (dirty || saving || conflict) {
      const reason = conflict
        ? '当前画布存在版本冲突未处理'
        : saving
          ? '当前画布正在保存'
          : '当前画布有未保存的改动';
      const ok = window.confirm(
        `${reason}。\n\n导入会跳到新画布，这些改动将丢失（不可撤销）。\n确定继续导入吗？`
      );
      if (!ok) return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';

    importInFlightRef.current = true;
    const release = () => { importInFlightRef.current = false; };
    // 用户取消文件选择（可能不触发 onchange）也释放锁
    input.oncancel = release;

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        release();
        return;
      }

      // 客户端先拦文件大小，避免等服务端 413
      const MAX_BYTES = 2 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        window.alert(
          `文件超过 2MB（实际 ${(file.size / 1024 / 1024).toFixed(2)}MB），无法导入。\n` +
            `如有大画布需求请联系管理员调整服务端 body limit。`
        );
        release();
        return;
      }

      // 读文件 + JSON.parse
      let text: string;
      try {
        text = await file.text();
      } catch {
        window.alert('读取文件失败，请重试');
        release();
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        window.alert('文件格式错误：不是合法的 JSON');
        release();
        return;
      }

      // 调 API（后端 Zod 会做完整校验，前端不重复跑）
      try {
        const result = await importCanvas({
          name: file.name.replace(/\.json$/i, '').slice(0, 200) || '导入的画布',
          data: data as MultiCanvasProject,
        });
        // 跳到新 canvasId（hook 会自动 reset dirty/conflict 等状态）
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
        window.alert(formatImportError(apiErr));
      } finally {
        release();
      }
    };

    document.body.appendChild(input);
    input.click();
    // 异步移除（让 onchange 有机会触发）
    setTimeout(() => document.body.removeChild(input), 0);
  }, [setSearchParams, dirty, saving, conflict]);

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

    // P3E-3 修法（部署后发现 useNodesState 锁状态问题）：
    // 不再把 unresolved 计数注入 data.__annotationUnresolvedCount —— FlowCanvas 内部
    // useNodesState(initialNodes) 会把首次值锁住，外部 props 重算不响应。
    // 改为 CustomNode/GroupNode 通过 AnnotationBadgeContext 直接读 hook 派生（响应式）。

    // 转换节点
    const flowNodes: Node<FlowNodeData>[] = activeSheet.nodes.map((node) => {
      // P3D-2 step 3 + step 5：__canEdit 派生（普通节点 + group 共用）
      // step 3：data.__canEdit 让节点组件本地判定（NodeResizer 显隐 / 双击改名 / 折叠等）
      // step 5：top-level node.draggable 让 React Flow 12 原生层拒绝拖拽，hover 也变 not-allowed
      // 两层共用同一个判定结果，避免重复算
      const nodeCanEdit = canEditNodeData(
        {
          creator_id: node.creator_id,
          __localNew: typeof node.creator_id !== 'number',
        },
        user,
        canvasWritable,
      );

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
            // 注入 readOnly 让 GroupNode 自己感知（用于 NodeResizer / 双击改名 / 折叠按钮）
            readOnly,
            // P3D-1：节点元信息透传（canEditNodeData 据 creator_id 判定可编辑）
            creator_id: node.creator_id,
            creator_username: node.creator_username,
            // P3D-1 codex 二审 Finding 1：creator_id 缺失派生 __localNew。
            // duplicateSheet 把 storage 节点 strip 后塞进 project，creator_id=undefined；
            // BFV 在 React Flow data 上派生 __localNew=true 让 canEditNodeData 立刻放行；
            // storage 不存 __localNew（migration 0002 + getCanvasFull 权威 hydrate 保证
            // 持久化节点必有 creator_id，不会误判）。
            __localNew: typeof node.creator_id !== 'number',
            // P3D-2 step 3 codex 二审必修 3：派生 __canEdit 让 NodeResizer / GroupNode
            // 折叠 / 对齐工具等"绕过中心 gate 的 direct setNodes"路径能本地判定。
            // 与 __localNew 同模式：__ 前缀 → autoSaveFilter 排除 → 不入 storage。
            __canEdit: nodeCanEdit,
            // P3C：废弃元信息透传到 data（GroupNode 用于半透明 + 角标 + tooltip）
            is_deprecated: node.is_deprecated,
            deprecated_by: node.deprecated_by,
            deprecated_at: node.deprecated_at,
            deprecated_by_username: node.deprecated_by_username,
          } as any,
          // P3D-2 step 5：节点级 draggable（React Flow 12 原生支持 top-level draggable）
          // canEdit=false 的节点（非作者 / 游客 / 归档）—— 拖拽直接被 React Flow 拒绝
          // 与中心 mutation gate 同源（中心 gate 会再拦一道，这里只是 UI 友好层 + 性能优化避免无效 change）
          draggable: nodeCanEdit,
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
          // 注入 readOnly 让 CustomNode 自己感知（用于 NodeResizer / 双击改名）
          readOnly,
          // P3D-1：节点元信息透传（canEditNodeData 据 creator_id 判定可编辑）
          creator_id: node.creator_id,
          creator_username: node.creator_username,
          // P3D-1 codex 二审 Finding 1：creator_id 缺失派生 __localNew（同分组节点说明）
          __localNew: typeof node.creator_id !== 'number',
          // P3D-2 step 3 codex 二审必修 3：派生 __canEdit（同分组节点说明）
          __canEdit: nodeCanEdit,
          // P3C：废弃元信息透传到 data（CustomNode 用于半透明 + 角标 + tooltip）
          is_deprecated: node.is_deprecated,
          deprecated_by: node.deprecated_by,
          deprecated_at: node.deprecated_at,
          deprecated_by_username: node.deprecated_by_username,
        },
        // P3D-2 step 5：节点级 draggable（同分组节点说明）
        // 与中心 mutation gate 同源；这里是 React Flow 12 原生层 + UI 友好层
        draggable: nodeCanEdit,
      };
    });

    // 确保分组节点在前面
    flowNodes.sort((a, b) => {
      if (a.type === 'group' && b.type !== 'group') return -1;
      if (a.type !== 'group' && b.type === 'group') return 1;
      return 0;
    });

    // P3C 取舍 4 codex 必修 1+2：边的废弃视觉**不在这里构造**。
    // 原因：
    // - FlowCanvas 用 useEdgesState(initialEdges) 仅初始化，之后内部 state 不响应
    //   父组件 props 变化 → 标废弃后 processedEdges 重算无效
    // - 若把 hasDeprecatedEndpoint 写入 edge.data，会被 convertEdgesToStorage 持久化
    // 改为 DraggableEdge 内用 useStore 订阅 nodeLookup 派生（响应式订阅，
    // 节点 data.is_deprecated 变化会触发 selector 重跑 + edge re-render）。
    // 同理 animated 也不能在这里固定（也会被 useEdgesState 锁住），DraggableEdge 内部处理。
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
            // 注入 readOnly 让 DraggableEdge 自己感知（拖动 offset 时拦截）
            readOnly,
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
  }, [activeSheet, activeSheetId, filterElements, showSubflows, readOnly, user, canvasWritable]);

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

      // P3F-3 偿还债务 #17：登录用户全新空场景 → 加载空草稿 + 空状态引导
      // 仅游客 / 未登录态保留默认 demo 数据加载（首次访问展示用）
      //
      // 鉴权竞态：codex 03 一审 high 1 关注"user === null 是否覆盖鉴权未完成态"。
      // 已确认无竞态：[App.tsx](../../App.tsx) AppShell 在 status === 'loading' 时显示 splash，
      // 仅在 'authenticated' / 'guest' 时才挂载 BFV。所以本 useEffect 跑时 user 已确定：
      //   - status='authenticated' → user 是 UserPublic（非 null）
      //   - status='guest' → user === null
      //   - status='unauthenticated' → 走 LoginPage 路径，BFV 不渲染
      // 因此 user !== null 等价于"已登录用户"，无误判风险。
      if (user !== null) {
        // 系统自动建的空草稿不该标 dirty（codex 03 一审 medium 1）
        loadProject(createEmptyProject(), { markDirty: false });
        setLoading(false);
        return;
      }

      // 游客 / 未登录态：加载默认 demo 流程（演示价值；登录用户看到 demo 会困惑）
      // demo 数据是系统展示，也不该标 dirty
      try {
        const response = await fetch('/data/complete-business-flow.json');
        const flowDef: FlowDefinition = await response.json();
        loadProject(flowDef, { markDirty: false });
      } catch (error) {
        console.error('加载默认数据失败:', error);
        loadProject(createEmptyProject(), { markDirty: false });
      }
      setLoading(false);
    };

    initializeProject();
  }, [isProjectLoading, project, canvasIdFromUrl, serverError, loadProject, user]);

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
      {recoveryInfo && (
        <DraftRecoveryDialog
          info={recoveryInfo}
          onRestore={handleRestore}
          onDiscard={handleDiscard}
          onKeep={handleKeep}
        />
      )}
      <div className="flow-header">
        <div className="header-left">
          <h1 className="flow-title">{project?.name || '业务流程图'}</h1>
          <p className="flow-subtitle">
            {activeSheet?.name || '画布'} - 从线索管理到项目执行的完整流程
          </p>
        </div>
        <div className="flow-header-center">
          <CanvasSwitcher
            currentCanvasId={canvasIdFromUrl}
            dirty={dirty}
            saving={saving}
          />
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
          <OtherEditorsBadge editors={otherEditors} />
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
            draftStatus={draftStatus}
            draftSavedAt={draftSavedAt}
            onSave={handleSave}
            onSaveAsNew={handleSaveAsNew}
            onDiscardAndReload={handleDiscardAndReload}
            onExportServer={handleExportServer}
            onExportLocal={handleExportLocal}
          />
        </div>
      </div>
      <div className="flow-content">
        {/* 空状态引导卡片（P3F-3 偿还债务 #17）—— 仅登录用户在本地草稿且无节点时显示 */}
        {canvasMetaState.kind === 'local' &&
          user !== null &&
          (activeSheet?.nodes.length ?? 0) === 0 && (
            <div className="bfv-empty-guide">
              <div className="bfv-empty-guide-card">
                <h3>👋 你正在本地草稿模式</h3>
                <p>
                  你的修改只保存在本机浏览器，不会被其他人看到。要协作编辑或加批注，请：
                </p>
                <ul>
                  <li>从顶栏 <strong>📁 切换画布</strong> 选择一个已有画布，或</li>
                  <li>
                    在右上角 <strong>另存为新画布</strong> 把当前草稿保存到服务器
                  </li>
                </ul>
              </div>
            </div>
          )}
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
            user={user}
            onImport={readOnly ? undefined : handleImport}
            // 多画布标签栏 —— readOnly 时所有 mutation 走 no-op，避免游客误以为能改
            sheets={project?.sheets || []}
            activeSheetId={activeSheetId}
            onSheetChange={setActiveSheet}
            onAddSheet={readOnly ? () => undefined : addSheet}
            onDeleteSheet={readOnly ? () => undefined : deleteSheet}
            onRenameSheet={readOnly ? () => undefined : renameSheet}
            onDuplicateSheet={readOnly ? undefined : duplicateSheet}
            annotationsBundle={annotationsBundle}
          />
        )}
      </div>
    </div>
  );
}
