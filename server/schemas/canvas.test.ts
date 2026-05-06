// schemas/canvas.ts superRefine 单元测试
//
// 重点覆盖 codex Day 1 五审 M1 + 六审 L2 引入的 parentId 双层硬约束（schema + assertProjectIntegrity）。
// schema 路径专门测客户端 PUT/POST body 校验流；assertProjectIntegrity 在 server/services/merge/computeDelta.test.ts 测。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MultiCanvasProjectSchema } from './canvas.ts';

// ============================================================
// 工厂 helper（仅本文件用，与 computeDelta.test.ts 各自独立）
// ============================================================

type Node = {
  id: string;
  name: string;
  type: 'process' | 'group' | 'terminator' | 'decision' | 'data' | 'subprocess';
  position: { x: number; y: number };
  size: { width: number; height: number };
  expandable: boolean;
  parentId?: string;
};

function makeNode(id: string, type: Node['type'] = 'process', overrides: Partial<Node> = {}): Node {
  return {
    id,
    name: id,
    type,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 60 },
    expandable: true,
    ...overrides,
  };
}

function makeProject(nodes: Node[]) {
  return {
    version: 2 as const,
    id: 'p1',
    name: 'project',
    activeSheetId: 's1',
    sheets: [
      {
        id: 's1',
        name: 's1',
        nodes,
        connectors: [],
      },
    ],
  };
}

// ============================================================
// Tests
// ============================================================

describe('MultiCanvasProjectSchema parentId 校验（codex 六审 L2）', () => {
  it('1. parentId 自引用 → schema 拒绝', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([makeNode('self', 'process', { parentId: 'self' })])
    );
    assert.equal(result.success, false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      assert.match(messages, /self-reference/);
    }
  });

  it('2. group 节点带 parentId → schema 拒绝（不允许 group 嵌套）', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('outer', 'group'),
        makeNode('inner', 'group', { parentId: 'outer' }),
      ])
    );
    assert.equal(result.success, false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      assert.match(messages, /group nesting is not allowed/);
    }
  });

  it('3. parentId 指向 group 节点 → schema 通过（合法嵌套）', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('grp', 'group'),
        makeNode('child', 'process', { parentId: 'grp' }),
      ])
    );
    assert.equal(result.success, true);
  });

  it('4. parentId 指向不存在节点 → schema 拒绝', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([makeNode('child', 'process', { parentId: 'ghost' })])
    );
    assert.equal(result.success, false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      assert.match(messages, /not found in sheet/);
    }
  });

  it('5. parentId 指向非 group 节点 → schema 拒绝', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('proc', 'process'),
        makeNode('child', 'process', { parentId: 'proc' }),
      ])
    );
    assert.equal(result.success, false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      assert.match(messages, /points to non-group/);
    }
  });

  it('6. parentId 后置（child 在 parent 之前）→ schema 仍通过（两遍循环修法）', () => {
    // 之前 placeholder 实现按拓扑顺序边收集边校验会误伤；五审 M1+M2 改两遍循环
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('child', 'process', { parentId: 'grp' }),
        makeNode('grp', 'group'),
      ])
    );
    assert.equal(result.success, true);
  });
});
