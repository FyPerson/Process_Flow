// 阶段 5 合并算法 — 类型定义
//
// 对应方案文档：[多人协作-方案.md §5.3 / §5.4 / §5.5 / §5.6](../../../docs/规划/多人协作-方案.md)
// 拍板记录：[02-拍板记录](../../../docs/规划/codex审查记录/阶段5/P5-合并算法/Day1-基建/02-拍板记录.md)
//
// 关键约定（codex 取舍审采纳）：
// - D2: 字段级 diff 复用 stripHydratedNodeMetaForCompareOrHydrate + deepEqualJsonShape
//   显式定义 node 顶层 diff 字段清单 + connector 顶层 diff 字段清单（M1+M2）
//   嵌套对象（style/labelStyle/labelBgStyle/data）按顶层冲突，不做深层 key 合并
// - D3: connector 用 semanticKey = sheetId + sourceID + targetID + sourceHandle + targetHandle 去重（H3）
// - G3 sheet 级 delta：MVP 保守 409，sheet 元信息任意字段双方都改 → 直接 409；不做字段级合并
// - G4: deltaB 是权限校验和 nodes_meta 同步的唯一输入；mergedData 仅用于最终 JSON

// ============================================================
// 节点字段 diff 粒度（顶层 diff 字段清单）
// ============================================================
//
// 服务端独占的归属字段（creator_id / created_at / updated_by / updated_at /
// is_deprecated / deprecated_by / deprecated_at / *_username）由 stripServerAttributionForSaveInput
// 在 save 路径剥离；NODE_DIFF_FIELDS 白名单不包含这些字段，永远不会进入 changedFields。
//
// 客户端会主动改的字段进入 diff（与 NODE_DIFF_FIELDS 常量保持完全一致 —— 任何不一致都是 bug）：
// - name / type / position / size / expandable / detailConfig / style / subType /
//   backgroundColor / parentId / hidden / label / color / relatedNodeIds /
//   collapsed / expandedSize / description（共 17 项）
//
// is_deprecated 是单向状态变化，单独走 nodes.deprecated 分类，不在白名单内。
// extent / data 不属于 storage 顶层字段（schema NodeSchema 没声明），不应入白名单。
//
// 嵌套对象（style / detailConfig）按顶层字段冲突处理：双方都改 style 即 409（不做深层 key 合并）。

// ============================================================
// connector 字段 diff 粒度（顶层 diff 字段清单）
// ============================================================
//
// connector 没有归属字段（§5.5 边不区分作者）。
// 顶层 diff 字段（与 CONNECTOR_DIFF_FIELDS 常量一致）：
//   sourceID / targetID / sourceHandle / targetHandle / label / waypoints / edgeType /
//   style / notImplemented / markerEnd / markerStart / labelStyle / labelBgStyle / data
// 嵌套对象（style / labelStyle / labelBgStyle / data）按顶层字段冲突处理。

// ============================================================
// Delta 类型
// ============================================================

/** 单字段变化 */
export interface FieldChange {
  /** 字段名 */
  field: string;
  /** 原值（来自 base） */
  before: unknown;
  /** 新值（来自 incoming） */
  after: unknown;
}

/** 节点 diff（仅在 modified 时使用 changedFields） */
export interface NodeDelta {
  /** 节点客户端字符串 ID */
  nodeId: string;
  /** 哪些顶层字段变了（按 NODE_DIFF_FIELDS 白名单内的字段；不含归属字段） */
  changedFields: FieldChange[];
  /** 内容修改 + 同时 is_deprecated false→true（H2 codex Day 1 审）
   *  G4 约束 deltaB 是 nodes_meta 同步的唯一输入；applyDelta 依赖此字段判断是否要写
   *  deprecated_by/deprecated_at（不能回读 base/incoming）。
   *  - 仅 is_deprecated false→true，其他字段未变 → 走 nodes.deprecated 分类，本字段不出现
   *  - 仅内容变（dep 没变）→ 本字段 false 或 omit
   *  - 内容变 + dep false→true → 本字段 true */
  alsoDeprecated?: boolean;
}

