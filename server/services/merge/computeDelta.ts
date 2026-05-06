// 阶段 5 合并算法 — computeDelta：算 base → incoming 的差集
//
// 关键约定（codex 取舍审采纳）：
// - D2 M1: 节点字段级 diff 通过白名单（NODE_DIFF_FIELDS）排除服务端独占归属字段，
//   不对整节点做 strip；这一点与 saveCanvas 路径不同（saveCanvas 用 strip + deepEqual 整节点比较）。
//   两边都正确：白名单更显式列出 diff 字段，strip 用排除集；语义等价，实现路径不同。
// - D2 M2: 节点 / 连线各按 NODE_DIFF_FIELDS / CONNECTOR_DIFF_FIELDS 顶层字段清单做 diff
// - D3 H3: connector 同语义边按 semanticKey 去重（E2 路径的支撑）；统一调用 connectorSemanticKey
// - G3: sheet / project 元信息字段任意一项变 → 进 *MetaChangedFields；下游冲突检测决定 409
// - G4: deltaB 是权限校验和 nodes_meta 同步的唯一输入；NodeDelta.alsoDeprecated 显式表达
//   "内容修改 + 同时标废弃" 让 applyDelta 不需要回读 base/incoming 即可决定写 deprecated_*
// - 防御性 H3: incoming 通过 schema 已拒重复 ID（superRefine），但 baseData/currentData 来自
//   DB 没经过 schema 校验；computeDelta 兜底检测重复 ID，发现损坏抛 DataIntegrityError
//
// 单元测试见 server/services/merge/computeDelta.test.ts

import {
  CONNECTOR_DIFF_FIELDS,
  NODE_DIFF_FIELDS,
  PROJECT_META_DIFF_FIELDS,
  SHEET_META_DIFF_FIELDS,
  connectorSemanticKey,
  type ConnectorDelta,
  type Delta,
  type FieldChange,
  type MultiCanvasProjectShape,
  type NodeDelta,
  type SheetDelta,
  type StorageConnector,
  type StorageNode,
  type StorageSheet,
} from './types.ts';

// ============================================================
// DataIntegrityError：DB 层数据损坏（重复 ID / null handle 等）
// ============================================================
//
// 客户端 incoming 经过 schema superRefine 拒重复 ID + 不允许 null handle，
// 正常路径不会触发。仅当历史 DB 快照（canvas_versions / canvases.data）含
// 损坏数据时才会抛。saveCanvas 应捕获并返回 500 + 'data_integrity_error'
// 让运维介入，**不要**混成普通 save_failed / 409 conflict（codex Day 1 三审）。

export class DataIntegrityError extends Error {
  constructor(public reason: string, public location: string) {
    super(`data integrity violation at ${location}: ${reason}`);
    this.name = 'DataIntegrityError';
  }
}

// ============================================================
// assertProjectIntegrity：全量扫描 project 数据完整性
// ============================================================
//
// computeDelta 入口必须先扫整个 project（含 sheetsAdded/sheetsRemoved 内部）；
// 仅在 sheetsModified 路径调 indexNodes/indexConnectors 会让 added/removed sheet
// 内部的重复 ID 绕过防御层（codex 三审 M1 发现的真漏）。
//
// 校验项（codex Day 1 三审 + 四审 M1+M2 完整集合）：
// 1. project.sheets[].id 全局唯一
// 2. 每个 sheet 内 nodes[].id 唯一
// 3. 每个 sheet 内 connectors[].id 唯一
// 4. connector handle 不能是 null（M3：null 与 undefined 归一为"未指定"，
//    schema 层不允许 null，但 DB 旧数据可能存在 null）
// 5. project.activeSheetId 必须存在于 sheets 中（codex 四审 M1）
// 6. 每条 connector 的 sourceID/targetID 必须指向同 sheet 内已存在节点（codex 四审 M1）
// 7. 每个节点的 parentId（若设置）必须指向同 sheet 内已存在的 group 节点（codex 四审 M2）
//    本项目 parentId 是分组 group 节点的硬引用（schema NodeSchema:parentId 是 ShortIdSchema.optional()）
//    schema superRefine 之前留了空注释没真校验，本函数兜底（同时 schemas/canvas.ts 也已补真校验）

