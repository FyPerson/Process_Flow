import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Edge, MarkerType } from '@xyflow/react';
import { EdgeUpdateParams, EdgeUpdateFields } from '../../types/flow';
import { EdgeStyleEditor } from './EdgeStyleEditor';
import { normalizeColor } from '../../utils/colorUtils';
import { calculateDefaultBgWidth, calculateDefaultBgHeight } from '../../utils/edgeLabelUtils';
import { SelectedElement } from './index';

interface EdgePropertiesPanelProps {
    selectedElement: SelectedElement;
    onEdgeChange: (id: string, updates: EdgeUpdateParams) => void;
}

export const EdgePropertiesPanel = memo(function EdgePropertiesPanel({
    selectedElement,
    onEdgeChange
}: EdgePropertiesPanelProps) {
    // State
    const [edgeLabel, setEdgeLabel] = useState('');
    const [edgeColor, setEdgeColor] = useState('#64748b');
    const [edgeWidth, setEdgeWidth] = useState(2);
    const [edgeArrowType, setEdgeArrowType] = useState<'forward' | 'reverse' | 'both' | 'none'>('forward');

    // Label Style
    const [edgeLabelFontSize, setEdgeLabelFontSize] = useState(12);
    const [edgeLabelFontSizeStr, setEdgeLabelFontSizeStr] = useState('12');
    const [edgeLabelFontFamily, setEdgeLabelFontFamily] = useState('微软雅黑');
    const [edgeLabelFontWeight, setEdgeLabelFontWeight] = useState(400);
    const [edgeLabelColor, setEdgeLabelColor] = useState('#64748b');
    const [edgeLabelBgColor, setEdgeLabelBgColor] = useState('#ffffff');
    const [edgeLabelOpacity, setEdgeLabelOpacity] = useState(100);
    const [edgeLabelOpacityStr, setEdgeLabelOpacityStr] = useState('100');

    const [edgeLabelBgWidth, setEdgeLabelBgWidth] = useState<'auto' | number>('auto');
    const [edgeLabelBgHeight, setEdgeLabelBgHeight] = useState<'auto' | number>('auto');
    const [edgeLabelBgWidthStr, setEdgeLabelBgWidthStr] = useState('');
    const [edgeLabelBgHeightStr, setEdgeLabelBgHeightStr] = useState('');

    // Refs
    const editingInputRef = useRef<HTMLElement | null>(null);
    // 使用 ref 追踪上一个 edge id，避免重复更新
    const prevEdgeIdRef = useRef<string | null>(null);

    // 同步状态
    useEffect(() => {
        if (selectedElement.type === 'edge') {
            const edge = selectedElement.data as Edge;

            // 如果 ID 没变，且不是首次加载，跳过更新（可选，但 React 推荐依赖 props 变化）
            // 这里我们使用 ref 来避免如果不必要的重复赋值（虽然 set state 也是安全的）
            if (prevEdgeIdRef.current !== edge.id) {
                prevEdgeIdRef.current = edge.id;

                // 使用 queueMicrotask 延迟更新，避免渲染期间的 potential issues
                queueMicrotask(() => {
                    const data = edge.data || {};
                    setEdgeLabel((typeof edge.label === 'string' ? edge.label : '') || '');
                    const style = edge.style || {};
                    setEdgeColor(normalizeColor(typeof style.stroke === 'string' ? style.stroke : '') || '#64748b');
                    setEdgeWidth(Number(style.strokeWidth) || 2);

                    const markerEnd = edge.markerEnd;
                    const markerStart = edge.markerStart;
                    if (markerEnd && markerStart) setEdgeArrowType('both');
                    else if (markerStart) setEdgeArrowType('reverse');
                    else if (markerEnd) setEdgeArrowType('forward');
                    else setEdgeArrowType('none');

                    const labelStyle = edge.labelStyle || {};
                    setEdgeLabelFontSize(Number(labelStyle.fontSize) || 12);
                    setEdgeLabelFontSizeStr(String(Number(labelStyle.fontSize) || 12));
                    setEdgeLabelFontFamily((labelStyle.fontFamily as string) || '微软雅黑');
                    setEdgeLabelFontWeight(Number(labelStyle.fontWeight) || 400);
                    setEdgeLabelColor(normalizeColor(typeof labelStyle.fill === 'string' ? labelStyle.fill : '') || '#64748b');

                    const labelBgStyle = edge.labelBgStyle || {};
                    setEdgeLabelBgColor(normalizeColor(typeof labelBgStyle.fill === 'string' ? labelBgStyle.fill : '') || '#ffffff');

                    const opacity = labelBgStyle.fillOpacity !== undefined ? Number(labelBgStyle.fillOpacity) : 0.8;
                    setEdgeLabelOpacity(Math.round(opacity * 100));
                    setEdgeLabelOpacityStr(String(Math.round(opacity * 100)));

                    const w = (data.bgWidth === undefined || data.bgWidth === 'auto') ? 'auto' : Number(data.bgWidth);
                    const h = (data.bgHeight === undefined || data.bgHeight === 'auto') ? 'auto' : Number(data.bgHeight);

                    setEdgeLabelBgWidth(w);
                    setEdgeLabelBgHeight(h);
                    setEdgeLabelBgWidthStr(w === 'auto' ? '' : String(w));
                    setEdgeLabelBgHeightStr(h === 'auto' ? '' : String(h));
                });
            }
        }
    }, [selectedElement]);

    const commitEdgeChanges = useCallback((overrides: Partial<EdgeUpdateFields> = {}) => {
        if (selectedElement.type !== 'edge') return;
        const edge = selectedElement.data as Edge;

        const currentArrowType = overrides.arrowType || edgeArrowType;
        let markerStart = undefined;
        let markerEnd = undefined;

        const color = overrides.color || edgeColor;

        if (currentArrowType === 'forward') {
            markerEnd = { type: MarkerType.ArrowClosed, color };
        } else if (currentArrowType === 'reverse') {
            markerStart = { type: MarkerType.ArrowClosed, color };
        } else if (currentArrowType === 'both') {
            markerStart = { type: MarkerType.ArrowClosed, color };
            markerEnd = { type: MarkerType.ArrowClosed, color };
        }

        let bgW = overrides.bgWidth !== undefined ? overrides.bgWidth : edgeLabelBgWidth;
        let bgH = overrides.bgHeight !== undefined ? overrides.bgHeight : edgeLabelBgHeight;

        // Determine if auto before resolving to numbers
        const isWidthAuto = bgW === 'auto';
        const isHeightAuto = bgH === 'auto';

        if (bgW === 'auto') {
            bgW = calculateDefaultBgWidth(overrides.label || edgeLabel, overrides.fontSize || edgeLabelFontSize);
        }
        if (bgH === 'auto') {
            bgH = calculateDefaultBgHeight(overrides.fontSize || edgeLabelFontSize);
        }

        const updates: EdgeUpdateParams = {
            label: overrides.label !== undefined ? overrides.label : edgeLabel,
            style: {
                ...edge.style,
                stroke: color,
                strokeWidth: overrides.width || edgeWidth,
            },
            markerStart,
            markerEnd,
            labelStyle: {
                ...edge.labelStyle,
                fontSize: overrides.fontSize || edgeLabelFontSize,
                fontFamily: overrides.fontFamily || edgeLabelFontFamily,
                fontWeight: overrides.fontWeight || edgeLabelFontWeight,
                fill: overrides.fontColor || edgeLabelColor,
            },
            labelBgStyle: {
                ...edge.labelBgStyle,
                fill: overrides.bgColor || edgeLabelBgColor,
                fillOpacity: (overrides.opacity !== undefined ? overrides.opacity : edgeLabelOpacity) / 100,
                width: bgW,
                height: bgH,
                // Add these flags so DraggableEdge knows it's auto
                widthAuto: isWidthAuto,
                heightAuto: isHeightAuto,
            },
            data: {
                ...edge.data,
                bgWidth: isWidthAuto ? 'auto' : bgW,
                bgHeight: isHeightAuto ? 'auto' : bgH,
            }
        };

        onEdgeChange(edge.id, updates);
    }, [
        selectedElement, onEdgeChange,
        edgeLabel, edgeColor, edgeWidth, edgeArrowType,
        edgeLabelFontSize, edgeLabelFontFamily, edgeLabelFontWeight, edgeLabelColor,
        edgeLabelBgColor, edgeLabelOpacity,
        edgeLabelBgWidth, edgeLabelBgHeight
    ]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
        }
    };

    if (selectedElement.type !== 'edge') {
        return null; // Or some placeholder
    }

    return (
        <EdgeStyleEditor
            edgeLabel={edgeLabel}
            edgeColor={edgeColor}
            edgeWidth={edgeWidth}
            edgeArrowType={edgeArrowType}

            onLabelChange={(newLabel) => {
                // 当标签从空变为有内容时，自动设置背景色为 #E0E0E0
                const wasEmpty = edgeLabel.trim() === '';
                const isNowFilled = newLabel.trim() !== '';
                setEdgeLabel(newLabel);

                if (wasEmpty && isNowFilled && edgeLabelBgColor === '#ffffff') {
                    setEdgeLabelBgColor('#E0E0E0');
                }
            }}
            onCommitLabelChange={() => {
                // 提交时检查是否需要设置默认背景色
                const updates: Partial<EdgeUpdateFields> = { label: edgeLabel };
                if (edgeLabel.trim() !== '' && edgeLabelBgColor === '#ffffff') {
                    updates.bgColor = '#E0E0E0';
                    setEdgeLabelBgColor('#E0E0E0');
                }
                commitEdgeChanges(updates);
            }}
            onColorChange={(c) => { setEdgeColor(c); commitEdgeChanges({ color: c }); }}
            onCommitColorChange={() => { }} // No-op as handled in change
            onWidthChange={(w) => { setEdgeWidth(w); commitEdgeChanges({ width: w }); }}
            onCommitWidthChange={() => { }} // No-op
            onArrowTypeChange={(t) => { setEdgeArrowType(t); commitEdgeChanges({ arrowType: t }); }}


            edgeLabelFontSize={edgeLabelFontSize}
            edgeLabelFontSizeStr={edgeLabelFontSizeStr}
            edgeLabelFontFamily={edgeLabelFontFamily}
            edgeLabelFontWeight={edgeLabelFontWeight}
            edgeLabelColor={edgeLabelColor}
            edgeLabelBgColor={edgeLabelBgColor}
            edgeLabelOpacity={edgeLabelOpacity}
            edgeLabelOpacityStr={edgeLabelOpacityStr}

            edgeLabelBgWidth={edgeLabelBgWidth}
            edgeLabelBgHeight={edgeLabelBgHeight}
            edgeLabelBgWidthStr={edgeLabelBgWidthStr}
            edgeLabelBgHeightStr={edgeLabelBgHeightStr}


            onLabelFontSizeChange={(s) => {
                setEdgeLabelFontSizeStr(s);
                const v = parseFloat(s);
                if (!isNaN(v) && v > 0) {
                    setEdgeLabelFontSize(v);
                    commitEdgeChanges({ fontSize: v });
                }
            }}
            onCommitLabelFontSizeChange={(s) => {
                const v = parseFloat(s);
                let finalSize = v;
                if (isNaN(v) || v <= 0) {
                    finalSize = 12; // Default fallback
                    setEdgeLabelFontSizeStr('12');
                }
                setEdgeLabelFontSize(finalSize);
                commitEdgeChanges({ fontSize: finalSize });
            }}
            onLabelFontFamilyChange={(v) => { setEdgeLabelFontFamily(v); commitEdgeChanges({ fontFamily: v }); }}
            onLabelFontWeightChange={(v) => { setEdgeLabelFontWeight(v); commitEdgeChanges({ fontWeight: v }); }}

            onLabelColorChange={(v) => { setEdgeLabelColor(v); commitEdgeChanges({ fontColor: v }); }}
            onLabelBgColorChange={(v) => { setEdgeLabelBgColor(v); commitEdgeChanges({ bgColor: v }); }}

            onLabelOpacityChange={(v, s) => {
                setEdgeLabelOpacity(v);
                setEdgeLabelOpacityStr(s);
                commitEdgeChanges({ opacity: v });
            }}
            onCommitLabelOpacityChange={() => { }}

            onLabelBgWidthChange={(s) => {
                setEdgeLabelBgWidthStr(s);
                const v = parseFloat(s);
                if (!isNaN(v) && s !== '') {
                    setEdgeLabelBgWidth(v);
                    commitEdgeChanges({ bgWidth: v });
                }
            }}
            onCommitLabelBgWidth={(s) => {
                const v = s === '' ? 'auto' : Number(s);
                setEdgeLabelBgWidth(v);
                commitEdgeChanges({ bgWidth: v });
            }}

            onLabelBgHeightChange={(s) => {
                setEdgeLabelBgHeightStr(s);
                const v = parseFloat(s);
                if (!isNaN(v) && s !== '') {
                    setEdgeLabelBgHeight(v);
                    commitEdgeChanges({ bgHeight: v });
                }
            }}
            onCommitLabelBgHeight={(s) => {
                const v = s === '' ? 'auto' : Number(s);
                setEdgeLabelBgHeight(v);
                commitEdgeChanges({ bgHeight: v });
            }}

            onResetBgWidth={() => {
                setEdgeLabelBgWidth('auto');
                setEdgeLabelBgWidthStr('');
                commitEdgeChanges({ bgWidth: 'auto' });
            }}
            onResetBgHeight={() => {
                setEdgeLabelBgHeight('auto');
                setEdgeLabelBgHeightStr('');
                commitEdgeChanges({ bgHeight: 'auto' });
            }}

            editingInputRef={editingInputRef}
            onInputFocus={(e) => { editingInputRef.current = e.currentTarget; }}
            onInputBlur={() => { editingInputRef.current = null; }}
            handleKeyDown={handleKeyDown}
        />
    );
});
