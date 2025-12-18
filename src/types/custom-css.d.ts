import 'react';

declare module 'react' {
  interface CSSProperties {
    // 自定义 CSS 属性，用于标记背景宽高是否为自动模式
    widthAuto?: boolean;
    heightAuto?: boolean;
  }
}
