// P3B 节点 ID 改 nanoid 单测
// 验证 helper 输出格式 + 与服务端 ShortIdSchema 兼容 + 跨 batch 唯一性

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newNodeId, newGroupId, newEdgeId } from './ids.ts';
import { ShortIdSchema } from '../../server/schemas/canvas.ts';

describe('id generators', () => {
  it('1. newNodeId 形如 n_<10 字符 nanoid> 且通过 ShortIdSchema', () => {
    const id = newNodeId();
    assert.match(id, /^n_[A-Za-z0-9_-]{10}$/);
    assert.equal(id.length, 12);
    assert.doesNotThrow(() => ShortIdSchema.parse(id));
  });

  it('2. newGroupId 形如 g_<10 字符 nanoid> 且通过 ShortIdSchema', () => {
    const id = newGroupId();
    assert.match(id, /^g_[A-Za-z0-9_-]{10}$/);
    assert.equal(id.length, 12);
    assert.doesNotThrow(() => ShortIdSchema.parse(id));
  });

  it('3. newEdgeId 形如 e_<10 字符 nanoid> 且通过 ShortIdSchema', () => {
    const id = newEdgeId();
    assert.match(id, /^e_[A-Za-z0-9_-]{10}$/);
    assert.equal(id.length, 12);
    assert.doesNotThrow(() => ShortIdSchema.parse(id));
  });

  it('4. 同进程内连续生成不重复（1000 个节点 ID）', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(newNodeId());
    assert.equal(set.size, 1000);
  });

  it('5. 同毫秒内连续生成不重复（修复旧 Date.now() 同毫秒撞 ID 的根因）', () => {
    // 旧实现 `new_node_${Date.now()}` 在同一 tick 内会拿到相同 ID
    // nanoid 不依赖时间戳，500 次同步调用必须全不重复
    const ids = Array.from({ length: 500 }, () => newNodeId());
    assert.equal(new Set(ids).size, 500);
  });

  it('6. 三种 ID 前缀互不相同（避免 node/group/edge 串号）', () => {
    assert.notEqual(newNodeId().charAt(0), newGroupId().charAt(0));
    assert.notEqual(newNodeId().charAt(0), newEdgeId().charAt(0));
    assert.notEqual(newGroupId().charAt(0), newEdgeId().charAt(0));
  });
});
