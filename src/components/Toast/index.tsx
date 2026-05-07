// Day 4 F-8 + H2 + M5 + L1：Toast 基建（ToastProvider + useToast()）
//
// 设计决策（codex Day 4 切片设计审 H2 + M5 + L1 + A2）：
// - **ToastProvider + useToast() hook 模式**（不是全局 imperative Toast.show()）
//   理由：session 去重 + 替换 + 测试隔离 + React 生态一致
// - **React Portal 挂 document.body**（M5）
//   理由：Chrome/Firefox/Edge 100+ 全支持；避免 z-index/transform/input 捕获问题
// - **少动画 / 不用 backdrop-filter**（M5）
//   理由：避免 React Flow 1000+ 节点画布主线程冲突
// - **业务级 session once 不在 ToastHost**（A2）
//   理由：D-8 session once 是业务语义；ToastHost 只提供通用 key replacement
//   BFV 持有 deferredMergeToastShownRef（F-11）做业务级去重

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './styles.css';

export type ToastSeverity = 'info' | 'success' | 'warning';

export interface ToastInput {
  /** 业务唯一 key — 相同 key 的 toast 后者覆盖前者（通用 key replacement，A2 调整）
   *  如果 key 缺省则视为独立 toast（多条并存）*/
  key?: string;
  severity?: ToastSeverity;
  /** 主标题：1 行短句 */
  title: string;
  /** 详情：可选，多行；如果有则展示「展开/收起」按钮 */
  detail?: string;
  /** 自动消失时间（ms），默认 5000；设 0 表示常驻直到用户手动关 */
  durationMs?: number;
}

interface ToastInstance extends Required<Omit<ToastInput, 'detail'>> {
  /** 内部生成的渲染 ID（与 user-supplied key 不同；key 可重，id 不重） */
  id: number;
  detail: string | undefined;
  /** 创建时间戳（用于动画 / 调试） */
  createdAt: number;
}

interface ToastContextValue {
  show: (input: ToastInput) => void;
  dismiss: (idOrKey: number | string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastInstance[]>([]);
  const idSeqRef = useRef(0);

  const show = useCallback((input: ToastInput) => {
    const id = ++idSeqRef.current;
    const instance: ToastInstance = {
      id,
      key: input.key ?? `__auto_${id}`,
      severity: input.severity ?? 'info',
      title: input.title,
      detail: input.detail,
      durationMs: input.durationMs ?? 5000,
      createdAt: Date.now(),
    };
    setToasts((prev) => {
      // 通用 key replacement：相同 key 的 toast 后者覆盖前者
      // 业务级 session once 由 caller（BFV deferredMergeToastShownRef）控制，不在这里
      const filtered = input.key
        ? prev.filter((t) => t.key !== input.key)
        : prev;
      return [...filtered, instance];
    });
  }, []);

  const dismiss = useCallback((idOrKey: number | string) => {
    setToasts((prev) =>
      prev.filter((t) =>
        typeof idOrKey === 'number' ? t.id !== idOrKey : t.key !== idOrKey,
      ),
    );
  }, []);

  const ctxValue = useMemo<ToastContextValue>(
    () => ({ show, dismiss }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={ctxValue}>
      {children}
      <ToastHost toasts={toasts} onDismiss={(id) => dismiss(id)} />
    </ToastContext.Provider>
  );
}

interface ToastHostProps {
  toasts: ToastInstance[];
  onDismiss: (id: number) => void;
}

function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  // SSR / 测试环境兜底：document 不存在时不 portal
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="toast-host" role="region" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

interface ToastItemProps {
  toast: ToastInstance;
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [expanded, setExpanded] = useState(false);

  // 自动消失（durationMs > 0 时）
  useEffect(() => {
    if (toast.durationMs <= 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  return (
    <div className={`toast-item toast-item--${toast.severity}`} role="status">
      <div className="toast-item__main">
        <span className="toast-item__title">{toast.title}</span>
        <button
          type="button"
          className="toast-item__close"
          aria-label="关闭"
          onClick={() => onDismiss(toast.id)}
        >
          ×
        </button>
      </div>
      {toast.detail && (
        <>
          <button
            type="button"
            className="toast-item__expand"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? '收起' : '展开详情'}
          </button>
          {expanded && (
            <div className="toast-item__detail">
              {toast.detail.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
