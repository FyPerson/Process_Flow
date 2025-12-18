import { memo } from 'react';
import { HexColorInput } from './HexColorInput';

interface NodeStyleEditorProps {
  // Node Identity
  nodeType?: string;
  nodeSubType?: string; // for terminator etc

  // Dimensions
  width: number | undefined;
  height: number | undefined;
  widthStr: string;
  heightStr: string;
  onWidthChange: (val: number | undefined, str: string) => void;
  onHeightChange: (val: number | undefined, str: string) => void;
  onCommitDimension: () => void; // onBlur

  // Font
  fontSize: number;
  fontSizeStr: string;
  fontColor: string;
  fontFamily: string;
  fontWeight: number;
  onFontSizeChange: (val: number, str: string) => void;
  onCommitFontSize: () => void;
  onFontColorChange: (val: string) => void; // immediate
  onFontFamilyChange: (val: string) => void;
  onFontWeightChange: (val: number) => void;

  // Background & Border
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  onBackgroundColorChange: (val: string) => void;
  onBorderColorChange: (val: string) => void;
  onBorderWidthChange: (val: number) => void;

  // Refs
  editingInputRef: React.MutableRefObject<HTMLElement | null>;
  onInputFocus: (e: React.FocusEvent<HTMLElement>) => void;
  onInputBlur: (e: React.FocusEvent<HTMLElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export const NodeStyleEditor = memo(function NodeStyleEditor({
  nodeType,
  nodeSubType,

  width,
  height,
  widthStr,
  heightStr,
  onWidthChange,
  onHeightChange,
  onCommitDimension,

  fontSize,
  fontSizeStr,
  fontColor,
  fontFamily,
  fontWeight,
  onFontSizeChange,
  onCommitFontSize,
  onFontColorChange,
  onFontFamilyChange,
  onFontWeightChange,

  backgroundColor,
  borderColor,
  borderWidth,
  onBackgroundColorChange,
  onBorderColorChange,
  onBorderWidthChange,

  editingInputRef,
  onInputFocus,
  onInputBlur,
  handleKeyDown,
}: NodeStyleEditorProps) {

  // Helper to determine if we should show certain options based on node type
  // For now, we show everything, but we can customize labels or defaults if needed.

  return (
    <div className="detail-section">
      <h3 className="panel-title" style={{ marginTop: '0', marginBottom: '12px' }}>样式设置</h3>

      {/* Dimensions */}
      <div className="info-item">
        <span className="info-label">宽度 (px)</span>
        <div style={{ position: 'relative', flex: 1, width: '100%' }}>
          <input
            type="number"
            className="info-input"
            value={widthStr}
            onChange={(e) => {
              const str = e.target.value;
              const num = str === '' ? undefined : Number(str);
              onWidthChange(num, str);
            }}
            onFocus={onInputFocus}
            onBlur={(e) => {
              onInputBlur(e);
              onCommitDimension();
            }}
            onKeyDown={handleKeyDown}
            placeholder="自动"
          />
          {width === undefined && (
            <span
              style={{
                position: 'absolute',
                right: '40px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '11px',
                color: '#94a3b8',
                pointerEvents: 'none',
              }}
            >
              自动
            </span>
          )}
        </div>
      </div>

      <div className="info-item">
        <span className="info-label">高度 (px)</span>
        <div style={{ position: 'relative', flex: 1, width: '100%' }}>
          <input
            type="number"
            className="info-input"
            value={heightStr}
            onChange={(e) => {
              const str = e.target.value;
              const num = str === '' ? undefined : Number(str);
              onHeightChange(num, str);
            }}
            onFocus={onInputFocus}
            onBlur={(e) => {
              onInputBlur(e);
              onCommitDimension();
            }}
            onKeyDown={handleKeyDown}
            placeholder="自动"
          />
          {height === undefined && (
            <span
              style={{
                position: 'absolute',
                right: '40px', // Adjusted for centered content
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '11px',
                color: '#94a3b8',
                pointerEvents: 'none',
              }}
            >
              自动
            </span>
          )}
        </div>
      </div>

      {/* Font Settings */}
      <div className="info-item">
        <span className="info-label">字号 (px)</span>
        <input
          type="number"
          className="info-input"
          value={fontSizeStr}
          onChange={(e) => {
            const str = e.target.value;
            const num = Number(str);
            onFontSizeChange(isNaN(num) ? 14 : num, str);
          }}
          onFocus={(e) => {
            onInputFocus(e);
            onFontSizeChange(fontSize, String(fontSize)); // ensure sync
          }}
          onBlur={(e) => {
            onInputBlur(e);
            onCommitFontSize();
          }}
          onKeyDown={handleKeyDown}
          placeholder="14"
        />
      </div>

      <div className="info-item">
        <span className="info-label">字体颜色</span>
        <HexColorInput
          value={fontColor}
          onChange={onFontColorChange}
          fontSize="13px"
        />
      </div>

      <div className="info-item">
        <span className="info-label">字体</span>
        <select
          className="info-input"
          value={fontFamily}
          onChange={(e) => onFontFamilyChange(e.target.value)}
        >
          <option value="微软雅黑">微软雅黑</option>
          <option value="SimSun">宋体</option>
          <option value="SimHei">黑体</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
        </select>
      </div>

      <div className="info-item">
        <span className="info-label">字重</span>
        <select
          className="info-input"
          value={fontWeight}
          onChange={(e) => onFontWeightChange(Number(e.target.value))}
        >
          <option value={300}>细体 (300)</option>
          <option value={400}>正常 (400)</option>
          <option value={600}>粗体 (600)</option>
        </select>
      </div>

      <div className="info-item">
        <span className="info-label">背景颜色</span>
        <HexColorInput
          value={backgroundColor}
          onChange={onBackgroundColorChange}
          fontSize="13px"
        />
      </div>

      <div className="info-item">
        <span className="info-label">边框颜色</span>
        <HexColorInput
          value={borderColor}
          onChange={onBorderColorChange}
          fontSize="13px"
        />
      </div>

      <div className="info-item">
        <span className="info-label">边框宽 (px)</span>
        <input
          type="number"
          className="info-input"
          value={borderWidth}
          onChange={(e) => onBorderWidthChange(Number(e.target.value))}
          min={0}
          max={10}
        />
      </div>
    </div >
  );
});
