import { memo, useCallback } from 'react';
import type { FlowNodeData, NodeUpdateParams, TextFontKey } from '../../types/flow';
import type { SelectedElement } from './index';

interface TextNodePropertiesPanelProps {
  selectedElement: Extract<SelectedElement, { type: 'node' }>;
  onNodeChange: (id: string, updates: NodeUpdateParams) => void;
  canEdit: boolean;
}

// 与 src/components/TextNode/index.tsx FONT_FAMILY_MAP 对齐
const FONT_OPTIONS: Array<{ value: TextFontKey; label: string }> = [
  { value: 'heiti', label: '黑体' },
  { value: 'yahei', label: '微软雅黑' },
  { value: 'kaiti', label: '楷体' },
  { value: 'songti', label: '宋体' },
  { value: 'fangsong', label: '仿宋' },
];

const FONT_SIZE_OPTIONS = [14, 18, 24, 32, 48];

// 复用现有节点常用颜色板（与 NodeStyleEditor 风格保持一致；不引入新色板）
const COLOR_OPTIONS = [
  '#000000', // 黑
  '#374151', // 深灰
  '#dc2626', // 红
  '#ea580c', // 橙
  '#d97706', // 琥珀
  '#16a34a', // 绿
  '#2563eb', // 蓝
  '#6366f1', // 靛
  '#9333ea', // 紫
  '#db2777', // 粉
];

export const TextNodePropertiesPanel = memo(
  ({ selectedElement, onNodeChange, canEdit }: TextNodePropertiesPanelProps) => {
    const data = selectedElement.data as FlowNodeData;

    const update = useCallback(
      (patch: Partial<FlowNodeData>) => {
        onNodeChange(data.id, { data: patch });
      },
      [data.id, onNodeChange]
    );

    const fontFamily = data.textFontFamily ?? 'heiti';
    const fontSize = data.textFontSize ?? 24;
    const color = data.textColor ?? '#000000';

    return (
      <fieldset
        disabled={!canEdit}
        style={{ border: 'none', padding: '12px 16px', margin: 0 }}
      >
        <div className="section">
          <div className="section-title" style={{ marginBottom: 8 }}>
            文字内容
          </div>
          <textarea
            value={data.name}
            onChange={(e) => update({ name: e.target.value })}
            rows={3}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4,
              color: '#e2e8f0',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
            placeholder="请输入说明文字"
          />
        </div>

        <div className="section" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            字体
          </div>
          <select
            value={fontFamily}
            onChange={(e) => update({ textFontFamily: e.target.value as TextFontKey })}
            style={{
              width: '100%',
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4,
              color: '#e2e8f0',
              fontSize: 13,
            }}
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="section" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            字号
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FONT_SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => update({ textFontSize: size })}
                style={{
                  padding: '4px 12px',
                  background:
                    fontSize === size
                      ? 'rgba(99, 102, 241, 0.3)'
                      : 'rgba(255,255,255,0.05)',
                  border:
                    fontSize === size
                      ? '1px solid #6366f1'
                      : '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 4,
                  color: '#e2e8f0',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {size}px
              </button>
            ))}
          </div>
        </div>

        <div className="section" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            文字颜色
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => update({ textColor: c })}
                title={c}
                style={{
                  width: 28,
                  height: 28,
                  background: c,
                  border:
                    color === c
                      ? '2px solid #6366f1'
                      : '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => update({ textColor: e.target.value })}
              title="自定义颜色"
              style={{
                width: 28,
                height: 28,
                padding: 0,
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 4,
                cursor: 'pointer',
                background: 'transparent',
              }}
            />
          </div>
        </div>
      </fieldset>
    );
  }
);

TextNodePropertiesPanel.displayName = 'TextNodePropertiesPanel';
