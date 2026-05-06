// 草稿恢复弹窗（阶段 4 P4E，方案 §4.6 + 判断点 2/3）
//
// 触发场景：
// 1. 打开服务端画布 → GET /api/canvases/:cid/draft 命中（baseVersion 与 currentVersion 比较）
// 2. 一次性 localStorage 迁移检测命中（旧 'saved-flow-data'）
//
// 用户三选一：
// - 恢复：用 draft.data 替换当前 project（如果 draft.baseVersion < currentVersion 则 toast 警告
//   "主版本已被他人推进；保存时若服务端拒绝（409），需手动比对"——判断点 2 决策）
// - 放弃：DELETE /api/canvases/:cid/draft（或 removeItem localStorage）
// - 留着：关闭弹窗（草稿不删，下次打开仍弹）
//
// XSS 安全：所有用户内容用 React 文本节点渲染，不用 dangerouslySetInnerHTML

import './styles.css';

export interface DraftRecoveryInfo {
  /** 草稿基于的版本号（来自 drafts.base_version）*/
  baseVersion: number;
  /** 当前主版本（用于显示"基于过期版本"警告）*/
  currentVersion: number;
  /** 草稿保存时间戳 */
  savedAt: number;
  /** 来源：服务端 drafts 表 / localStorage 迁移 */
  source: 'server' | 'legacy_local_storage';
}

interface Props {
  info: DraftRecoveryInfo;
  onRestore: () => void;
  onDiscard: () => void;
  onKeep: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function DraftRecoveryDialog({ info, onRestore, onDiscard, onKeep }: Props) {
  const isOutdated = info.source === 'server' && info.baseVersion < info.currentVersion;
  const isLegacy = info.source === 'legacy_local_storage';

  return (
    <div className="draft-recovery-overlay" role="dialog" aria-modal="true">
      <div className="draft-recovery-dialog">
        <h3 className="draft-recovery-title">
          {isLegacy ? '检测到本地草稿（旧版）' : '检测到未保存的草稿'}
        </h3>
        <div className="draft-recovery-body">
          {isLegacy ? (
            <p>
              在你的浏览器本地缓存里发现了之前的草稿。当前版本已经使用服务端保存，旧的本地草稿可能不再需要。
            </p>
          ) : (
            <p>
              你上次离开此画布时有一份未保存到主版本的草稿（{formatTime(info.savedAt)}）。
            </p>
          )}
          {isOutdated && (
            <p className="draft-recovery-warning">
              ⚠️ 此草稿基于版本 v{info.baseVersion}，但主版本已被他人更新到 v
              {info.currentVersion}。如果恢复后保存，服务端会拒绝（要求基于最新版本）。
              建议先导出草稿备份再决定。
            </p>
          )}
        </div>
        <div className="draft-recovery-actions">
          <button
            type="button"
            className="draft-recovery-btn draft-recovery-btn--primary"
            onClick={onRestore}
          >
            恢复草稿
          </button>
          <button
            type="button"
            className="draft-recovery-btn"
            onClick={onKeep}
          >
            稍后再说
          </button>
          <button
            type="button"
            className="draft-recovery-btn draft-recovery-btn--danger"
            onClick={onDiscard}
          >
            放弃草稿
          </button>
        </div>
      </div>
    </div>
  );
}
