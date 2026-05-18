import { useMemo, useState, useEffect, memo } from 'react';
import { Edge, Node, useReactFlow } from '@xyflow/react';
import { FlowNodeData, Screenshot, NodeUpdateParams, EdgeUpdateParams, GroupNodeData } from '../../types/flow';
import type { UserPublic } from '../../auth/api';
import type { Annotation, ApiError, CreateAnnotationInput } from '../../api/annotations';
import { canEditNodeData } from '../../auth/canEditNode';
import { formatCreatorName } from '../../auth/formatCreatorName';
import { ScreenshotViewer } from '../ScreenshotViewer';
import { PageSelector, PageOption } from '../PageSelector';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { EdgePropertiesPanel } from './EdgePropertiesPanel';
import { GroupPropertiesPanel, GroupUpdateParams } from './GroupPropertiesPanel';
import { TextNodePropertiesPanel } from './TextNodePropertiesPanel';
import { DeprecateNodeSection } from './DeprecateNodeSection';
import { AnnotationPanel } from './AnnotationPanel';
import './styles.css?v=2.0';

/** P3E-3 顶层 tab：节点选中时切换"详情"和"批注"。edge 选中无 tab */
export type PanelTab = 'details' | 'annotations';

/** 批注 tab 切换请求（codex 06-取舍审 high 2：必须含 nodeId 防时序错位） */
export interface PendingPanelTabRequest {
  nodeId: string;
  tab: PanelTab;
}

// Define the wrapper type passed from FlowCanvas
export type SelectedElement =
  | { type: 'node'; data: FlowNodeData; node?: Node<FlowNodeData> }
  | { type: 'edge'; data: Edge };

interface NodeDetailPanelProps {
  selectedElement: SelectedElement | null;
  visible: boolean;
  onClose: () => void;
  onNodeChange: (id: string, updates: NodeUpdateParams) => void;
  onEdgeChange: (id: string, updates: EdgeUpdateParams) => void;
  // 分组相关
  onGroupChange?: (id: string, updates: GroupUpdateParams) => void;
  onUngroup?: (groupId: string) => void;
  onRemoveFromGroup?: (nodeId: string) => void;
  allNodes?: Node<FlowNodeData>[];
  /** 画布级只读（游客 / 归档 / 无写权限）：所有 onXxxChange 回调被吞掉；UI 仍可点击但改动不持久化 */
  readOnly?: boolean;
  /** P3D-2 step 4：当前登录用户。给节点级 canEdit 判定用 —— 中心 gate 同源。
   *  null = 游客（与 readOnly=true 协同）。必传，不允许 default null（与 FlowCanvas user 同款约定）。
   *
   *  P3D-2 step 4 codex 一审 L1 约定：上游必须保证 user=null 时 readOnly=true。
   *  当前实现：BFV 通过 canWriteCanvas(canvasMetaState, user) 派生 readOnly = !canvasWritable，
   *  user=null 时 canWriteCanvas 第一行 if (!user) return false → readOnly=true，约定成立。
   *  如果未来上游加新调用点，必须保持此约定，否则蓝色"非作者"横幅会替代黄色"只读"横幅，体验错乱。 */
  user: UserPublic | null;

  // ===== P3E-3 批注相关 props（打包成 1 个 bundle 对象，FlowCanvas 透传不臃肿）=====
  /** 批注数据层 bundle（由 BFV 顶层接 useAnnotations + 派生）；
   *  null = 不渲染批注 tab（理论上 P3E-3 总是传非 null；fail-closed 防御） */
  annotationsBundle: AnnotationsBundle | null;
}

/** P3E-3 批注 bundle：把 useAnnotations 派生数据 + actions + tab 控制打包传递 */
export interface AnnotationsBundle {
  /** 当前选中节点所在 sheet 的 id（与 nodeId 复合定位批注） */
  sheetId: string | null;
  /** 单节点批注查找（按 sheetId+nodeId 复合 key 派生）；nodeCreatorId 同样按 nodeId 查 nodes_meta */
  getAnnotationsForNode: (sheetId: string, nodeId: string) => Annotation[];
  getNodeCreatorId: (sheetId: string, nodeId: string) => number | undefined;
  /** 整画布批注是否在加载（hook.loading） */
  loading: boolean;
  /** 批注 fetch 错误（hook.error），仅展示 */
  fetchError: ApiError | null;
  /** 批注数据层是否可用（canvasId 非空 + user 非空 + readReady） */
  enabled: boolean;
  /** 同 id 是否在 mutation 飞行（hook.isAnnotationPending） */
  isAnnotationPending: (id: number) => boolean;
  /** 创建批注（hook.createAnnotation）；失败 throw ApiError */
  onCreateAnnotation: (input: CreateAnnotationInput) => Promise<Annotation>;
  /** 标记 resolved；失败 throw ApiError */
  onResolveAnnotation: (id: number) => Promise<void>;
  /** 重开；失败 throw ApiError */
  onReopenAnnotation: (id: number) => Promise<void>;
  /** 外部请求切换 tab（如徽章点击）；含 nodeId 用于消费时校验 */
  pendingPanelTab: PendingPanelTabRequest | null;
  /** pendingPanelTab 被消费后回调清零（避免重复触发） */
  onPendingPanelTabConsumed: () => void;
  /** 请求切换 tab（FlowCanvas 内部徽章点击 → 选中节点 + 打开面板后调）；
   *  设计上等价于 BFV setPendingPanelTab；放进 bundle 让 FlowCanvas 内部能调 */
  requestPanelTab: (nodeId: string, tab: PanelTab) => void;
}

