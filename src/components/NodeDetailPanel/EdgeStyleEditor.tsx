import { memo } from 'react';
import { HexColorInput } from './HexColorInput';

interface EdgeStyleEditorProps {
  // Basic properties
  edgeLabel: string;
  edgeColor: string;
  edgeWidth: number;
  edgeArrowType: 'forward' | 'reverse' | 'both' | 'none';

  onLabelChange: (label: string) => void;
  onCommitLabelChange: () => void; // for onBlur
  onColorChange: (color: string) => void;
  onCommitColorChange: () => void; // for onBlur
  onWidthChange: (width: number) => void;
  onCommitWidthChange: () => void; // for onBlur
  onArrowTypeChange: (type: 'forward' | 'reverse' | 'both' | 'none') => void;


  // Label Style Properties
  edgeLabelFontSize: number;
  edgeLabelFontSizeStr: string;
  edgeLabelFontFamily: string;
  edgeLabelFontWeight: number;
  edgeLabelColor: string;
  edgeLabelBgColor: string;
  edgeLabelOpacity: number;
  edgeLabelOpacityStr: string;

  edgeLabelBgWidth: 'auto' | number;
  edgeLabelBgHeight: 'auto' | number;
  edgeLabelBgWidthStr: string;
  edgeLabelBgHeightStr: string;

  // Label Style Handlers
  onLabelFontSizeChange: (str: string) => void;
  onCommitLabelFontSizeChange: (str: string) => void;

  onLabelFontFamilyChange: (family: string) => void;
  onLabelFontWeightChange: (weight: number) => void;

  onLabelColorChange: (color: string) => void; // usually immediate
  onLabelBgColorChange: (color: string) => void; // usually immediate

  onLabelOpacityChange: (value: number, str: string) => void; // immediate update to state
  onCommitLabelOpacityChange: () => void;

  onLabelBgWidthChange: (str: string) => void;
  onCommitLabelBgWidth: (str: string) => void;

  onLabelBgHeightChange: (str: string) => void;
  onCommitLabelBgHeight: (str: string) => void;

  onResetBgWidth: () => void;
  onResetBgHeight: () => void;

