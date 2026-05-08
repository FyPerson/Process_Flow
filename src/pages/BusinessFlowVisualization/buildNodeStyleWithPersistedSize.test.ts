// #35 修法回归测试（codex spec-critique 2026-05-08 推荐方案 B）
//
// 测目标：BFV 普通节点构造时把持久化 size 注入 style.width/height，避免
// "加载即推 baseline +1" — 公共画布 user01 加载 admin 创节点 30s 后被 403 forbidden_modify_others_node
//
// 测试矩阵（按 codex M2 + Recommendations#4 + risks 设计）：
// 1. size 是 number → 注入 style.width/height
// 2. size.width=0（合法的 0）→ 不被吞 / 注入 0（防 `||` 写法）
// 3. size 缺失 → 不注入，保留 inlineStyle 原值
// 4. size 字符串 → 不注入（M2 number guard），保留 inlineStyle 原值
// 5. inlineStyle 已有 width 但 size 也有 → size 优先（H1 fallback 顺序）
// 6. inlineStyle undefined + size 完整 → 仅含 size 注入字段
// 7. 其他 inlineStyle 字段（如 backgroundColor）保留

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeStyleWithPersistedSize } from './buildNodeStyleWithPersistedSize';

describe('buildNodeStyleWithPersistedSize（#35 加载即推 baseline 修法）', () => {
  it('size 是 number → 注入 style.width/height', () => {
    const result = buildNodeStyleWithPersistedSize(undefined, { width: 120, height: 50 });
    assert.equal(result.width, 120);
    assert.equal(result.height, 50);
  });

  it('size.width=0 不被吞（M2 number guard 防 `||` 写法）', () => {
    const result = buildNodeStyleWithPersistedSize(undefined, { width: 0, height: 0 });
    assert.equal(result.width, 0);
    assert.equal(result.height, 0);
  });

  it('size 缺失 → 不注入 width/height，保留 inlineStyle 原值', () => {
    const result = buildNodeStyleWithPersistedSize(
      { backgroundColor: 'red', width: 99 },
      undefined,
    );
    assert.equal(result.backgroundColor, 'red');
    assert.equal(result.width, 99);
    assert.ok(!('height' in result));
  });

  it('size 是字符串 → 不注入（M2 number guard），保留 inlineStyle 原值', () => {
    const result = buildNodeStyleWithPersistedSize(
      { width: 200, height: 60 },
      // 模拟历史数据被错写成字符串
      { width: 'auto' as unknown as number, height: '50px' as unknown as number },
    );
    assert.equal(result.width, 200);
    assert.equal(result.height, 60);
  });

  it('inlineStyle 已有 width + size 也有 → size 优先（H1 fallback 顺序）', () => {
    const result = buildNodeStyleWithPersistedSize(
      { width: 999, height: 999, backgroundColor: 'blue' },
      { width: 120, height: 50 },
    );
    assert.equal(result.width, 120);
    assert.equal(result.height, 50);
    assert.equal(result.backgroundColor, 'blue');
  });

  it('inlineStyle 是 undefined + size 完整 → 只有 size 注入字段', () => {
    const result = buildNodeStyleWithPersistedSize(undefined, { width: 100, height: 40 });
    assert.deepEqual(result, { width: 100, height: 40 });
  });

  it('size.width 是 number 但 size.height 缺失 → 仅注入 width', () => {
    const result = buildNodeStyleWithPersistedSize(
      { backgroundColor: 'green' },
      { width: 80 },
    );
    assert.equal(result.width, 80);
    assert.ok(!('height' in result));
    assert.equal(result.backgroundColor, 'green');
  });

  it('inlineStyle 其他字段（borderRadius / opacity / transform 等）原样保留', () => {
    const result = buildNodeStyleWithPersistedSize(
      {
        borderRadius: 8,
        opacity: 0.6,
        transform: 'rotate(45deg)',
        zIndex: 10,
      },
      { width: 150, height: 60 },
    );
    assert.equal(result.borderRadius, 8);
    assert.equal(result.opacity, 0.6);
    assert.equal(result.transform, 'rotate(45deg)');
    assert.equal(result.zIndex, 10);
    assert.equal(result.width, 150);
    assert.equal(result.height, 60);
  });

  it('回归核心：服务端含 size 但 inlineStyle 无 width/height → 输出 style 必有 width/height', () => {
    // 这是 #35 真因复现：BFV 加载 admin 创建的节点（含 size），inlineStyle 仅有装饰字段
    // 修法后输出 style 必带 width/height，让 React Flow 不再测量 + 反向同步
    const result = buildNodeStyleWithPersistedSize(
      { backgroundColor: '#fff' }, // admin 创节点典型 inlineStyle
      { width: 120, height: 50 }, // 服务端 size
    );
    assert.equal(typeof result.width, 'number');
    assert.equal(typeof result.height, 'number');
    assert.equal(result.width, 120);
    assert.equal(result.height, 50);
    assert.equal(result.backgroundColor, '#fff');
  });
});
