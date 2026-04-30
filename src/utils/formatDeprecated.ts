// P3C 废弃元信息显示工具
//
// 抽出原因（codex 建议项 3）：DeprecateNodeSection / CustomNode / GroupNode 三处
// 重复了相同的 pad + 拼接逻辑，字段扩展时容易漏改。

/** 时间戳 → "YYYY-MM-DD HH:mm"。undefined 返回空串 */
export function formatDeprecatedAt(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "X 在 YYYY-MM-DD HH:mm 标记废弃" / "X 标记废弃" / "已废弃" */
export function formatDeprecatedTooltip(input: {
  deprecated_by?: number;
  deprecated_at?: number;
  deprecated_by_username?: string;
}): string {
  const userText = input.deprecated_by_username
    || (input.deprecated_by ? `用户 #${input.deprecated_by}` : '');
  const ts = formatDeprecatedAt(input.deprecated_at);
  if (userText && ts) return `${userText} 在 ${ts} 标记废弃`;
  if (userText) return `${userText} 标记废弃`;
  if (ts) return `${ts} 标记废弃`;
  return '已废弃';
}
