// P3D-1 / P3D-2 节点级权限前端判定（纯函数，可单测）
//
// 设计原则（codex 建议项）：
// - 纯函数，不放 AuthContext —— FlowCanvas / 节点组件 / 详情面板都能直接复用
// - 不依赖 React，便于单测
// - **前端只是友好层** —— 服务端 saveCanvas §5.7 是终极兜底（伪造 creator_id 越权
//   仍会被 nodes_meta 索引判定 modified 后 403 forbidden_modify_others_node）
//
// 权限矩阵（与服务端一致）：
//
// | user 角色 | canvasWritable | __localNew | creator_id 匹配 | 结果 |
// |---|---|---|---|---|
// | 游客（user=null） | * | * | * | false |
// | 任意 | false | * | * | false |
// | admin | true | * | * | true |
// | 普通用户 | true | true | * | true（本地新增） |
// | 普通用户 | true | * | true | true（自己创建） |
// | 普通用户 | true | false | false | false（别人节点） |
//
// 注意 is_deprecated 不参与判定 —— 标废弃是公开权限（任何登录用户都可标），
// 但**改其他内容**仍需 creator/admin。DeprecateNodeSection 的按钮启用条件是
// canvasWritable + !is_deprecated（不依赖 canEditNode）。

import type { UserPublic } from './api';
import type { NodeChange, Node, Edge } from '@xyflow/react';
import type { FlowNodeData } from '../types/flow';

export interface CanEditNodeData {
  /** 节点元信息：creator_id 来自 nodes_meta（服务端 hydrate） */
  creator_id?: number;
  /** 运行时标记：本地新增节点（拖出/粘贴/创建分组），不入 storage */
  __localNew?: boolean;
}

/**
 * 当前用户是否能编辑此节点（修改内容、改名、改样式等"非废弃"动作）
 *
 * @param nodeData 节点 data（FlowNodeData 或 GroupNodeData 都满足这个最小接口）
 * @param user    当前登录用户（null = 游客）
 * @param canvasWritable 当前画布是否可写（游客 / 归档 / 非 owner private 都 false）
 *                       由 caller 算好（通常 = !readOnly && status==='authenticated'）
 */
export function canEditNodeData(
  nodeData: CanEditNodeData,
  user: UserPublic | null,
  canvasWritable: boolean,
): boolean {
  if (!user) return false;
  if (!canvasWritable) return false;
  if (user.role === 'admin') return true;
  if (nodeData.__localNew === true) return true;
  if (typeof nodeData.creator_id === 'number' && nodeData.creator_id === user.id) {
    return true;
  }
  return false;
}

// ============================================================
// P3D-2 step 3 中心 mutation gate helper（codex 二审建议项）
// ============================================================
//
// 抽出 3 个纯函数让 mutation gate 逻辑可单测、可复用：
// - isPublicDeprecateUpdate：判定一次 onNodeUpdate 是否仅"标废弃"
// - filterNodeChangesByPermission：按 canEditNodeData 过滤 React Flow 节点 change 数组
// - assertCanApplyNodeUpdate：判定一次 onNodeUpdate 是否可应用（结合 isDeprecate 例外）

/**
 * P3D-2 step 9 / 六审 medium 3：数值合法性校验（NaN / Infinity / 负宽高）。
 *
 * 校验规则：
 *   - isFiniteNumber：必须是有限 number（拒 NaN / Infinity / null / undefined / 非 number）
 *   - isValidXY：x/y 都必须是有限数
 *   - isValidDimensions：width/height 都必须是有限数 + ≥ 0（负宽高必拒）
 *
 * 用于：
 *   - filterNodeChangesByPermission 的 position/dimensions/add/replace 分支
 *   - canApplyNodeUpdate 的 style.width/height（codex 26-审 medium 2）
 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidXY(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false;
  const obj = p as { x?: unknown; y?: unknown };
  return isFiniteNumber(obj.x) && isFiniteNumber(obj.y);
}

function isValidDimensions(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const obj = d as { width?: unknown; height?: unknown };
  return (
    isFiniteNumber(obj.width)
    && isFiniteNumber(obj.height)
    && obj.width >= 0
    && obj.height >= 0
  );
}

/**
 * 校验 onNodeUpdate 的 style 几何字段（width/height）合法性。
 * codex 26-审 medium 2：详情面板/恶意调用可能传 style.width=NaN 绕过 NodeChange gate。
 * codex 27-二审 low 1：收紧非 object 入参 —— 字符串/数字/数组都 fail-closed。
 *
 * 规则：
 *   - null / undefined → 放行（"无 style 改动"，调用方约定）
 *   - 非 plain object（含 string / number / boolean / array）→ 拒（fail-closed）
 *   - plain object：给了 width/height 就必须是有限数 + ≥ 0；undefined 放行（部分改动场景）
 *
 * @returns true 合法 / false 拒绝
 */
