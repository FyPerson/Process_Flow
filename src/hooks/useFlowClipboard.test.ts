// P3B codex 二审 #1+#2+#3 单测：覆盖 remapClipboardNodes 核心场景
//
// 主要场景：
// 1. 复制单普通节点 → n_ 前缀 + data.id 同步 + __localNew + meta strip
// 2. 复制 group + children → 新 group 用 g_ 前缀 + children.parentId 指向新 group
// 3. 半组选区（只复制 child 不含 group）→ child.parentId 删除 + extent 清掉 + 转绝对坐标
// 4. relatedNodeIds 只保留剪贴板内命中的引用并 remap

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import { remapClipboardNodes } from './useFlowClipboard.ts';
import type { FlowNodeData } from '../types/flow.ts';

const NODE_RE = /^n_[A-Za-z0-9_-]{10}$/;
const GROUP_RE = /^g_[A-Za-z0-9_-]{10}$/;

function makeNode(over: Partial<Node<FlowNodeData>> & { id: string }): Node<FlowNodeData> {
  const defaults = {
    type: 'custom' as const,
    position: { x: 0, y: 0 },
    data: { id: over.id, name: over.id, type: 'process', expandable: true } as FlowNodeData,
  };
  return { ...defaults, ...over };
}

describe('remapClipboardNodes', () => {
  it('1. 复制单普通节点 → n_ 前缀 + data.id 同步 + __localNew + meta strip + position 加 OFFSET', () => {
    const src = makeNode({
      id: 'old1',
      position: { x: 100, y: 200 },
      data: {
        id: 'old1', name: 'A', type: 'process', expandable: true,
        creator_id: 99, creator_username: 'alice', is_deprecated: true,
        deprecated_by: 99, deprecated_at: 1, updated_by: 99, updated_at: 2,
      } as FlowNodeData,
    });
    const out = remapClipboardNodes([src]);
    assert.equal(out.length, 1);
    const n = out[0];
    assert.match(n.id, NODE_RE);
    assert.equal(n.data.id, n.id, 'data.id 必须同步到新 id');
    assert.equal((n.data as { __localNew?: boolean }).__localNew, true);
    // creator/updated/deprecated 全 strip
    for (const k of ['creator_id', 'creator_username', 'is_deprecated', 'deprecated_by', 'deprecated_at', 'updated_by', 'updated_at']) {
      assert.equal((n.data as Record<string, unknown>)[k], undefined, `${k} 必须 strip`);
    }
    assert.equal(n.selected, true);
    // 三审 Issue 1：根节点（无父）必须加 OFFSET 让粘贴副本可见
    assert.deepEqual(n.position, { x: 130, y: 230 }, '无父节点时 position 必须加 OFFSET (30, 30)');
  });

  it('2. 复制 group + 2 children → 新 group 用 g_ + children.parentId 指向新 group + child position 不加 OFFSET', () => {
    // 三审 Issue 1：父被一起复制时 child 的 position 是相对父的，不应再加 OFFSET，否则组内布局错乱
    const group = makeNode({
      id: 'g_old',
      type: 'group',
      position: { x: 100, y: 100 },
      data: { id: 'g_old', label: 'G', type: 'group', expandable: false } as unknown as FlowNodeData,
    });
    const child1 = makeNode({
      id: 'c1',
      parentId: 'g_old',
      position: { x: 10, y: 10 },
    });
    const child2 = makeNode({
      id: 'c2',
      parentId: 'g_old',
      position: { x: 20, y: 20 },
    });
    const out = remapClipboardNodes([group, child1, child2]);
    assert.equal(out.length, 3);
    const newGroup = out[0];
    const newC1 = out[1];
    const newC2 = out[2];
    assert.match(newGroup.id, GROUP_RE, '新 group 必须 g_ 前缀');
    assert.match(newC1.id, NODE_RE);
    assert.match(newC2.id, NODE_RE);
    assert.equal(newC1.parentId, newGroup.id, 'child1.parentId 指向新 group');
    assert.equal(newC2.parentId, newGroup.id, 'child2.parentId 指向新 group');
    // 三个 ID 互不相同
    assert.equal(new Set([newGroup.id, newC1.id, newC2.id]).size, 3);
    // 三审 Issue 1：position 断言 —— group 加 OFFSET (无父)，children 保持相对坐标 (有父)
    assert.deepEqual(newGroup.position, { x: 130, y: 130 }, 'group 作为根节点加 OFFSET');
    assert.deepEqual(newC1.position, { x: 10, y: 10 }, 'child1 相对坐标必须保持原值（不加 OFFSET）');
    assert.deepEqual(newC2.position, { x: 20, y: 20 }, 'child2 相对坐标必须保持原值（不加 OFFSET）');
  });

  it('3. 半组选区（只复制 child 不含 group）→ parentId/extent 删除 + position 加 OFFSET（不支持转绝对，按无父孤儿降级）', () => {
    // 三审 Issue 2 修法 A：FlowCanvas.copyNodes 只 copy 选中节点，剪贴板里没有源父节点
    // → 不支持半组复制的绝对坐标转换。视觉上半组复制出的孤儿子节点会画到画布相对坐标位置
    //   （可能偏左上），符合"不支持但不崩"的可预期降级
    const child = makeNode({
      id: 'c_alone',
      parentId: 'g_not_in_clip',
      position: { x: 10, y: 10 },
      extent: 'parent',
    });
    const out = remapClipboardNodes([child]);
    assert.equal(out.length, 1);
    const n = out[0];
    assert.equal(n.parentId, undefined, '半组复制必须删 parentId');
    assert.equal((n as { extent?: unknown }).extent, undefined, '半组复制必须删 extent');
    // 三审 Issue 1+2：父丢失 → 加 OFFSET（按"无父节点"处理；不再宣称转绝对）
    assert.deepEqual(n.position, { x: 40, y: 40 }, '半组孤儿按无父处理，position 加 OFFSET');
  });

  it('4. relatedNodeIds 只保留剪贴板内命中的引用并 remap', () => {
    const a = makeNode({
      id: 'a',
      data: {
        id: 'a', name: 'A', type: 'process', expandable: true,
        relatedNodeIds: ['b', 'ghost'], // b 在剪贴板内，ghost 不在
      } as unknown as FlowNodeData,
    });
    const b = makeNode({ id: 'b' });
    const out = remapClipboardNodes([a, b]);
    const newA = out[0];
    const newB = out[1];
    const related = (newA.data as { relatedNodeIds?: string[] }).relatedNodeIds;
    assert.deepEqual(related, [newB.id], 'relatedNodeIds 应只剩 b 的新 id（ghost 被丢）');
  });

  it('5. relatedNodeIds 全部不命中 → 字段被删除（而不是空数组）', () => {
    const a = makeNode({
      id: 'a',
      data: {
        id: 'a', name: 'A', type: 'process', expandable: true,
        relatedNodeIds: ['ghost1', 'ghost2'],
      } as unknown as FlowNodeData,
    });
    const out = remapClipboardNodes([a]);
    const newA = out[0];
    assert.equal(
      (newA.data as { relatedNodeIds?: unknown }).relatedNodeIds,
      undefined,
      '全 ghost 时 relatedNodeIds 应被删除',
    );
  });

  // 名称去重场景（方案 2：复用 getUniqueName 数字后缀，不累积）
  it('6. 画布已有同名节点 → 粘贴后 name 自动加 _1', () => {
    const src = makeNode({
      id: 'old1',
      data: { id: 'old1', name: 'Child1', type: 'process', expandable: true } as FlowNodeData,
    });
    const out = remapClipboardNodes([src], ['Child1']);
    assert.equal((out[0].data as { name?: string }).name, 'Child1_1');
  });

  it('7. 连续粘贴 → name 自动累加 _1, _2, _3（不重复后缀）', () => {
    const src = makeNode({
      id: 'old1',
      data: { id: 'old1', name: 'Child1', type: 'process', expandable: true } as FlowNodeData,
    });
    // 模拟画布上已有 Child1（源） + Child1_1（之前粘的）
    const out = remapClipboardNodes([src], ['Child1', 'Child1_1']);
    assert.equal(
      (out[0].data as { name?: string }).name,
      'Child1_2',
      '应跳过已被占的 Child1_1，分配 Child1_2',
    );
  });

  it('8. 复制已是 _1 后缀的副本再粘贴 → 每次 append 一层（有限累积，可接受）', () => {
    // 准确行为说明：getUniqueName 不解析后缀，只是把 baseName 当字面量加数字。
    //  - 最常见路径不累积：连续复制同一源 Child1 → Child1_1, Child1_2, Child1_3
    //  - 复制副本再粘：每次 append 一层 → Child1_1 → Child1_1_1 → Child1_1_2 → Child1_1_1_1
    //
    // 该行为已与用户确认可接受（5 人内网工具，复制副本嵌套深度极少超过 2-3 层）。
    // 未来若需"剥到原始名再递增"，可在此处加 baseName 提取（regex /^(.+?)(_\d+)*$/）。
    const src = makeNode({
      id: 'paste',
      data: { id: 'paste', name: 'Child1_1', type: 'process', expandable: true } as FlowNodeData,
    });
    // 画布上有 Child1（源）+ Child1_1（被复制的副本）
    const out = remapClipboardNodes([src], ['Child1', 'Child1_1']);
    assert.equal(
      (out[0].data as { name?: string }).name,
      'Child1_1_1',
      'baseName Child1_1 已存在 → append _1 → Child1_1_1',
    );
    // 再粘第二次：画布多了 Child1_1_1
    const out2 = remapClipboardNodes([src], ['Child1', 'Child1_1', 'Child1_1_1']);
    assert.equal(
      (out2[0].data as { name?: string }).name,
      'Child1_1_2',
      '同 baseName 第二次粘贴 → Child1_1_2（同层递增）',
    );
  });

  it('9. group 用 label 去重 + name 同步（与 onCreateGroup 同口径）', () => {
    const group = makeNode({
      id: 'g_old',
      type: 'group',
      data: {
        id: 'g_old', label: 'Group A', name: 'Group A',
        type: 'group', expandable: false,
      } as unknown as FlowNodeData,
    });
    const out = remapClipboardNodes([group], ['Group A']);
    const data = out[0].data as { label?: string; name?: string };
    assert.equal(data.label, 'Group A_1', 'group 主显示名 label 必须去重');
    assert.equal(data.name, 'Group A_1', 'group 兜底 name 也同步');
  });

  it('10. 剪贴板内多个同名节点 → 互不撞（usedNames 随分配累加）', () => {
    const a = makeNode({
      id: 'a',
      data: { id: 'a', name: 'X', type: 'process', expandable: true } as FlowNodeData,
    });
    const b = makeNode({
      id: 'b',
      data: { id: 'b', name: 'X', type: 'process', expandable: true } as FlowNodeData,
    });
    // 画布已有 X
    const out = remapClipboardNodes([a, b], ['X']);
    assert.equal((out[0].data as { name?: string }).name, 'X_1');
    assert.equal(
      (out[1].data as { name?: string }).name, 'X_2',
      '剪贴板第二个同名节点必须避开 X_1，得 X_2',
    );
  });
});
