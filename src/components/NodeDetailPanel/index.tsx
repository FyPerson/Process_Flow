import { useState, useEffect, memo } from 'react';
import { Edge, Node, useReactFlow } from '@xyflow/react';
import { FlowNodeData, Screenshot, NodeUpdateParams, EdgeUpdateParams, GroupNodeData } from '../../types/flow';
import { ScreenshotViewer } from '../ScreenshotViewer';
import { PageSelector, PageOption } from '../PageSelector';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { EdgePropertiesPanel } from './EdgePropertiesPanel';
import { GroupPropertiesPanel, GroupUpdateParams } from './GroupPropertiesPanel';
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
}: NodeDetailPanelProps) {

  // Node Extras to be lifted here because of PageSelector
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);

  const { setCenter, getZoom } = useReactFlow();

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
    onNodeChange(selectedElement.data.id, updates);

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
          {/* Group Node Content */}
          {isGroupNode && selectedElement.type === 'node' && selectedElement.node && onGroupChange && onUngroup && onRemoveFromGroup && (
            <GroupPropertiesPanel
              groupData={selectedElement.node.data as unknown as GroupNodeData}
              groupNode={selectedElement.node}
              childNodes={childNodes}
              onGroupChange={onGroupChange}
              onUngroup={onUngroup}
              onRemoveFromGroup={onRemoveFromGroup}
              allNodes={allNodes}
            />
          )}

          {/* Regular Node Content */}
          {isNode && !isGroupNode && selectedElement.type === 'node' && (
            <NodePropertiesPanel
              selectedElement={selectedElement}
              onNodeChange={onNodeChange}
              onViewScreenshot={setViewingScreenshot}
              onOpenPageSelector={() => setShowPageSelector(true)}
              screenshots={screenshots}
              setScreenshots={setScreenshots}
              allNodes={allNodes}
            />
          )}

          {/* Edge Content */}
          {!isNode && selectedElement.type === 'edge' && (
            <EdgePropertiesPanel
              selectedElement={selectedElement}
              onEdgeChange={onEdgeChange}
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
