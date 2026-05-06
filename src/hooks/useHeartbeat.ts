// useHeartbeat：30s 心跳定时器（阶段 4 P4C，方案 §4.5 + 判断点 6）
//
// 设计约束（判断点 6 决策）：
// - 30s 上报间隔；服务端单一时钟源（90s 过期客户端不判断，仅展示服务端返回的 otherEditors）
// - document.hidden 时暂停（节流 + 隐含语义"用户没在看 = 不算在编辑"）
// - visibilitychange to visible 立即补发一次（让重新激活的 tab 立刻出现在他人视野）
// - 同用户多 tab 由后端 PRIMARY KEY (user_id, canvas_id) 自动去重
//
// 错误处理：心跳失败不抛异常给上层（不让"编辑者列表"导致页面崩溃），仅 console.warn

import { useEffect, useState } from 'react';
import { postHeartbeat, type ActiveEditor } from '../api/canvases';

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface UseHeartbeatOptions {
  /** 画布 id；为 null 时不上报（如未选中画布）*/
  canvasId: number | null;
  /** 是否启用（如游客模式可禁用）*/
  enabled?: boolean;
}

export interface UseHeartbeatReturn {
  /** 当前画布上除自己外的活跃编辑者；空数组表示无人或未上报过 */
  otherEditors: ActiveEditor[];
}

export function useHeartbeat(options: UseHeartbeatOptions): UseHeartbeatReturn {
  const { canvasId, enabled = true } = options;
  const [otherEditors, setOtherEditors] = useState<ActiveEditor[]>([]);

  useEffect(() => {
    // 切画布或禁用：立即清空旧数据（codex P4 二审 #7：避免显示旧画布的协作者）
    setOtherEditors([]);

    if (!enabled || canvasId === null) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      // hidden 时跳过（visibilitychange 重新激活时会立即补发一次）
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const editors = await postHeartbeat(canvasId);
        if (!cancelled) setOtherEditors(editors);
      } catch (err) {
        // 不阻塞业务流：心跳失败仅 warn；清空避免显示过期数据
        if (!cancelled) setOtherEditors([]);
        console.warn('[heartbeat] post failed', err);
      }
    };

    // 立即上报一次（避免 30s 内编辑者列表是空的）
    void tick();
    const timer = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) {
        // 从 hidden 变 visible：立即补发一次
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [canvasId, enabled]);

  return { otherEditors };
}
