import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// 注意：不要抑制 ResizeObserver 错误
// 虽然 "ResizeObserver loop completed with undelivered notifications" 看起来像是错误，
// 但它实际上是一个无害的浏览器警告，而且 GroupNode 的 useStore 依赖于 ResizeObserver
// 来获取节点的 measured 尺寸。抑制这个错误会导致分组功能异常。

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
