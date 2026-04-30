// P3C 标废弃 UI 区块（NodeDetailPanel 单一入口，codex 取舍 1 推荐 A）
//
// 不变量（与服务端 P3A 对齐）：
// - 标废弃是单向操作（false → true），服务端不支持取消废弃
// - 任何登录用户可触发（公开权限），不需 creator 校验
// - 二次确认必填（codex 取舍 3：不做 toast undo，因为服务端不支持撤销）
// - 已废弃节点 → 按钮 disabled，文案告知用户"恢复需 admin 介入或导入旧版本"

import { useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { FlowNodeData, NodeUpdateParams } from '../../types/flow';
import { formatDeprecatedAt, formatDeprecatedTooltip } from '../../utils/formatDeprecated';

interface DeprecateNodeSectionProps {
  /** 当前节点数据（包含 is_deprecated / deprecated_by_username / deprecated_at） */
  nodeData: FlowNodeData;
  /** 用于计算受影响的连线数（二次确认 dialog 显示影响范围） */
  allNodes: Node<FlowNodeData>[];
  /** 当前画布所有连线（计算影响范围用） */
  edgeCount: { fromOrTo: number };
  /** 触发标废弃（写 data.is_deprecated=true，由 onNodeChange → autosave 推到服务端） */
  onNodeChange: (id: string, updates: NodeUpdateParams) => void;
  /** 只读模式（游客 / 归档画布）→ 隐藏整个区块 */
  readOnly: boolean;
}

export function DeprecateNodeSection({
  nodeData,
  edgeCount,
  onNodeChange,
  readOnly,
}: DeprecateNodeSectionProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isDeprecated = !!nodeData.is_deprecated;

  // 显示文案：已废弃节点 tooltip 显示"X 在 YYYY-MM-DD HH:mm 标废弃"
  const deprecatedAtText = useMemo(
    () => formatDeprecatedAt(nodeData.deprecated_at),
    [nodeData.deprecated_at]
  );
  const deprecatedByText = nodeData.deprecated_by_username
    || (nodeData.deprecated_by ? `用户 #${nodeData.deprecated_by}` : '');

  // 只读模式不显示整个区块（无意义，反正点不动）
  if (readOnly) return null;

  const handleConfirmDeprecate = () => {
    onNodeChange(nodeData.id, {
      data: { is_deprecated: true } as Partial<FlowNodeData>,
    });
    setConfirmOpen(false);
  };

  return (
    <div
      className="section"
      style={{
        borderTop: '1px solid rgba(255,255,255,0.08)',
        marginTop: 8,
        padding: '12px 16px',
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: '#94a3b8',
          marginBottom: 8,
          fontWeight: 500,
        }}
      >
        废弃管理
      </div>

      {isDeprecated ? (
        <div>
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 6,
              color: '#fca5a5',
              fontSize: 12,
              lineHeight: 1.6,
            }}
            title={formatDeprecatedTooltip({
              deprecated_by: nodeData.deprecated_by,
              deprecated_at: nodeData.deprecated_at,
              deprecated_by_username: nodeData.deprecated_by_username,
            })}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>● 节点已废弃</div>
            {deprecatedByText && (
              <div>
                {deprecatedByText}
                {deprecatedAtText && ` · ${deprecatedAtText}`}
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
            标废弃为单向操作，前端不支持取消。如需恢复请联系管理员或导入历史版本。
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirmOpen(true)}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 6,
            color: '#fca5a5',
            fontSize: 13,
            cursor: 'pointer',
            transition: 'background 120ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.16)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
          }}
        >
          标记为已废弃
        </button>
      )}

      {confirmOpen && (
        <DeprecateConfirmDialog
          nodeName={nodeData.name}
          edgeCount={edgeCount.fromOrTo}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirmDeprecate}
        />
      )}
    </div>
  );
}

interface DeprecateConfirmDialogProps {
  nodeName: string;
  edgeCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

function DeprecateConfirmDialog({
  nodeName,
  edgeCount,
  onCancel,
  onConfirm,
}: DeprecateConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#1e293b',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          padding: 24,
          minWidth: 360,
          maxWidth: 480,
          color: '#e2e8f0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          确认标记废弃？
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
          将把节点 <span style={{ color: '#fff', fontWeight: 600 }}>{nodeName}</span>{' '}
          标记为已废弃。
          {edgeCount > 0 && (
            <>
              <br />
              受影响：弱化 <span style={{ color: '#fbbf24' }}>{edgeCount}</span>{' '}
              条相关连线（半透明显示）。
            </>
          )}
          <br />
          <br />
          <span style={{ color: '#fca5a5' }}>
            此操作单向不可逆，前端无法撤销。如需恢复需联系管理员或导入历史版本。
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 20,
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 16px',
              background: 'rgba(239, 68, 68, 0.8)',
              border: '1px solid rgba(239, 68, 68, 1)',
              borderRadius: 6,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            标记废弃
          </button>
        </div>
      </div>
    </div>
  );
}
