// P3E-3 批注面板（共享组件，纯 props 驱动）
//
// 设计要点（codex 06-取舍审锁定）：
// - NodeDetailPanel 顶层 "详情/批注" 二级 tab 切换（统一普通节点 + 分组节点）
// - 本组件为纯展示组件，hook 数据由上层 NodeDetailPanel 通过 props 传入
// - 7 条 UI 规则：表单顶部 / 列表正序 / resolve 按钮右上 / 默认隐藏 resolved
//   / resolved 灰度 + 显示解决人时间 / 错误 inline / 空状态引导文案
// - loading 不显示假空状态
// - 提交期间按钮 disabled 防双击；resolve/reopen 用 isAnnotationPending(id) 防重复
//
// 服务端契约（与 server/schemas/annotation.ts + services/annotations.ts 对齐）：
// - 关闭权限：批注作者 / 节点 creator / admin（前端 UI 只拦显式越权点击；服务端兜底）
// - 容量限制：content trim 后 1-2000 字符；单节点 unresolved ≤ 100；超限 409

import { useMemo, useState } from 'react';
import type { Annotation, ApiError, CreateAnnotationInput } from '../../api/annotations';
import type { UserPublic } from '../../auth/api';

interface AnnotationPanelProps {
  /** 当前选中节点所在 sheet 的 id（与 nodeId 复合定位） */
  sheetId: string;
  /** 当前选中节点 id */
  nodeId: string;
  /** 该节点的全部批注（按 created_at 正序，由 useAnnotations 派生） */
  annotations: Annotation[];
  /** 节点 creator id（用于关闭权限判定）；无 nodes_meta 记录时 undefined */
  nodeCreatorId: number | undefined;
  /** 当前登录用户；游客 null（理论上 readReady=false 时不会渲染本组件，但兜底） */
  user: UserPublic | null;
  /** 整画布是否在加载批注（hook.loading）；为 true 时显示加载行而非空状态 */
  loading: boolean;
  /** 上次 fetch 错误（hook.error） —— 仅展示，不阻塞操作 */
  fetchError: ApiError | null;
  /** 是否有数据层访问权（hook 的 enabled 判定）：本地草稿/游客/canvasMetaState!=='server' 时 false */
  enabled: boolean;
  /** 同 id 是否在 mutation 飞行（hook.isAnnotationPending） */
  isAnnotationPending: (id: number) => boolean;
  /** 创建批注（hook.createAnnotation）；失败 throw ApiError */
  onCreate: (input: CreateAnnotationInput) => Promise<Annotation>;
  /** 标记 resolved；失败 throw ApiError */
  onResolve: (id: number) => Promise<void>;
  /** 重开；失败 throw ApiError */
  onReopen: (id: number) => Promise<void>;
}

/**
 * 关闭权限判定（前端 UI 层；服务端 services/annotations.ts canCloseAnnotation 兜底）。
 *
 * @returns true 当前用户能关闭/重开此批注
 */
function canCloseAnnotation(
  annotation: Annotation,
  user: UserPublic | null,
  nodeCreatorId: number | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (annotation.author_id === user.id) return true;
  if (nodeCreatorId !== undefined && nodeCreatorId === user.id) return true;
  return false;
}

/** 格式化批注时间（"YYYY-MM-DD HH:mm"）。空值 fallback 为 "—"。 */
function formatTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 格式化作者名（fallback "用户 #N" / "未知作者"）。 */
function formatAuthorName(annotation: Pick<Annotation, 'author_id' | 'author_username'>): string {
  if (annotation.author_username) return annotation.author_username;
  if (annotation.author_id) return `用户 #${annotation.author_id}`;
  return '未知作者';
}