/** connector diff（仅在 modified 时使用 changedFields） */
export interface ConnectorDelta {
  /** 连线客户端字符串 ID */
  connectorId: string;
  /** semanticKey = JSON.stringify([sheetId, sourceID, targetID, sourceHandle ?? null, targetHandle ?? null])
   *  用于 E2 去重；元组 JSON 编码避免 handle 含分隔符撞 key（详见 connectorSemanticKey 实现） */
  semanticKey: string;
  /** 哪些顶层字段变了 */
  changedFields: FieldChange[];
}

/** 单 sheet 的 delta */
export interface SheetDelta {
  sheetId: string;
  /** sheet 元信息字段 diff（name / sheet 内非 nodes/connectors 的字段）
   *  G3: MVP 保守 409，任意字段双方都改 → 直接 409；不做字段级合并 */
  sheetMetaChangedFields: FieldChange[];
  // ---- 节点 ----
  nodes: {
    /** 新增节点（base 没有，incoming 有） */
    added: Map<string, StorageNode>;
    /** 物理删除（base 有，incoming 没有） */
    removed: Map<string, StorageNode>;
    /** 内容变（不只是 is_deprecated） */
    modified: Map<string, NodeDelta>;
    /** 仅 is_deprecated false→true 的"标废弃"操作（公开权限） */
    deprecated: Map<string, StorageNode>;
  };
  // ---- 连线 ----
  connectors: {
    added: Map<string, StorageConnector>;
    removed: Map<string, StorageConnector>;
    modified: Map<string, ConnectorDelta>;
  };
}

/** 整个 project 的 delta */
export interface Delta {
  /** project 顶层元信息变化（name / description / activeSheetId）
   *  G3: MVP 保守 409，任意字段双方都改 → 直接 409 */
  projectMetaChangedFields: FieldChange[];
  /** 新增 sheet（base 没有，incoming 有） */
  sheetsAdded: Map<string, StorageSheet>;
  /** 删除 sheet（base 有，incoming 没有） */
  sheetsRemoved: Map<string, StorageSheet>;
  /** 修改 sheet 内容（节点 / 连线 / sheet 元信息字段） */
  sheetsModified: Map<string, SheetDelta>;
}

// ============================================================
// DetectContext：detect 函数的辅助上下文（D3 修订后节点段不依赖此对象）
// ============================================================
//
// 历史背景（codex Day 1 四审 M3）：早期方案打算让 detector 按 userA !== userB 判定
// node_modified_both，userA === userB 时同人多窗口也判冲突保守。
//
// **D3 修订后**（Day 2 拍板 03）：N4 改为按 changedFields 字段交集精确判定——
// 同字段重叠 → 每个重叠字段一条 node_modified_both；
// 不重叠 → auto-merge（含同人多窗口改不同字段的合法 N3 路径）。
//
// 因此 detectNodeConflicts(deltaA, deltaB, ctx) 中 ctx.userA / ctx.userB **不参与**
// 节点段判定。本对象仅保留两个用途：
// 1. ctx.visibility：N7 admin 物删可达性的展示语义（保留供 detector 给前端 message 时用，
//    但不影响 conflict 是否产出）；
// 2. 后续编排（B-3 applyDelta / B-4 tryMerge）若需要按 saved_by 写归属字段时复用。
//
// userA 的取值（仍记录供后续切片用）：从 canvas_versions WHERE version=currentVersion
// 查 saved_by。若 currentVersion 来自 createCanvas 初始快照，userA 是创建者；后续
// saveCanvas 则是该次保存者。

export interface DetectContext {
  /** currentVersion 的 saved_by（"对方"，已写入 DB）；节点段 detector 不读此字段 */
  userA: number;
  /** 当前保存者 ID（来自 SaveCanvasInput.user.id）；节点段 detector 不读此字段 */
  userB: number;
  /** 当前画布的 visibility（影响 N7 admin 物删规则的可达性的展示语义） */
  visibility: 'public' | 'private';
}

