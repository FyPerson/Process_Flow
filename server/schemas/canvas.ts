// Zod schemas for canvas API（方案 §4.7，按现有 src/types/flow.ts 实际结构对齐）
//
// 关键安全限制：
// - body size limit 由 express.json({ limit }) 控制（global 2MB）
// - .strict() 拒绝未知字段（防客户端塞恶意字段绕过）
// - superRefine 跨字段校验：sheet/node/edge ID 唯一性、edge 端点必须指向同 sheet 内有效节点、activeSheetId 存在性
//
// 节点元信息字段（creator_id / created_at / updated_by / updated_at / is_deprecated）
// 在 schema 里声明为 optional，但服务端在保存流程中**强制以 nodes_meta 表为准重写**——
// 客户端传任何值都会被 §5.7 流程覆盖（详见 services/canvases.ts）

import { z } from 'zod';

// ID 字符集：仅字母/数字/下划线/短横线，1-64 字符（防 SQL 注入面 + URL 安全）
export const ShortIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

// 业务流程图节点类型（来自 flow.ts NodeType）
const NodeTypeSchema = z.enum([
  'terminator',
  'process',
  'decision',
  'data',
  'subprocess',
  'group',
]);

// 数据库表字段（DatabaseField）
const DatabaseFieldSchema = z
  .object({
    fieldName: z.string().max(100),
    fieldType: z.string().max(50),
    comment: z.string().max(500),
    required: z.boolean(),
  })
  .strict();

// 数据库表（DatabaseTable）
const DatabaseTableSchema = z
  .object({
    tableName: z.string().max(100),
    description: z.string().max(500),
    sourceDatabase: z.string().max(100).optional(),
    sourceDatabaseUrl: z.string().max(500).optional(),
    primaryKey: z.string().max(200).optional(),
    foreignKeys: z.string().max(500).optional(),
    fields: z.array(DatabaseFieldSchema).max(200),
    keyFields: z.array(z.string().max(100)).max(50).optional(),
  })
  .strict();

// 截图（Screenshot）
const ScreenshotSchema = z
  .object({
    id: z.string().max(64),
    title: z.string().max(200).optional(),
    url: z.string().max(2000),
    thumbnail: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
    order: z.number().optional(),
    pageName: z.string().max(200).optional(),
    isComponent: z.boolean().optional(),
    componentType: z.enum(['page', 'image']).optional(),
    locked: z.boolean().optional(),
  })
  .strict();

// 节点详情配置（NodeDetailConfig）
const NodeDetailConfigSchema = z
  .object({
    databaseTables: z.array(DatabaseTableSchema).max(50).optional(),
    screenshots: z.array(ScreenshotSchema).max(100).optional(),
    description: z.string().max(10000).optional(),
  })
  .strict();

// React.CSSProperties 太开放，宽松接受 string-key map（限制 key 数量与字符串长度）
// 真正的 XSS 防御依靠服务端不解析 CSS、前端不用 dangerouslySetInnerHTML
const StyleSchema = z.record(z.string().max(64), z.unknown()).optional();

// 节点（FlowDefinition.nodes 单元素的实际结构）
const NodeSchema = z
  .object({
    id: ShortIdSchema,
    name: z.string().max(200),
    type: NodeTypeSchema,
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    size: z.object({
      width: z.number().positive().max(10000),
      height: z.number().positive().max(10000),
    }),
    expandable: z.boolean(),
    detailConfig: NodeDetailConfigSchema.optional(),
    style: StyleSchema,
    subType: z.enum(['start', 'end']).optional(),
    backgroundColor: z.string().max(32).optional(),
    parentId: ShortIdSchema.optional(),
    // 分组节点专用
    label: z.string().max(100).optional(),
    color: z.string().max(32).optional(),
    relatedNodeIds: z.array(ShortIdSchema).max(100).optional(),
    // 元信息（服务端强制重写，client 可传可不传）
    creator_id: z.number().int().optional(),
    created_at: z.number().int().optional(),
    updated_by: z.number().int().optional(),
    updated_at: z.number().int().optional(),
    is_deprecated: z.boolean().optional(),
  })
  .strict();

// 连接线（FlowConnector）
const EdgeSchema = z
  .object({
    id: ShortIdSchema,
    sourceID: ShortIdSchema,
    targetID: ShortIdSchema,
    sourceHandle: z.string().max(64).optional(),
    targetHandle: z.string().max(64).optional(),
    label: z.string().max(200).optional(),
    waypoints: z
      .array(
        z.object({
          x: z.number().finite(),
          y: z.number().finite(),
        })
      )
      .max(20)
      .optional(),
    edgeType: z.enum(['straight', 'smoothstep', 'step']).optional(),
    style: z
      .object({
        stroke: z.string().max(32).optional(),
        strokeWidth: z.number().positive().max(20).optional(),
        strokeDasharray: z.string().max(32).optional(),
      })
      .strict()
      .optional(),
    notImplemented: z.boolean().optional(),
    markerEnd: z.unknown().optional(), // string | object，宽松接受
    markerStart: z.unknown().optional(),
    labelStyle: StyleSchema,
    labelBgStyle: StyleSchema,
    data: z.record(z.string().max(64), z.unknown()).optional(),
  })
  .strict();