function isValidStyleGeometry(style: unknown): boolean {
  if (style === null || style === undefined) return true;
  if (typeof style !== 'object') return false; // string / number / boolean → fail-closed
  if (Array.isArray(style)) return false; // 数组也拒
  const obj = style as { width?: unknown; height?: unknown };
  if (obj.width !== undefined && (!isFiniteNumber(obj.width) || obj.width < 0)) return false;
  if (obj.height !== undefined && (!isFiniteNumber(obj.height) || obj.height < 0)) return false;
  return true;
}

/**
 * 判定一次 dataUpdates 是否仅"标废弃"动作 —— 公开权限路径。
 *
 * P3D-2 step 3 codex 二审必修 2：精确为 `is_deprecated === true && user !== null`。
 * 不能放行 `false`（取消废弃，服务端禁）或 `undefined`（语义不明），且必须登录用户。
 *
 * P3D-2 step 3 codex 七审 L1（约定）：调用方约定 `updatedStyle` 用 `undefined` 表"无 style 改动"。
 * 当前所有 onNodeUpdate 调用点（FlowCanvas/index.tsx:627 / 646）都满足此约定 ——
 * 一处不传（=undefined），一处直接转发上游 NodeUpdateParams.style（也是 undefined 才不传）。
 * 如果未来有调用方传 `{}` 表"无 style"，会被 `updatedStyle != null` 误判为"有 style 改动"
 * 进而拒绝标废弃 —— 那是调用方 bug，应在调用方归一化为 undefined，不在此处放宽。
 *
 * @param dataUpdates onNodeUpdate 的 dataUpdates 入参
 * @param updatedStyle onNodeUpdate 的 updatedStyle 入参（约定 undefined 表无 style）
 * @param user 当前登录用户
 */
export function isPublicDeprecateUpdate(
  dataUpdates: Record<string, unknown>,
  updatedStyle: unknown,
  user: UserPublic | null,
): boolean {
  if (!user) return false;
  if (updatedStyle != null) return false;
  const keys = Object.keys(dataUpdates);
  if (keys.length !== 1) return false;
  if (keys[0] !== 'is_deprecated') return false;
  // 精确判定：必须是 === true（取消废弃 false / undefined 不属于公开权限路径）
  return dataUpdates.is_deprecated === true;
}

/**
 * 判定一次 onNodeUpdate 是否可应用 —— 中心 gate 主入口。
 *
 * 决策树：
 * 1. 标废弃（公开权限）→ 任何登录用户放行
 * 2. 其他改动 → canEditNodeData（admin / __localNew / creator）
 *
 * @param targetNodeData 目标节点 data
 * @param dataUpdates 本次更新的 dataUpdates
 * @param updatedStyle 本次更新的 updatedStyle
 * @param user 当前登录用户
 * @param canvasWritable 当前画布是否可写
 * @returns true=允许应用；false=必须吞掉（UI 状态/画布数据都不应改）
 */
export function canApplyNodeUpdate(
  targetNodeData: CanEditNodeData,
  dataUpdates: Record<string, unknown>,
  updatedStyle: unknown,
  user: UserPublic | null,
  canvasWritable: boolean,
): boolean {
  // codex 26-审 medium 2：style 几何字段（width/height）数值合法性
  // 任何路径（标废弃 / 普通编辑）都要过这道校验，避免详情面板/恶意调用传 NaN 绕过 NodeChange gate
  if (!isValidStyleGeometry(updatedStyle)) return false;

  if (isPublicDeprecateUpdate(dataUpdates, updatedStyle, user)) {
    // 标废弃也需要 canvasWritable（归档画布等场景）
    return canvasWritable && user !== null;
  }
  return canEditNodeData(targetNodeData, user, canvasWritable);
}

