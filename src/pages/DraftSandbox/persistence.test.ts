// DraftSandbox persistence 单测
//
// 覆盖范围：
//   - loadDraft：从 localStorage 读 + version 校验 + schema 兜底 + 失败 fallback
//   - saveDraft：写入 + 失败兜底
//   - clearDraft：清空
//
// 用 node:test + 内存 localStorage stub（globalThis.localStorage）

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadDraft, saveDraft, clearDraft } from './persistence';

// ---- localStorage stub ----
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

test('loadDraft: 无数据时返回 null', () => {
  assert.equal(loadDraft(), null);
});

test('loadDraft: 正常读取 saveDraft 写入的数据', () => {
  const nodes = [{ id: 'n_aaa', type: 'step', position: { x: 0, y: 0 }, data: { label: '步骤 1' } }];
  const edges = [{ id: 'e_aaa', source: 'n_aaa', target: 'n_bbb' }];
  saveDraft(nodes as never, edges as never);

  const loaded = loadDraft();
  assert.ok(loaded);
  assert.equal(loaded.version, 1);
  assert.deepEqual(loaded.nodes, nodes);
  assert.deepEqual(loaded.edges, edges);
  assert.ok(typeof loaded.updatedAt === 'number');
});

test('loadDraft: version 不匹配 → 返回 null + console warn', () => {
  localStorage.setItem(
    'business-flow:draft-sandbox:v1',
    JSON.stringify({ version: 999, nodes: [], edges: [] }),
  );
  assert.equal(loadDraft(), null);
});

test('loadDraft: nodes 非数组 → 返回 null（schema 兜底）', () => {
  localStorage.setItem(
    'business-flow:draft-sandbox:v1',
    JSON.stringify({ version: 1, nodes: 'not-array', edges: [] }),
  );
  assert.equal(loadDraft(), null);
});

test('loadDraft: edges 缺失 → 返回 null（schema 兜底）', () => {
  localStorage.setItem(
    'business-flow:draft-sandbox:v1',
    JSON.stringify({ version: 1, nodes: [] }),
  );
  assert.equal(loadDraft(), null);
});

test('loadDraft: 非法 JSON → 返回 null（不抛错）', () => {
  localStorage.setItem('business-flow:draft-sandbox:v1', '{this is not valid json}');
  assert.equal(loadDraft(), null);
});

test('saveDraft: 写入后能正确取回', () => {
  saveDraft([], []);
  const raw = localStorage.getItem('business-flow:draft-sandbox:v1');
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.nodes, []);
  assert.deepEqual(parsed.edges, []);
});

test('saveDraft: localStorage 异常时不抛错', () => {
  // 模拟 quota exceeded
  const stub = new MemoryStorage();
  stub.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = stub;
  // 期望不抛
  assert.doesNotThrow(() => saveDraft([], []));
});

test('clearDraft: 清空 localStorage', () => {
  saveDraft([{ id: 'n_a' }] as never, []);
  assert.ok(localStorage.getItem('business-flow:draft-sandbox:v1'));
  clearDraft();
  assert.equal(localStorage.getItem('business-flow:draft-sandbox:v1'), null);
});

test('loadDraft 不依赖 saveDraft 的 updatedAt 时间戳', () => {
  // 写入一份不含 updatedAt 但 schema 满足的数据 → 仍能加载
  localStorage.setItem(
    'business-flow:draft-sandbox:v1',
    JSON.stringify({ version: 1, nodes: [], edges: [] }),
  );
  const loaded = loadDraft();
  assert.ok(loaded);
  assert.deepEqual(loaded.nodes, []);
  assert.deepEqual(loaded.edges, []);
});