// ============================================================
// 冲突类型（§5.4 N1-N10 + §5.5 E1-E7 + sheet 级 + project 级）
// 共 16 项（codex Day 1 三审 M2 修正：之前 brief 误标 17）
// ============================================================
//
// N1-N10 / E1-E7 → ConflictType / auto-merge / warning 映射表（codex Day 1 三审给）：
//
// 节点 N 类（§5.4，10 种）：
//   N1 加不同节点         → auto-merge（无冲突类型）
//   N2 各改自己不同节点    → auto-merge（无冲突类型）
//   N3 同人多窗口同节点改不同字段 → auto-merge（字段级不重叠；本 MVP 字段级精细化合并）
//   N4 同节点同字段双方都改 → node_modified_both
//      Day 2 D3 修订：按 changedFields 字段交集精确判定——
//        同字段重叠（含 admin / 创建者 / 同人多窗口） → 每个重叠字段一条 node_modified_both；
//        字段不重叠（含 N3 同人多窗口改不同字段） → auto-merge。
//      detector 不依赖 ctx.userA/userB，纯靠 Delta 字段交集即可判定。
//   N5 双方同标废弃        → auto-merge 幂等（无冲突类型）
//   N6 A 标废弃 + B 改字段 → node_deprecated_modified
//   N7 admin 物删 + B 改字段 → node_removed_modified
//   N8 A 加节点+边 / B 改边端点 → auto-merge
//   N9 A 加边引用 admin 已删节点 → edge_endpoint_removed_by_other
//   N10 双方改 sheet 元信息 → sheet_meta_conflict（G3 保守）
//   外加：admin 物删 + B 标废弃 → node_removed_deprecated（数据完整性）
//   外加：incoming 节点 ID 与 nodes_meta 撞车 → node_id_collision
//   外加：modified/deprecated 节点 nodes_meta 缺失 → node_meta_missing
//
// 边 E 类（§5.5，7 种）：
//   E1 加不同边           → auto-merge
//   E2 加同语义边 (semanticKey 相同 + 非语义字段也相同) → auto-merge 去重保留 A
//      若非语义字段（label/style/waypoints/...）不同 → edge_semantic_conflict（codex 四审 M4）
//   E3 改同边不同字段      → auto-merge 字段级
//   E4 改同边同字段        → edge_modified_both
//   E5 A 删边 + B 改边     → edge_removed_modified
//   E6 双方都删同边        → auto-merge 幂等
//   E7 加边时端点节点已被删 → MergeWarning.edge_dropped_dangling_endpoint（不算冲突，自动丢弃 + 显示给用户）
//   外加：同 edge ID 但 semanticKey 不同（两人 add 撞 ID） → edge_id_collision
//   外加：同 semanticKey 但非语义字段不同（无论 ID 是否相同） → edge_semantic_conflict
//
// sheet / project 类（G3 保守 409）：
//   两人各自新建同 ID sheet → sheet_id_collision
//   A 删 sheet + B 改该 sheet → sheet_removed_modified
//   双方改同 sheet name     → sheet_meta_conflict
//   双方改 project meta     → project_meta_conflict
//   incoming.activeSheetId 指向被对方删除的 sheet → active_sheet_missing
//
// 共 16 项 ConflictType（节点 6 + 边 5 + sheet/project 5）。E7 走 MergeWarning 不计入。

