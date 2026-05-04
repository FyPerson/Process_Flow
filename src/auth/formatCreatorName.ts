// P3D-2 step 4 / step 8 节点创建者显示 helper（纯函数，可单测）
//
// 设计原则（codex 06-范围审查）：
// - 不复用 formatDeprecatedTooltip —— 语义不同（创建者 vs 废弃者）
// - 优先级：creator_username > __localNew "本地新建" > creator_id "用户 #N" > "未知创建者"
// - step 4 详情面板顶部横幅 + step 8 hover tooltip 共用此 helper

export interface CreatorNameInput {
  /** 节点 data.creator_username（服务端 hydrate；可能 undefined） */
  creator_username?: string;
  /** 节点 data.creator_id（服务端 hydrate；可能 undefined） */
  creator_id?: number;
  /** 运行时本地新增标记（不入 storage） */
  __localNew?: boolean;
}

/**
 * 格式化节点创建者名字，用于详情面板横幅 / hover tooltip / 角标。
 *
 * @param data 节点 data 子集（CreatorNameInput）
 * @returns 用户可读的创建者名字
 *
 * 分支（按优先级）：
 * 1. creator_username 存在 → 直接返回
 * 2. __localNew === true → "本地新建（保存后归属为你）"
 * 3. creator_id 存在但无 username → "用户 #N"
 * 4. 其他 → "未知创建者"
 */
export function formatCreatorName(data: CreatorNameInput): string {
  if (data.creator_username && data.creator_username.length > 0) {
    return data.creator_username;
  }
  if (data.__localNew === true) {
    return '本地新建（保存后归属为你）';
  }
  if (typeof data.creator_id === 'number') {
    return `用户 #${data.creator_id}`;
  }
  return '未知创建者';
}