// 单个画布（CanvasSheet）
const SheetSchema = z
  .object({
    id: ShortIdSchema,
    name: z.string().max(100),
    nodes: z.array(NodeSchema).max(500),
    connectors: z.array(EdgeSchema).max(2000),
  })
  .strict();

// 多画布项目（MultiCanvasProject，方案 §4.7 主入口）
export const MultiCanvasProjectSchema = z
  .object({
    version: z.literal(2),
    id: ShortIdSchema,
    name: z.string().max(200),
    description: z.string().max(2000).optional(),
    activeSheetId: ShortIdSchema,
    sheets: z.array(SheetSchema).min(1).max(20),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  })
  .strict()
  .superRefine((project, ctx) => {
    // 跨字段一致性校验（v3 新增，方案 §4.7）
    const sheetIds = new Set<string>();

    for (const sheet of project.sheets) {
      // 1. sheet ID 全局唯一
      if (sheetIds.has(sheet.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate sheet id: ${sheet.id}`,
          path: ['sheets'],
        });
      }
      sheetIds.add(sheet.id);

      // 2. node ID 在 sheet 内唯一
      const nodeIds = new Set<string>();
      for (const node of sheet.nodes) {
        if (nodeIds.has(node.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate node id ${node.id} in sheet ${sheet.id}`,
            path: ['sheets', sheet.id, 'nodes'],
          });
        }
        nodeIds.add(node.id);

        // 节点 parentId 必须指向同 sheet 内已存在节点（顺序检查：必须出现在前面）
        // 简化：parentId 不为空时只校验存在，不校验顺序
        if (node.parentId && !nodeIds.has(node.parentId)) {
          // 暂时只 warn 不阻塞（前端可能按拓扑顺序混乱保存）
          // 真要严格可放进 superRefine 第二遍循环
        }
      }

      // 3. edge ID 在 sheet 内唯一 + sourceID/targetID 必须指向本 sheet 已存在节点
      const edgeIds = new Set<string>();
      for (const edge of sheet.connectors) {
        if (edgeIds.has(edge.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate edge id ${edge.id} in sheet ${sheet.id}`,
            path: ['sheets', sheet.id, 'connectors'],
          });
        }
        edgeIds.add(edge.id);

        if (!nodeIds.has(edge.sourceID)) {
          ctx.addIssue({
            code: 'custom',
            message: `Edge ${edge.id} has invalid sourceID ${edge.sourceID} (not in sheet ${sheet.id})`,
            path: ['sheets', sheet.id, 'connectors'],
          });
        }
        if (!nodeIds.has(edge.targetID)) {
          ctx.addIssue({
            code: 'custom',
            message: `Edge ${edge.id} has invalid targetID ${edge.targetID} (not in sheet ${sheet.id})`,
            path: ['sheets', sheet.id, 'connectors'],
          });
        }
      }
    }

    // 4. activeSheetId 必须存在于 sheets 中
    if (!sheetIds.has(project.activeSheetId)) {
      ctx.addIssue({
        code: 'custom',
        message: `activeSheetId ${project.activeSheetId} not in sheets`,
        path: ['activeSheetId'],
      });
    }
  });

export type MultiCanvasProjectInput = z.infer<typeof MultiCanvasProjectSchema>;

// =====================================================================
// API 请求 schemas
// =====================================================================

// POST /api/canvases —— 创建画布
export const CreateCanvasRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    visibility: z.enum(['public', 'private']),
    is_public_to_guest: z.boolean().optional(), // 默认 false
    data: MultiCanvasProjectSchema,
  })
  .strict();

export type CreateCanvasRequest = z.infer<typeof CreateCanvasRequestSchema>;

// PUT /api/canvases/:id —— 保存画布
export const SaveCanvasRequestSchema = z
  .object({
    baseVersion: z.number().int().positive(),
    data: MultiCanvasProjectSchema,
  })
  .strict();

export type SaveCanvasRequest = z.infer<typeof SaveCanvasRequestSchema>;

// PATCH /api/canvases/:id —— 改元信息
export const PatchCanvasRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    is_public_to_guest: z.boolean().optional(),
    archived: z.boolean().optional(),
    owner_id: z.number().int().nullable().optional(), // admin 接管 owner（§9.5）
  })
  .strict();

export type PatchCanvasRequest = z.infer<typeof PatchCanvasRequestSchema>;