export function AnnotationPanel({
  sheetId,
  nodeId,
  annotations,
  nodeCreatorId,
  user,
  loading,
  fetchError,
  enabled,
  isAnnotationPending,
  onCreate,
  onResolve,
  onReopen,
}: AnnotationPanelProps) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<ApiError | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  // 单条 mutation error（per-id 反馈）
  const [mutationError, setMutationError] = useState<{ id: number; error: ApiError } | null>(null);

  // 派生：unresolved + resolved 拆开（开关控制 resolved 是否显示）
  const { unresolved, resolved } = useMemo(() => {
    const u: Annotation[] = [];
    const r: Annotation[] = [];
    for (const a of annotations) {
      (a.status === 'unresolved' ? u : r).push(a);
    }
    return { unresolved: u, resolved: r };
  }, [annotations]);

  // 不可用文案（游客 / 本地草稿 / readReady=false）
  if (!enabled) {
    return (
      <div style={{ padding: 16, color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: '#cbd5e1' }}>批注暂不可用</div>
        <div>
          {!user
            ? '请先登录以查看和添加批注。'
            : '画布尚未加载完成或未连接到服务端，请稍候。'}
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    const content = draft.trim();
    if (!content) {
      setCreateError({ status: 0, error: 'empty', message: '批注内容不能为空' });
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      await onCreate({ sheetId, nodeId, content });
      setDraft('');
    } catch (e) {
      setCreateError(e as ApiError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (id: number) => {
    setMutationError(null);
    try {
      await onResolve(id);
    } catch (e) {
      setMutationError({ id, error: e as ApiError });
    }
  };

  const handleReopen = async (id: number) => {
    setMutationError(null);
    try {
      await onReopen(id);
    } catch (e) {
      setMutationError({ id, error: e as ApiError });
    }
  };

  const draftLength = draft.trim().length;
  const draftOverLimit = draftLength > 2000;

  return (
    <div style={{ padding: 16, color: '#e2e8f0' }}>
      {/* === 新增表单 === */}
      <div style={{ marginBottom: 16 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="写一条批注…（支持纯文本，1-2000 字符）"
          rows={3}
          style={{
            width: '100%',
            padding: '8px 10px',
            background: '#0f172a',
            border: `1px solid ${draftOverLimit ? 'rgba(239, 68, 68, 0.6)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 6,
            color: '#e2e8f0',
            fontSize: 13,
            resize: 'vertical',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
          disabled={submitting}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 6,
          }}
        >
          <span style={{ fontSize: 11, color: draftOverLimit ? '#fca5a5' : '#64748b' }}>
            {draftLength} / 2000
          </span>
          <button
            onClick={handleSubmit}
            disabled={submitting || draftLength === 0 || draftOverLimit}
            style={{
              padding: '6px 14px',
              background:
                submitting || draftLength === 0 || draftOverLimit
                  ? 'rgba(59, 130, 246, 0.3)'
                  : 'rgba(59, 130, 246, 0.8)',
              border: '1px solid rgba(59, 130, 246, 0.5)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 13,
              cursor:
                submitting || draftLength === 0 || draftOverLimit ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? '发布中…' : '发布批注'}
          </button>
        </div>
        {createError && (
          <ErrorBanner error={createError} onDismiss={() => setCreateError(null)} />
        )}
      </div>

      {/* === 列表标题 + "显示已解决"开关 === */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
          批注（未解决 {unresolved.length} / 已解决 {resolved.length}）
        </div>
        {resolved.length > 0 && (
          <label
            style={{
              fontSize: 12,
              color: '#cbd5e1',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            显示已解决
          </label>
        )}
      </div>

      {/* === 列表 === */}
      {fetchError && (
        // fetch error 由 hook 管理（下次 refetch 成功自动清），不暴露 dismiss 按钮
        <ErrorBanner error={fetchError} />
      )}
      {loading && annotations.length === 0 ? (
        <div style={{ fontSize: 12, color: '#64748b', padding: '12px 0' }}>加载中…</div>
      ) : annotations.length === 0 ? (
        <div style={{ fontSize: 12, color: '#64748b', padding: '12px 0', textAlign: 'center' }}>
          暂无批注，添加第一条吧。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {unresolved.map((a) => (
            <AnnotationItem
              key={a.id}
              annotation={a}
              canClose={canCloseAnnotation(a, user, nodeCreatorId)}
              isPending={isAnnotationPending(a.id)}
              mutationError={mutationError?.id === a.id ? mutationError.error : null}
              onResolve={handleResolve}
              onReopen={handleReopen}
              onDismissError={() => setMutationError(null)}
            />
          ))}
          {showResolved &&
            resolved.map((a) => (
              <AnnotationItem
                key={a.id}
                annotation={a}
                canClose={canCloseAnnotation(a, user, nodeCreatorId)}
                isPending={isAnnotationPending(a.id)}
                mutationError={mutationError?.id === a.id ? mutationError.error : null}
                onResolve={handleResolve}
                onReopen={handleReopen}
                onDismissError={() => setMutationError(null)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 单条批注卡片
// =====================================================================

interface AnnotationItemProps {
  annotation: Annotation;
  canClose: boolean;
  isPending: boolean;
  mutationError: ApiError | null;
  onResolve: (id: number) => void;
  onReopen: (id: number) => void;
  onDismissError: () => void;
}

/** codex 07-代码审 medium 3 + low 1：按字符 + 按行同时折叠，取更短结果。
 *  - 行数超 6：lines.slice(0, 6).join('\n') + '…'
 *  - 字符超 200：content.slice(0, 200) + '…'
 *  - 两者都触发：取字符数更少的（更紧凑）
 *  - 都不触发：返 content 原文（caller 用 tooLong 判断是否需要折叠 UI） */
function getCollapsedContent(content: string): { collapsed: string; tooLong: boolean } {
  const lines = content.split('\n');
  const overLines = lines.length > 6;
  const overChars = content.length > 200;
  if (!overLines && !overChars) {
    return { collapsed: content, tooLong: false };
  }
  const byLines = overLines ? lines.slice(0, 6).join('\n') + '…' : content;
  const byChars = overChars ? content.slice(0, 200) + '…' : content;
  // 取更短结果（更紧凑的折叠展示）
  const collapsed = byChars.length <= byLines.length ? byChars : byLines;
  return { collapsed, tooLong: true };
}

function AnnotationItem({
  annotation,
  canClose,
  isPending,
  mutationError,
  onResolve,
  onReopen,
  onDismissError,
}: AnnotationItemProps) {
  const [expanded, setExpanded] = useState(false);
  const isResolved = annotation.status === 'resolved';
  const { collapsed: collapsedContent, tooLong } = getCollapsedContent(annotation.content);
  const displayContent = !expanded && tooLong ? collapsedContent : annotation.content;

  return (
    <div
      style={{
        padding: 10,
        background: isResolved ? 'rgba(100, 116, 139, 0.08)' : 'rgba(59, 130, 246, 0.06)',
        border: `1px solid ${isResolved ? 'rgba(100, 116, 139, 0.2)' : 'rgba(59, 130, 246, 0.2)'}`,
        borderRadius: 6,
        opacity: isResolved ? 0.7 : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          <span style={{ color: '#cbd5e1', fontWeight: 500 }}>
            {formatAuthorName(annotation)}
          </span>
          {' · '}
          {formatTime(annotation.created_at)}
          {isResolved && (
            <>
              {' · '}
              <span style={{ color: '#64748b' }}>
                由{' '}
                <span style={{ color: '#94a3b8' }}>
                  {annotation.resolved_by_username
                    || (annotation.resolved_by ? `用户 #${annotation.resolved_by}` : '—')}
                </span>{' '}
                于 {formatTime(annotation.resolved_at)} 解决
              </span>
            </>
          )}
        </div>
        {canClose && (
          <button
            onClick={() => (isResolved ? onReopen(annotation.id) : onResolve(annotation.id))}
            disabled={isPending}
            style={{
              padding: '2px 8px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4,
              color: isPending ? '#475569' : '#94a3b8',
              fontSize: 11,
              cursor: isPending ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            {isPending ? '处理中' : isResolved ? '重开' : '解决'}
          </button>
        )}
      </div>
      <div
        style={{
          fontSize: 13,
          color: '#e2e8f0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.5,
        }}
      >
        {displayContent}
      </div>
      {tooLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: 4,
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: '#60a5fa',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
      {mutationError && (
        <ErrorBanner error={mutationError} onDismiss={onDismissError} />
      )}
    </div>
  );
}

// =====================================================================
// 错误条（inline，不引 toast 基建）
// =====================================================================

interface ErrorBannerProps {
  error: ApiError;
  /** 用户主动关闭时调；undefined 则不显示关闭按钮（codex 07-代码审 medium 4） */
  onDismiss?: () => void;
}

function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  const message = error.message || formatErrorCode(error.error) || '操作失败';
  return (
    <div
      style={{
        marginTop: 8,
        padding: '6px 10px',
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        borderRadius: 4,
        color: '#fca5a5',
        fontSize: 12,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: '#fca5a5',
            fontSize: 14,
            cursor: 'pointer',
            lineHeight: 1,
          }}
          title="关闭"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** 已知错误码 → 中文文案 */
function formatErrorCode(code: string): string | null {
  switch (code) {
    case 'unresolved_limit':
      return '该节点未解决批注已达上限 100 条，请先解决部分再继续。';
    case 'total_limit':
      return '该节点批注总数已达上限 500 条。';
    case 'node_not_found':
      return '节点不存在（可能已被删除或保存未完成）。';
    case 'forbidden_close_annotation':
      return '仅批注作者、节点创建者或管理员可关闭/重开此批注。';
    case 'forbidden':
      return '没有权限。';
    case 'unauthorized':
      return '请先登录。';
    case 'not_found':
      return '批注不存在或已被删除。';
    case 'annotation_mutation_pending':
      return '该批注上一个操作还在进行中。';
    case 'annotation_not_in_cache':
      return '该批注不在本地缓存中（请刷新后重试）。';
    case 'not_ready':
      return '画布尚未就绪。';
    case 'invalid_input':
      return '输入不合法。';
    case 'empty':
      return '内容不能为空。';
    case 'network_error':
      return '网络错误，请检查连接。';
    default:
      return null;
  }
}