/**
 * 按节点级权限过滤 React Flow 节点 change 数组。
 *
 * 处理顺序（fail-closed 原则）：
 * 1. 非 mutating（select 等）→ 放行
 * 2. !canvasWritable → 全拒
 * 3. **批级结构校验**（admin 也执行——数据完整性约束）：
 *    - add：item 存在 + item.id 是非空 string + 与现有 nodes 不冲突 + 批内不与其它 add 重复
 *    - replace：item 存在 + change.id 是非空 string + item.id === change.id + 目标在 nodes 中
 *    - position/dimensions/remove：change.id 是非空 string + 目标在 nodes 中
 * 4. admin 短路放行
 * 5. 权限判定：
 *    - add：普通用户必须 item.data.__localNew === true（不能信 item.data.creator_id）
 *    - replace/position/dimensions/remove：按 nodes 中**原节点**的 data 调 canEditNodeData
 *      （不能信 replace 的 item.data，攻击者可改 creator_id/__localNew 绕过）
 *
 * 攻击面覆盖（穷举）：
 * - 伪造 replace item.data.creator_id / __localNew → 按原节点 data 判权
 * - 伪造 replace change.id 与 item.id 错配 → ID 结构校验
 * - 伪造 add 带自己 creator_id 但无 __localNew → 必须 __localNew===true
 * - 伪造 add 复用现有节点 ID → ID 唯一性校验（admin 也执行）
 * - 伪造同批多个 add 用相同新 ID → 批内重复检查（admin 也执行）
 * - position/dimensions/remove 指向 ghost 节点 → 目标存在校验
 * - !canvasWritable + 任意 mutating → 全拒
 * - id 是非 string、空字符串、null、undefined → 全拒
 *
 * @param changes React Flow 喂来的 change 数组
 * @param nodes 当前 nodes 引用（用于按 change.id 找原节点 data）
 * @param user 当前登录用户
 * @param canvasWritable 当前画布是否可写
 * @returns 过滤后的 change 数组
 */
