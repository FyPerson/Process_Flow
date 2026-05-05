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
import {
  canEditNodeData,
  isPublicDeprecateUpdate,
  canApplyNodeUpdate,
  filterNodeChangesByPermission,
  mergeSnapshotByPermission,
  mergeEdgesForMergedNodes,
} from './canEditNode.ts';
import type { UserPublic } from './api.ts';
import type { Node, NodeChange, Edge } from '@xyflow/react';
import type { FlowNodeData } from '../types/flow.ts';

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

// ============================================================
// P3D-2 step 3 中心 mutation gate helper 单测
// ============================================================

describe('isPublicDeprecateUpdate', () => {
  it('精确判定 is_deprecated === true + 登录用户 → 公开权限放行', () => {
    assert.equal(isPublicDeprecateUpdate({ is_deprecated: true }, undefined, normalUser), true);
    assert.equal(isPublicDeprecateUpdate({ is_deprecated: true }, undefined, otherUser), true);
    assert.equal(isPublicDeprecateUpdate({ is_deprecated: true }, undefined, adminUser), true);
  });

  it('游客（user=null）即使是标废弃也拒（公开权限不含未登录）', () => {
    assert.equal(isPublicDeprecateUpdate({ is_deprecated: true }, undefined, null), false);
  });

  it('is_deprecated=false（取消废弃）走正常 canEditNode 路径，不享公开权限', () => {
    // 服务端禁取消废弃，前端这里精确拦下 false 走 modified 路径让 canEditNode 兜底
    assert.equal(isPublicDeprecateUpdate({ is_deprecated: false }, undefined, normalUser), false);
  });

  it('is_deprecated=undefined / 其他奇怪值不享公开权限', () => {
    assert.equal(isPublicDeprecateUpdate({ is_deprecated: undefined }, undefined, normalUser), false);
    assert.equal(isPublicDeprecateUpdate({ is_deprecated: null }, undefined, normalUser), false);
    assert.equal(isPublicDeprecateUpdate({ is_deprecated: 1 }, undefined, normalUser), false);
  });

  it('多字段（标废弃 + 改其他内容）不享公开权限', () => {
    assert.equal(
      isPublicDeprecateUpdate({ is_deprecated: true, name: 'changed' }, undefined, normalUser),
      false,
    );
  });

  it('伴随 style 改动不享公开权限', () => {
    assert.equal(
      isPublicDeprecateUpdate({ is_deprecated: true }, { width: 100 }, normalUser),
      false,
    );
  });
});

describe('canApplyNodeUpdate', () => {
  it('标废弃 + 画布可写 + 任何登录用户 → 放行（即使非 creator）', () => {
    const otherUserNode = { creator_id: otherUser.id };
    assert.equal(
      canApplyNodeUpdate(otherUserNode, { is_deprecated: true }, undefined, normalUser, true),
      true,
    );
  });

  it('标废弃 + 画布不可写 → 拒（归档画布等场景）', () => {
    assert.equal(
      canApplyNodeUpdate({}, { is_deprecated: true }, undefined, normalUser, false),
      false,
    );
  });

  it('改 name + creator 匹配 → 放行', () => {
    assert.equal(
      canApplyNodeUpdate({ creator_id: normalUser.id }, { name: 'new' }, undefined, normalUser, true),
      true,
    );
  });

  it('改 name + creator 不匹配 → 拒', () => {
    assert.equal(
      canApplyNodeUpdate({ creator_id: otherUser.id }, { name: 'new' }, undefined, normalUser, true),
      false,
    );
  });

  // codex 26-审 medium 2：style 几何字段（width/height）NaN/Infinity/负数 必拒
  it('style.width = NaN → 拒（绕过 NodeChange gate 的攻击面）', () => {
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: normalUser.id },
        { name: 'x' },
        { width: NaN },
        normalUser,
        true,
      ),
      false,
    );
  });

  it('style.height = Infinity → 拒（admin 也拒）', () => {
    assert.equal(
      canApplyNodeUpdate({}, { name: 'x' }, { height: Infinity }, adminUser, true),
      false,
    );
  });

  it('style.width = -10 → 拒（负数）', () => {
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: normalUser.id },
        { name: 'x' },
        { width: -10 },
        normalUser,
        true,
      ),
      false,
    );
  });

  it('style.width = 100, height = 50 → 合法值不影响权限判定', () => {
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: normalUser.id },
        { name: 'x' },
        { width: 100, height: 50 },
        normalUser,
        true,
      ),
      true,
    );
  });

  it('style 含其它非几何字段（color 等）→ 不拦截', () => {
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: normalUser.id },
        { name: 'x' },
        { color: 'red', width: 100 },
        normalUser,
        true,
      ),
      true,
    );
  });

  it('标废弃路径也校验 style.width = NaN → 拒', () => {
    // 攻击场景：恶意调用同时传 is_deprecated=true 和 style={width:NaN}
    // isPublicDeprecateUpdate 已经因为 updatedStyle != null 而拒走公开权限
    // 但即使理论上能进 deprecate 路径，style 数值 gate 也要兜底
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: otherUser.id },
        { is_deprecated: true },
        { width: NaN },
        normalUser,
        true,
      ),
      false,
    );
  });

  // codex 27-二审 low 1：style 非 object 入参 fail-closed
  it('style 是 string → 拒（fail-closed）', () => {
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: normalUser.id },
        { name: 'x' },
        'invalid',
        normalUser,
        true,
      ),
      false,
    );
  });

  it('style 是 number → 拒', () => {
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: normalUser.id },
        { name: 'x' },
        42,
        normalUser,
        true,
      ),
      false,
    );
  });

  it('style 是 array → 拒', () => {
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: normalUser.id },
        { name: 'x' },
        [{ width: 100 }],
        normalUser,
        true,
      ),
      false,
    );
  });

  it('style 是 boolean → 拒', () => {
    assert.equal(
      canApplyNodeUpdate(
        { creator_id: normalUser.id },
        { name: 'x' },
        true,
        normalUser,
        true,
      ),
      false,
    );
  });
});

