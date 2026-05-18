// Zod schemas for canvas API（方案 §4.7，按现有 src/types/flow.ts 实际结构对齐）
//
// 关键安全限制：
// - body size limit 由 express.json({ limit }) 控制（global 2MB）
// - .strict() 拒绝未知字段（防客户端塞恶意字段绕过）
// - superRefine 跨字段校验：sheet/node/edge ID 唯一性、edge 端点必须指向同 sheet 内有效节点、activeSheetId 存在性
//
// 节点元信息字段（creator_id / created_at / updated_by / updated_at / is_deprecated /
// deprecated_by / deprecated_at / deprecated_by_username）
// 在 schema 里声明为 optional + nullable，但服务端在保存流程中**强制以 nodes_meta 表为准重写**——
// 客户端传任何值都会被 §5.7 流程覆盖；deprecated_by/at 由 stripMeta 在 save 时丢弃，
// 客户端伪造无效（详见 services/canvases.ts）

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
  'text', // MVP v1.20.0：文本框节点，纯展示元素，无 Handle 不参与连线
]);

// 文本框节点字体 key（与 src/types/flow.ts TextFontKey 对齐）
const TextFontKeySchema = z.enum(['heiti', 'yahei', 'kaiti', 'songti', 'fangsong']);

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
    // 显隐：前端把节点 hidden 状态保存进 storage（subflow 过滤等场景）
    hidden: z.boolean().optional(),
    // 分组节点专用
    label: z.string().max(100).optional(),
    color: z.string().max(32).optional(),
    relatedNodeIds: z.array(ShortIdSchema).max(100).optional(),
    // 分组节点折叠状态 + 折叠前尺寸（前端保存到 storage）
    collapsed: z.boolean().optional(),
    expandedSize: z
      .object({
        width: z.union([z.number(), z.string().max(32)]),
        height: z.union([z.number(), z.string().max(32)]),
      })
      .strict()
      .optional(),
    // 节点描述（普通节点 storage 字段）
    description: z.string().max(10000).optional(),
    // 元信息（服务端强制重写，client 可传可不传）
    creator_id: z.number().int().optional(),
    created_at: z.number().int().optional(),
    updated_by: z.number().int().optional(),
    updated_at: z.number().int().optional(),
    // 废弃单向语义（M3 codex Day 1 审）：客户端可传 true 或 false，但 saveCanvas
    // 路径强制 newDeprecated = isDeprecatingNow || !!meta.is_deprecated（line 820），
    // 已废弃节点不可被 incoming 传 false 回退；computeDelta 路径 NodeDelta.changedFields
    // 不含 is_deprecated（白名单不含此字段），applyDelta 应用到 currentData 后 dep 状态
    // 仍来自 currentData。schema 层不强制 refine（需查当前态），双层防御已就位。
    is_deprecated: z.boolean().optional(),
    // P3D-1：creator_username 由 GET 时 JOIN users hydrate；save 时 strip 掉。
    // 客户端若伪造此字段，stripServerAttributionForSaveInput 会清掉，无法绕过。
    creator_username: z.string().max(64).nullable().optional(),
    // 废弃元信息（GET 时 hydrate 自 nodes_meta + users JOIN；save 时 stripMeta 丢弃）
    // 未废弃节点这三字段在响应里直接 omit；废弃但历史无 username 时仅 omit username
    deprecated_by: z.number().int().nullable().optional(),
    deprecated_at: z.number().int().nullable().optional(),
    deprecated_by_username: z.string().max(64).nullable().optional(),
    // 文本框节点专用字段（type='text'，MVP v1.20.0）
    // schema 不强制 type='text' 才允许传（避免跨字段校验复杂度）；
    // 其他 type 传了也不影响渲染（CustomNode 不读这些字段）
    textFontFamily: TextFontKeySchema.optional(),
    textFontSize: z.number().int().positive().max(200).optional(),
    textColor: z.string().max(32).optional(),
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
    // codex Day 1 四审 M2 修订：parentId 真校验（之前是空注释 placeholder）
    // 用两遍循环避免拓扑顺序误伤：先收集所有 nodeIds（含分组内子节点），再二遍校验 parentId
    const sheetIds = new Set<string>();

    // 第一遍：sheet/node/edge ID 唯一性 + edge 端点
    // 同时收集每个 sheet 的 (nodeId → node) 索引供第二遍 parentId 校验用
    const sheetNodeIndex = new Map<string, Map<string, typeof project.sheets[number]['nodes'][number]>>();

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
      const nodeMap = new Map<string, typeof project.sheets[number]['nodes'][number]>();
      for (const node of sheet.nodes) {
        if (nodeIds.has(node.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate node id ${node.id} in sheet ${sheet.id}`,
            path: ['sheets', sheet.id, 'nodes'],
          });
        }
        nodeIds.add(node.id);
        nodeMap.set(node.id, node);
      }
      sheetNodeIndex.set(sheet.id, nodeMap);

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

    // 第二遍：parentId 真校验（codex 四审 M2 + 五审 M1 收紧 + 六审 L1 拍板）
    // 规则：
    //   - parentId 必须指向同 sheet 内已存在的 group 类型节点
    //   - 拒绝自引用（node.parentId === node.id）
    //   - group 节点本身不能有 parentId（不允许 group 嵌套；与 useFlowOperations:315
    //     "选中节点新建分组时过滤 type=group && !parentId" 对齐）
    //   - **允许** parentId 指向 is_deprecated=true 的 group：本项目 P3C 语义是
    //     "标废弃只是节点状态，节点仍存在"，废弃 group 仍可作为 parent 合理（codex 六审 L1）
    for (const sheet of project.sheets) {
      const nodeMap = sheetNodeIndex.get(sheet.id);
      if (!nodeMap) continue;
      for (const node of sheet.nodes) {
        if (node.parentId === undefined) continue;
        // 拒自引用
        if (node.parentId === node.id) {
          ctx.addIssue({
            code: 'custom',
            message: `Node ${node.id} parentId points to itself (self-reference)`,
            path: ['sheets', sheet.id, 'nodes'],
          });
          continue;
        }
        // group 不能嵌套
        if (node.type === 'group') {
          ctx.addIssue({
            code: 'custom',
            message: `Node ${node.id} is a group with parentId ${node.parentId}; group nesting is not allowed`,
            path: ['sheets', sheet.id, 'nodes'],
          });
          continue;
        }
        const parent = nodeMap.get(node.parentId);
        if (!parent) {
          ctx.addIssue({
            code: 'custom',
            message: `Node ${node.id} parentId ${node.parentId} not found in sheet ${sheet.id}`,
            path: ['sheets', sheet.id, 'nodes'],
          });
          continue;
        }
        if (parent.type !== 'group') {
          ctx.addIssue({
            code: 'custom',
            message: `Node ${node.id} parentId ${node.parentId} points to non-group node (type=${parent.type})`,
            path: ['sheets', sheet.id, 'nodes'],
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

// POST /api/canvases/import —— 导入 JSON 为新的 private 画布（方案 §1.3 / §3.1）
// name 可选：缺省时用 data.name（导入文件里的项目名）
export const ImportCanvasRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    data: MultiCanvasProjectSchema,
  })
  .strict();

export type ImportCanvasRequest = z.infer<typeof ImportCanvasRequestSchema>;

// POST /api/canvases/:id/publish —— 发布画布为 public（P3G）
// 校验语义（codex 02-审 medium #1）：published_note 是"trim 后 1-500 字"。
// 用 transform(trim) → pipe(min(1).max(500)) 把 trim 收敛到 schema：
// - 全空格 → trim 后 '' → min(1) 拒
// - 前后大量空格 + 正文 ≤500 → trim 后通过
// - 原始字符串 600 字其中 200 是空格 → trim 后正文 400 → 通过
// route 层不需要再 trim，直接拿 body.published_note 即为已 trim 值
export const PublishCanvasRequestSchema = z
  .object({
    published_note: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1).max(500)),
  })
  .strict();

export type PublishCanvasRequest = z.infer<typeof PublishCanvasRequestSchema>;

// POST /api/canvases/:id/unpublish —— 撤回 public 画布回 private（P3G）
// 当前不需要参数（撤回不需要说明），保留 schema 以便未来扩展（如 unpublished_note）
export const UnpublishCanvasRequestSchema = z.object({}).strict();

export type UnpublishCanvasRequest = z.infer<typeof UnpublishCanvasRequestSchema>;
