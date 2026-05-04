// P3D-2 step 4 formatCreatorName 单测（4 主分支 + 2 边界）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCreatorName } from './formatCreatorName.ts';

describe('formatCreatorName', () => {
  it('1. creator_username 存在 → 直接返回', () => {
    assert.equal(
      formatCreatorName({ creator_username: 'alice', creator_id: 2 }),
      'alice',
    );
  });

  it('2. __localNew=true（无 username/id）→ "本地新建（保存后归属为你）"', () => {
    assert.equal(
      formatCreatorName({ __localNew: true }),
      '本地新建（保存后归属为你）',
    );
  });

  it('3. creator_id 存在但无 username + 非 localNew → "用户 #N"', () => {
    assert.equal(
      formatCreatorName({ creator_id: 42 }),
      '用户 #42',
    );
  });

  it('4. 全空 → "未知创建者"', () => {
    assert.equal(formatCreatorName({}), '未知创建者');
  });

  // 边界：优先级
  it('5. __localNew=true 但有 creator_username → username 优先（已保存到服务端的本地节点）', () => {
    // 实际场景：节点保存后，creator_username 由服务端 hydrate 回来；
    // 但 __localNew 派生字段在某些边界路径可能仍残留 true。
    // 此时应以服务端权威为准（username 优先）
    assert.equal(
      formatCreatorName({ creator_username: 'bob', __localNew: true }),
      'bob',
    );
  });

  it('6. creator_username 是空字符串 → 走 fallback（不直接返回 ""）', () => {
    assert.equal(
      formatCreatorName({ creator_username: '', creator_id: 7 }),
      '用户 #7',
    );
  });
});
