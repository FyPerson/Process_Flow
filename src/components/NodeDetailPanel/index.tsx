import { useMemo, useState, useEffect, memo } from 'react';
import { Edge, Node, useReactFlow } from '@xyflow/react';
import { FlowNodeData, Screenshot, NodeUpdateParams, EdgeUpdateParams, GroupNodeData } from '../../types/flow';
import type { UserPublic } from '../../auth/api';
import { canEditNodeData } from '../../auth/canEditNode';
import { formatCreatorName } from '../../auth/formatCreatorName';
import { ScreenshotViewer } from '../ScreenshotViewer';
import { PageSelector, PageOption } from '../PageSelector';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { EdgePropertiesPanel } from './EdgePropertiesPanel';
import { GroupPropertiesPanel, GroupUpdateParams } from './GroupPropertiesPanel';
import { DeprecateNodeSection } from './DeprecateNodeSection';
import './styles.css?v=2.0';

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

  // 获取分组的子节点
  const childNodes = isGroupNode
    ? allNodes.filter((n) => n.parentId === selectedElement.data.id)
    : [];

  // 获取面板标题
  const getPanelTitle = () => {
    if (isGroupNode) return '分组属性';
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
          {/* P3D-2 step 4：节点级权限横幅
              - 画布只读 → 黄色"只读"横幅（保留原行为）
              - 画布可写但当前用户不可编辑此节点 → 蓝色"非作者"横幅
              - 否则不显示横幅
              注：DeprecateNodeSection 不受 canEdit 拦（公开权限） */}
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

          {/* Regular Node Content */}
          {isNode && !isGroupNode && selectedElement.type === 'node' && (
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

          {/* Edge Content */}
          {!isNode && selectedElement.type === 'edge' && (
            <EdgePropertiesPanel
              selectedElement={selectedElement}
              onEdgeChange={safeOnEdgeChange}
            />
          )}

          {/* P3C 标废弃区块（节点专属，包含 group + 普通节点）
              一审 H1：必须走 safeOnDeprecateChange（仅 canvasWritable gate），不走 safeOnNodeChange（canEdit gate）
              否则非作者点标废弃会被详情面板层 no-op 吞掉，破坏 P3C 公开权限
              M1: 此区块在 NodeDetailPanel 顶层，不在 NodePropertiesPanel 的 fieldset 内部，所以浏览器原生 disabled 不影响 */}
          {isNode && selectedElement.type === 'node' && (
            <DeprecateNodeSection
              nodeData={selectedElement.data}
              allNodes={allNodes}
              edgeCount={deprecateEdgeCount}
              onNodeChange={safeOnDeprecateChange}
              readOnly={readOnly}
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
