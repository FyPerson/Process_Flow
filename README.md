# 业务流程全景图 - React Flow

基于 React Flow 实现的业务流程全景图，支持：

- 🎯 不同类型节点（开始/结束、处理、判断）
- 🔗 节点连接线和分支
- 📋 节点详情展开（数据库表、截图等）
- 🖱️ 拖拽、缩放、平移
- 🎨 美观的深色主题

## 快速启动

### Windows 用户

双击运行 `启动.bat`

### 跨平台启动

```bash
node 快速启动.js
```

### 手动启动

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

## 技术栈

- React 19
- React Flow (@xyflow/react)
- Vite
- TypeScript

## 项目结构

```
business-flow-react/
├── public/
│   └── data/
│       └── business-flow.json  # 流程定义数据
├── src/
│   ├── components/
│   │   ├── BusinessFlow/       # 主流程图组件
│   │   ├── CustomNodes/        # 自定义节点组件
│   │   └── NodeDetailPanel/    # 节点详情面板
│   ├── types/
│   │   └── flow.ts             # 类型定义
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── 启动.bat                     # Windows 快速启动
├── 快速启动.js                  # 跨平台启动脚本
└── package.json
```

## 使用说明

1. 点击蓝色虚线边框节点可查看详情
2. 使用鼠标滚轮缩放
3. 拖拽空白区域平移画布
4. 拖拽节点可移动位置
5. 左下角控制面板可缩放和适应视图

## 许可证

MIT
