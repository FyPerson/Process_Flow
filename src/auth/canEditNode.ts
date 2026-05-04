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
import type { NodeChange, Node } from '@xyflow/react';
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
    } else {
      // position / dimensions / remove
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
