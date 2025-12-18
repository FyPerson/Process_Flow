/**
 * 颜色格式统一工具函数
 */

/**
 * 将颜色值统一为小写十六进制格式
 * @param color - 输入的颜色值
 * @returns 小写十六进制格式的颜色值，如 #000000。如果输入为空，返回空字符串。
 */
export function normalizeColor(color: string | undefined | null): string {
  if (!color) return '';

  const c = color.trim().toLowerCase();

  // 如果已经是十六进制格式
  if (c.startsWith('#')) {
    // 处理短十六进制 #xyz -> #xxyyzz
    if (c.length === 4) {
      return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    }
    return c;
  }

  // 如果是 rgb/rgba 格式，转换为十六进制
  const rgbMatch = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  // 其他情况返回原值的小写形式
  // 也可以考虑在这里处理命名颜色（如 'red' -> '#ff0000'），但通常输入是 hex
  return c;
}

/**
 * 验证颜色值是否为有效的十六进制格式
 * @param color - 颜色值
 * @returns 是否有效
 */
export function isValidHexColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}
