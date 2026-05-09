// CSS 副作用导入的 TS 模块声明
//
// 项目里 20 个组件都写 `import './styles.css'` —— 这是 vite 的副作用导入语法（vite 把
// CSS 注入 <head>，不返回任何东西）。tsc 在 `moduleResolution: "bundler"` 下默认容忍
// 这种导入（npx tsc --noEmit 0 错），但**新版 IDE TS server 更严格**，会报
// ts(2882) "找不到 './styles.css' 的副作用导入的模块或类型声明"。
//
// 加这个 ambient declaration 让 IDE TS server 也认；不影响运行时（vite 处理）。

declare module '*.css';