export function filterNodeChangesByPermission(
  changes: NodeChange<Node<FlowNodeData>>[],
  nodes: Node<FlowNodeData>[],
  user: UserPublic | null,
  canvasWritable: boolean,
): NodeChange<Node<FlowNodeData>>[] {
  // P3D-2 step 3 codex 六审 medium 2：未知 NodeChange 类型 fail-closed
  // React Flow 12 当前主流：select/position/dimensions/remove/add/replace
  // 显式 allow-list 只放行 select 作为非 mutating；
  // 未知/未来新增的 mutating 类型 → 走 mutating 校验路径默认拒绝，避免 fail-open 漏。
  const NON_MUTATING_TYPES = new Set(['select']);
  const KNOWN_MUTATING_TYPES = new Set(['position', 'dimensions', 'remove', 'add', 'replace']);

  // 批级预扫描：统计本批 add 的 item.id 计数（>1 说明批内重复）
  const addIdCounts = new Map<string, number>();
  for (const change of changes) {
    if (change.type !== 'add') continue;
    const item = (change as { item?: Node<FlowNodeData> }).item;
    const itemId = item?.id;
    if (typeof itemId === 'string' && itemId.length > 0) {
      addIdCounts.set(itemId, (addIdCounts.get(itemId) ?? 0) + 1);
    }
  }
  const existingNodeIds = new Set(nodes.map((n) => n.id));
  const isAdmin = !!user && user.role === 'admin';

  return changes.filter((change) => {
    if (NON_MUTATING_TYPES.has(change.type)) return true;
    // 未知类型（既不在 allow-list 也不在已知 mutating 类型）→ fail-closed
    if (!KNOWN_MUTATING_TYPES.has(change.type)) return false;
    if (!canvasWritable) return false;

    // ============================================================
    // 第 3 步：批级结构校验（admin 也执行）
    // ============================================================
    if (change.type === 'add') {
      const item = (change as { item?: Node<FlowNodeData> }).item;
      if (!item) return false;
      const itemId = item.id;
      if (typeof itemId !== 'string' || itemId.length === 0) return false;
      // P3D-2 step 3 codex 六审 medium 1：item.data.id 必须等于 item.id
      // 攻击者构造 item.id='legitimate' 但 item.data.id='other' 会让下游按 data.id 索引时错位
      const itemDataId = (item.data as { id?: unknown } | undefined)?.id;
      if (itemDataId !== undefined && itemDataId !== itemId) return false;
      // 与现有 nodes 不冲突
      if (existingNodeIds.has(itemId)) return false;
      // 批内不与其它 add 重复（>1 表示本批至少出现两次，全部拒）
      if ((addIdCounts.get(itemId) ?? 0) > 1) return false;
      // P3D-2 step 3 codex 八审 L1：parentId 若给了，必须指向现有的 group 节点
      // 数据完整性约束（admin 也执行）—— 防止挂到孤儿 ID 或非 group 节点
      // 普通用户的 parentId 限制在第 5 步另行处理（必须 undefined）
      if (item.parentId !== undefined) {
        const parentNode = nodes.find((n) => n.id === item.parentId);
        if (!parentNode) return false;
        if (parentNode.type !== 'group') return false;
      }
      // P3D-2 step 9 / 六审 medium 3：item.position 数值合法性
      if (!isValidXY(item.position)) return false;
      // 可选 width/height —— 给了就要合法（NodeBase.width/height 是 optional）
      const itemWidth = (item as { width?: unknown }).width;
      const itemHeight = (item as { height?: unknown }).height;
      if (itemWidth !== undefined && (!isFiniteNumber(itemWidth) || itemWidth < 0)) return false;
      if (itemHeight !== undefined && (!isFiniteNumber(itemHeight) || itemHeight < 0)) return false;
    } else if (change.type === 'replace') {
      const item = (change as { item?: Node<FlowNodeData> }).item;
      const id = (change as { id?: unknown }).id;
      if (typeof id !== 'string' || id.length === 0) return false;
      if (!item) return false;
      if (item.id !== id) return false;
      // P3D-2 step 3 codex 六审 medium 1：item.data.id 必须等于 item.id
      const itemDataId = (item.data as { id?: unknown } | undefined)?.id;
      if (itemDataId !== undefined && itemDataId !== item.id) return false;
      if (!existingNodeIds.has(id)) return false;
      // P3D-2 step 3 codex 七审 M1：禁止通过 NodeChange 改 parentId（含 admin）
      // 分组关系变更必须走 useFlowOperations 的 onCreateGroup/onAddToGroup/onRemoveFromGroup/onUngroup
      // 那里有完整的"oldParent + newParent + child" 三方权限校验。
      // 这里只断"通过 replace 偷改 parentId"这一条路 —— 防御深度。
      const targetForReplace = nodes.find((n) => n.id === id);
      if (targetForReplace && targetForReplace.parentId !== item.parentId) return false;
      // P3D-2 step 9 / 六审 medium 3：item.position 数值合法性
      if (!isValidXY(item.position)) return false;
      const itemWidth = (item as { width?: unknown }).width;
      const itemHeight = (item as { height?: unknown }).height;
      if (itemWidth !== undefined && (!isFiniteNumber(itemWidth) || itemWidth < 0)) return false;
      if (itemHeight !== undefined && (!isFiniteNumber(itemHeight) || itemHeight < 0)) return false;
    } else if (change.type === 'position') {
      const id = (change as { id?: unknown }).id;
      if (typeof id !== 'string' || id.length === 0) return false;
      if (!existingNodeIds.has(id)) return false;
      // P3D-2 step 9 / 六审 medium 3：position / positionAbsolute 数值校验
      // 注意 React Flow 12 的 NodePositionChange.position 是 optional，
      // 给了就必须合法；undefined 放行（drag 中间态等 React Flow 内部场景）
      const pos = (change as { position?: unknown }).position;
      if (pos !== undefined && !isValidXY(pos)) return false;
      const posAbs = (change as { positionAbsolute?: unknown }).positionAbsolute;
      if (posAbs !== undefined && !isValidXY(posAbs)) return false;
    } else if (change.type === 'dimensions') {
      const id = (change as { id?: unknown }).id;
      if (typeof id !== 'string' || id.length === 0) return false;
      if (!existingNodeIds.has(id)) return false;
      // P3D-2 step 9 / 六审 medium 3：dimensions 数值合法性 + 非负
      const dim = (change as { dimensions?: unknown }).dimensions;
      if (dim !== undefined && !isValidDimensions(dim)) return false;
    } else {
      // remove
      const id = (change as { id?: unknown }).id;
      if (typeof id !== 'string' || id.length === 0) return false;
      if (!existingNodeIds.has(id)) return false;
    }

    // ============================================================
    // 第 4 步：admin 短路（结构校验已通过）
    // ============================================================
    if (isAdmin) return true;

    // ============================================================
    // 第 5 步：普通用户权限判定
    // ============================================================
    if (!user) return false;

    if (change.type === 'add') {
      const item = (change as { item: Node<FlowNodeData> }).item;
      // 普通用户必须 __localNew===true（不能信 item.data.creator_id）
      if (item.data.__localNew !== true) return false;
      // P3D-2 step 3 codex 七审 M1：普通用户的 add 不允许直接挂到现有分组下
      // 想把新节点放进分组应该走 onAddToGroup（有"新父分组也必须可编辑"的 gate）
      // 这里 admin 不限制 —— 它本就有完整画布写权限
      if (item.parentId !== undefined) return false;
      return true;
    }

    // replace / position / dimensions / remove：按原节点 data 判权
    const id = (change as { id: string }).id;
    const target = nodes.find((n) => n.id === id);
    if (!target) return false; // existingNodeIds 已校验，理论上不会到这；fail-closed 兜底
    return canEditNodeData(target.data, user, canvasWritable);
  });
}