export type ConflictType =
  // 节点级（6 项）
  | 'node_modified_both'              // 两人改同一 node 同字段（顶层 diff 字段）
  | 'node_deprecated_modified'        // N6: A 标废弃 + B 改字段
  | 'node_removed_modified'           // N7: admin 物删 + B 改字段
  | 'node_removed_deprecated'         // A 物删 + B 标废弃（数据完整性）
  | 'node_id_collision'               // ID 撞车（add 节点 ID 已存在 nodes_meta）
  | 'node_meta_missing'               // modified/deprecated 节点找不到 nodes_meta
  // 边级（5 项）
  | 'edge_id_collision'               // 同一 edge ID 但 semanticKey 不同（两人 add 撞 ID）
  // edge_semantic_conflict：3 个子场景（codex 四审 M4 扩展 + B-2 H1 修法登记 modified 子场景）
  // 触发场景：
  //   a) added 路径 同 ID + semanticKey 相同 + 非语义字段（label/style/waypoints/...）不同
  //   b) added 路径 不同 ID + semanticKey 相同 + 非语义字段不同
  //   c) modified 路径 双方都触及语义字段（sourceID/targetID/sourceHandle/targetHandle）且 sem-key 分歧
  //      —— B-2 H1 修法收紧：仅一方触及语义字段时不产 semantic conflict，按字段交集判 E4 / auto-merge
  // 两条 detector 不产冲突的路径（applyDelta 处理）：
  //   - added 路径 同 ID 完全等价 → 幂等保留一份（codex B-2 复审 L1' 修订：之前注释只覆盖了不同 ID 路径）
  //   - added 路径 不同 ID + sem-key 相同 + 非语义字段也相同 → E2 去重保留 A
  // detector 用 NON_SEMANTIC_CONNECTOR_FIELDS（types.ts 已编译期保证 = CONNECTOR_DIFF_FIELDS - SEMANTIC_CONNECTOR_FIELDS）
  // 比对非语义字段时用 deepEqualJsonShape（key 顺序无关，避免对象 key 顺序不同的误报）
  | 'edge_semantic_conflict'
  | 'edge_modified_both'              // E4: A B 改同一边同字段
  | 'edge_removed_modified'           // E5: A 删边 + B 改边
  | 'edge_endpoint_removed_by_other'  // N9: A 加边引用被 admin 删的节点（主动行为应弹窗）
  // sheet / project 级（5 项，G3 保守 409）
  | 'sheet_id_collision'              // 两人各自新建同 ID sheet
  | 'sheet_removed_modified'          // 删除 vs 修改同一 sheet
  | 'sheet_meta_conflict'             // 同一 sheet 元信息字段双方都改（G3 保守 409）
  | 'project_meta_conflict'           // project 顶层元信息字段双方都改（G3 保守 409）
  | 'active_sheet_missing';           // incoming activeSheetId 指向已被对方删除的 sheet

/** 单条冲突描述（用于 mergeReport / 弹窗 / conflict_logs.details） */
export interface Conflict {
  type: ConflictType;
  sheetId?: string;
  /** 节点 / 边 / sheet ID（按 type 决定语义） */
  targetId?: string;
  /** 字段名（仅边/sheet/project 同字段冲突时使用） */
  field?: string;
  /** 额外消息（前端可直接显示） */
  message?: string;
}

// ============================================================
// E7 警告（被动悬空边，自动丢弃，不算真冲突，不弹窗）
// ============================================================

export interface MergeWarning {
  type: 'edge_dropped_dangling_endpoint';
  sheetId: string;
  edgeId: string;
  missingEndpoint: string;
  missingEndpointSide: 'source' | 'target';
}

// ============================================================
// 合并结果
// ============================================================

/** mergeReport：自动合并成功时的摘要（用于 UI toast + 详情）
 *  L2 codex: 每类截断 20 条 + totalCount；E7 warnings 至少保留总数 + 前几条 edgeId */
export interface MergeReport {
  /** 自动合并的节点新增数量（汇总） */
  nodesAddedCount: number;
  /** 自动合并的节点修改数量 */
  nodesModifiedCount: number;
  /** 自动合并的节点废弃数量 */
  nodesDeprecatedCount: number;
  /** 自动合并的节点删除数量（admin） */
  nodesRemovedCount: number;
  /** 自动合并的边新增数量 */
  edgesAddedCount: number;
  /** 自动合并的边修改数量 */
  edgesModifiedCount: number;
  /** 自动合并的边删除数量 */
  edgesRemovedCount: number;
  /** E7 自动丢弃的悬空边（必须显示给用户：用户加的边没了） */
  warnings: MergeWarning[];
  /** 对方（A 用户）userId / username（用于"已与张三的改动合并"toast） */
  mergedFromUserId: number | null;
  mergedFromUsername: string | null;
  /** mergedFrom: 合并基于的 currentVersion（用户看到"基于 vN 合并"） */
  mergedFromVersion: number;
}

