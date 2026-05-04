import { memo, useState, useEffect, useCallback } from 'react';
import { Node } from '@xyflow/react';
import { FlowNodeData, GroupNodeData } from '../../types/flow';
import { BufferedInput } from '../common/BufferedInput';
import { NodeSelector } from './NodeSelector';

// 预设颜色选项
const COLOR_PRESETS = [
    { label: '蓝色', value: '#3b82f6' },
    { label: '绿色', value: '#22c55e' },
    { label: '紫色', value: '#8b5cf6' },
    { label: '橙色', value: '#f97316' },
    { label: '红色', value: '#ef4444' },
    { label: '青色', value: '#06b6d4' },
    { label: '粉色', value: '#ec4899' },
    { label: '灰色', value: '#6b7280' },
];

export interface GroupUpdateParams {
    label?: string;
    color?: string;
    relatedNodeIds?: string[];
}

interface GroupPropertiesPanelProps {
    groupData: GroupNodeData;
    groupNode: Node<FlowNodeData>;
    childNodes: Node<FlowNodeData>[];
    onGroupChange: (id: string, updates: GroupUpdateParams) => void;
    onUngroup: (groupId: string) => void;
    onRemoveFromGroup: (nodeId: string) => void;
    allNodes?: Node<FlowNodeData>[];
    /** P3D-2 step 4：当前用户是否可编辑此分组（label / color / 关联节点 / 移出子节点）。
     *  false → fieldset disabled 兜底 + 解散按钮也 disabled。 */
    canEdit: boolean;
    /** P3D-2 step 4：当前用户是否 admin。
     *  解散分组按钮在 06-范围审查 last paragraph 定调 admin-only —— 即使 canEdit=true 也要 admin 才能解散。 */
    isAdmin: boolean;
}

