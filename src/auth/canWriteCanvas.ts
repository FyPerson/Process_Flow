// P3D-2 step 2 前端画布可写判定（纯函数，可单测）
//
// 设计原则（与 canEditNode 同模式）：
// - 纯函数，不依赖 React Context；单一口径，避免下游各 hook/面板各算各的
// - mirror 后端 [server/services/canvases.ts canWrite()](见 §1.4 + §5.7)
// - 前端只是友好层 —— 真值仍由服务端 saveCanvas 兜底（403 forbidden）
//
// codex 二审必修 1：参数从 `CanvasMeta | null` 改成 `CanvasMetaState` 三态，
// 拆开"本地草稿"和"加载中"两种 null 语义，避免 fetch 加载期间漏放行权限。
//
// 权限矩阵（按 canvasMetaState.kind 分支）：
//
// | metaState.kind | user 角色 | archived | visibility | owner_id 匹配 | 结果 |
// |---|---|---|---|---|---|
// | 任何 | null（游客）| - | - | - | false |
// | 'loading' | 任意登录 | - | - | - | false（fail-closed）|
// | 'local' | 任意登录 | - | - | - | true（本地草稿，保持 readOnly=guest 行为兼容）|
// | 'server' | admin | * | * | * | true（admin 全能：归档画布也能改）|
// | 'server' | 普通用户 | true | * | * | false（归档画布只 admin）|
// | 'server' | 普通用户 | false | public | * | true（任何登录用户能编辑共有画布）|
// | 'server' | 普通用户 | false | private | true | true（owner 自己的私有画布）|
// | 'server' | 普通用户 | false | private | false | false（看不到也写不了别人 private）|

import type { UserPublic } from './api';
import type { CanvasMetaState } from '../hooks/useMultiCanvas';

/**
 * 当前用户是否能写入此画布（影响所有 mutation 入口）
 *
 * @param state 画布元信息状态机（来自 useMultiCanvas 的 canvasMetaState）
 * @param user  当前登录用户（null = 游客）
 */
export function canWriteCanvas(
  state: CanvasMetaState,
  user: UserPublic | null,
): boolean {
  // 游客永远不能写
  if (!user) return false;
  // 加载中 → fail-closed（codex 二审必修 1）
  if (state.kind === 'loading') return false;
  // 本地草稿（未挂接服务端）→ 登录用户可写（保持 readOnly=guest 行为兼容）
  if (state.kind === 'local') return true;
  // server 态：按服务端 canWrite 矩阵判定
  const meta = state.meta;
  // admin 全能：归档画布也能改
  if (user.role === 'admin') return true;
  // 归档画布只 admin 能改（普通用户即使是 owner 也不能写）
  if (meta.archived) return false;
  // 公共画布：任何登录用户都能写
  if (meta.visibility === 'public') return true;
  // 私有画布：只 owner 能写
  return meta.owner_id === user.id;
}