describe('filterNodeChangesByPermission', () => {
  const myNode: Node<FlowNodeData> = {
    id: 'mine',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { id: 'mine', name: 'mine', type: 'process', expandable: true, creator_id: normalUser.id },
  };
  const otherNode: Node<FlowNodeData> = {
    id: 'other',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { id: 'other', name: 'other', type: 'process', expandable: true, creator_id: otherUser.id },
  };
  const localNode: Node<FlowNodeData> = {
    id: 'local',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { id: 'local', name: 'local', type: 'process', expandable: true, __localNew: true },
  };
  const nodes = [myNode, otherNode, localNode];

  it('select 类型 changes 不被拦（纯 UI 状态）', () => {
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { id: 'other', type: 'select', selected: true },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, true);
    assert.equal(filtered.length, 1);
  });

  it('普通用户拖动自己的节点 / 本地新节点 → 放行；拖动别人的 → 拦', () => {
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { id: 'mine', type: 'position', position: { x: 1, y: 1 } },
      { id: 'other', type: 'position', position: { x: 1, y: 1 } },
      { id: 'local', type: 'position', position: { x: 1, y: 1 } },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, true);
    assert.equal(filtered.length, 2);
    assert.deepEqual(
      filtered.map((c) => (c as { id: string }).id),
      ['mine', 'local'],
    );
  });

  it('admin 全放行（不遍历节点）', () => {
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { id: 'mine', type: 'position', position: { x: 1, y: 1 } },
      { id: 'other', type: 'dimensions', dimensions: { width: 100, height: 50 } },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, adminUser, true);
    assert.equal(filtered.length, 2);
  });

  it('!canvasWritable 时 mutating change 全拒（fail-closed）+ 非 mutating 仍放行', () => {
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { id: 'mine', type: 'position', position: { x: 1, y: 1 } },
      { id: 'mine', type: 'remove' },
      { id: 'other', type: 'dimensions', dimensions: { width: 1, height: 1 } },
      { id: 'mine', type: 'select', selected: true }, // select 不算 mutating
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, false);
    assert.equal(filtered.length, 1);
    assert.equal((filtered[0] as { type: string }).type, 'select');
  });

  it('remove 类型按节点 canEditNodeData 过滤', () => {
    // 普通用户删自己创建的节点 → 放行（这里只测 mutation gate，物理删除规则在 step 8 + 服务端）
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { id: 'mine', type: 'remove' },
      { id: 'other', type: 'remove' },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, true);
    assert.equal(filtered.length, 1);
    assert.equal((filtered[0] as { id: string }).id, 'mine');
  });

  // P3D-2 step 3 codex 二审 Blocker 3：replace/add 也是 mutating
  it('replace 类型按原节点 creator_id 判权（自己 → 放行；别人 → 拦）', () => {
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      {
        id: 'mine',
        type: 'replace',
        item: { ...myNode, data: { ...myNode.data, name: 'changed' } },
      },
      {
        id: 'other',
        type: 'replace',
        item: { ...otherNode, data: { ...otherNode.data, name: 'changed' } },
      },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, true);
    assert.equal(filtered.length, 1);
    assert.equal((filtered[0] as { id: string }).id, 'mine');
  });

  it('add 类型：普通用户必须 __localNew === true 才放行（codex 三审 high）', () => {
    const newLocalNode: Node<FlowNodeData> = {
      id: 'newlocal',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        id: 'newlocal',
        name: 'newlocal',
        type: 'process',
        expandable: true,
        __localNew: true,
      },
    };
    const newOtherNode: Node<FlowNodeData> = {
      id: 'newother',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        id: 'newother',
        name: 'newother',
        type: 'process',
        expandable: true,
        creator_id: otherUser.id,
      },
    };
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { type: 'add', item: newLocalNode },
      { type: 'add', item: newOtherNode },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, true);
    assert.equal(filtered.length, 1);
    assert.equal((filtered[0] as { item: Node<FlowNodeData> }).item.id, 'newlocal');
  });

  // codex 三审 high 防伪造：普通用户构造 add change 把自己 creator_id 塞进去
  // 必须拒（不能凭 creator_id 通过，必须 __localNew=true）
  it('add 类型：伪造自己 creator_id 但无 __localNew → 拒（防绕过）', () => {
    const fakeAdd: Node<FlowNodeData> = {
      id: 'fakeadd',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        id: 'fakeadd',
        name: 'fake',
        type: 'process',
        expandable: true,
        creator_id: normalUser.id, // 攻击者构造：装作自己创建
        // __localNew 故意省略
      },
    };
    const changes: NodeChange<Node<FlowNodeData>>[] = [{ type: 'add', item: fakeAdd }];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  it('add 类型：admin 不需 __localNew（但仍受 ID 唯一性约束）', () => {
    const arbitraryAdd: Node<FlowNodeData> = {
      id: 'admin-add',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        id: 'admin-add',
        name: 'x',
        type: 'process',
        expandable: true,
        creator_id: otherUser.id,
      },
    };
    const changes: NodeChange<Node<FlowNodeData>>[] = [{ type: 'add', item: arbitraryAdd }];
    const filtered = filterNodeChangesByPermission(changes, nodes, adminUser, true);
    assert.equal(filtered.length, 1);
  });

  // codex 三审 critical 防伪造：构造 replace 把别人节点的 creator_id 改成自己
  // 必须按 nodes 中的原节点 data 判权（item.data 不可信）
  it('replace 类型：伪造 item.data.creator_id 仍按原节点判权 → 拒', () => {
    const forgedReplace: NodeChange<Node<FlowNodeData>> = {
      id: 'other', // 原节点是 other 创建的
      type: 'replace',
      item: {
        ...otherNode,
        data: {
          ...otherNode.data,
          name: 'hijacked',
          creator_id: normalUser.id, // 攻击者把 creator 改成自己
        },
      },
    };
    const filtered = filterNodeChangesByPermission(
      [forgedReplace],
      nodes, // nodes 里 'other' 还是原 creator
      normalUser,
      true,
    );
    assert.equal(filtered.length, 0);
  });

  it('replace 类型：伪造 item.data.__localNew=true 仍按原节点判权 → 拒', () => {
    const forgedReplace: NodeChange<Node<FlowNodeData>> = {
      id: 'other',
      type: 'replace',
      item: {
        ...otherNode,
        data: {
          ...otherNode.data,
          __localNew: true, // 攻击者装作本地新增
        },
      },
    };
    const filtered = filterNodeChangesByPermission([forgedReplace], nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  it('replace + !canvasWritable 仍 fail-closed', () => {
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      {
        id: 'mine',
        type: 'replace',
        item: { ...myNode, data: { ...myNode.data, name: 'x' } },
      },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, false);
    assert.equal(filtered.length, 0);
  });

  it('mutating change 找不到目标节点 → fail-closed 拒绝', () => {
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { id: 'ghost', type: 'position', position: { x: 1, y: 1 } },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  // codex 四审 high 1：replace item.id !== change.id → fail-closed
  it('replace 类型：item.id 与 change.id 错配 → 拒（防 ID 污染）', () => {
    const forgedReplace: NodeChange<Node<FlowNodeData>> = {
      id: 'mine', // change.id 指向自己的节点（有权限）
      type: 'replace',
      item: {
        ...otherNode, // 但 item 是别人的节点（item.id='other'）
        data: { ...otherNode.data, name: 'hijacked' },
      },
    };
    const filtered = filterNodeChangesByPermission([forgedReplace], nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  // codex 四审 high 1：admin 也执行 ID 一致性校验（数据完整性约束）
  it('replace 类型：admin 也执行 item.id===change.id 校验', () => {
    const forgedReplace: NodeChange<Node<FlowNodeData>> = {
      id: 'mine',
      type: 'replace',
      item: { ...otherNode, data: { ...otherNode.data } },
    };
    const filtered = filterNodeChangesByPermission([forgedReplace], nodes, adminUser, true);
    assert.equal(filtered.length, 0);
  });

  // codex 四审 high 2：add 不能复用现有节点 ID
  it('add 类型：item.id 与现有节点重复 → 拒（防覆盖）', () => {
    const duplicateAdd: Node<FlowNodeData> = {
      id: 'mine', // 与现有节点 ID 重复
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        id: 'mine',
        name: 'dup',
        type: 'process',
        expandable: true,
        __localNew: true,
      },
    };
    const filtered = filterNodeChangesByPermission(
      [{ type: 'add', item: duplicateAdd }],
      nodes,
      normalUser,
      true,
    );
    assert.equal(filtered.length, 0);
  });

  // codex 四审 high 2：admin 也执行 ID 唯一性校验
  it('add 类型：admin 也执行 ID 唯一性校验（数据完整性约束）', () => {
    const duplicateAdd: Node<FlowNodeData> = {
      id: 'other', // 与现有节点 ID 重复
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        id: 'other',
        name: 'dup',
        type: 'process',
        expandable: true,
      },
    };
    const filtered = filterNodeChangesByPermission(
      [{ type: 'add', item: duplicateAdd }],
      nodes,
      adminUser,
      true,
    );
    assert.equal(filtered.length, 0);
  });

  // codex 四审 high 2：add item.id 空字符串 → 拒
  it('add 类型：item.id 为空字符串 → 拒', () => {
    const emptyIdAdd: Node<FlowNodeData> = {
      id: '',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        id: '',
        name: 'x',
        type: 'process',
        expandable: true,
        __localNew: true,
      },
    };
    const filtered = filterNodeChangesByPermission(
      [{ type: 'add', item: emptyIdAdd }],
      nodes,
      normalUser,
      true,
    );
    assert.equal(filtered.length, 0);
  });

  // ============================================================
  // 自主穷举攻击面：批内重复 ID / 类型脏数据 / ghost 一致性
  // ============================================================

  it('add 类型：同批 2 个 add 用相同新 ID → 全部拒（普通用户）', () => {
    const dupA: Node<FlowNodeData> = {
      id: 'newdup',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { id: 'newdup', name: 'a', type: 'process', expandable: true, __localNew: true },
    };
    const dupB: Node<FlowNodeData> = {
      id: 'newdup',
      type: 'custom',
      position: { x: 1, y: 1 },
      data: { id: 'newdup', name: 'b', type: 'process', expandable: true, __localNew: true },
    };
    const filtered = filterNodeChangesByPermission(
      [
        { type: 'add', item: dupA },
        { type: 'add', item: dupB },
      ],
      nodes,
      normalUser,
      true,
    );
    assert.equal(filtered.length, 0);
  });

  it('add 类型：同批 2 个 add 用相同新 ID → 全部拒（admin 也执行）', () => {
    const dupA: Node<FlowNodeData> = {
      id: 'admindup',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { id: 'admindup', name: 'a', type: 'process', expandable: true },
    };
    const dupB: Node<FlowNodeData> = {
      id: 'admindup',
      type: 'custom',
      position: { x: 1, y: 1 },
      data: { id: 'admindup', name: 'b', type: 'process', expandable: true },
    };
    const filtered = filterNodeChangesByPermission(
      [
        { type: 'add', item: dupA },
        { type: 'add', item: dupB },
      ],
      nodes,
      adminUser,
      true,
    );
    assert.equal(filtered.length, 0);
  });

  it('add 类型：批内冲突的拦，独立合法的 add 不连坐', () => {
    const dupA: Node<FlowNodeData> = {
      id: 'dupAB',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { id: 'dupAB', name: 'a', type: 'process', expandable: true, __localNew: true },
    };
    const dupB: Node<FlowNodeData> = {
      id: 'dupAB',
      type: 'custom',
      position: { x: 1, y: 1 },
      data: { id: 'dupAB', name: 'b', type: 'process', expandable: true, __localNew: true },
    };
    const cleanC: Node<FlowNodeData> = {
      id: 'cleanC',
      type: 'custom',
      position: { x: 2, y: 2 },
      data: { id: 'cleanC', name: 'c', type: 'process', expandable: true, __localNew: true },
    };
    const filtered = filterNodeChangesByPermission(
      [
        { type: 'add', item: dupA },
        { type: 'add', item: dupB },
        { type: 'add', item: cleanC },
      ],
      nodes,
      normalUser,
      true,
    );
    assert.equal(filtered.length, 1);
    assert.equal((filtered[0] as { item: Node<FlowNodeData> }).item.id, 'cleanC');
  });

  it('replace 类型：目标节点不存在于 nodes（ghost）→ fail-closed 拒（含 admin）', () => {
    const ghostReplace: Node<FlowNodeData> = {
      id: 'ghost-id',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { id: 'ghost-id', name: 'x', type: 'process', expandable: true },
    };
    const change: NodeChange<Node<FlowNodeData>> = {
      id: 'ghost-id',
      type: 'replace',
      item: ghostReplace,
    };
    assert.equal(
      filterNodeChangesByPermission([change], nodes, normalUser, true).length,
      0,
    );
    assert.equal(
      filterNodeChangesByPermission([change], nodes, adminUser, true).length,
      0,
    );
  });

  it('admin 也对 position/dimensions/remove 的 ghost id fail-closed', () => {
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { id: 'ghost', type: 'position', position: { x: 1, y: 1 } },
      { id: 'ghost', type: 'dimensions', dimensions: { width: 1, height: 1 } },
      { id: 'ghost', type: 'remove' },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, adminUser, true);
    assert.equal(filtered.length, 0);
  });

  it('id 类型脏数据（number / null / undefined）→ fail-closed 拒', () => {
    // React Flow 类型上 id 是 string，但运行时如果有人构造异常 change，应拒不应崩
    const dirtyChanges = [
      { id: 123, type: 'position', position: { x: 1, y: 1 } },
      { id: null, type: 'remove' },
      { id: undefined, type: 'dimensions', dimensions: { width: 1, height: 1 } },
    ] as unknown as NodeChange<Node<FlowNodeData>>[];
    const filtered = filterNodeChangesByPermission(dirtyChanges, nodes, adminUser, true);
    assert.equal(filtered.length, 0);
  });

  it('add item.id 是 number 或 missing → fail-closed 拒', () => {
    const dirtyAdds = [
      { type: 'add', item: { id: 123, type: 'custom', position: { x: 0, y: 0 }, data: { id: '123', name: 'x', type: 'process', expandable: true, __localNew: true } } },
      { type: 'add', item: { type: 'custom', position: { x: 0, y: 0 }, data: { name: 'x', type: 'process', expandable: true, __localNew: true } } },
    ] as unknown as NodeChange<Node<FlowNodeData>>[];
    const filtered = filterNodeChangesByPermission(dirtyAdds, nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  it('replace item 缺失 → fail-closed 拒', () => {
    const noItem = { id: 'mine', type: 'replace' } as unknown as NodeChange<Node<FlowNodeData>>;
    const filtered = filterNodeChangesByPermission([noItem], nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  // P3D-2 step 3 codex 六审 medium 1：item.data.id === item.id 校验
  it('add 类型：item.data.id 与 item.id 错配 → 拒（防 data.id 索引污染）', () => {
    const newId = 'newnode_' + Date.now();
    const mismatchAdd: NodeChange<Node<FlowNodeData>> = {
      type: 'add',
      item: {
        id: newId,
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          // 故意让 data.id 与 item.id 不一致
          id: 'mine',
          name: 'forged',
          type: 'process',
          expandable: true,
          __localNew: true,
        },
      },
    };
    const filtered = filterNodeChangesByPermission([mismatchAdd], nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  it('add 类型：item.data.id 缺失（undefined）→ 放行（兼容旧节点构造路径）', () => {
    const newId = 'newnode2_' + Date.now();
    const noDataIdAdd: NodeChange<Node<FlowNodeData>> = {
      type: 'add',
      item: {
        id: newId,
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          // 故意没有 id 字段
          name: 'noDataId',
          type: 'process',
          expandable: true,
          __localNew: true,
        } as unknown as FlowNodeData,
      },
    };
    const filtered = filterNodeChangesByPermission([noDataIdAdd], nodes, normalUser, true);
    assert.equal(filtered.length, 1);
  });

  it('replace 类型：item.data.id 与 item.id 错配 → 拒', () => {
    const mismatchReplace: NodeChange<Node<FlowNodeData>> = {
      id: 'mine',
      type: 'replace',
      item: {
        id: 'mine',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          // data.id 故意写成别人的 id
          id: 'other',
          name: 'forged',
          type: 'process',
          expandable: true,
          creator_id: normalUser.id,
        },
      },
    };
    const filtered = filterNodeChangesByPermission([mismatchReplace], nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  it('replace 类型：admin 也对 item.data.id 错配 fail-closed（数据完整性约束）', () => {
    const mismatchReplace: NodeChange<Node<FlowNodeData>> = {
      id: 'mine',
      type: 'replace',
      item: {
        id: 'mine',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          id: 'other',
          name: 'forged',
          type: 'process',
          expandable: true,
        },
      },
    };
    const filtered = filterNodeChangesByPermission([mismatchReplace], nodes, adminUser, true);
    assert.equal(filtered.length, 0);
  });

  // P3D-2 step 3 codex 六审 medium 2：未知 NodeChange 类型 fail-closed
  it('未知 NodeChange 类型 → fail-closed 拒（防 React Flow 升级新增 mutating 类型）', () => {
    const unknownChanges = [
      { id: 'mine', type: 'unknown_future_mutation', payload: 'whatever' },
      { id: 'mine', type: 'rotate', degrees: 90 },
    ] as unknown as NodeChange<Node<FlowNodeData>>[];
    // admin 也拒 —— 未知类型属于结构性 fail-closed，不是权限例外
    const filteredAdmin = filterNodeChangesByPermission(unknownChanges, nodes, adminUser, true);
    assert.equal(filteredAdmin.length, 0);
    const filteredUser = filterNodeChangesByPermission(unknownChanges, nodes, normalUser, true);
    assert.equal(filteredUser.length, 0);
  });

  it('select 仍是 allow-list 唯一非 mutating 类型', () => {
    // 验证 NON_MUTATING_TYPES 收紧后，select 仍能放行（不应被未知类型 fail-closed 误伤）
    const changes: NodeChange<Node<FlowNodeData>>[] = [
      { id: 'mine', type: 'select', selected: true },
      { id: 'other', type: 'select', selected: false },
    ];
    const filtered = filterNodeChangesByPermission(changes, nodes, null, false);
    // 即使 user=null + canvasWritable=false，select 仍放行
    assert.equal(filtered.length, 2);
  });

  // P3D-2 step 3 codex 七审 M1：禁止通过 NodeChange 改 parentId
  // 分组关系变更必须走 useFlowOperations 的 onCreateGroup/onAddToGroup/onRemoveFromGroup/onUngroup
  it('replace 类型：item.parentId 与原节点 parentId 不一致 → 拒（admin 也执行）', () => {
    const changeChild: NodeChange<Node<FlowNodeData>> = {
      id: 'mine',
      type: 'replace',
      item: {
        ...myNode,
        parentId: 'someGroup', // 原节点 parentId 为 undefined，此处偷改成 someGroup
      },
    };
    const filteredUser = filterNodeChangesByPermission([changeChild], nodes, normalUser, true);
    assert.equal(filteredUser.length, 0);
    const filteredAdmin = filterNodeChangesByPermission([changeChild], nodes, adminUser, true);
    assert.equal(filteredAdmin.length, 0);
  });

  it('replace 类型：item.parentId 与原节点 parentId 一致 → 放行（不影响合法 replace）', () => {
    // 原节点 parentId 为 undefined，replace 也保持 undefined → 应放行
    const changeChild: NodeChange<Node<FlowNodeData>> = {
      id: 'mine',
      type: 'replace',
      item: {
        ...myNode,
        // parentId 不传 = undefined，与原节点一致
        data: { ...myNode.data, name: 'renamed' },
      },
    };
    const filtered = filterNodeChangesByPermission([changeChild], nodes, normalUser, true);
    assert.equal(filtered.length, 1);
  });

  it('add 类型：普通用户带 parentId → 拒（应该走 onAddToGroup）', () => {
    const newId = 'newchild_' + Date.now();
    const addWithParent: NodeChange<Node<FlowNodeData>> = {
      type: 'add',
      item: {
        id: newId,
        type: 'custom',
        position: { x: 0, y: 0 },
        parentId: 'someGroup',
        data: {
          id: newId,
          name: 'new',
          type: 'process',
          expandable: true,
          __localNew: true,
        },
      },
    };
    const filtered = filterNodeChangesByPermission([addWithParent], nodes, normalUser, true);
    assert.equal(filtered.length, 0);
  });

  it('add 类型：admin 带 parentId 指向不存在的节点 → 拒（八审 L1：数据完整性约束）', () => {
    // 八审 L1：admin 也对"parentId 必须存在且为 group" 执行结构校验
    // 普通用户在第 5 步另行限制（必须 undefined），admin 这里走数据完整性
    const newId = 'newchildadmin_' + Date.now();
    const addWithGhostParent: NodeChange<Node<FlowNodeData>> = {
      type: 'add',
      item: {
        id: newId,
        type: 'custom',
        position: { x: 0, y: 0 },
        parentId: 'ghostGroup',
        data: {
          id: newId,
          name: 'new',
          type: 'process',
          expandable: true,
        },
      },
    };
    const filtered = filterNodeChangesByPermission([addWithGhostParent], nodes, adminUser, true);
    assert.equal(filtered.length, 0);
  });

  it('add 类型：admin 带 parentId 指向非 group 节点 → 拒（结构性约束）', () => {
    // myNode 是 type='custom' 不是 group
    const newId = 'newchildadmin2_' + Date.now();
    const addWithCustomParent: NodeChange<Node<FlowNodeData>> = {
      type: 'add',
      item: {
        id: newId,
        type: 'custom',
        position: { x: 0, y: 0 },
        parentId: 'mine', // mine 不是 group
        data: {
          id: newId,
          name: 'new',
          type: 'process',
          expandable: true,
        },
      },
    };
    const filtered = filterNodeChangesByPermission([addWithCustomParent], nodes, adminUser, true);
    assert.equal(filtered.length, 0);
  });

  it('add 类型：admin 带 parentId 指向现有 group → 放行', () => {
    // 给 nodes 加一个 group 节点验证正常路径
    const groupNode: Node<FlowNodeData> = {
      id: 'realGroup',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { id: 'realGroup', name: 'g', type: 'group', expandable: false } as unknown as FlowNodeData,
    };
    const nodesWithGroup = [...nodes, groupNode];

    const newId = 'newchildadmin3_' + Date.now();
    const addWithRealParent: NodeChange<Node<FlowNodeData>> = {
      type: 'add',
      item: {
        id: newId,
        type: 'custom',
        position: { x: 0, y: 0 },
        parentId: 'realGroup',
        data: {
          id: newId,
          name: 'new',
          type: 'process',
          expandable: true,
        },
      },
    };
    const filtered = filterNodeChangesByPermission([addWithRealParent], nodesWithGroup, adminUser, true);
    assert.equal(filtered.length, 1);
  });
});

// ============================================================
// P3D-2 step 9：mergeSnapshotByPermission（undo/redo 权限 diff）
// ============================================================
//
// 起点：12-代码审查 二审 必修 3 —— useFlowHistory.undo/redo 整份 setNodes 绕过中心 gate。
// 修法：合并而非整份覆盖；只回滚自己有权的节点，他人节点保留 current 版本。

function makeNode(
  id: string,
  data: Partial<FlowNodeData> & { id?: string; creator_id?: number; __localNew?: boolean } = {},
): Node<FlowNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    type: 'custom',
    data: {
      id,
      name: data.name ?? id,
      type: data.type ?? 'process',
      expandable: data.expandable ?? true,
      creator_id: data.creator_id,
      __localNew: data.__localNew,
      ...data,
    } as FlowNodeData,
  };
}

describe('filterNodeChangesByPermission - 数值合法性（六审 medium 3 / step 9）', () => {
  const adminWritable = true;

  it('1. position change 含 NaN → 拒', () => {
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'position',
      id: 'a',
      position: { x: NaN, y: 0 },
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a', { creator_id: adminUser.id })],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 0);
  });

  it('2. position change 含 Infinity → 拒（admin 也拒）', () => {
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'position',
      id: 'a',
      position: { x: 0, y: Infinity },
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a')],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 0);
  });

  it('3. position change positionAbsolute 含 NaN → 拒', () => {
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'position',
      id: 'a',
      position: { x: 1, y: 1 },
      positionAbsolute: { x: NaN, y: 1 },
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a')],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 0);
  });

  it('4. position change 不含 position 字段 → 放行（drag 中间态）', () => {
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'position',
      id: 'a',
      dragging: true,
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a')],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 1);
  });

  it('5. dimensions 含负数 → 拒（admin 也拒）', () => {
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'dimensions',
      id: 'a',
      dimensions: { width: -10, height: 100 },
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a')],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 0);
  });

  it('6. dimensions 含 NaN → 拒', () => {
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'dimensions',
      id: 'a',
      dimensions: { width: NaN, height: 100 },
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a')],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 0);
  });

  it('7. dimensions 合法 0 宽高 → 放行（边界）', () => {
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'dimensions',
      id: 'a',
      dimensions: { width: 0, height: 0 },
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a')],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 1);
  });

  it('8. add change item.position 含 NaN → 拒', () => {
    const newId = 'new-bad-pos';
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'add',
      item: {
        id: newId,
        position: { x: NaN, y: 0 },
        data: { id: newId, name: 'x', type: 'process', expandable: true } as FlowNodeData,
      },
    };
    const result = filterNodeChangesByPermission([change], [], adminUser, adminWritable);
    assert.equal(result.length, 0);
  });

  it('9. add change 含负宽高 → 拒', () => {
    const newId = 'new-neg-w';
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'add',
      item: {
        id: newId,
        position: { x: 0, y: 0 },
        width: -5,
        data: { id: newId, name: 'x', type: 'process', expandable: true } as FlowNodeData,
      },
    };
    const result = filterNodeChangesByPermission([change], [], adminUser, adminWritable);
    assert.equal(result.length, 0);
  });

  it('10. replace change item.position 含 Infinity → 拒', () => {
    const id = 'a';
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'replace',
      id,
      item: {
        id,
        position: { x: 0, y: Infinity },
        data: { id, name: 'a', type: 'process', expandable: true } as FlowNodeData,
      },
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a', { creator_id: adminUser.id })],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 0);
  });

  it('11. position 不是 object（攻击者塞 number）→ 拒', () => {
    const change: NodeChange<Node<FlowNodeData>> = {
      type: 'position',
      id: 'a',
      position: 42 as unknown as { x: number; y: number },
    };
    const result = filterNodeChangesByPermission(
      [change],
      [makeNode('a')],
      adminUser,
      adminWritable,
    );
    assert.equal(result.length, 0);
  });
});

describe('mergeSnapshotByPermission', () => {
  it('1. 游客 / canvasWritable=false → 整份保留 current（短路防御）', () => {
    const snap = [makeNode('a', { creator_id: 2 })];
    const cur = [makeNode('a', { creator_id: 2, name: 'current-a' })];
    assert.deepEqual(mergeSnapshotByPermission(snap, cur, null, true), cur);
    assert.deepEqual(mergeSnapshotByPermission(snap, cur, normalUser, false), cur);
  });

  it('2. admin → 整份回滚 snapshot（admin 全画布写权）', () => {
    const snap = [makeNode('a', { creator_id: 999 }), makeNode('b', { creator_id: 888 })];
    const cur = [makeNode('a', { creator_id: 999, name: 'changed' })];
    assert.deepEqual(mergeSnapshotByPermission(snap, cur, adminUser, true), snap);
  });

  // codex 27-二审 medium：admin 路径也走 parentId 归一化（不能让历史脏 parentId 还魂）
  it('2b. admin + snapshot 含孤儿 parentId → 归一化清除', () => {
    const snapChild: Node<FlowNodeData> = {
      ...makeNode('child', { creator_id: 999 }),
      parentId: 'ghost-group', // 不存在
      extent: 'parent',
    };
    const snap = [snapChild];
    const cur: Node<FlowNodeData>[] = [];
    const merged = mergeSnapshotByPermission(snap, cur, adminUser, true);
    const child = merged.find((n) => n.id === 'child');
    assert.ok(child);
    assert.equal(child!.parentId, undefined, 'admin 路径也应清除孤儿 parentId');
    assert.equal((child as { extent?: unknown }).extent, undefined);
  });

  it('2c. admin + snapshot parentId 指向非 group → 归一化清除', () => {
    const snapChild: Node<FlowNodeData> = {
      ...makeNode('child', { creator_id: 999 }),
      parentId: 'not-a-group',
    };
    const snapNonGroup = { ...makeNode('not-a-group', { creator_id: 999 }), type: 'custom' as const };
    const snap = [snapNonGroup, snapChild];
    const cur: Node<FlowNodeData>[] = [];
    const merged = mergeSnapshotByPermission(snap, cur, adminUser, true);
    const child = merged.find((n) => n.id === 'child');
    assert.ok(child);
    assert.equal(child!.parentId, undefined);
  });

  it('3. 普通用户：自己节点 snapshot 覆盖 current（正常回滚）', () => {
    const snap = [makeNode('a', { creator_id: normalUser.id, name: 'old' })];
    const cur = [makeNode('a', { creator_id: normalUser.id, name: 'new' })];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].data.name, 'old');
  });

  it('4. 普通用户：别人节点 snapshot 不能覆盖 current（核心防御）', () => {
    // 关键攻击场景：A undo 时不能把 B 节点回滚到 A snapshot 里的旧版本
    const snap = [makeNode('a', { creator_id: otherUser.id, name: 'snapshot-old' })];
    const cur = [makeNode('a', { creator_id: otherUser.id, name: 'current-by-other' })];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].data.name, 'current-by-other');
  });

  it('5. 普通用户：snapshot 含别人 ghost（current 已无）→ 不还魂', () => {
    const snap = [
      makeNode('a', { creator_id: normalUser.id }),
      makeNode('ghost', { creator_id: otherUser.id }),
    ];
    const cur = [makeNode('a', { creator_id: normalUser.id, name: 'changed' })];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'a');
  });

  it('6. 普通用户：current 含别人节点 + snapshot 中没有 → 必须保留（不能借 undo 删别人）', () => {
    const snap = [makeNode('a', { creator_id: normalUser.id })];
    const cur = [
      makeNode('a', { creator_id: normalUser.id }),
      makeNode('other-node', { creator_id: otherUser.id }),
    ];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    const ids = merged.map((n) => n.id).sort();
    assert.deepEqual(ids, ['a', 'other-node']);
  });

  it('7. 普通用户：current 含自己节点 + snapshot 中没有 → 删（正常回滚 add）', () => {
    const snap = [makeNode('a', { creator_id: normalUser.id })];
    const cur = [
      makeNode('a', { creator_id: normalUser.id }),
      makeNode('my-new', { creator_id: normalUser.id }),
    ];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    const ids = merged.map((n) => n.id).sort();
    assert.deepEqual(ids, ['a']);
  });

  it('8. 普通用户：snapshot 含自己 __localNew + current 已无 → 还魂（正常 redo add）', () => {
    const snap = [
      makeNode('a', { creator_id: normalUser.id }),
      makeNode('local-new', { __localNew: true }),
    ];
    const cur = [makeNode('a', { creator_id: normalUser.id })];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    const ids = merged.map((n) => n.id).sort();
    assert.deepEqual(ids, ['a', 'local-new']);
  });

  it('9. 顺序：snapshot 顺序优先，current 中保留的他人节点追加在后', () => {
    const snap = [
      makeNode('a', { creator_id: normalUser.id }),
      makeNode('b', { creator_id: normalUser.id }),
    ];
    const cur = [
      makeNode('other', { creator_id: otherUser.id }),
      makeNode('a', { creator_id: normalUser.id }),
      makeNode('b', { creator_id: normalUser.id }),
    ];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    assert.deepEqual(
      merged.map((n) => n.id),
      ['a', 'b', 'other'],
    );
  });

  it('11. parentId 归一化：snapshot 子节点 parent group 是别人的 → 合并后清除孤儿 parentId（codex high）', () => {
    // 场景：用户自己创建子节点 X，把 X 拖进别人创建的 group G → saveHistory（X.parentId=G）
    // 后来别人删了 G 或 G 是 ghost-others → undo 时 G 不应还魂，X 还魂后 parentId 必须清
    const snapChild: Node<FlowNodeData> = {
      ...makeNode('child', { creator_id: normalUser.id }),
      parentId: 'others-group',
      extent: 'parent',
    };
    const snapOthersGroup: Node<FlowNodeData> = {
      ...makeNode('others-group', { creator_id: otherUser.id }),
      type: 'group',
    };
    const snap = [snapOthersGroup, snapChild];
    const cur = [makeNode('something-else', { creator_id: normalUser.id })];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    const child = merged.find((n) => n.id === 'child');
    assert.ok(child, 'child 应该被恢复（自己有权）');
    assert.equal(child!.parentId, undefined, 'parentId 应被清（孤儿）');
    assert.equal((child as { extent?: unknown }).extent, undefined, 'extent 也应被清');
    // others-group 不应在 merged 中（不还魂）
    assert.ok(!merged.find((n) => n.id === 'others-group'));
  });

  it('12. parentId 归一化：parent 存在但 type 不是 group → 清', () => {
    const snapChild: Node<FlowNodeData> = {
      ...makeNode('child', { creator_id: normalUser.id }),
      parentId: 'not-a-group',
    };
    const snapNotGroup = makeNode('not-a-group', { creator_id: normalUser.id });
    // 显式给 type='custom'，不是 group
    const snap = [{ ...snapNotGroup, type: 'custom' as const }, snapChild];
    const cur: Node<FlowNodeData>[] = [];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    const child = merged.find((n) => n.id === 'child');
    assert.ok(child);
    assert.equal(child!.parentId, undefined);
  });

  // codex 28-三审 medium：group 节点本身不允许有 parentId（业务约定不嵌套）
  it('14. parentId 归一化：group.parentId 指向另一 group → 清（不允许嵌套）', () => {
    const innerGroup: Node<FlowNodeData> = {
      ...makeNode('inner-group', { creator_id: adminUser.id }),
      type: 'group',
      parentId: 'outer-group',
    };
    const outerGroup: Node<FlowNodeData> = {
      ...makeNode('outer-group', { creator_id: adminUser.id }),
      type: 'group',
    };
    const snap = [outerGroup, innerGroup];
    const merged = mergeSnapshotByPermission(snap, [], adminUser, true);
    const inner = merged.find((n) => n.id === 'inner-group');
    assert.ok(inner);
    assert.equal(inner!.parentId, undefined, 'group.parentId 应被清（不允许嵌套）');
  });

  it('15. parentId 归一化：group.parentId 自引用 → 清', () => {
    const selfRef: Node<FlowNodeData> = {
      ...makeNode('self-ref-group', { creator_id: adminUser.id }),
      type: 'group',
      parentId: 'self-ref-group', // 自引用
    };
    const merged = mergeSnapshotByPermission([selfRef], [], adminUser, true);
    const node = merged.find((n) => n.id === 'self-ref-group');
    assert.ok(node);
    assert.equal(node!.parentId, undefined);
  });

  it('16. parentId 归一化：普通节点 parentId 自引用 → 清', () => {
    const selfRef: Node<FlowNodeData> = {
      ...makeNode('self-ref', { creator_id: normalUser.id }),
      parentId: 'self-ref',
    };
    const merged = mergeSnapshotByPermission([selfRef], [], normalUser, true);
    const node = merged.find((n) => n.id === 'self-ref');
    assert.ok(node);
    assert.equal(node!.parentId, undefined);
  });

  it('13. parentId 归一化：parent 是合法 group + 都被恢复 → 保留 parentId', () => {
    const snapChild: Node<FlowNodeData> = {
      ...makeNode('child', { creator_id: normalUser.id }),
      parentId: 'my-group',
      extent: 'parent',
    };
    const snapGroup: Node<FlowNodeData> = {
      ...makeNode('my-group', { creator_id: normalUser.id }),
      type: 'group',
    };
    const snap = [snapGroup, snapChild];
    const cur: Node<FlowNodeData>[] = [];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    const child = merged.find((n) => n.id === 'child');
    assert.ok(child);
    assert.equal(child!.parentId, 'my-group');
    assert.equal((child as { extent?: unknown }).extent, 'parent');
  });

  it('10. 混合场景：自己改 + 别人改 + 自己删 + 别人 ghost 在 snapshot', () => {
    const snap = [
      makeNode('mine', { creator_id: normalUser.id, name: 'old-mine' }),
      makeNode('others', { creator_id: otherUser.id, name: 'snap-others' }),
      makeNode('ghost-others', { creator_id: otherUser.id }),
    ];
    const cur = [
      makeNode('mine', { creator_id: normalUser.id, name: 'new-mine' }),
      makeNode('others', { creator_id: otherUser.id, name: 'cur-others' }),
      makeNode('mine-new', { creator_id: normalUser.id }),
    ];
    const merged = mergeSnapshotByPermission(snap, cur, normalUser, true);
    const byId = new Map(merged.map((n) => [n.id, n]));
    // mine（回滚）+ others（保留 current）= 2；ghost-others 不还魂；mine-new 被删
    assert.equal(byId.size, 2);
    assert.equal(byId.get('mine')?.data.name, 'old-mine'); // 自己节点回滚
    assert.equal(byId.get('others')?.data.name, 'cur-others'); // 别人节点保留 current
    assert.ok(!byId.has('ghost-others')); // 别人 ghost 不还魂
    assert.ok(!byId.has('mine-new')); // 自己 add 在 snapshot 中没有 → 删（正常回滚）
    assert.equal(byId.get('mine')?.data.creator_id, normalUser.id);
  });
});

