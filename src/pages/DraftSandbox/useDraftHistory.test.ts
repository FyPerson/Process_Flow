// useDraftHistory hook 单测
//
// 用 react 的 act + minimal hook 调用模式测试栈语义
// 覆盖范围：
//   - 初始栈含 initial snapshot
//   - pushSnapshot 写入 + 栈深 ≤ 20
//   - 实质相等不重复 push（幂等）
//   - undo/redo 链路
//   - undo/redo 边界（栈底/栈顶）
//   - push 之后清空 future 栈

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Edge, Node } from '@xyflow/react';
import type { DraftNodeData } from './DraftNode';

// 抽 hook 内部纯逻辑做测试（避开 React renderer 依赖）
// 实际生产 hook 在 useDraftHistory.ts，这里复刻栈管理纯逻辑做语义验证
// 后续 D-6 接 RTL 可改用真 hook + renderHook
function snapshotsEqual(a: { nodes: unknown; edges: unknown }, b: { nodes: unknown; edges: unknown }) {
  return JSON.stringify(a.nodes) === JSON.stringify(b.nodes)
    && JSON.stringify(a.edges) === JSON.stringify(b.edges);
}

class HistoryStack {
  private history: Array<{ nodes: Node<DraftNodeData>[]; edges: Edge[] }> = [];
  private index = 0;
  private readonly max: number;

  constructor(initialNodes: Node<DraftNodeData>[], initialEdges: Edge[], max = 20) {
    this.history = [{ nodes: JSON.parse(JSON.stringify(initialNodes)), edges: JSON.parse(JSON.stringify(initialEdges)) }];
    this.index = 0;
    this.max = max;
  }

  push(nodes: Node<DraftNodeData>[], edges: Edge[]): void {
    const next = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    const branch = this.history.slice(0, this.index + 1);
    const top = branch[branch.length - 1];
    if (top && snapshotsEqual(top, next)) {
      this.history = branch;
      this.index = branch.length - 1;
      return;
    }
    branch.push(next);
    if (branch.length > this.max) {
      branch.splice(0, branch.length - this.max);
    }
    this.history = branch;
    this.index = branch.length - 1;
  }

  undo(): { nodes: Node<DraftNodeData>[]; edges: Edge[] } | null {
    if (this.index <= 0) return null;
    this.index--;
    return this.history[this.index];
  }

  redo(): { nodes: Node<DraftNodeData>[]; edges: Edge[] } | null {
    if (this.index >= this.history.length - 1) return null;
    this.index++;
    return this.history[this.index];
  }

  get length() {
    return this.history.length;
  }

  get currentIndex() {
    return this.index;
  }
}

test('init: 栈含 initial snapshot', () => {
  const stack = new HistoryStack([], []);
  assert.equal(stack.length, 1);
  assert.equal(stack.currentIndex, 0);
});

test('undo 在栈底返回 null', () => {
  const stack = new HistoryStack([], []);
  assert.equal(stack.undo(), null);
});

test('push 后 undo 拿回上一个快照', () => {
  const stack = new HistoryStack([], []);
  const node1 = { id: 'n_1', type: 'step', position: { x: 0, y: 0 }, data: { label: 'a' } } as Node<DraftNodeData>;
  stack.push([node1], []);
  assert.equal(stack.length, 2);
  const undoSnap = stack.undo();
  assert.ok(undoSnap);
  assert.deepEqual(undoSnap.nodes, []);
});

test('push 后 undo + redo 还原', () => {
  const stack = new HistoryStack([], []);
  const node1 = { id: 'n_1', type: 'step', position: { x: 0, y: 0 }, data: { label: 'a' } } as Node<DraftNodeData>;
  stack.push([node1], []);
  stack.undo();
  const redoSnap = stack.redo();
  assert.ok(redoSnap);
  assert.deepEqual(redoSnap.nodes, [node1]);
});

test('实质相等 push 不重复入栈（幂等）', () => {
  const stack = new HistoryStack([], []);
  const node1 = { id: 'n_1', type: 'step', position: { x: 0, y: 0 }, data: { label: 'a' } } as Node<DraftNodeData>;
  stack.push([node1], []);
  stack.push([node1], []); // 同一 snapshot 第二次 push
  stack.push([node1], []); // 第三次
  assert.equal(stack.length, 2); // 仍只有 [initial, node1]
});

test('栈深超 20 截掉最早一条（保留最近 20）', () => {
  const stack = new HistoryStack([], []);
  for (let i = 0; i < 30; i++) {
    const node = { id: `n_${i}`, type: 'step', position: { x: i, y: 0 }, data: { label: `${i}` } } as Node<DraftNodeData>;
    stack.push([node], []);
  }
  assert.equal(stack.length, 20);
  // 栈底应该是第 11 次 push（前 11 个被截掉）
  // undo 到底（19 次 undo）后到达栈底
  for (let i = 0; i < 19; i++) stack.undo();
  const bottom = stack.undo();
  assert.equal(bottom, null); // 已到栈底
});

test('undo 后 push → 清空 future 栈（分支替换）', () => {
  const stack = new HistoryStack([], []);
  const n1 = { id: 'n_1', type: 'step', position: { x: 0, y: 0 }, data: { label: 'a' } } as Node<DraftNodeData>;
  const n2 = { id: 'n_2', type: 'step', position: { x: 0, y: 0 }, data: { label: 'b' } } as Node<DraftNodeData>;
  const n3 = { id: 'n_3', type: 'step', position: { x: 0, y: 0 }, data: { label: 'c' } } as Node<DraftNodeData>;
  stack.push([n1], []);  // index=1
  stack.push([n2], []);  // index=2
  stack.undo();          // index=1
  stack.push([n3], []);  // 替换 future → index=2，栈为 [init, n1, n3]
  assert.equal(stack.length, 3);
  // redo 应该返回 null（n2 被丢弃）
  assert.equal(stack.redo(), null);
});

test('redo 在栈顶返回 null', () => {
  const stack = new HistoryStack([], []);
  const n1 = { id: 'n_1', type: 'step', position: { x: 0, y: 0 }, data: { label: 'a' } } as Node<DraftNodeData>;
  stack.push([n1], []);
  // 没 undo 过 → 已经在栈顶
  assert.equal(stack.redo(), null);
});

test('initial 含已加载的 nodes/edges（loadDraft 路径）', () => {
  const n1 = { id: 'n_1', type: 'step', position: { x: 0, y: 0 }, data: { label: 'a' } } as Node<DraftNodeData>;
  const e1 = { id: 'e_1', source: 'n_1', target: 'n_2' } as Edge;
  const stack = new HistoryStack([n1], [e1]);
  assert.equal(stack.length, 1);
  // undo 在栈底返回 null（loadDraft 路径下 initial 就是栈底，没有更早态）
  assert.equal(stack.undo(), null);
});
