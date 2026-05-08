// useBackdropClickClose — 解决"鼠标 drag-select 从对话框内拖出后释放在 backdrop 误关弹窗"
//
// 现象（2026-05-08 用户反馈）：
// 在 input 内全选并按住鼠标拖拽 selection 出对话框，鼠标在 backdrop 上抬起 → click 事件触发
// → backdrop 的 onClick 把弹窗关掉。用户体验：选择文本时弹窗意外消失。
//
// 修法：
// 用 onMouseDown 记录起始元素是否是 backdrop 本身；onClick 时仅当起点也是 backdrop 才关。
// 这样 drag from input → release on backdrop 不会误关；纯点击 backdrop 仍能关。
//
// 参考：material-ui Modal 等成熟库都用这个模式。

import { useCallback, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

export interface BackdropClickCloseHandlers {
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
  onMouseUp: (e: ReactMouseEvent<HTMLElement>) => void;
}

/** 返回一对绑到 backdrop 上的 mousedown / mouseup handler；
 *  仅当 mousedown 与 mouseup 都发生在 backdrop 本身（target===currentTarget）时调 onClose。 */
export function useBackdropClickClose(onClose: () => void): BackdropClickCloseHandlers {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  const onMouseDown = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    // 只有 mousedown 在 backdrop 本身（不是子元素冒泡）才记录
    if (e.target === e.currentTarget) {
      mouseDownTargetRef.current = e.currentTarget;
    } else {
      mouseDownTargetRef.current = null;
    }
  }, []);

  const onMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      // 仅当 mousedown 起点是 backdrop + mouseup 也在 backdrop 才关
      if (
        mouseDownTargetRef.current === e.currentTarget &&
        e.target === e.currentTarget
      ) {
        onClose();
      }
      mouseDownTargetRef.current = null;
    },
    [onClose],
  );

  return { onMouseDown, onMouseUp };
}
