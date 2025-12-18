import { memo } from 'react';
import './AlignmentToolbar.css';

interface AlignmentToolbarProps {
    onAlign: (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-h' | 'distribute-v') => void;
    visible: boolean;
}

export const AlignmentToolbar = memo(function AlignmentToolbar({ onAlign, visible }: AlignmentToolbarProps) {
    if (!visible) return null;

    return (
        <div className="alignment-toolbar">
            <div className="alignment-group">
                <button className="alignment-btn" onClick={() => onAlign('left')} title="左对齐">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h2v12H2V2zm4 2h8v2H6V4zm0 6h6v2H6v-2z" /></svg>
                </button>
                <button className="alignment-btn" onClick={() => onAlign('center')} title="水平居中">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7 2h2v12H7V2zm-4 2h10v2H3V4zm2 6h6v2H5v-2z" /></svg>
                </button>
                <button className="alignment-btn" onClick={() => onAlign('right')} title="右对齐">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12 2h2v12h-2V2zM2 4h8v2H2V4zm2 6h6v2H4v-2z" /></svg>
                </button>
            </div>
            <div className="alignment-divider" />
            <div className="alignment-group">
                <button className="alignment-btn" onClick={() => onAlign('top')} title="顶部对齐">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v2H2V2zm2 4h2v8H4V6zm6 0h2v6h-2V6z" /></svg>
                </button>
                <button className="alignment-btn" onClick={() => onAlign('middle')} title="垂直居中">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 7h12v2H2V7zm2-4h2v10H4V3zm6 2h2v6h-2V5z" /></svg>
                </button>
                <button className="alignment-btn" onClick={() => onAlign('bottom')} title="底部对齐">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 12h12v2H2v-2zm2-8h2v6H4V4zm6 2h2v4h-2V6z" /></svg>
                </button>
            </div>
            <div className="alignment-divider" />
            <div className="alignment-group">
                <button className="alignment-btn" onClick={() => onAlign('distribute-h')} title="水平均分">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h2v12H2V2zm10 0h2v12h-2V2zM6 6h4v4H6V6z" /></svg>
                </button>
                <button className="alignment-btn" onClick={() => onAlign('distribute-v')} title="垂直均分">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v2H2V2zm0 10h12v2H2v-2zM6 6h4v4H6V6z" /></svg>
                </button>
            </div>
        </div>
    );
});