export const GroupPropertiesPanel = memo(function GroupPropertiesPanel({
    groupData,
    groupNode,
    childNodes,
    onGroupChange,
    onUngroup,
    onRemoveFromGroup,
    allNodes = [],
    canEdit,
    isAdmin,
}: GroupPropertiesPanelProps) {
    const [groupLabel, setGroupLabel] = useState(groupData.label || '新分组');
    const [groupColor, setGroupColor] = useState(groupData.color || '#3b82f6');
    const [relatedNodeIds, setRelatedNodeIds] = useState<string[]>([]);

    // 同步外部数据
    useEffect(() => {
        setGroupLabel(groupData.label || '新分组');
        setGroupColor(groupData.color || '#3b82f6');
        setRelatedNodeIds(groupData.relatedNodeIds || []);
    }, [groupData]);

    const handleLabelCommit = useCallback((value: string) => {
        setGroupLabel(value);
        onGroupChange(groupData.id, { label: value });
    }, [groupData.id, onGroupChange]);

    const handleColorChange = useCallback((color: string) => {
        setGroupColor(color);
        onGroupChange(groupData.id, { color });
    }, [groupData.id, onGroupChange]);

    const handleUngroup = useCallback(() => {
        if (window.confirm('确定要解散此分组吗？子节点将变为独立节点。')) {
            onUngroup(groupData.id);
        }
    }, [groupData.id, onUngroup]);

    const handleRemoveNode = useCallback((nodeId: string, nodeName: string) => {
        if (window.confirm(`确定要将"${nodeName}"从分组中移除吗？`)) {
            onRemoveFromGroup(nodeId);
        }
    }, [onRemoveFromGroup]);

    const handleAddRelatedNode = useCallback((targetId: string) => {
        if (!relatedNodeIds.includes(targetId)) {
            const newIds = [...relatedNodeIds, targetId];
            setRelatedNodeIds(newIds);
            onGroupChange(groupData.id, { relatedNodeIds: newIds });
        }
    }, [relatedNodeIds, groupData.id, onGroupChange]);

    const handleRemoveRelatedNode = useCallback((targetId: string) => {
        const newIds = relatedNodeIds.filter(id => id !== targetId);
        setRelatedNodeIds(newIds);
        onGroupChange(groupData.id, { relatedNodeIds: newIds });
    }, [relatedNodeIds, groupData.id, onGroupChange]);

    return (
        <>
            {/* P3D-2 step 4：fieldset disabled={!canEdit} 兜底 label/color/关联节点/移出子节点
                解散按钮在 fieldset 内部还要叠加 admin-only 检查（canEdit ≠ admin） */}
            <fieldset disabled={!canEdit} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
            {/* 基本信息 */}
            <div className="info-section">
                <div className="info-item">
                    <span className="info-label">分组名称</span>
                    <BufferedInput
                        type="text"
                        className="info-input"
                        value={groupLabel}
                        onCommit={handleLabelCommit}
                        placeholder="分组名称"
                    />
                </div>
            </div>

            {/* 主题颜色 */}
            <div className="section">
                <div className="section-title">主题颜色</div>
                <div className="color-presets" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '8px',
                    marginBottom: '12px'
                }}>
                    {COLOR_PRESETS.map((preset) => (
                        <button
                            key={preset.value}
                            className="color-preset-btn"
                            style={{
                                width: '100%',
                                height: '32px',
                                backgroundColor: preset.value,
                                border: groupColor === preset.value ? '3px solid #1e293b' : '2px solid transparent',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                            title={preset.label}
                            onClick={() => handleColorChange(preset.value)}
                        />
                    ))}
                </div>
                <div className="info-item" style={{ marginTop: '8px' }}>
                    <span className="info-label">自定义颜色</span>
                    <input
                        type="color"
                        value={groupColor}
                        onChange={(e) => handleColorChange(e.target.value)}
                        style={{
                            width: '100%',
                            height: '32px',
                            padding: '2px',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            cursor: 'pointer',
                        }}
                    />
                </div>
            </div>

            {/* 分组信息 */}
            <div className="section">
                <div className="section-title">分组信息</div>
                <div className="info-item">
                    <span className="info-label">包含节点数</span>
                    <span className="info-value" style={{
                        padding: '8px 12px',
                        background: '#f1f5f9',
                        borderRadius: '6px',
                        fontSize: '14px',
                        color: '#1e293b',
                        fontWeight: 500,
                    }}>
                        {childNodes.length} 个节点
                    </span>
                </div>
            </div>

            {/* 关联节点 */}
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
                                                {node?.type === 'group' && '📁 '}
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
                            currentNodeId={groupData.id}
                            allNodes={allNodes}
                            onSelect={handleAddRelatedNode}
                            excludeIds={relatedNodeIds}
                        />
                    </div>
                </div>
            </div>

            {/* 子节点列表 */}
            {childNodes.length > 0 && (
                <div className="section">
                    <div className="section-title">子节点列表</div>
                    <div className="child-nodes-list" style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                    }}>
                        {childNodes.map((node, index) => (
                            <div
                                key={node.id}
                                className="child-node-item"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 12px',
                                    borderBottom: index < childNodes.length - 1 ? '1px solid #e2e8f0' : 'none',
                                    fontSize: '13px',
                                }}
                            >
                                <span style={{
                                    flex: 1,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {node.data.name || '未命名节点'}
                                </span>
                                <button
                                    onClick={() => handleRemoveNode(node.id, node.data.name || '未命名节点')}
                                    style={{
                                        marginLeft: '8px',
                                        padding: '4px 8px',
                                        fontSize: '12px',
                                        color: '#64748b',
                                        background: '#f1f5f9',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                    }}
                                    title="从分组中移除"
                                >
                                    移除
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 操作按钮 */}
            <div className="section">
                {/* P3D-2 step 4：解散分组 admin-only（与 useFlowOperations onUngroup 后端 gate 同口径）
                    canEdit=true 但非 admin 时也要 disable，并在 title 提示原因 */}
                <button
                    onClick={handleUngroup}
                    disabled={!isAdmin}
                    title={isAdmin ? undefined : '仅管理员可解散分组（普通用户可对子节点单独操作）'}
                    style={{
                        width: '100%',
                        padding: '12px',
                        fontSize: '14px',
                        fontWeight: 500,
                        color: isAdmin ? '#dc2626' : '#94a3b8',
                        background: isAdmin ? '#fef2f2' : '#f1f5f9',
                        border: `1px solid ${isAdmin ? '#fecaca' : '#cbd5e1'}`,
                        borderRadius: '8px',
                        cursor: isAdmin ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                        if (isAdmin) e.currentTarget.style.background = '#fee2e2';
                    }}
                    onMouseLeave={(e) => {
                        if (isAdmin) e.currentTarget.style.background = '#fef2f2';
                    }}
                >
                    解散分组{!isAdmin && ' (仅管理员)'}
                </button>
            </div>
            </fieldset>
        </>
    );
});