describe('mergeEdgesForMergedNodes', () => {
  const mkEdge = (id: string, source: string, target: string): Edge => ({
    id,
    source,
    target,
  });

  it('1. 游客 / canvasWritable=false → 整份 current.edges', () => {
    const snapEdges = [mkEdge('e1', 'a', 'b')];
    const curEdges = [mkEdge('e2', 'a', 'c')];
    const merged = [makeNode('a'), makeNode('b'), makeNode('c')];
    assert.deepEqual(
      mergeEdgesForMergedNodes(snapEdges, curEdges, merged, [], null, true),
      curEdges,
    );
    assert.deepEqual(
      mergeEdgesForMergedNodes(snapEdges, curEdges, merged, [], normalUser, false),
      curEdges,
    );
  });

  it('2. admin → 整份 snapshot.edges', () => {
    const snapEdges = [mkEdge('e1', 'a', 'b')];
    const curEdges = [mkEdge('e2', 'a', 'c')];
    const merged = [makeNode('a'), makeNode('b'), makeNode('c')];
    assert.deepEqual(
      mergeEdgesForMergedNodes(snapEdges, curEdges, merged, [], adminUser, true),
      snapEdges,
    );
  });

  it('3. snapshot.edge 端点不在 merged.nodes 内 → 丢弃（防孤儿）', () => {
    // 别人 ghost 不还魂场景下，连过去的 snapshot 边也要丢
    const snapEdges = [mkEdge('e1', 'a', 'ghost'), mkEdge('e2', 'a', 'b')];
    const curEdges: Edge[] = [];
    const merged = [makeNode('a', { creator_id: normalUser.id }), makeNode('b', { creator_id: normalUser.id })];
    const cur = merged;
    const result = mergeEdgesForMergedNodes(snapEdges, curEdges, merged, cur, normalUser, true);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'e2');
  });

  it('4. 别人节点的连边在 current 但 snapshot 没有 → 保留 current 边（防误删）', () => {
    // 场景：current 里别人节点 X 连到 X-Y，X 在 snapshot 时还不存在 → snapshot 没有这条边
    // 整份回滚 snapshot.edges 会把别人节点的边抹掉，必须保留
    const snapEdges: Edge[] = [];
    const curEdges = [mkEdge('e-other', 'others', 'mine')];
    const merged = [
      makeNode('mine', { creator_id: normalUser.id }),
      makeNode('others', { creator_id: otherUser.id }),
    ];
    const cur = merged;
    const result = mergeEdgesForMergedNodes(snapEdges, curEdges, merged, cur, normalUser, true);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'e-other');
  });

  it('5. 自己节点之间的边在 current 但 snapshot 没有 → 不补（正常回滚 add）', () => {
    // 自己加的边（snapshot 没有）→ undo 应该把它删掉
    const snapEdges: Edge[] = [];
    const curEdges = [mkEdge('e-mine', 'a', 'b')];
    const merged = [
      makeNode('a', { creator_id: normalUser.id }),
      makeNode('b', { creator_id: normalUser.id }),
    ];
    const cur = merged;
    const result = mergeEdgesForMergedNodes(snapEdges, curEdges, merged, cur, normalUser, true);
    assert.equal(result.length, 0);
  });

  it('6. snapshot 与 current 边 ID 重复 → 不重复入栈', () => {
    const snapEdges = [mkEdge('e1', 'a', 'b')];
    const curEdges = [mkEdge('e1', 'a', 'b')]; // 同 ID
    const merged = [
      makeNode('a', { creator_id: otherUser.id }), // 别人节点
      makeNode('b', { creator_id: otherUser.id }),
    ];
    const cur = merged;
    const result = mergeEdgesForMergedNodes(snapEdges, curEdges, merged, cur, normalUser, true);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'e1');
  });

  it('7. 混合：snapshot 自己边 + current 别人边 + ghost 边 → 各自规则', () => {
    const snapEdges = [
      mkEdge('snap-mine', 'mine1', 'mine2'),
      mkEdge('snap-ghost', 'mine1', 'ghost-others'), // ghost 端点
    ];
    const curEdges = [
      mkEdge('cur-others', 'others1', 'others2'), // 别人节点之间，snapshot 没有
      mkEdge('cur-mine-add', 'mine1', 'mine2-extra'), // 自己加的，snapshot 没有
    ];
    const merged = [
      makeNode('mine1', { creator_id: normalUser.id }),
      makeNode('mine2', { creator_id: normalUser.id }),
      makeNode('others1', { creator_id: otherUser.id }),
      makeNode('others2', { creator_id: otherUser.id }),
      // mine2-extra 不在 merged（被回滚删了）
      // ghost-others 不在 merged（不还魂）
    ];
    const cur = [
      ...merged,
      makeNode('mine2-extra', { creator_id: normalUser.id }),
    ];
    const result = mergeEdgesForMergedNodes(snapEdges, curEdges, merged, cur, normalUser, true);
    const ids = result.map((e) => e.id).sort();
    // snap-mine 保留（端点都在 merged）；snap-ghost 丢（ghost 端点不在）；
    // cur-others 补入（端点是 current-only 保留的别人节点）；
    // cur-mine-add 不补（端点 mine2-extra 不在 merged，且本来也是自己加的）
    assert.deepEqual(ids, ['cur-others', 'snap-mine']);
  });
});