/** tryMerge 返回值
 *
 *  D2 修订（B-4 切片）：加 debugDelta? 可选字段给 Day 3 conflict_logs 用。
 *  ok:false 路径不携带 warnings（codex B-3 L1 验收）——前端弹窗只展示 conflicts；
 *  warnings 仅在 ok:true 路径下随 report 返回。 */
export type MergeResult =
  | {
      ok: true;
      mergedData: MultiCanvasProjectShape;
      report: MergeReport;
      debugDelta?: { deltaA: Delta; deltaB: Delta };
    }
  | {
      ok: false;
      conflicts: Conflict[];
      debugDelta?: { deltaA: Delta; deltaB: Delta };
    };

// ============================================================
// 复用 saveCanvas 已有 storage 类型（不重新定义，保持单一信息源）
// ============================================================

// storage 层 node 的客户端可改内容字段（codex Day 1 五审 M5 拆出独立 type）
//
// 这是真正的"硬边界"：每加一个字段都必须同步 NODE_DIFF_FIELDS 常量；
// 文件末尾的 _NodeDiffFieldsCovered 静态断言会在两者 union 不一致时编译报错。
//
// 不含：
// - id（索引用，永远不进 diff）
// - is_deprecated（单向状态变化，单独走 nodes.deprecated 分类）
// - 服务端独占归属字段（被 strip 剥离）
export type StorageNodeContentFields = {
  name?: string;
  type?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  expandable?: boolean;
  detailConfig?: Record<string, unknown>;
  style?: Record<string, unknown>;
  subType?: 'start' | 'end';
  backgroundColor?: string;
  parentId?: string;
  hidden?: boolean;
  label?: string;
  color?: string;
  relatedNodeIds?: string[];
  collapsed?: boolean;
  expandedSize?: { width: number | string; height: number | string };
  description?: string;
};

// storage 层 node（按 server/schemas/canvas.ts NodeSchema 实际持久化字段显式声明）
//
// H1 codex Day 1 二审：每个客户端可改持久化字段都必须在此处显式声明 + 进 NODE_DIFF_FIELDS 白名单。
//
// M4 codex Day 1 三审 + M5 四审：本类型仍保留 [key: string]: unknown 索引签名（因为 saveCanvas
// 多处 spread/解构依赖宽容期，删除会让现有代码 TS 失效）。索引签名不是编译期防漏的兜底，真正
// 的硬边界是 StorageNodeContentFields + _NodeDiffFieldsCovered 静态断言（文件末尾）。
//
// 维护规范：
//  - schema 加新 storage 内容字段 → 必须同时加进 StorageNodeContentFields + NODE_DIFF_FIELDS
//    （否则 _NodeDiffFieldsCovered 静态断言会编译报错）
export type StorageNode = StorageNodeContentFields & {
  id: string;
  // 服务端独占归属字段（被 strip 函数剥离，不进 diff）
  creator_id?: number | null;
  creator_username?: string | null;
  created_at?: number | null;
  updated_by?: number | null;
  updated_at?: number | null;
  is_deprecated?: boolean;
  deprecated_by?: number | null;
  deprecated_at?: number | null;
  deprecated_by_username?: string | null;
  // 索引签名保留：客户端 schema 未来加新字段时给宽限期，但白名单不宽限
  [key: string]: unknown;
};

