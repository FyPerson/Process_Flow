// 其他编辑者指示器（阶段 4 P4C，方案 §4.5）
//
// 显示位置：BFV 顶栏（与 SaveStatus 同一行）
// 数据源：useHeartbeat 返回的 otherEditors（30s 上报刷新）
//
// 显示规则：
// - 0 人 → 不渲染
// - 1-3 人 → chip 列出 nickname（服务端已 fallback 到 username）
// - >3 人 → 前 3 个 chip + "+N" 折叠
// - hover/title → 列出全部 nickname + 最近活跃时间（v1.18.x：username 是手机号时不友好，
//   nickname 优先；服务端已做 trim 判空 fallback，前端直接读 editor.nickname）

import './styles.css';
import type { ActiveEditor } from '../../api/canvases';

interface Props {
  editors: ActiveEditor[];
}

const MAX_VISIBLE = 3;

export function OtherEditorsBadge({ editors }: Props) {
  if (editors.length === 0) return null;

  const visible = editors.slice(0, MAX_VISIBLE);
  const overflow = editors.length - MAX_VISIBLE;

  const tooltipLines = editors.map((e) => {
    const seenSec = Math.max(0, Math.round((Date.now() - e.lastSeenAt) / 1000));
    return `${e.nickname}（${seenSec}s 前活跃）`;
  });

  return (
    <span
      className="other-editors-badge"
      title={`${editors.length} 人在编辑\n${tooltipLines.join('\n')}`}
      role="status"
      aria-label={`${editors.length} 人在编辑`}
    >
      <span className="other-editors-icon" aria-hidden="true">
        👥
      </span>
      {visible.map((editor) => (
        <span key={editor.userId} className="other-editor-chip">
          {editor.nickname}
        </span>
      ))}
      {overflow > 0 && <span className="other-editor-overflow">+{overflow}</span>}
    </span>
  );
}
