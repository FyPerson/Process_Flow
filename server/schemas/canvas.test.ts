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
  type: 'process' | 'group' | 'terminator' | 'decision' | 'data' | 'subprocess' | 'text';
  position: { x: number; y: number };
  size: { width: number; height: number };
  expandable: boolean;
  parentId?: string;
  textFontFamily?: 'heiti' | 'yahei' | 'kaiti' | 'songti' | 'fangsong';
  textFontSize?: number;
  textColor?: string;
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

// ============================================================
// 文本框节点（MVP v1.20.0，方案 docs/规划/文本框节点/方案.md §3-§5）
// ============================================================

describe('MultiCanvasProjectSchema text 节点（MVP v1.20.0）', () => {
  it('1. type=text 单节点 → schema 通过', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([makeNode('t1', 'text')])
    );
    assert.equal(result.success, true);
  });

  it('2. text 节点带 textFontFamily/textFontSize/textColor 三字段 → schema 通过', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('t1', 'text', {
          textFontFamily: 'kaiti',
          textFontSize: 32,
          textColor: '#dc2626',
        }),
      ])
    );
    assert.equal(result.success, true);
  });

  it('3. text 节点 textFontFamily 非法 key → schema 拒绝', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('t1', 'text', {
          textFontFamily: 'comic-sans' as any,
        }),
      ])
    );
    assert.equal(result.success, false);
  });

  it('4. text 节点 textFontSize 超 200 → schema 拒绝', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('t1', 'text', {
          textFontSize: 300,
        }),
      ])
    );
    assert.equal(result.success, false);
  });

  it('5. text 节点 textFontSize 非正整数 → schema 拒绝', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('t1', 'text', {
          textFontSize: 0,
        }),
      ])
    );
    assert.equal(result.success, false);
  });

  it('6. text 节点不能作为 group 的 parent（非 group 类型）→ schema 拒绝', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('t1', 'text'),
        makeNode('child', 'process', { parentId: 't1' }),
      ])
    );
    assert.equal(result.success, false);
  });

  it('7. text 节点也可以作为 group 子节点（与其他节点同权）', () => {
    const result = MultiCanvasProjectSchema.safeParse(
      makeProject([
        makeNode('grp', 'group'),
        makeNode('t1', 'text', { parentId: 'grp' }),
      ])
    );
    assert.equal(result.success, true);
  });
});
