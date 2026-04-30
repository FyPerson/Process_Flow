// P3D-1 节点级权限前端判定（纯函数，可单测）
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