export const NodeDetailPanel = memo(function NodeDetailPanel({
  selectedElement,
  visible,
  onClose,
  onNodeChange,
  onEdgeChange,
  onGroupChange,
  onUngroup,
  onRemoveFromGroup,
  allNodes = [],
  readOnly = false,
  user,
  annotationsBundle,
}: NodeDetailPanelProps) {
  // P3D-2 step 4：节点级编辑权限判定
  // - canEdit = false 时面板顶部加横幅 + 输入 disabled，但 DeprecateNodeSection 仍可用（公开权限）
  // - canEdit = true 时按现有逻辑走
  // - 边没有节点级权限语义（边操作走 canvasWritable 兜底，一审 M2 显式锁定）
  // - canvasWritable = !readOnly（与 FlowCanvas 同口径，单一来源）
  const canvasWritable = !readOnly;
  const canEdit = useMemo(() => {
    // 一审 M2：边没有 creator 语义，直接 fallback 到 canvasWritable —— 防止 EdgePropertiesPanel
    // 因当前选中节点的 creator 不是自己而被误禁用
    if (!selectedElement || selectedElement.type !== 'node') return canvasWritable;
    return canEditNodeData(selectedElement.data, user, canvasWritable);
  }, [selectedElement, user, canvasWritable]);
  // P3D-2 step 4：safe* 回调按"可写性"分三层：
  // - 普通编辑（NodePropertiesPanel / GroupPropertiesPanel 普通字段 / onRemoveFromGroup）：用 canEdit
  //   非可编辑节点 → no-op（与中心 mutation gate 同口径）
  // - 边操作（onEdgeChange）：边没有 creator 语义，用 canvasWritable
  // - 解散分组（onUngroup）：admin-only（数据层 useFlowOperations.onUngroup 也加 admin gate；这里 UI 兜底）
  // - 标废弃（DeprecateNodeSection 用的回调）：P3C 公开权限——任何登录用户对任何节点可标。
  //   走 canvasWritable 不走 canEdit；中心层 isPublicDeprecateUpdate 配合放行。
  //   一审 H1：之前 DeprecateNodeSection 错误地接收了 safeOnNodeChange（canEdit no-op），
  //   导致非作者点标废弃被详情面板层提前吞掉，破坏 P3C 公开权限。
  // 关键：safe* 必须返回 no-op 函数而非 undefined ——
  // 否则 GroupPropertiesPanel 的渲染条件 `&& onGroupChange && onUngroup && onRemoveFromGroup`
  // 会让无权用户看不到分组的子节点列表（七审 #3 回归修复同思路）
  const isAdmin = !!user && user.role === 'admin';
  const safeOnNodeChange = canEdit ? onNodeChange : (() => undefined);
  // 标废弃专用回调（公开权限，不走 canEdit）—— 一审 H1 修复
  const safeOnDeprecateChange = canvasWritable ? onNodeChange : (() => undefined);
  // 边操作不参与节点级权限（边的 creator 暂未跟踪），按 canvasWritable 即可
  // 一审 M2：edge fallback 已通过 selectedElement.type !== 'node' 时 canEdit = canvasWritable 实现
  const safeOnEdgeChange = canvasWritable ? onEdgeChange : (() => undefined);
  const safeOnGroupChange = (canEdit
    ? onGroupChange
    : (() => undefined)) as (id: string, updates: GroupUpdateParams) => void;
  // 解散分组仅 admin（与 group 面板按钮 disabled 同口径；数据层 useFlowOperations.onUngroup 兜底）
  const safeOnUngroup = isAdmin ? onUngroup : (() => undefined);
  const safeOnRemoveFromGroup = canEdit ? onRemoveFromGroup : (() => undefined);

  // P3E-3：顶层 tab 状态（仅 isNode 有意义；edge 不显示 tab）
  const [panelTab, setPanelTab] = useState<PanelTab>('details');

  // 切节点时重置 tab 到 details（避免上一个节点的 tab 状态泄露给新节点）
  // P3D-2 step 4 同款时序：根据 selectedElement.data.id 变化重置
  const selectedNodeIdForTabReset =
    selectedElement?.type === 'node' ? selectedElement.data.id : null;
  useEffect(() => {
    setPanelTab('details');
  }, [selectedNodeIdForTabReset]);

  // 消费 pendingPanelTab：codex 06-取舍审 high 2 必须校验 nodeId 匹配再切
  // codex 07-代码审 medium 1：增加过期清理 —— 但只清"明显过期"场景：
  //   - selectedElement 为 edge → 用户主动选边，pending 切 tab 已无意义，清
  //   - selectedElement 为 null → 面板已关闭，pending 不再适用，清
  //   - selectedElement 为不同 nodeId 节点 → **不清**：可能是 React 18 跨组件 setState
  //     批量未完成的中间态（FlowCanvas setSelectedElement + BFV setPendingPanelTab 在不同
  //     组件树）；新 nodeId 的 pending 会覆盖旧的，旧 pending 留着不消费即可（tab 不切）
  //   - nodeId 匹配 → 消费 + 清
  const pendingPanelTab = annotationsBundle?.pendingPanelTab ?? null;
  const onPendingPanelTabConsumed = annotationsBundle?.onPendingPanelTabConsumed;
  useEffect(() => {
    if (!pendingPanelTab) return;
    // 选中的不是节点（edge / null）→ 立即清零
    if (!selectedElement || selectedElement.type !== 'node') {
      onPendingPanelTabConsumed?.();
      return;
    }
    // nodeId 匹配 → 消费 + 清零
    if (selectedElement.data.id === pendingPanelTab.nodeId) {
      setPanelTab(pendingPanelTab.tab);
      onPendingPanelTabConsumed?.();
    }
    // nodeId 不匹配 → 等下次 selectedElement 更新（同步 setState 完成后）
  }, [pendingPanelTab, selectedElement, onPendingPanelTabConsumed]);

  // Node Extras to be lifted here because of PageSelector
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);

  const { setCenter, getZoom, getEdges } = useReactFlow();

  // P3C：当前选中节点关联的连线数（标废弃二次确认 dialog 显示影响范围）
  // 不依赖 edges 引用本身（React Flow 内部 mutation 可能不触发 re-render），
  // 改为依赖 selectedElement.data.id —— selectedElement 变化时重新计算即可。
  const selectedNodeId =
    selectedElement?.type === 'node' ? selectedElement.data.id : null;
  const deprecateEdgeCount = useMemo(() => {
    if (!selectedNodeId) return { fromOrTo: 0 };
    const count = getEdges().filter(
      (e) => e.source === selectedNodeId || e.target === selectedNodeId
    ).length;
    return { fromOrTo: count };
  }, [selectedNodeId, getEdges]);

  // UI State
  const [viewingScreenshot, setViewingScreenshot] = useState<Screenshot | null>(null);
  const [showPageSelector, setShowPageSelector] = useState(false);

  // Synchronization for screenshots which might be needed for PageSelector context
  useEffect(() => {
    if (!selectedElement || selectedElement.type !== 'node') return;

    const data = selectedElement.data;
    const screenshots = data.detailConfig?.screenshots ||
      (Array.isArray(data.screenshots) ? data.screenshots as Screenshot[] : []);
    setScreenshots(screenshots);
  }, [selectedElement]);

  // ---------------- UI Helpers ----------------
  const handlePageSelected = (page: PageOption) => {
    // Only valid if node selected
    if (!selectedElement || selectedElement.type !== 'node') return;

    const newScreenshot: Screenshot = {
      id: `screenshot_${Date.now()}`,
      title: page.title,
      url: page.url,
      pageName: page.title,
      description: page.description,
      isComponent: true,
      locked: true,
      componentType: 'page'
    };

    const newScreenshots = [...screenshots, newScreenshot];
    setScreenshots(newScreenshots);
    // Directly commit changes to node from here? 
    // We need to call onNodeChange.

    // We can reuse the logic, but since we are refactoring, let's keep it simple.
    // Ideally NodePropertiesPanel should handle this, BUT PageSelector is global-ish (modal-like).
    // Let's pass the update down or handle it here. 

    // Construct updates manually:
    const updates: NodeUpdateParams = {
      data: {
        screenshots: newScreenshots,
        detailConfig: {
          ...(selectedElement.data.detailConfig || {}),
          screenshots: newScreenshots
        }
      }
    };
    safeOnNodeChange(selectedElement.data.id, updates);

    setShowPageSelector(false);
  };

  if (!selectedElement) {
    if (viewingScreenshot) {
      return (
        <ScreenshotViewer
          screenshot={viewingScreenshot}
          visible={!!viewingScreenshot}
          onClose={() => setViewingScreenshot(null)}
        />
      );
    }
    return null;
  }

  const isNode = selectedElement.type === 'node';
  const isGroupNode = isNode && selectedElement.node?.type === 'group';
  // 文本框节点（MVP v1.20.0）：纯展示，仅显示精简面板，不显示废弃/批注
  const isTextNode =
    isNode &&
    (selectedElement.node?.type === 'text' || selectedElement.data.type === 'text');

  // 获取分组的子节点
  const childNodes = isGroupNode
    ? allNodes.filter((n) => n.parentId === selectedElement.data.id)
    : [];

  // 获取面板标题
  const getPanelTitle = () => {
    if (isGroupNode) return '分组属性';
    if (isTextNode) return '文本框';
    if (isNode) return '节点属性';
    return '连线属性';
  };

  return (
    <>
      <ScreenshotViewer
        screenshot={viewingScreenshot}
        visible={!!viewingScreenshot}
        onClose={() => setViewingScreenshot(null)}
      />

      {showPageSelector && (
        <PageSelector
          onSelect={handlePageSelected}
          onClose={() => setShowPageSelector(false)}
          visible={showPageSelector}
        />
      )}

      <div className={`detail-panel ${visible ? 'visible' : ''}`}>
        <div className="panel-header">
          <h3 className="panel-title">{getPanelTitle()}</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            {isNode && (
              <button
                className="locate-btn"
                onClick={() => {
                  if (selectedElement.node) {
                    const { position, measured } = selectedElement.node;
                    const width = measured?.width || 0;
                    const height = measured?.height || 0;
                    const x = position.x + width / 2;
                    const y = position.y + height / 2;
                    const zoom = getZoom();
                    setCenter(x, y, { zoom, duration: 1000 });
                  }
                }}
                title="定位到当前节点"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 2V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 19V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M19 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="panel-content">
          {/* P3D-2 step 4：节点级权限横幅（保留在所有 tab 上方，仅 isNode 时显示） */}
          {readOnly && (
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(245, 158, 11, 0.1)',
                borderBottom: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#fbbf24',
                fontSize: 12,
              }}
            >
              ⚠ 只读模式：所有修改不会被保存
            </div>
          )}
          {!readOnly && !canEdit && isNode && selectedElement.type === 'node' && (
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(59, 130, 246, 0.08)',
                borderBottom: '1px solid rgba(59, 130, 246, 0.25)',
                color: '#93c5fd',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              此节点由 <strong>{formatCreatorName(selectedElement.data)}</strong> 创建，仅作者或管理员可编辑。
              {!isGroupNode && '如需标记废弃请使用下方按钮。'}
            </div>
          )}

          {/* P3E-3：顶层 tab 切换（仅节点；edge 不显示 tab，保持原渲染流）
              文本框节点不显示批注 tab——纯展示元素，无批注语义 */}
          {isNode && !isTextNode && selectedElement.type === 'node' && annotationsBundle && (() => {
            const sheetIdForTab = annotationsBundle.sheetId;
            const annotationsForTabBadge = sheetIdForTab
              ? annotationsBundle.getAnnotationsForNode(sheetIdForTab, selectedElement.data.id)
              : [];
            const unresolvedForTabBadge = annotationsForTabBadge.filter((a) => a.status === 'unresolved').length;
            return (
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  padding: '8px 16px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {(['details', 'annotations'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setPanelTab(tab)}
                    style={{
                      padding: '6px 12px',
                      background: panelTab === tab ? 'rgba(37, 99, 235, 0.10)' : 'transparent',
                      border: 'none',
                      borderBottom:
                        panelTab === tab ? '2px solid #2563eb' : '2px solid transparent',
                      color: panelTab === tab ? '#1d4ed8' : '#64748b',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontWeight: panelTab === tab ? 600 : 400,
                    }}
                  >
                    {tab === 'details' ? '详情' : '批注'}
                    {tab === 'annotations' && unresolvedForTabBadge > 0 && (
                      <span
                        style={{
                          marginLeft: 6,
                          padding: '0 6px',
                          fontSize: 10,
                          background: 'rgba(59, 130, 246, 0.4)',
                          color: '#fff',
                          borderRadius: 8,
                          minWidth: 16,
                          display: 'inline-block',
                          lineHeight: '14px',
                        }}
                      >
                        {unresolvedForTabBadge > 99 ? '99+' : unresolvedForTabBadge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* === 详情 tab === */}
          {panelTab === 'details' && (
            <>
              {/* Group Node Content */}
              {isGroupNode && selectedElement.type === 'node' && selectedElement.node && safeOnGroupChange && safeOnUngroup && safeOnRemoveFromGroup && (
                <GroupPropertiesPanel
                  groupData={selectedElement.node.data as unknown as GroupNodeData}
                  groupNode={selectedElement.node}
                  childNodes={childNodes}
                  onGroupChange={safeOnGroupChange}
                  onUngroup={safeOnUngroup}
                  onRemoveFromGroup={safeOnRemoveFromGroup}
                  allNodes={allNodes}
                  canEdit={canEdit}
                  isAdmin={isAdmin}
                />
              )}

              {/* 文本框节点（MVP v1.20.0）：精简面板 / 不显示废弃 */}
              {isTextNode && selectedElement.type === 'node' && (
                <TextNodePropertiesPanel
                  selectedElement={selectedElement}
                  onNodeChange={safeOnNodeChange}
                  canEdit={canEdit}
                />
              )}

              {/* Regular Node Content */}
              {isNode && !isGroupNode && !isTextNode && selectedElement.type === 'node' && (
                <NodePropertiesPanel
                  selectedElement={selectedElement}
                  onNodeChange={safeOnNodeChange}
                  onViewScreenshot={setViewingScreenshot}
                  onOpenPageSelector={() => setShowPageSelector(true)}
                  screenshots={screenshots}
                  setScreenshots={setScreenshots}
                  allNodes={allNodes}
                  canEdit={canEdit}
                />
              )}

              {/* P3C 标废弃区块（节点专属；details tab 内显示）
                  一审 H1：必须走 safeOnDeprecateChange（仅 canvasWritable gate），不走 safeOnNodeChange（canEdit gate）
                  M1: 此区块在 NodeDetailPanel 顶层，不在 NodePropertiesPanel 的 fieldset 内部，所以浏览器原生 disabled 不影响
                  文本框（isTextNode）不显示废弃区块——纯展示元素，无废弃语义 */}
              {isNode && !isTextNode && selectedElement.type === 'node' && (
                <DeprecateNodeSection
                  nodeData={selectedElement.data}
                  allNodes={allNodes}
                  edgeCount={deprecateEdgeCount}
                  onNodeChange={safeOnDeprecateChange}
                  readOnly={readOnly}
                />
              )}
            </>
          )}

          {/* === 批注 tab === （文本框不渲染） */}
          {panelTab === 'annotations'
            && isNode
            && !isTextNode
            && selectedElement.type === 'node'
            && annotationsBundle
            && annotationsBundle.sheetId && (
              <AnnotationPanel
                sheetId={annotationsBundle.sheetId}
                nodeId={selectedElement.data.id}
                annotations={annotationsBundle.getAnnotationsForNode(
                  annotationsBundle.sheetId,
                  selectedElement.data.id,
                )}
                nodeCreatorId={annotationsBundle.getNodeCreatorId(
                  annotationsBundle.sheetId,
                  selectedElement.data.id,
                )}
                user={user}
                loading={annotationsBundle.loading}
                fetchError={annotationsBundle.fetchError}
                enabled={annotationsBundle.enabled}
                isAnnotationPending={annotationsBundle.isAnnotationPending}
                onCreate={annotationsBundle.onCreateAnnotation}
                onResolve={annotationsBundle.onResolveAnnotation}
                onReopen={annotationsBundle.onReopenAnnotation}
              />
            )}

          {/* Edge Content（不受 tab 影响） */}
          {!isNode && selectedElement.type === 'edge' && (
            <EdgePropertiesPanel
              selectedElement={selectedElement}
              onEdgeChange={safeOnEdgeChange}
            />
          )}

          {!isNode && selectedElement.type !== 'edge' && (
            // Should not happen, but as legacy fallback
            <div className="section">
              <div className="empty-hint" style={{ padding: '24px' }}>
                <div className="hint-text">请选择一个节点或连线</div>
              </div>
            </div>
          )}

          {!isNode && selectedElement.type === 'edge' && (
            // Additional hints for edges
            <div className="section">
              <div className="empty-hint" style={{ padding: '24px' }}>
                <div className="hint-text">提示：您可以拖动连线上的圆点来调整路径。</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
});
