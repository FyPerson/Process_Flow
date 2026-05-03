// P3D-2 第 1 步：canEditNode 6 分支单测
//
// 矩阵（与 canEditNode.ts 文件头注释对应）：
//
// | user 角色 | canvasWritable | __localNew | creator_id 匹配 | 结果 |
// |---|---|---|---|---|
// | 游客（user=null） | * | * | * | false |
// | 任意 | false | * | * | false |
// | admin | true | * | * | true |
// | 普通用户 | true | true | * | true（本地新增） |
// | 普通用户 | true | * | true | true（自己创建） |
// | 普通用户 | true | false | false | false（别人节点） |

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canEditNodeData } from './canEditNode.ts';
import type { UserPublic } from './api.ts';

const adminUser: UserPublic = { id: 1, username: 'admin', role: 'admin' };
const normalUser: UserPublic = { id: 2, username: 'alice', role: 'user' };
const otherUser: UserPublic = { id: 3, username: 'bob', role: 'user' };

describe('canEditNodeData', () => {
  it('1. 游客（user=null）→ false（无论其他参数）', () => {
    assert.equal(canEditNodeData({}, null, true), false);
    assert.equal(canEditNodeData({ creator_id: 2 }, null, true), false);
    assert.equal(canEditNodeData({ __localNew: true }, null, true), false);
    assert.equal(canEditNodeData({}, null, false), false);
  });

  it('2. 画布只读（canvasWritable=false）→ false（无论用户角色）', () => {
    // 即使 admin，画布只读也不能编辑（归档画布 / 游客视角等）
    assert.equal(canEditNodeData({}, adminUser, false), false);
    assert.equal(canEditNodeData({ creator_id: 2 }, normalUser, false), false);
    assert.equal(canEditNodeData({ __localNew: true }, normalUser, false), false);
  });

  it('3. admin + 画布可写 → true（无论节点归属）', () => {
    // admin 是终极兜底，能改任意节点（不论 creator_id / __localNew）
    assert.equal(canEditNodeData({}, adminUser, true), true);
    assert.equal(canEditNodeData({ creator_id: 999 }, adminUser, true), true);
    assert.equal(canEditNodeData({ creator_id: 2 }, adminUser, true), true);
    assert.equal(canEditNodeData({ __localNew: false }, adminUser, true), true);
  });

  it('4. 普通用户 + 画布可写 + __localNew=true → true（本地新增节点）', () => {
    // 拖出 / 粘贴 / 创建分组都会打 __localNew，让用户立刻能编辑自己刚创建的节点
    // creator_id 缺失也放行（duplicateSheet 副本场景，BFV 派生 __localNew）
    assert.equal(
      canEditNodeData({ __localNew: true }, normalUser, true),
      true,
    );
    // 即使 creator_id 是别人的，__localNew 优先（理论不该出现，但防御性）
    assert.equal(
      canEditNodeData({ __localNew: true, creator_id: 999 }, normalUser, true),
      true,
    );
  });

  it('5. 普通用户 + 画布可写 + creator_id 匹配 → true（自己创建的节点）', () => {
    assert.equal(
      canEditNodeData({ creator_id: normalUser.id }, normalUser, true),
      true,
    );
  });

  it('6. 普通用户 + 画布可写 + creator_id 不匹配 + 非本地新 → false（别人的节点）', () => {
    // 这是 P3D-2 的核心拦截场景：用户看到别人的节点时编辑入口要 disable
    assert.equal(
      canEditNodeData({ creator_id: otherUser.id }, normalUser, true),
      false,
    );
    // creator_id 缺失 + __localNew 缺失 → false（fail-closed）
    // 持久化节点必有 creator_id（migration 0002 保证），此分支理论不该出现，
    // 出现说明数据异常 → 不放行
    assert.equal(canEditNodeData({}, normalUser, true), false);
    assert.equal(
      canEditNodeData({ __localNew: false }, normalUser, true),
      false,
    );
  });
});
