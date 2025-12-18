import { useState, useEffect, memo } from 'react';
import { Edge, Node } from '@xyflow/react';
import { FlowNodeData, Screenshot, NodeUpdateParams, EdgeUpdateParams, GroupNodeData } from '../../types/flow';
import { ScreenshotViewer } from '../ScreenshotViewer';
import { PageSelector, PageOption } from '../PageSelector';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { EdgePropertiesPanel } from './EdgePropertiesPanel';
import { GroupPropertiesPanel, GroupUpdateParams } from './GroupPropertiesPanel';
import './styles.css';

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
          <button className="close-btn" onClick={onClose}>×</button>
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
