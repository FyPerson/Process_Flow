import { memo, useMemo, CSSProperties } from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';

import { FlowNodeData, TextFontKey } from '../../types/flow';

interface TextNodeProps extends NodeProps {
  style?: CSSProperties;
}

// 字体 key → font-family 字符串
// 与 docs/规划/文本框节点/方案.md §3 对齐
const FONT_FAMILY_MAP: Record<TextFontKey, string> = {
  heiti: "'SimHei', 'Microsoft YaHei', sans-serif",
  yahei: "'Microsoft YaHei', sans-serif",
  kaiti: "'KaiTi', '楷体', serif",
  songti: "'SimSun', '宋体', serif",
  fangsong: "'FangSong', '仿宋', serif",
};

const DEFAULT_FONT: TextFontKey = 'heiti';
const DEFAULT_FONT_SIZE = 24;
const DEFAULT_COLOR = '#000000';

export const TextNode = memo(({ data, selected, style }: TextNodeProps) => {
  const nodeData = data as unknown as FlowNodeData;

  const fontFamily = FONT_FAMILY_MAP[nodeData.textFontFamily ?? DEFAULT_FONT];
  const fontSize = nodeData.textFontSize ?? DEFAULT_FONT_SIZE;
  const color = nodeData.textColor ?? DEFAULT_COLOR;

  const text = nodeData.name || '请输入说明文字';

  const wrapperStyle = useMemo<CSSProperties>(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      padding: '4px 8px',
      boxSizing: 'border-box',
      background: 'transparent',
      // 选中时显示虚线轮廓，便于区分纯展示节点已被选中
      outline: selected ? '1px dashed #6366f1' : 'none',
      outlineOffset: 2,
      cursor: 'move',
      userSelect: 'none',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }),
    [selected]
  );

  const textStyle = useMemo<CSSProperties>(
    () => ({
      fontFamily,
      fontSize: `${fontSize}px`,
      color,
      lineHeight: 1.4,
      width: '100%',
    }),
    [fontFamily, fontSize, color]
  );

  return (
    <>
      {/* 仅选中时显示拖拽 resize 控制点；最小尺寸防误操作收成 0 */}
      <NodeResizer
        isVisible={selected}
        minWidth={60}
        minHeight={24}
        lineStyle={{ borderColor: '#6366f1' }}
        handleStyle={{ background: '#6366f1', width: 8, height: 8 }}
      />
      <div style={wrapperStyle} className="text-node-wrapper">
        <span style={textStyle}>{text}</span>
      </div>
    </>
  );
});

TextNode.displayName = 'TextNode';
