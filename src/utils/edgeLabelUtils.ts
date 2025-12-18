/**
 * Edge 标签背景尺寸计算工具
 */

/**
 * 解析 padding 值
 * @param paddingStr - padding 字符串，如 "6px 12px"
 * @returns padding 对象
 */
function parsePadding(paddingStr: string): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const parts = paddingStr.trim().split(/\s+/);
  if (parts.length === 2) {
    const vertical = parseFloat(parts[0]) || 6;
    const horizontal = parseFloat(parts[1]) || 12;
    return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
  } else if (parts.length === 4) {
    return {
      top: parseFloat(parts[0]) || 6,
      right: parseFloat(parts[1]) || 12,
      bottom: parseFloat(parts[2]) || 6,
      left: parseFloat(parts[3]) || 12,
    };
  }
  // 默认值
  return { top: 6, right: 12, bottom: 6, left: 12 };
}

/**
 * 估算文本宽度
 * @param text - 文本内容
 * @param fontSize - 字体大小
 * @returns 估算的文本宽度（像素）
 */
function estimateTextWidth(text: string, fontSize: number): number {
  if (!text) return 0;

  let totalWidth = 0;
  for (const char of text) {
    // 判断是否为中文字符
    if (/[\u4e00-\u9fa5]/.test(char)) {
      // 中文字符宽度约为 fontSize
      totalWidth += fontSize;
    } else if (/[a-zA-Z0-9]/.test(char)) {
      // 英文字母和数字宽度约为 fontSize * 0.6
      totalWidth += fontSize * 0.6;
    } else {
      // 其他字符（标点符号等）宽度约为 fontSize * 0.5
      totalWidth += fontSize * 0.5;
    }
  }

  return totalWidth;
}

/**
 * 计算标签背景的默认宽度
 * @param text - 标签文本
 * @param fontSize - 字体大小
 * @param padding - padding 字符串，默认 "6px 12px"
 * @returns 计算后的宽度（像素）
 */
export function calculateDefaultBgWidth(
  text: string,
  fontSize: number,
  padding: string = '6px 12px',
): number {
  const paddingObj = parsePadding(padding);
  const textWidth = estimateTextWidth(text, fontSize);
  return Math.ceil(textWidth + paddingObj.left + paddingObj.right);
}

/**
 * 计算标签背景的默认高度
 * @param fontSize - 字体大小
 * @param padding - padding 字符串，默认 "6px 12px"
 * @returns 计算后的高度（像素）
 */
export function calculateDefaultBgHeight(fontSize: number, padding: string = '6px 12px'): number {
  const paddingObj = parsePadding(padding);
  const lineHeight = fontSize * 1.5; // 行高约为字体大小的 1.5 倍
  return Math.ceil(lineHeight + paddingObj.top + paddingObj.bottom);
}