// ============================================================
// step 9 已降级：RTL 集成测占位 → 自审 checklist 归档
// ============================================================
//
// 决策（step 9 收尾）：不引入 RTL + jsdom 测试基建。
// 详见 docs/规划/codex审查记录/阶段3/P3D/29-自审-P3D-2-step9-RTL占位清单降级.md
//
// 7 项原占位中：
//   - #3 (updatedStyle === {}) + #6 (DeprecateNodeSection 公开权限) → helper 单测已覆盖
//   - #1 / #2 / #4 / #5 / #7 → 数据层 helper 已兜住，缺 React 副作用 + 端到端断言
//
// 触发引入 RTL 的判定（任一条满足）：
//   1. P3F admin 后台 UI 引入新 React hook 边界
//   2. P4 心跳 + auto-save 引入定时器副作用
//   3. P5 合并算法引入复杂 conflict 状态机
//   4. 实战中出现"helper 单测全过但端到端 bug"≥ 2 起
//
// 以下保留作为"未来引入 RTL 时直接复制粘贴的 brief"：
//
// 1. onNodeUpdate ghost nodeId 早退（九审 Medium）：
//    - 调用 onNodeUpdate('nonexistent', { name: 'x' })
//    - 断言：setNodes / setSelectedElement / saveHistory / triggerAutoSave 都不被调用
//
// 2. onUpdateGroupLabel 拒绝路径不调副作用（八审 M1）：
//    - 普通用户 + 别人创建的 group
//    - 调用 onUpdateGroupLabel(otherGroupId, '新名字')
//    - 断言：setNodes / saveHistory / triggerAutoSave 都不被调用
//
// 3. updatedStyle === {} 应走完整权限校验（七审 L1 + 八审 L2 + 九审 Low 2）：
//    - 普通用户 + 别人节点 + 仅 is_deprecated=true + style={}（不是 undefined）
//    - 断言：被 canApplyNodeUpdate 拒（因为 isPublicDeprecateUpdate 把空对象视为有 style）
//    - 这条是行为锁定 —— 防止未来调用方传 {} 触发误判
//
// 4. saveHistory React 18 StrictMode 双调用幂等（八审 / 九审 Low 1）：
//    - StrictMode 包装下连续触发 setNodes updater
//    - 断言：history 栈顶 snapshot 只有 1 条，不重复
//    - 修法预期：useFlowHistory.saveHistory 内对比栈顶去重
//
// 5. step 4 一审 H2 useFlowOperations.onUngroup admin-only 数据层 gate：
//    - 普通用户（非 admin）作为 group creator，对自己创建的 group 调用 onUngroup
//    - 断言：setNodes / saveHistory / triggerAutoSave 都不被调用（admin-only 在 canEditNodeData 之前拒）
//    - 同时验证 admin 路径：admin 调 onUngroup 仍按原 canEditNodeData + child 全可编辑流程走
//
// 6. step 4 一审 H1 DeprecateNodeSection 公开权限不被 canEdit 吞：
//    - 普通用户 + 别人创建的可写画布节点 + 点标废弃按钮
//    - 断言：onNodeChange 被实际调用（不被 safeOnDeprecateChange 吞），dataUpdates 含 is_deprecated=true
//    - 配合 isPublicDeprecateUpdate 在 canApplyNodeUpdate 层放行
//    - 这是 P3C 公开权限 + step 4 横幅"如需标记废弃请使用下方按钮"指引的端到端验证