// storage 层 connector 的客户端可改内容字段（codex Day 1 六审 M1 拆出独立 type）
//
// 这是真正的"硬边界"：每加一个字段都必须同步 CONNECTOR_DIFF_FIELDS 常量；
// 文件末尾的 _ConnectorDiffFieldsForwardAssert/_BackwardAssert 静态断言会在两者
// union 不一致时编译报错（与 NODE 同款 AssertNever 模式）。
//
// 不含：id（索引用，永远不进 diff）。
// 注：connector 没有归属字段（§5.5 边不区分作者），所以不需要"strip 归属"逻辑。
export type StorageConnectorContentFields = {
  sourceID: string;
  targetID: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  waypoints?: Array<{ x: number; y: number }>;
  edgeType?: 'straight' | 'smoothstep' | 'step';
  style?: Record<string, unknown>;
  notImplemented?: boolean;
  markerEnd?: unknown;
  markerStart?: unknown;
  labelStyle?: Record<string, unknown>;
  labelBgStyle?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

/** storage 层 connector（与 src/types/flow.ts FlowConnector 字段对齐） */
export type StorageConnector = StorageConnectorContentFields & {
  id: string;
  // 索引签名保留：客户端 schema 未来加新字段时给宽限期，但白名单不宽限
  [key: string]: unknown;
};

export type StorageSheet = {
  id: string;
  name?: string;
  nodes: StorageNode[];
  connectors: StorageConnector[];
  [key: string]: unknown;
};

/** project 顶层 shape（与 src/types/flow.ts MultiCanvasProject 对齐） */
export type MultiCanvasProjectShape = {
  version: 2;
  id: string;
  name?: string;
  description?: string;
  activeSheetId?: string;
  sheets: StorageSheet[];
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
};

// ============================================================
// 字段白名单常量（M1+M2）
// ============================================================

// 节点顶层 diff 字段（按 server/schemas/canvas.ts NodeSchema 实际持久化顶层字段对表）。
// 不含：id（索引用）；creator_id created_at updated_by updated_at deprecated_by deprecated_at
//   creator_username deprecated_by_username（服务端独占归属字段，stripServerAttributionForSaveInput
//   剥离）；is_deprecated（单独走 nodes.deprecated 分类）。
//
// H1 codex Day 1 审揪出漏 4 字段：name + detailConfig + hidden + description。这是节点最重要
// 持久化字段（节点名 + 节点详情 + subflow 隐藏状态 + 节点描述），缺失会让自动合并静默丢失。
//
// 注意：extent 是 React Flow 运行态字段（schema 没此字段），从早先草稿里误列入，已移除。
// expandable 由 schema 确认是 storage 字段，保留。
export const NODE_DIFF_FIELDS = [
  'name',           // H1 必修
  'type',
  'position',
  'size',
  'expandable',
  'detailConfig',   // H1 必修
  'style',
  'subType',
  'backgroundColor',
  'parentId',
  'hidden',         // H1 必修：subflow 过滤 storage
  'label',          // 分组节点
  'color',
  'relatedNodeIds',
  'collapsed',
  'expandedSize',
  'description',    // H1 必修：节点描述 storage
  // 注：data 不入白名单 —— schema NodeSchema 顶层无 data 字段（React Flow 客户端的 data
  //     在 BFV processedNodes 派生时构造，存储路径 storage 里所有节点字段都在顶层）
] as const;

/** connector 顶层 diff 字段 */
export const CONNECTOR_DIFF_FIELDS = [
  'sourceID',
  'targetID',
  'sourceHandle',
  'targetHandle',
  'label',
  'waypoints',
  'edgeType',
  'style',
  'notImplemented',
  'markerEnd',
  'markerStart',
  'labelStyle',
  'labelBgStyle',
  'data',
] as const;

/** connector 语义键字段（参与 connectorSemanticKey 编码的字段，用于 E2 / edge_id_collision /
 *  edge_semantic_conflict / H1 modified 端点变化判定）
 *
 *  必须与 connectorSemanticKey() 实现严格对齐：
 *    JSON.stringify([sheetId, sourceID, targetID, sourceHandle ?? null, targetHandle ?? null])
 *
 *  本常量是 detector / applyDelta / 未来 conflict_logs 的单一信息源；改它必须同步改 connectorSemanticKey
 *  和文件末尾的双向 AssertNever 静态断言（编译期防漂移）。 */
export const SEMANTIC_CONNECTOR_FIELDS = [
  'sourceID',
  'targetID',
  'sourceHandle',
  'targetHandle',
] as const;

/** connector 非语义字段：CONNECTOR_DIFF_FIELDS 排除 SEMANTIC_CONNECTOR_FIELDS 后的剩余字段
 *  detector 用于 edge_semantic_conflict 判定（同 sem-key 但非语义字段不同 → 冲突）
 *  注意：编译期由 _SemanticConnectorFieldsForward/Backward 断言守住语义字段集合一致性 */
export const NON_SEMANTIC_CONNECTOR_FIELDS = CONNECTOR_DIFF_FIELDS.filter(
  (f): f is Exclude<typeof CONNECTOR_DIFF_FIELDS[number], typeof SEMANTIC_CONNECTOR_FIELDS[number]> =>
    !(SEMANTIC_CONNECTOR_FIELDS as readonly string[]).includes(f)
);

/** sheet 元信息 diff 字段（不含 nodes / connectors，G3 任意字段冲突就 409） */
export const SHEET_META_DIFF_FIELDS = ['name'] as const;

/** project 顶层元信息 diff 字段（不含 sheets，G3 任意字段冲突就 409）
 *  createdAt/updatedAt 是服务端时间戳，不进 diff */
export const PROJECT_META_DIFF_FIELDS = ['name', 'description', 'activeSheetId'] as const;

// ============================================================
// semanticKey 工具（D3 codex H3：E2 同语义边去重）
// ============================================================

// connector 的 semanticKey：用 JSON.stringify 元组编码（M1 codex Day 1 二审 + M3 三审 + L1 四审）。
// 用于 E2 同语义边去重（两个客户端可能用不同 id 创建同一语义边）。
//
// 设计原则：
// - 用 JSON.stringify([...]) 而非 ${a}|${b}|... 字符串拼接，避免 handle / sheetId / nodeId
//   含分隔符 | 时撞 key（旧实现的真风险）。
// - sourceHandle/targetHandle 三态语义：
//   * undefined：未指定 handle（React Flow 自动选 default handle 渲染）
//   * 非空字符串（含 ""）：客户端显式传的 handle 值（包括 React Flow 默认空字符串 handle）
//   * null：DB 旧数据损坏 / 不应出现 → assertProjectIntegrity 显式拒绝
//
// undefined vs 空字符串 "" 区分（codex 四审 L1 收敛）：
// - schema 不禁止空字符串（z.string().max(64).optional() 允许 ""），因为 React Flow
//   的 default handle 在某些渲染路径会传 ""
// - 本 helper 把 undefined 通过 `?? null` 编码为 JSON null（"未指定"）
// - 把 "" 编码为 JSON ""（"显式空"）
// - 两者 semanticKey 不同 → undefined-handle 边和空字符串-handle 边视作不同语义边
//   （这与"用户视角"对齐：他们看到的是"自动选 handle" vs "选了某个具体 handle"两种行为）
//
// undefined / null 互斥契约（codex 三审 M3）：
// - schema 层不允许 sourceHandle/targetHandle 为 null（z.string().optional() 仅接受 undefined）
// - assertProjectIntegrity 拒绝 DB 旧数据 null handle，避免 ?? null 归一让 null 与
//   undefined 编码相同从而误判同语义边
// - 本 helper 接到 sourceHandle/targetHandle 一律是 undefined 或字符串（含 ""）
//
// computeConnectorDelta 必须调用此 helper，不要再手写一份相同逻辑（避免漂移）。
export function connectorSemanticKey(sheetId: string, c: StorageConnector): string {
  return JSON.stringify([
    sheetId,
    c.sourceID,
    c.targetID,
    c.sourceHandle ?? null,
    c.targetHandle ?? null,
  ]);
}

// ============================================================
// 静态类型断言：NODE_DIFF_FIELDS 与 StorageNodeContentFields 双向覆盖（codex 四审 M5 + 五审 H1）
// ============================================================
//
// 当 schema NodeSchema 加新字段时：
// 1. 加进 StorageNodeContentFields 类型
// 2. 加进 NODE_DIFF_FIELDS 常量
// 3. 若漏其中一步，下面任一断言会**编译报错**（codex 五审 H1：之前用元组 ?: 写法
//    TS 不会拒编译，是假闭环；本次改 AssertNever<T extends never> 真断言）
//
// 实施方式（双向 Exclude + AssertNever 真断言）：
// - Forward：NODE_DIFF_FIELDS 内的所有字符串必须是 StorageNodeContentFields 的 key
// - Backward：StorageNodeContentFields 的所有 key 必须出现在 NODE_DIFF_FIELDS
//
// 验证方法：临时把 NODE_DIFF_FIELDS 删一个字段（如 'name'），tsc -p tsconfig.server.json 应直接报
// "Type 'name' does not satisfy the constraint 'never'"。

// AssertNever<T>：T 必须是 never，否则编译报错
type AssertNever<T extends never> = T;

type _NodeDiffFieldsForward = Exclude<
  typeof NODE_DIFF_FIELDS[number],
  keyof StorageNodeContentFields
>;
type _NodeDiffFieldsBackward = Exclude<
  keyof StorageNodeContentFields,
  typeof NODE_DIFF_FIELDS[number]
>;

// 编译期断言：两个 Exclude 必须都是 never；任何一个非 never 都让 AssertNever 编译失败
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _NodeDiffFieldsForwardAssert = AssertNever<_NodeDiffFieldsForward>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _NodeDiffFieldsBackwardAssert = AssertNever<_NodeDiffFieldsBackward>;

// CONNECTOR_DIFF_FIELDS 与 StorageConnectorContentFields 双向覆盖（codex 六审 M1）
// 同 NODE 模式，未来加字段任一漏改都编译失败
// 注：SHEET_META_DIFF_FIELDS / PROJECT_META_DIFF_FIELDS 不照搬此模式（codex 六审明确指出
// 这些是有意选择的元信息子集，不是全字段镜像，应靠注释而非静态断言表达边界）

type _ConnectorDiffFieldsForward = Exclude<
  typeof CONNECTOR_DIFF_FIELDS[number],
  keyof StorageConnectorContentFields
>;
type _ConnectorDiffFieldsBackward = Exclude<
  keyof StorageConnectorContentFields,
  typeof CONNECTOR_DIFF_FIELDS[number]
>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ConnectorDiffFieldsForwardAssert = AssertNever<_ConnectorDiffFieldsForward>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ConnectorDiffFieldsBackwardAssert = AssertNever<_ConnectorDiffFieldsBackward>;

// SEMANTIC_CONNECTOR_FIELDS 与 connectorSemanticKey 实际编码字段对齐（B-2 codex H1+L1 修法）
//
// 编译期保证 SEMANTIC_CONNECTOR_FIELDS ⊂ CONNECTOR_DIFF_FIELDS（语义字段必须是 diff 字段子集；
// 否则下游"非语义字段 = diff 字段 - 语义字段"的差集会缺漏字段）。
//
// connectorSemanticKey 实际编码 4 字段（sourceID / targetID / sourceHandle / targetHandle）；
// 第二个断言用元组保证常量值与函数实现严格一致——若加 5 个语义字段或漏掉一个都编译报错。
//
// 验证方法：临时把 SEMANTIC_CONNECTOR_FIELDS 删一个字段（如 'sourceID'），tsc -p tsconfig.server.json
// 应直接报 "Type 'X' does not satisfy the constraint 'never'"。

type _SemanticConnectorFieldsSubset = Exclude<
  typeof SEMANTIC_CONNECTOR_FIELDS[number],
  typeof CONNECTOR_DIFF_FIELDS[number]
>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SemanticConnectorFieldsSubsetAssert = AssertNever<_SemanticConnectorFieldsSubset>;

// 与 connectorSemanticKey 实现的 4 字段元组严格对齐（顺序无关，集合相等）
type _ExpectedSemanticFields = 'sourceID' | 'targetID' | 'sourceHandle' | 'targetHandle';
type _SemanticForwardMissing = Exclude<typeof SEMANTIC_CONNECTOR_FIELDS[number], _ExpectedSemanticFields>;
type _SemanticBackwardMissing = Exclude<_ExpectedSemanticFields, typeof SEMANTIC_CONNECTOR_FIELDS[number]>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SemanticForwardAssert = AssertNever<_SemanticForwardMissing>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SemanticBackwardAssert = AssertNever<_SemanticBackwardMissing>;
