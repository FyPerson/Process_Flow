import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Node } from '@xyflow/react';
import { FlowNodeData, Screenshot, DatabaseTable, NodeUpdateParams, NodeUpdateFields } from '../../types/flow';
import { NodeStyleEditor } from './NodeStyleEditor';
import { ScreenshotManager } from './ScreenshotManager';
import { DatabaseTableEditor } from './DatabaseTableEditor';
import { normalizeColor } from '../../utils/colorUtils';
import { getIframeUrl } from '../../config/iframeMapping';
import { SelectedElement } from './index';
import { BufferedInput } from '../common/BufferedInput';
import { NodeSelector } from './NodeSelector';

interface NodePropertiesPanelProps {
    selectedElement: SelectedElement;
    onNodeChange: (id: string, updates: NodeUpdateParams) => void;
    onViewScreenshot: (s: Screenshot) => void;
    onOpenPageSelector: () => void;
    screenshots: Screenshot[];
    setScreenshots: (s: Screenshot[]) => void;
    allNodes?: Node<FlowNodeData>[];
}

export const NodePropertiesPanel = memo(function NodePropertiesPanel({
    selectedElement,
    onNodeChange,
    onViewScreenshot,
    onOpenPageSelector,
    screenshots,
    setScreenshots,
    allNodes = []
}: NodePropertiesPanelProps) {
    // State Management
    const [nodeName, setNodeName] = useState('');
    const [nodeDescription, setNodeDescription] = useState('');
    const [relatedNodeIds, setRelatedNodeIds] = useState<string[]>([]);
    const [nodeWidth, setNodeWidth] = useState<number | undefined>(undefined);
    const [nodeHeight, setNodeHeight] = useState<number | undefined>(undefined);
    const [nodeWidthStr, setNodeWidthStr] = useState('');
    const [nodeHeightStr, setNodeHeightStr] = useState('');

    // Node Style
    const [nodeFontSize, setNodeFontSize] = useState(14);
    const [nodeFontSizeStr, setNodeFontSizeStr] = useState('14');
    const [nodeFontColor, setNodeFontColor] = useState('#000000');
    const [nodeFontFamily, setNodeFontFamily] = useState('微软雅黑');
    const [nodeFontWeight, setNodeFontWeight] = useState(400);
    const [nodeBackgroundColor, setNodeBackgroundColor] = useState('#ffffff');
    const [nodeBorderColor, setNodeBorderColor] = useState('#cbd5e1');
    const [nodeBorderWidth, setNodeBorderWidth] = useState(1);

    // Extras
    const [databaseTables, setDatabaseTables] = useState<DatabaseTable[]>([]);

    // Refs
    const editingInputRef = useRef<HTMLElement | null>(null);

    // Synchronization
    useEffect(() => {
        if (selectedElement.type !== 'node') return;

        const data = selectedElement.data;
        const node = selectedElement.node;

        setNodeName(data.name || (typeof data.label === 'string' ? data.label : '') || '');
        setNodeDescription((typeof data.description === 'string' ? data.description : '') || '');
        setRelatedNodeIds(data.relatedNodeIds || []);

        // Screenshots are managed by parent to handle page selector callback
        // But tables are local here
        const dbTables = data.detailConfig?.databaseTables ||
            (Array.isArray(data.databaseTables) ? data.databaseTables as DatabaseTable[] : []);
        setDatabaseTables(dbTables);

        if (node) {
            setNodeWidth(node.style?.width as number | undefined);
            setNodeHeight(node.style?.height as number | undefined);
            setNodeWidthStr(node.style?.width ? String(node.style.width) : '');
            setNodeHeightStr(node.style?.height ? String(node.style.height) : '');

            setNodeFontSize(Number(node.style?.fontSize) || 14);
            setNodeFontSizeStr(String(Number(node.style?.fontSize) || 14));

            setNodeFontColor(normalizeColor(typeof node.style?.color === 'string' ? node.style.color : '') || '#000000');
            setNodeFontFamily((typeof node.style?.fontFamily === 'string' ? node.style.fontFamily : '') || '微软雅黑');
            setNodeFontWeight(Number(node.style?.fontWeight) || 400);

            // Sync background color
            // Check data.backgroundColor first for decision/data nodes
            if ((data.type === 'decision' || data.type === 'data') && data.backgroundColor) {
                setNodeBackgroundColor(data.backgroundColor);
            } else {
                setNodeBackgroundColor(normalizeColor(typeof node.style?.backgroundColor === 'string' ? node.style.backgroundColor : '') || '#ffffff');
            }

            setNodeBorderColor(normalizeColor(typeof node.style?.borderColor === 'string' ? node.style.borderColor : '') || '#cbd5e1');
            setNodeBorderWidth(Number(node.style?.borderWidth) || 1);
        }
    }, [selectedElement]);

    const commitNodeChanges = useCallback((
        updatedFields: Partial<FlowNodeData> = {},
        updatedStyle: React.CSSProperties = {}
    ) => {
        if (selectedElement.type !== 'node') return;

        const newDataUpdates: Partial<FlowNodeData> & NodeUpdateFields = {};
        // Cast unknown from index signature to expected types
        const label = updatedFields.label as string | undefined;
        const description = updatedFields.description as string | undefined;

        if (label !== undefined) newDataUpdates.label = label;
        if (description !== undefined) newDataUpdates.description = description;

        if (updatedFields.screenshots) {
            const screenshots = updatedFields.screenshots as Screenshot[];
            newDataUpdates.screenshots = screenshots;
            newDataUpdates.detailConfig = {
                ...(selectedElement.data.detailConfig || {}),
                screenshots: screenshots
            };
        }
        if (updatedFields.databaseTables) {
            const tables = updatedFields.databaseTables as DatabaseTable[];
            newDataUpdates.databaseTables = tables;
            newDataUpdates.detailConfig = {
                ...(selectedElement.data.detailConfig || {}),
                databaseTables: tables
            };
        }

        const currentStyle = selectedElement.node?.style || {};
        const newStyle = {
            ...currentStyle,
            ...updatedStyle
        };

        Object.keys(newStyle).forEach(key => {
            const styleKey = key as keyof React.CSSProperties;
            if (newStyle[styleKey] === undefined) {
                delete newStyle[styleKey];
            }
        });

        onNodeChange(selectedElement.data.id, {
            data: newDataUpdates,
            style: newStyle
        });
    }, [selectedElement, onNodeChange]);


    const handleAddRelatedNode = (targetId: string) => {
        if (!relatedNodeIds.includes(targetId)) {
            const newIds = [...relatedNodeIds, targetId];
            setRelatedNodeIds(newIds);
            // Manually commit update since it's not in the main commitNodeChanges flow for simplicty, or extend commitNodeChanges
            onNodeChange(selectedElement.data.id, {
                data: {
                    relatedNodeIds: newIds,
                    [targetId]: true // trigger check if needed
                } as any // dirty cast to bypass Partial<FlowNodeData> strict check for now or update commitNodeChanges
            });
            // Better to use commitNodeChanges logic properly
            onNodeChange(selectedElement.data.id, {
                data: {
                    relatedNodeIds: newIds
                }
            });
        }
    };

    const handleRemoveRelatedNode = (targetId: string) => {
        const newIds = relatedNodeIds.filter(id => id !== targetId);
        setRelatedNodeIds(newIds);
        onNodeChange(selectedElement.data.id, {
            data: {
                relatedNodeIds: newIds
            }
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
        }
    };

    return (
        <>
            <div className="info-section">
                <div className="info-item">
                    <span className="info-label">名称</span>
                    <BufferedInput
                        type="text"
                        className="info-input"
                        value={nodeName}
                        onCommit={(value) => {
                            setNodeName(value);
                            commitNodeChanges({ label: value });
                        }}
                        placeholder="节点名称"
                    />
                </div>
                <div className="info-item">
                    <span className="info-label">描述</span>
                    <textarea
                        className="info-textarea"
                        value={nodeDescription}
                        onChange={e => setNodeDescription(e.target.value)}
                        onBlur={() => commitNodeChanges({ description: nodeDescription })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                e.currentTarget.blur();
                            }
                        }}
                        placeholder="节点详细描述..."
                        rows={3}
                    />
                </div>
            </div>

            <div className="info-section">
                <div className="info-item">
                    <span className="info-label">关联节点</span>
                    <div className="related-nodes-container">
                        {relatedNodeIds.length > 0 && (
                            <div className="related-list">
                                {relatedNodeIds.map(id => {
                                    const node = allNodes.find(n => n.id === id);
                                    return (
                                        <div key={id} className="related-tag">
                                            <span className="related-tag-text" title={String(node?.data?.label || node?.data?.name || id)}>
                                                {String(node?.data?.label || node?.data?.name || id)}
                                            </span>
                                            <span
                                                className="related-tag-remove"
                                                onClick={() => handleRemoveRelatedNode(id)}
                                                title="移除关联"
                                            >×</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <NodeSelector
                            currentNodeId={selectedElement.data.id}
                            allNodes={allNodes}
                            onSelect={handleAddRelatedNode}
                            excludeIds={relatedNodeIds}
                        />
                    </div>
                </div>
            </div>

            <NodeStyleEditor
                nodeType={selectedElement.data.type}
                // Dims
                width={nodeWidth}
                height={nodeHeight}
                widthStr={nodeWidthStr}
                heightStr={nodeHeightStr}
                onWidthChange={(v, s) => {
                    setNodeWidth(v);
                    setNodeWidthStr(s);
                    if (v !== undefined) commitNodeChanges({}, { width: v });
                }}
                onHeightChange={(v, s) => {
                    setNodeHeight(v);
                    setNodeHeightStr(s);
                    if (v !== undefined) commitNodeChanges({}, { height: v });
                }}
                onCommitDimension={() => commitNodeChanges()}
                // Font
                fontSize={nodeFontSize}
                fontSizeStr={nodeFontSizeStr}
                fontColor={nodeFontColor}
                fontFamily={nodeFontFamily}
                fontWeight={nodeFontWeight}
                onFontSizeChange={(v, s) => {
                    setNodeFontSize(v);
                    setNodeFontSizeStr(s);
                    if (v && !isNaN(v)) commitNodeChanges({}, { fontSize: v });
                }}
                onCommitFontSize={() => commitNodeChanges()}
                onFontColorChange={(v) => { setNodeFontColor(v); commitNodeChanges({}, { color: v }); }}
                onFontFamilyChange={(v) => { setNodeFontFamily(v); commitNodeChanges({}, { fontFamily: v }); }}
                onFontWeightChange={(v) => { setNodeFontWeight(v); commitNodeChanges({}, { fontWeight: v }); }}
                // Bg & Border
                backgroundColor={nodeBackgroundColor}
                borderColor={nodeBorderColor}
                borderWidth={nodeBorderWidth}
                onBackgroundColorChange={(v) => { setNodeBackgroundColor(v); commitNodeChanges({}, { backgroundColor: v }); }}
                onBorderColorChange={(v) => { setNodeBorderColor(v); commitNodeChanges({}, { borderColor: v }); }}
                onBorderWidthChange={(v) => { setNodeBorderWidth(v); commitNodeChanges({}, { borderWidth: v }); }}
                // Refs
                editingInputRef={editingInputRef}
                onInputFocus={(e) => { editingInputRef.current = e.currentTarget; }}
                onInputBlur={() => { editingInputRef.current = null; }}
                handleKeyDown={handleKeyDown}
            />

            <ScreenshotManager
                screenshots={screenshots}
                onScreenshotsChange={(newScreenshots) => {
                    setScreenshots(newScreenshots);
                    commitNodeChanges({ screenshots: newScreenshots });
                }}
                onViewScreenshot={onViewScreenshot}
                onOpenPageSelector={onOpenPageSelector}
                getComponentUrl={getIframeUrl}
            />

            <DatabaseTableEditor
                tables={databaseTables}
                onTablesChange={(newTables) => {
                    setDatabaseTables(newTables);
                    commitNodeChanges({ databaseTables: newTables });
                }}
            />
        </>
    );
});
