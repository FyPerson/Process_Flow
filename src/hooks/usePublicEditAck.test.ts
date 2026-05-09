// usePublicEditAck 纯函数单测（codex 取舍审 9 条全采纳后落地）
//
// 覆盖：
// - isPublicCanvasReady 触发条件矩阵（codex M1：必须 server + canvasId + project + !loading）
// - ackKey 命名空间正确性（codex L1：v1 命名空间 + userId + canvasId 跨用户隔离）
//
// 不覆盖（hook state 流转 / sessionStorage 副作用）：
// - 这部分由 Playwright e2e 端到端验证，比 RTL 单测更接近真实路径
// - 项目未引入 RTL/jsdom（codex Day 4 F-16b 同款理由）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicCanvasReady, ackKey, ACK_KEY_PREFIX } from './usePublicEditAck.ts';
import type { UserPublic } from '../auth/api.ts';
import type { CanvasMetaState } from './useMultiCanvas.ts';
import type { MultiCanvasProject } from '../types/flow.ts';

// ============================================================
// fixture
// ============================================================

const adminUser: UserPublic = {
  id: 1,
  username: 'admin',
  role: 'admin',
  nickname: 'admin',
};
const normalUser: UserPublic = {
  id: 2,
  username: 'alice',
  role: 'user',
  nickname: 'alice',
};

const localState: CanvasMetaState = { kind: 'local' };
const loadingState: CanvasMetaState = { kind: 'loading' };
const publicServerState: CanvasMetaState = {
  kind: 'server',
  meta: { visibility: 'public', owner_id: null, archived: false },
};
const privateServerState: CanvasMetaState = {
  kind: 'server',
  meta: { visibility: 'private', owner_id: 2, archived: false },
};

const dummyProject = { sheets: [], activeSheetId: 's1', name: 'p' } as unknown as MultiCanvasProject;

// 默认满足所有触发条件（每个 case 只覆盖偏离的一个维度）
const trigger = {
  user: normalUser,
  canvasMetaState: publicServerState,
  canvasId: 12 as number | null,
  project: dummyProject as MultiCanvasProject | null,
  isProjectLoading: false,
};

// ============================================================
// isPublicCanvasReady 触发条件矩阵
// ============================================================

describe('isPublicCanvasReady', () => {
  it('1. 默认 fixture（普通用户 + 公共 server + canvasId + project + !loading）→ true', () => {
    assert.equal(isPublicCanvasReady(trigger), true);
  });

  it('2. user=null（游客）→ false', () => {
    assert.equal(isPublicCanvasReady({ ...trigger, user: null }), false);
  });

  it('3. user.role=admin → false（admin 编辑公共画布是日常，不弹）', () => {
    assert.equal(isPublicCanvasReady({ ...trigger, user: adminUser }), false);
  });

  it('4. canvasMetaState.kind=local → false', () => {
    assert.equal(isPublicCanvasReady({ ...trigger, canvasMetaState: localState }), false);
  });

  it('5. canvasMetaState.kind=loading → false（codex M1：避免抖动）', () => {
    assert.equal(isPublicCanvasReady({ ...trigger, canvasMetaState: loadingState }), false);
  });

  it('6. visibility=private → false', () => {
    assert.equal(isPublicCanvasReady({ ...trigger, canvasMetaState: privateServerState }), false);
  });

  it('7. canvasId=null → false（codex M1：必须有具体 canvasId）', () => {
    assert.equal(isPublicCanvasReady({ ...trigger, canvasId: null }), false);
  });

  it('8. project=null → false（codex M1：必须 project 完成加载）', () => {
    assert.equal(isPublicCanvasReady({ ...trigger, project: null }), false);
  });

  it('9. isProjectLoading=true → false（codex M1：加载中不弹）', () => {
    assert.equal(isPublicCanvasReady({ ...trigger, isProjectLoading: true }), false);
  });

  it('10. archived public 画布 + 普通用户 → 仍 true（虽然 archived 由 canWriteCanvas 拦死，但触发判定不看 archived；effective writable 由外层算）', () => {
    const archivedPublic: CanvasMetaState = {
      kind: 'server',
      meta: { visibility: 'public', owner_id: null, archived: true },
    };
    assert.equal(isPublicCanvasReady({ ...trigger, canvasMetaState: archivedPublic }), true);
  });
});

// ============================================================
// ackKey 命名空间
// ============================================================

describe('ackKey', () => {
  it('1. 包含 v1 命名空间前缀（codex L1）', () => {
    const key = ackKey(2, 12);
    assert.ok(key.startsWith(ACK_KEY_PREFIX), `key 应以 ${ACK_KEY_PREFIX} 开头，实际：${key}`);
    assert.ok(ACK_KEY_PREFIX.includes(':v1:'), 'ACK_KEY_PREFIX 必须含 :v1: 命名空间位');
  });

  it('2. userId + canvasId 拼接，跨用户隔离（codex L2 + L1）', () => {
    const k1 = ackKey(2, 12);
    const k2 = ackKey(3, 12); // 同 canvas 不同用户
    const k3 = ackKey(2, 13); // 同用户不同 canvas
    assert.notEqual(k1, k2, '不同 userId 必须产生不同 key');
    assert.notEqual(k1, k3, '不同 canvasId 必须产生不同 key');
  });

  it('3. 同 (userId, canvasId) 稳定（再次调用相同结果）', () => {
    assert.equal(ackKey(2, 12), ackKey(2, 12));
  });
});