  // Refs for focus management
  editingInputRef: React.MutableRefObject<HTMLElement | null>;
  onInputFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onInputBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export const EdgeStyleEditor = memo(function EdgeStyleEditor({
  edgeLabel,
  edgeColor,
  edgeWidth,
  edgeArrowType,
  onLabelChange,
  onCommitLabelChange,
  onColorChange,
  onCommitColorChange,
  onWidthChange,
  onCommitWidthChange,
  onArrowTypeChange,

  edgeLabelFontSize,
  edgeLabelFontSizeStr,
  edgeLabelFontFamily,
  edgeLabelFontWeight,
  edgeLabelColor,
  edgeLabelBgColor,
  edgeLabelOpacity,
  edgeLabelOpacityStr,
  edgeLabelBgWidth,
  edgeLabelBgHeight,
  edgeLabelBgWidthStr,
  edgeLabelBgHeightStr,

  onLabelFontSizeChange,
  onCommitLabelFontSizeChange,
  onLabelFontFamilyChange,
  onLabelFontWeightChange,
  onLabelColorChange,
  onLabelBgColorChange,
  onLabelOpacityChange,
  onCommitLabelOpacityChange,
  onLabelBgWidthChange,
  onCommitLabelBgWidth,
  onLabelBgHeightChange,
  onCommitLabelBgHeight,
  onResetBgWidth,
  onResetBgHeight,

  editingInputRef,
  onInputFocus,
  onInputBlur,
  handleKeyDown
}: EdgeStyleEditorProps) {
  return (
    <div className="detail-panel-content">
      <div className="info-section">
        <div className="info-item">
          <span className="info-label">连线标签 (Label)</span>
          <input
            type="text"
            className="info-input"
            value={edgeLabel}
            onChange={(e) => onLabelChange(e.target.value)}
            onBlur={onCommitLabelChange}
            onKeyDown={handleKeyDown}
            placeholder="例如：是/否/提交"
          />
        </div>

        {/* 箭头方向选择 */}
        <div className="info-item">
          <span className="info-label">箭头方向</span>
          <div className="arrow-type-selector">
            <button
              className={`arrow-btn ${edgeArrowType === 'forward' ? 'active' : ''}`}
              onClick={() => onArrowTypeChange('forward')}
              title="正向箭头"
            >
              →
            </button>
            <button
              className={`arrow-btn ${edgeArrowType === 'reverse' ? 'active' : ''}`}
              onClick={() => onArrowTypeChange('reverse')}
              title="反向箭头"
            >
              ←
            </button>
            <button
              className={`arrow-btn ${edgeArrowType === 'both' ? 'active' : ''}`}
              onClick={() => onArrowTypeChange('both')}
              title="双向箭头"
            >
              ↔
            </button>
            <button
              className={`arrow-btn ${edgeArrowType === 'none' ? 'active' : ''}`}
              onClick={() => onArrowTypeChange('none')}
              title="无箭头"
            >
              —
            </button>
          </div>
        </div>


        <div className="info-item">
          <span className="info-label">线条颜色</span>
          <HexColorInput
            value={edgeColor}
            onChange={(color) => { onColorChange(color); onCommitColorChange(); }}
            fontSize="13px"
          />
        </div>
        <div className="info-item">
          <span className="info-label">线条粗细 (px)</span>
          <input
            type="number"
            className="info-input"
            value={edgeWidth}
            onChange={(e) => onWidthChange(Number(e.target.value))}
            onBlur={onCommitWidthChange}
            onKeyDown={handleKeyDown}
            min={1}
            max={10}
          />
        </div>
      </div>

      {/* 标签样式设置 */}
      <div className="info-section">
        <div className="info-section-title">标签样式</div>

        <div className="info-item">
          <span className="info-label">文字大小 (px)</span>
          <input
            type="number"
            className="info-input"
            value={edgeLabelFontSizeStr}
            onChange={(e) => onLabelFontSizeChange(e.target.value)}
            onFocus={(e) => {
              onInputFocus(e);
              onLabelFontSizeChange(String(edgeLabelFontSize));
            }}
            onBlur={(e) => {
              onInputBlur(e);
              onCommitLabelFontSizeChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            min={6}
            max={72}
          />
        </div>

        <div className="info-item">
          <span className="info-label">字体</span>
          <select
            className="info-input"
            value={edgeLabelFontFamily}
            onChange={(e) => onLabelFontFamilyChange(e.target.value)}
          >
            <option value="微软雅黑">微软雅黑</option>
            <option value="Arial">Arial</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier New">Courier New</option>
            <option value="Verdana">Verdana</option>
            <option value="Georgia">Georgia</option>
            <option value="Palatino">Palatino</option>
            <option value="Garamond">Garamond</option>
            <option value="Bookman">Bookman</option>
            <option value="Comic Sans MS">Comic Sans MS</option>
            <option value="Trebuchet MS">Trebuchet MS</option>
            <option value="Arial Black">Arial Black</option>
            <option value="Impact">Impact</option>
          </select>
        </div>

        <div className="info-item">
          <span className="info-label">字体粗细</span>
          <select
            className="info-input"
            value={edgeLabelFontWeight}
            onChange={(e) => onLabelFontWeightChange(Number(e.target.value))}
          >
            <option value="300">细体 (300)</option>
            <option value="400">正常 (400)</option>
            <option value="600">半粗 (600)</option>
          </select>
        </div>

        <div className="info-item">
          <span className="info-label">文字颜色</span>
          <HexColorInput
            value={edgeLabelColor}
            onChange={onLabelColorChange}
            fontSize="13px"
          />
        </div>

        <div className="info-item">
          <span className="info-label">背景色</span>
          <HexColorInput
            value={edgeLabelBgColor}
            onChange={onLabelBgColorChange}
            fontSize="13px"
          />
        </div>

        <div className="info-item">
          <span className="info-label">透明度</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <input
              type="range"
              min="0"
              max="100"
              value={edgeLabelOpacity}
              onChange={(e) => {
                const val = Number(e.target.value);
                onLabelOpacityChange(val, String(val));
                onCommitLabelOpacityChange();
              }}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              min="0"
              max="100"
              value={edgeLabelOpacityStr}
              onChange={(e) => {
                // Update string immediately
                onLabelOpacityChange(Number(e.target.value), e.target.value);
              }}
              onFocus={(e) => {
                onInputFocus(e);
                onLabelOpacityChange(edgeLabelOpacity, String(edgeLabelOpacity));
              }}
              onBlur={(e) => {
                onInputBlur(e);
                // Commit logic should be handled by parent based on string or value
                onCommitLabelOpacityChange();
              }}
              onKeyDown={handleKeyDown}
              style={{
                width: '60px',
                padding: '4px 8px',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                textAlign: 'center',
              }}
            />
            <span style={{ color: '#64748b', fontSize: '12px' }}>%</span>
          </div>
        </div>

        <div className="info-item">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <span className="info-label">背景宽度</span>
            {edgeLabelBgWidth !== 'auto' && (
              <button
                onClick={onResetBgWidth}
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  background: '#f0f0f0',
                  border: '1px solid #d9d9d9',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  color: '#666',
                }}
              >
                重置
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="number"
                min="1"
                value={edgeLabelBgWidthStr}
                onChange={(e) => onLabelBgWidthChange(e.target.value)}
                onFocus={onInputFocus}
                onBlur={(e) => {
                  onInputBlur(e);
                  onCommitLabelBgWidth(e.target.value);
                }}
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  paddingRight: edgeLabelBgWidth === 'auto' ? '50px' : '8px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  color: edgeLabelBgWidth === 'auto' ? '#999' : '#333',
                }}
              />
              {edgeLabelBgWidth === 'auto' && (
                <span
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '11px',
                    color: '#1890ff',
                    pointerEvents: 'none',
                  }}
                >
                  自动
                </span>
              )}
            </div>
            <span style={{ color: '#64748b', fontSize: '12px' }}>px</span>
          </div>
        </div>

        <div className="info-item">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '4px',
              width: '100%',
            }}
          >
            <span className="info-label">背景高度</span>
            {edgeLabelBgHeight !== 'auto' && (
              <button
                onClick={onResetBgHeight}
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  background: '#f0f0f0',
                  border: '1px solid #d9d9d9',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  color: '#666',
                }}
              >
                重置
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="number"
                min="1"
                value={edgeLabelBgHeightStr}
                onChange={(e) => onLabelBgHeightChange(e.target.value)}
                onFocus={onInputFocus}
                onBlur={(e) => {
                  onInputBlur(e);
                  onCommitLabelBgHeight(e.target.value);
                }}
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  paddingRight: edgeLabelBgHeight === 'auto' ? '50px' : '8px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  color: edgeLabelBgHeight === 'auto' ? '#999' : '#333',
                }}
              />
              {edgeLabelBgHeight === 'auto' && (
                <span
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '11px',
                    color: '#1890ff',
                    pointerEvents: 'none',
                  }}
                >
                  自动
                </span>
              )}
            </div>
            <span style={{ color: '#64748b', fontSize: '12px' }}>px</span>
          </div>
        </div>
      </div>
    </div>
  );
});