export function assertProjectIntegrity(
  project: MultiCanvasProjectShape,
  sourceLabel: string
): void {
  // 第一遍：收集所有 sheetId / nodeId / connectorId，校验唯一性 + null handle
  const seenSheetIds = new Set<string>();
  // sheet 内 nodes/connectors 索引：sheet.id → Map<nodeId, node>
  const sheetNodes = new Map<string, Map<string, StorageNode>>();

  for (const sheet of project.sheets) {
    if (seenSheetIds.has(sheet.id)) {
      throw new DataIntegrityError(
        `duplicate sheet id ${sheet.id}`,
        sourceLabel
      );
    }
    seenSheetIds.add(sheet.id);

    const nodeMap = new Map<string, StorageNode>();
    for (const node of sheet.nodes) {
      if (nodeMap.has(node.id)) {
        throw new DataIntegrityError(
          `duplicate node id ${node.id}`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
      nodeMap.set(node.id, node);
    }
    sheetNodes.set(sheet.id, nodeMap);

    const seenConnectorIds = new Set<string>();
    for (const conn of sheet.connectors) {
      if (seenConnectorIds.has(conn.id)) {
        throw new DataIntegrityError(
          `duplicate connector id ${conn.id}`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
      seenConnectorIds.add(conn.id);
      // M3 codex Day 1 三审：null handle 视作"未指定"（与 undefined 归一），
      // schema 不允许 null，但 DB 旧数据可能存在；显式拒绝避免 semanticKey 编码
      // 把 null 与缺省 handle 误判为同一语义边
      if (conn.sourceHandle === null) {
        throw new DataIntegrityError(
          `connector ${conn.id} sourceHandle is null (use undefined for unspecified)`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
      if (conn.targetHandle === null) {
        throw new DataIntegrityError(
          `connector ${conn.id} targetHandle is null (use undefined for unspecified)`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
    }
  }

  // 第二遍：校验跨字段引用一致性（codex 四审 M1+M2）
  // 5. activeSheetId 必须存在
  if (project.activeSheetId !== undefined && !seenSheetIds.has(project.activeSheetId)) {
    throw new DataIntegrityError(
      `activeSheetId ${project.activeSheetId} does not exist in sheets`,
      sourceLabel
    );
  }

  for (const sheet of project.sheets) {
    const nodeMap = sheetNodes.get(sheet.id)!;

    // 6. connector endpoints 必须指向同 sheet 内节点
    for (const conn of sheet.connectors) {
      if (!nodeMap.has(conn.sourceID)) {
        throw new DataIntegrityError(
          `connector ${conn.id} sourceID ${conn.sourceID} not found in sheet`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
      if (!nodeMap.has(conn.targetID)) {
        throw new DataIntegrityError(
          `connector ${conn.id} targetID ${conn.targetID} not found in sheet`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
    }

    // 7. parentId 校验（codex 四审 M2 + 五审 M1 收紧 + 六审 L1 拍板）
    //    - 拒自引用（node.parentId === node.id）
    //    - group 节点本身不能有 parentId（不允许 group 嵌套；与 useFlowOperations:315 对齐）
    //    - parentId 必须指向同 sheet 内已存在的 group 节点
    //    - 允许 parentId 指向 is_deprecated=true 的 group（P3C 语义：标废弃只是状态，节点仍存在）
    for (const node of sheet.nodes) {
      if (node.parentId === undefined) continue;
      if (node.parentId === node.id) {
        throw new DataIntegrityError(
          `node ${node.id} parentId points to itself (self-reference)`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
      if (node.type === 'group') {
        throw new DataIntegrityError(
          `node ${node.id} is a group with parentId ${node.parentId}; group nesting is not allowed`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
      const parent = nodeMap.get(node.parentId);
      if (!parent) {
        throw new DataIntegrityError(
          `node ${node.id} parentId ${node.parentId} not found in sheet`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
      if (parent.type !== 'group') {
        throw new DataIntegrityError(
          `node ${node.id} parentId ${node.parentId} points to non-group (type=${parent.type ?? 'undefined'})`,
          `${sourceLabel} sheet=${sheet.id}`
        );
      }
    }
  }
}

// ============================================================
// deepEqual + strip helper（与 saveCanvas 同款语义）
// ============================================================
//
// 以下两个 helper 与 server/services/canvases.ts 的 deepEqualJsonShape /
// stripHydratedNodeMetaForCompareOrHydrate 是同语义实现。两边独立写各自的副本不为了
// 不耦合 —— canvases.ts 的 helper 是 file-private，merge 这边需要相同语义但拿不到
// 那个未导出的实现。
//
// 等阶段 5 全套合并算法稳定后，再考虑把这两个 helper 提到独立 utility 文件
// （server/utils/json-shape.ts）双方共用。本次保持双副本以减少 saveCanvas 改动面。

/** key-order 无关的 deep equal，等价于 JSON 序列化语义：
 * - 跳过 value === undefined 的 key（JSON.stringify 会丢，必须忽略）
 * - 不依赖键插入顺序
 * - 仅支持 JSON-safe 值（原始 / 数组 / 普通对象）
 */
export function deepEqualJsonShape(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualJsonShape(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (bo[k] === undefined) return false;
    if (!deepEqualJsonShape(ao[k], bo[k])) return false;
  }
  return true;
}

// ============================================================
// 字段级 diff helper（按白名单）
// ============================================================

/** 比两组字段，返回 changedFields 列表（按白名单逐字段比较）
 *  每字段按 deepEqualJsonShape 判等；不等则记入 FieldChange */
function diffByWhitelist(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[]
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const f of fields) {
    if (!deepEqualJsonShape(before[f], after[f])) {
      changes.push({ field: f, before: before[f], after: after[f] });
    }
  }
  return changes;
}

// ============================================================
// 节点 / 连线 索引工具
// ============================================================

/** sheet → (nodeId → node)。重复 nodeId 抛 DataIntegrityError（H3 防御层） */
function indexNodes(sheet: StorageSheet, sourceLabel: string): Map<string, StorageNode> {
  const m = new Map<string, StorageNode>();
  for (const n of sheet.nodes) {
    if (m.has(n.id)) {
      throw new DataIntegrityError(
        `duplicate node id ${n.id}`,
        `${sourceLabel} sheet=${sheet.id}`
      );
    }
    m.set(n.id, n);
  }
  return m;
}

/** sheet → (connectorId → connector)。重复 connectorId 抛 DataIntegrityError */
function indexConnectors(sheet: StorageSheet, sourceLabel: string): Map<string, StorageConnector> {
  const m = new Map<string, StorageConnector>();
  for (const c of sheet.connectors) {
    if (m.has(c.id)) {
      throw new DataIntegrityError(
        `duplicate connector id ${c.id}`,
        `${sourceLabel} sheet=${sheet.id}`
      );
    }
    m.set(c.id, c);
  }
  return m;
}

/** project → (sheetId → sheet)。重复 sheetId 抛 DataIntegrityError */
function indexSheets(project: MultiCanvasProjectShape, sourceLabel: string): Map<string, StorageSheet> {
  const m = new Map<string, StorageSheet>();
  for (const s of project.sheets) {
    if (m.has(s.id)) {
      throw new DataIntegrityError(
        `duplicate sheet id ${s.id}`,
        sourceLabel
      );
    }
    m.set(s.id, s);
  }
  return m;
}

// ============================================================
// 单 sheet delta：节点级
// ============================================================

function computeNodeDelta(
  baseNodes: Map<string, StorageNode>,
  incomingNodes: Map<string, StorageNode>
): SheetDelta['nodes'] {
  const added = new Map<string, StorageNode>();
  const removed = new Map<string, StorageNode>();
  const modified = new Map<string, NodeDelta>();
  const deprecated = new Map<string, StorageNode>();

  for (const [id, node] of incomingNodes) {
    const baseNode = baseNodes.get(id);
    if (!baseNode) {
      added.set(id, node);
      continue;
    }
    const baseDep = !!baseNode.is_deprecated;
    const newDep = !!node.is_deprecated;

    // 顶层字段 diff（白名单内）
    const changedFields = diffByWhitelist(
      baseNode as Record<string, unknown>,
      node as Record<string, unknown>,
      NODE_DIFF_FIELDS
    );

    // 仅 is_deprecated false→true 且其他字段未变 → deprecated 单独分类
    if (changedFields.length === 0 && !baseDep && newDep) {
      deprecated.set(id, node);
      continue;
    }
    // 内容变（可能同时 dep 也变）→ modified 分类
    // H2 codex Day 1 审：alsoDeprecated 显式表达"内容变 + dep false→true"，
    // 让 applyDelta 不需要回读 base/incoming 即可决定写 deprecated_*（G4 deltaB 唯一权限源）
    if (changedFields.length > 0) {
      const alsoDeprecated = !baseDep && newDep;
      const nodeDelta: NodeDelta = { nodeId: id, changedFields };
      if (alsoDeprecated) {
        nodeDelta.alsoDeprecated = true;
      }
      modified.set(id, nodeDelta);
    }
    // 如果 changedFields 为空且 dep 也未变（含 dep true→true）→ 完全相等，跳过
    // 注：dep true→false 静默忽略 —— 业务规则单向废弃，schema/saveCanvas 应在更早路径强制保废
    //     （是否要在 schema/saveCanvas 拒此输入是 M3 codex Day 1 审的范围，不在 computeDelta 责任）
  }

  for (const [id, node] of baseNodes) {
    if (!incomingNodes.has(id)) {
      removed.set(id, node);
    }
  }

  return { added, removed, modified, deprecated };
}

// ============================================================
// 单 sheet delta：连线级
// ============================================================

function computeConnectorDelta(
  sheetId: string,
  baseConnectors: Map<string, StorageConnector>,
  incomingConnectors: Map<string, StorageConnector>
): SheetDelta['connectors'] {
  const added = new Map<string, StorageConnector>();
  const removed = new Map<string, StorageConnector>();
  const modified = new Map<string, ConnectorDelta>();

  for (const [id, conn] of incomingConnectors) {
    const baseConn = baseConnectors.get(id);
    if (!baseConn) {
      added.set(id, conn);
      continue;
    }
    const changedFields = diffByWhitelist(
      baseConn as Record<string, unknown>,
      conn as Record<string, unknown>,
      CONNECTOR_DIFF_FIELDS
    );
    if (changedFields.length > 0) {
      // M1 codex Day 1 审：统一调用 connectorSemanticKey，不再手写拼接
      const semanticKey = connectorSemanticKey(sheetId, conn);
      modified.set(id, { connectorId: id, semanticKey, changedFields });
    }
  }

  for (const [id, conn] of baseConnectors) {
    if (!incomingConnectors.has(id)) {
      removed.set(id, conn);
    }
  }

  return { added, removed, modified };
}

// ============================================================
// 单 sheet delta（含 sheet 元信息字段 diff）
// ============================================================

function computeSheetDelta(
  baseSheet: StorageSheet,
  incomingSheet: StorageSheet,
  baseLabel: string,
  incomingLabel: string
): SheetDelta {
  const sheetMetaChangedFields = diffByWhitelist(
    baseSheet as Record<string, unknown>,
    incomingSheet as Record<string, unknown>,
    SHEET_META_DIFF_FIELDS
  );

  const baseNodes = indexNodes(baseSheet, baseLabel);
  const incomingNodes = indexNodes(incomingSheet, incomingLabel);
  const baseConns = indexConnectors(baseSheet, baseLabel);
  const incomingConns = indexConnectors(incomingSheet, incomingLabel);

  return {
    sheetId: baseSheet.id,
    sheetMetaChangedFields,
    nodes: computeNodeDelta(baseNodes, incomingNodes),
    connectors: computeConnectorDelta(baseSheet.id, baseConns, incomingConns),
  };
}

// ============================================================
// 顶层入口：computeDelta
// ============================================================

/**
 * 计算 base → incoming 的 delta。
 *
 * 用法：
 * - deltaA = computeDelta(baseData, currentData)：对方做的改动（A user）
 * - deltaB = computeDelta(baseData, clientData)：当前用户想做的改动（B user）
 *
 * 规则：
 * - 顶层字段（NODE_DIFF_FIELDS / CONNECTOR_DIFF_FIELDS）按白名单 diff
 * - 服务端独占归属字段（被 stripHydratedNodeMetaForCompareOrHydrate 剥的字段）
 *   不在白名单内 → 永不进 changedFields
 * - is_deprecated 单独走 sheet.nodes.deprecated（不在 NODE_DIFF_FIELDS）
 * - sheet 顶层元信息（name）按 SHEET_META_DIFF_FIELDS 白名单 diff
 * - project 顶层元信息（name/description/activeSheetId）按 PROJECT_META_DIFF_FIELDS diff
 */
export function computeDelta(
  base: MultiCanvasProjectShape,
  incoming: MultiCanvasProjectShape
): Delta {
  // M1 codex Day 1 三审：入口先全量扫数据完整性（含 sheetsAdded/sheetsRemoved 内部）
  // 避免双方都存在的 sheet 路径（indexNodes/indexConnectors）才检测重复 ID
  // 历史 DB 快照若含损坏数据（重复 ID / null handle），此处显式抛 DataIntegrityError
  // saveCanvas 调用方负责捕获并返 500 + 'data_integrity_error'
  assertProjectIntegrity(base, 'baseData');
  assertProjectIntegrity(incoming, 'incomingData');

  // project 元信息
  const projectMetaChangedFields = diffByWhitelist(
    base as Record<string, unknown>,
    incoming as Record<string, unknown>,
    PROJECT_META_DIFF_FIELDS
  );

  // sheets 索引（H3 防御层：重复 sheet ID 抛 DataIntegrityError）
  const baseSheets = indexSheets(base, 'baseData');
  const incomingSheets = indexSheets(incoming, 'incomingData');

  const sheetsAdded = new Map<string, StorageSheet>();
  const sheetsRemoved = new Map<string, StorageSheet>();
  const sheetsModified = new Map<string, SheetDelta>();

  for (const [id, sheet] of incomingSheets) {
    const baseSheet = baseSheets.get(id);
    if (!baseSheet) {
      sheetsAdded.set(id, sheet);
      continue;
    }
    const sheetDelta = computeSheetDelta(baseSheet, sheet, 'baseData', 'incomingData');
    if (
      sheetDelta.sheetMetaChangedFields.length > 0 ||
      sheetDelta.nodes.added.size > 0 ||
      sheetDelta.nodes.removed.size > 0 ||
      sheetDelta.nodes.modified.size > 0 ||
      sheetDelta.nodes.deprecated.size > 0 ||
      sheetDelta.connectors.added.size > 0 ||
      sheetDelta.connectors.removed.size > 0 ||
      sheetDelta.connectors.modified.size > 0
    ) {
      sheetsModified.set(id, sheetDelta);
    }
  }

  for (const [id, sheet] of baseSheets) {
    if (!incomingSheets.has(id)) {
      sheetsRemoved.set(id, sheet);
    }
  }

  return {
    projectMetaChangedFields,
    sheetsAdded,
    sheetsRemoved,
    sheetsModified,
  };
}

/** delta 是否为空（无任何变化）—— saveCanvas 的"完全一样"快速路径 */
export function isEmptyDelta(delta: Delta): boolean {
  return (
    delta.projectMetaChangedFields.length === 0 &&
    delta.sheetsAdded.size === 0 &&
    delta.sheetsRemoved.size === 0 &&
    delta.sheetsModified.size === 0
  );
}