// ============================================================
// P3D-2 step 9：undo/redo snapshot 数据完整性归一化
// ============================================================

/**
 * 节点 parentId/extent 数据完整性归一化（codex 27-二审 medium / 28-三审 medium）。
 *
 * 规则（按顺序）：
 *   1. group 节点不允许有 parentId（业务约定：group 不能嵌套 / 不能自引用）
 *      → 见 useFlowOperations.onCreateGroup 创建入口已过滤 group 类型
 *      历史脏 snapshot 含 group.parentId 的情况一律清
 *   2. parentId 必须指向 result 内的 group 节点；否则清（孤儿 / 指向非 group / 自引用）
 *
 * 这是数据完整性约束，不是权限判定 —— admin / 普通用户都应该走，
 * 防止历史 snapshot 因任何原因含脏 parentId 后被整份恢复。
 */
function normalizeNodeParents(nodes: Node<FlowNodeData>[]): Node<FlowNodeData>[] {
  const allIds = new Set(nodes.map((n) => n.id));
  const groupIds = new Set(nodes.filter((n) => n.type === 'group').map((n) => n.id));
  return nodes.map((n) => {
    if (n.parentId === undefined) return n;
    // 1) group 节点本身不能有 parentId（不允许嵌套）
    if (n.type === 'group') {
      const { parentId: _drop, extent: _drop2, ...rest } = n;
      return rest as Node<FlowNodeData>;
    }
    // 2) 自引用 / 孤儿 / 指向非 group → 清
    if (n.parentId === n.id) {
      const { parentId: _drop, extent: _drop2, ...rest } = n;
      return rest as Node<FlowNodeData>;
    }
    if (!allIds.has(n.parentId) || !groupIds.has(n.parentId)) {
      const { parentId: _drop, extent: _drop2, ...rest } = n;
      return rest as Node<FlowNodeData>;
    }
    return n;
  });
}

