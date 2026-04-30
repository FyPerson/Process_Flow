// 节点类型枚举
export type NodeType = 'terminator' | 'process' | 'decision' | 'data' | 'subprocess' | 'group';

// 数据库字段
export interface DatabaseField {
  fieldName: string;
  fieldType: string;
  comment: string;
  required: boolean;
}

// 数据库表
export interface DatabaseTable {
  tableName: string;
  description: string;
  sourceDatabase?: string;
  sourceDatabaseUrl?: string;
  primaryKey?: string;
  foreignKeys?: string;
  fields: DatabaseField[]; // Expanded from simple string[]
  keyFields?: string[]; // Keep for backward compat if needed, but likely unused
}

// 截图信息
export interface Screenshot {
  id: string;
  title?: string;
  url: string;
  thumbnail?: string;
  description?: string;
  order?: number;
  // Unified fields
  pageName?: string;
  isComponent?: boolean;
  componentType?: 'page' | 'image';
  locked?: boolean;
}

// 节点详情配置
export interface NodeDetailConfig {
  databaseTables?: DatabaseTable[];
  screenshots?: Screenshot[];
  description?: string;
}

// 流程节点
export interface FlowNodeData {
  id: string;
  name: string;
  type: NodeType;
  subType?: 'start' | 'end'; // 开始/结束节点子类型
  expandable: boolean;
  detailConfig?: NodeDetailConfig;
  backgroundColor?: string; // 节点背景色（对于判断节点，只用于SVG填充）
  relatedNodeIds?: string[]; // 关联的其他节点 ID (手动维护，用于高亮显示)
  // P3C 废弃元信息（从服务端 hydrate；前端不直接写，由"标记废弃"按钮 → autosave 触发）
  is_deprecated?: boolean;
  deprecated_by?: number;
  deprecated_at?: number;
  deprecated_by_username?: string;
  [key: string]: unknown;
}

// 分组节点数据
export interface GroupNodeData {
  id: string;
  label: string;
  color?: string;
  collapsed?: boolean; // 是否折叠
  expandedSize?: { width: number | string; height: number | string }; // 折叠前的尺寸
  relatedNodeIds?: string[]; // 关联的其他节点 ID（支持分组之间互相关联）
  [key: string]: unknown; // 索引签名，兼容 React Flow
}

// 流程连接线
export interface FlowConnector {
  id: string;
  sourceID: string;
  targetID: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  // 路径点（用于精确控制连接线走向，避免交叉）
  waypoints?: Array<{ x: number; y: number }>;
  // 连接线类型：straight（直线）、smoothstep（圆角折线）、step（直角折线）
  edgeType?: 'straight' | 'smoothstep' | 'step';
  // 连接线样式
  style?: {
    stroke?: string;
    strokeWidth?: number;
    strokeDasharray?: string;
  };
  // 是否未实现：true 表示业务上应该有这个流程，但系统上没有实现
  notImplemented?: boolean;
  // 箭头标记
  markerEnd?: string | { type: string; color?: string; width?: number; height?: number };
  markerStart?: string | { type: string; color?: string; width?: number; height?: number };
  // 标签样式
  labelStyle?: React.CSSProperties;
  labelBgStyle?: React.CSSProperties;
  // 自定义数据
  data?: Record<string, unknown>;
}

// 流程定义
export interface FlowDefinition {
  id: string;
  name: string;
  description?: string;
  nodes: {
    id: string;
    name: string;
    type: NodeType;
    position: { x: number; y: number };
    size: { width: number; height: number };
    expandable: boolean;
    detailConfig?: NodeDetailConfig;
    style?: React.CSSProperties;
    subType?: 'start' | 'end'; // 起止节点子类型
    backgroundColor?: string; // 节点背景色
    parentId?: string; // 父节点 ID（用于分组）
    // 分组节点专用字段
    label?: string; // 分组标签
    color?: string; // 分组颜色
    relatedNodeIds?: string[]; // 关联的其他节点 ID
    // ============================================
    // 节点元信息（服务端从 nodes_meta 表 hydrate；前端只读）
    // ============================================
    creator_id?: number;
    created_at?: number;
    updated_by?: number;
    updated_at?: number;
    // 废弃状态：单向 false → true（P3A 服务端不支持取消废弃）
    is_deprecated?: boolean;
    // 废弃元信息：服务端 GET 时 JOIN users 注入；未废弃节点这三字段 omit
    deprecated_by?: number;
    deprecated_at?: number;
    deprecated_by_username?: string; // 用户已删除时为 undefined（前端 fallback "用户 #N"）
  }[];
  connectors: FlowConnector[];
}