// ============================================================
// P3D-2 step 9：undo/redo snapshot 权限 diff（12-二审 必修延期项）
// ============================================================
//
// 问题：useFlowHistory.undo/redo 整份 setNodes(snapshot)，绕过中心 gate。
// 攻击/误用场景：
//   1. 用户 A 改了自己的节点 → 别人改了 B 的节点 → A 按 ctrl+z
//      若整份回滚，B 节点会被 A 的 snapshot 旧版本覆盖（绕过权限）
//   2. snapshot 含已被删除的别人节点 → 整份恢复会重新拉回（ghost 还魂）
//
// 修法：合并而非整份覆盖。语义为"只回滚自己有权的节点"，逐节点决策：
//   - current 中无权编辑的节点 → 保留 current 版本（不被 snapshot 覆盖）
//   - snapshot 中无权编辑的 ghost（current 已无）→ 不恢复
//   - 其余按 snapshot 应用（含 admin 全量回滚）
//
// 边的策略：边的存在跟随节点。merge 完 nodes 后，
//   - snapshot.edges 中两端都在 merged.nodes 内的 → 保留
//   - current.edges 中涉及"current-only 保留节点"且端点都在 merged 内的 → 补入
//   这避免出现孤儿边（ghost 端点）以及"别人节点的边被 undo 错误抹除"。

/**
 * 按节点级权限合并历史 snapshot 与当前 nodes。
 *
 * @param snapshot 历史 snapshot 中的 nodes（undo/redo 目标）
 * @param current 当前画布的 nodes
 * @param user 当前登录用户
 * @param canvasWritable 当前画布是否可写
 * @returns 合并后的 nodes 数组（顺序：snapshot 中保留的 + current 中无权节点的"插入位置"维持）
 *
 * 规则：
 *   - current 中存在 + 用户无权 → 保留 current 版本
 *   - current 中存在 + 用户有权 + snapshot 中也存在 → 用 snapshot 版本（正常回滚）
 *   - current 中存在 + 用户有权 + snapshot 中不存在 → 删（snapshot 是历史真相，但要看用户是否有权删）
 *     · 用户有权该 current 节点 → 允许删（=正常回滚到该节点不存在的历史）
 *   - current 中不存在 + snapshot 中存在 + 用户无权该 snapshot 节点 → 不恢复（无权"还魂"别人节点）
 *   - current 中不存在 + snapshot 中存在 + 用户有权 → 恢复（=正常回滚 add）
 *
 * 顺序策略：以 snapshot 顺序为主，再追加 current 中保留下来但 snapshot 没有的节点。
 */
export function mergeSnapshotByPermission(
  snapshot: Node<FlowNodeData>[],
  current: Node<FlowNodeData>[],
  user: UserPublic | null,
  canvasWritable: boolean,
): Node<FlowNodeData>[] {
  if (!canvasWritable || !user) {
    // 无写权限：整份保留 current（理论上 undo/redo 入口已被 readOnly 短路）
    return current;
  }
  if (user.role === 'admin') {
    // admin 短路：整份回滚（admin 有完整画布写权限）
    // codex 27-二审 medium：admin 路径也走数据完整性归一化，避免历史脏 parentId 还魂
    return normalizeNodeParents(snapshot);
  }

  const currentById = new Map(current.map((n) => [n.id, n]));
  const snapshotIds = new Set(snapshot.map((n) => n.id));
  const result: Node<FlowNodeData>[] = [];

  // 1) 遍历 snapshot：决定每个 snapshot 节点是否能恢复/覆盖
  for (const snapNode of snapshot) {
    const curNode = currentById.get(snapNode.id);
    if (curNode) {
      // current 中也有：看用户对 current 版本是否有权
      if (canEditNodeData(curNode.data, user, canvasWritable)) {
        // 有权 → 用 snapshot 覆盖（正常回滚）
        result.push(snapNode);
      } else {
        // 无权 → 保留 current 版本（不被 snapshot 覆盖）
        result.push(curNode);
      }
    } else {
      // current 中没有，snapshot 中有 → 是否允许"还魂"
      if (canEditNodeData(snapNode.data, user, canvasWritable)) {
        result.push(snapNode);
      }
      // 无权 → 不恢复
    }
  }

  // 2) current 中存在但 snapshot 中没有的节点：
  //    若用户有权该节点 → 应该被删（snapshot 是无该节点的历史）
  //    若用户无权 → 必须保留（不能借 undo/redo 删别人节点）
  for (const curNode of current) {
    if (snapshotIds.has(curNode.id)) continue;
    if (!canEditNodeData(curNode.data, user, canvasWritable)) {
      result.push(curNode);
    }
  }

  // 3) parentId/extent 归一化（codex 26-审 high 必修 + 27-二审 medium 抽 helper）
  //    场景：snapshot 中自己有权恢复的子节点 X（X.parentId=G）+ G 是别人的 group
  //    → G 在合并步骤被丢弃（unauthorized ghost）→ X 还魂后 parentId 变孤儿
  return normalizeNodeParents(result);
}

/**
 * 与 mergeSnapshotByPermission 配套：边的存在跟随节点。
 *
 * 调用语义：
 *   const mergedNodes = mergeSnapshotByPermission(snap.nodes, current.nodes, user, w);
 *   const mergedEdges = mergeEdgesForMergedNodes(snap.edges, current.edges, mergedNodes, user, w);
 *
 * 规则（避免孤儿边 + 保护别人节点的连边）：
 *   1. 整理 mergedNodeIds 集合
 *   2. 取 snapshot.edges 里两端都在 mergedNodeIds 内的边 → 保留；
 *      边无 creator 字段，权限语义按节点合并结果近似处理（codex 27-二审 low 2）
 *   3. 对 current.edges 中"两端都在 mergedNodeIds 内 + snapshot 中无对应 edge"的边：
 *      若边的至少一端是 protected 节点（current 中用户无权编辑、且仍在 merged 内的节点），
 *      则补入（fail-closed 策略：凡涉及他人节点的边都保留，避免 undo 抹除别人的连边）。
 *
 * 注意（codex 26-审 medium 1）：fail-closed 的副作用是"自己新增到他人节点的边"也无法
 *   被 undo 撤销 —— 因为它的端点涉及 protected 节点。这是有意为之，因为前端无法分辨
 *   "我自己加的、可撤销的边" vs "保护边" —— 边没有 creator 字段。如果未来要精确撤销，
 *   需要为边引入 creator_id（属于 P3E 之后的 schema 演进）。
 *
 * 短路：
 *   - 游客 / canvasWritable=false → 整份保留 current.edges
 *   - admin → 整份回滚 snapshot.edges
 */
export function mergeEdgesForMergedNodes(
  snapshotEdges: Edge[],
  currentEdges: Edge[],
  mergedNodes: Node<FlowNodeData>[],
  current: Node<FlowNodeData>[],
  user: UserPublic | null,
  canvasWritable: boolean,
): Edge[] {
  if (!canvasWritable || !user) return currentEdges;
  if (user.role === 'admin') return snapshotEdges;

  const mergedNodeIds = new Set(mergedNodes.map((n) => n.id));
  // protectedCurrentNodeIds：current 中用户无权编辑、且仍在 merged 中的节点
  // = "保护节点"，凡涉及它的 current 边都不能被 undo 抹除
  const protectedCurrentNodeIds = new Set(
    current
      .filter((n) => mergedNodeIds.has(n.id) && !canEditNodeData(n.data, user, canvasWritable))
      .map((n) => n.id),
  );

  const result: Edge[] = [];
  const seenEdgeIds = new Set<string>();

  // 1) snapshot.edges 里两端都在 merged 内的 → 保留
  for (const e of snapshotEdges) {
    if (!mergedNodeIds.has(e.source) || !mergedNodeIds.has(e.target)) continue;
    result.push(e);
    seenEdgeIds.add(e.id);
  }

  // 2) current.edges 中涉及保护节点的边补入（fail-closed 策略）
  for (const e of currentEdges) {
    if (seenEdgeIds.has(e.id)) continue;
    if (!mergedNodeIds.has(e.source) || !mergedNodeIds.has(e.target)) continue;
    if (protectedCurrentNodeIds.has(e.source) || protectedCurrentNodeIds.has(e.target)) {
      result.push(e);
      seenEdgeIds.add(e.id);
    }
  }

  return result;
}