// 节点更新字段
export interface NodeUpdateFields {
  label?: string;
  description?: string;
  screenshots?: Screenshot[];
  databaseTables?: DatabaseTable[];
}

// 节点更新参数
export interface NodeUpdateParams {
  data?: Partial<FlowNodeData> | NodeUpdateFields;
  style?: React.CSSProperties;
}

// 边更新字段
export interface EdgeUpdateFields {
  label?: string;
  color?: string;
  arrowType?: 'forward' | 'reverse' | 'both' | 'none';
  bgWidth?: number | string;
  bgHeight?: number | string;
  fontSize?: number;
  notImplemented?: boolean;
  // Added for EdgePropertiesPanel
  width?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontColor?: string;
  bgColor?: string;
  opacity?: number;
}

// 边更新参数
export interface EdgeUpdateParams {
  label?: string;
  style?: React.CSSProperties;
  markerEnd?: string | { type: string; color?: string; width?: number; height?: number };
  markerStart?: string | { type: string; color?: string; width?: number; height?: number };
  labelStyle?: React.CSSProperties;
  labelBgStyle?: React.CSSProperties;
  data?: Record<string, unknown>;
  notImplemented?: boolean;
}

// 节点信息（用于 FloatingEdge）
export interface NodeInfo {
  width: number;
  height: number;
  x: number;
  y: number;
  centerX: number;
  centerY: number;
}

// Edge 数据扩展（用于 FloatingEdge）
export interface EdgeData {
  sourceHandle?: string;
  targetHandle?: string;
  waypoints?: Array<{ x: number; y: number }>;
  edgeType?: 'straight' | 'smoothstep' | 'step';
  [key: string]: unknown;
}

// ============================================
// 多画布功能相关类型
// ============================================

// 单个画布定义
export interface CanvasSheet {
  id: string;
  name: string;
  nodes: FlowDefinition['nodes'];
  connectors: FlowConnector[];
}

// 多画布项目定义（新的顶层结构）
export interface MultiCanvasProject {
  version: 2;                    // 版本标记，用于区分旧数据
  id: string;
  name: string;
  description?: string;
  activeSheetId: string;         // 当前激活的画布 ID
  sheets: CanvasSheet[];         // 画布列表
  createdAt?: number;
  updatedAt?: number;
}

// 类型守卫：判断是否为多画布项目
export function isMultiCanvasProject(data: unknown): data is MultiCanvasProject {
  return (
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    (data as MultiCanvasProject).version === 2 &&
    'sheets' in data &&
    Array.isArray((data as MultiCanvasProject).sheets)
  );
}

// 迁移函数：将旧单画布数据转为多画布格式
export function migrateToMultiCanvas(oldData: FlowDefinition): MultiCanvasProject {
  const sheetId = `sheet_${Date.now()}`;
  return {
    version: 2,
    id: oldData.id || `project_${Date.now()}`,
    name: oldData.name || '业务流程图',
    description: oldData.description,
    activeSheetId: sheetId,
    sheets: [
      {
        id: sheetId,
        name: '画布 1',
        nodes: oldData.nodes || [],
        connectors: oldData.connectors || [],
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// 创建空白项目
export function createEmptyProject(): MultiCanvasProject {
  const sheetId = `sheet_${Date.now()}`;
  return {
    version: 2,
    id: `project_${Date.now()}`,
    name: '新项目',
    description: '',
    activeSheetId: sheetId,
    sheets: [
      {
        id: sheetId,
        name: '画布 1',
        nodes: [],
        connectors: [],
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}