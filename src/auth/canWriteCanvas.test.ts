// P3D-2 step 2：canWriteCanvas 单测（codex 二审后改用三态）
// 与服务端 canWrite() 行为一致 + 加载/本地状态显式拆分（src/auth/canWriteCanvas.ts 矩阵）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canWriteCanvas } from './canWriteCanvas.ts';
import type { UserPublic } from './api.ts';
import type { CanvasMetaState } from '../hooks/useMultiCanvas.ts';

const adminUser: UserPublic = { id: 1, username: 'admin', role: 'admin' };
const ownerUser: UserPublic = { id: 2, username: 'alice', role: 'user' };
const otherUser: UserPublic = { id: 3, username: 'bob', role: 'user' };

const localState: CanvasMetaState = { kind: 'local' };
const loadingState: CanvasMetaState = { kind: 'loading' };
const publicState: CanvasMetaState = {
  kind: 'server',
  meta: { visibility: 'public', owner_id: null, archived: false },
};
const privateOwnedState: CanvasMetaState = {
  kind: 'server',
  meta: { visibility: 'private', owner_id: 2, archived: false },
};
const privateOtherState: CanvasMetaState = {
  kind: 'server',
  meta: { visibility: 'private', owner_id: 99, archived: false },
};
const archivedPublicState: CanvasMetaState = {
  kind: 'server',
  meta: { visibility: 'public', owner_id: null, archived: true },
};

describe('canWriteCanvas', () => {
  it('1. 游客（user=null）→ false（任何 metaState）', () => {
    assert.equal(canWriteCanvas(localState, null), false);
    assert.equal(canWriteCanvas(loadingState, null), false);
    assert.equal(canWriteCanvas(publicState, null), false);
    assert.equal(canWriteCanvas(privateOwnedState, null), false);
    assert.equal(canWriteCanvas(archivedPublicState, null), false);
  });

  it('2. loading 态 → false（任何登录用户都 fail-closed）', () => {
    // codex 二审必修 1 关键测试：fetch 加载期间不能漏放行
    assert.equal(canWriteCanvas(loadingState, adminUser), false);
    assert.equal(canWriteCanvas(loadingState, ownerUser), false);
    assert.equal(canWriteCanvas(loadingState, otherUser), false);
  });

  it('3. local 态（本地草稿）+ 任意登录用户 → true（保持 readOnly=guest 行为兼容）', () => {
    // 关键不变量：登录用户在未挂接服务端的本地数据上仍能编辑
    // 否则 readOnly 为 guest 的当前行为会回归（"另存到服务器"前所有节点都 disable）
    assert.equal(canWriteCanvas(localState, ownerUser), true);
    assert.equal(canWriteCanvas(localState, adminUser), true);
    assert.equal(canWriteCanvas(localState, otherUser), true);
  });

  it('4. server 态 + admin → true（任意画布，含归档）', () => {
    assert.equal(canWriteCanvas(publicState, adminUser), true);
    assert.equal(canWriteCanvas(privateOwnedState, adminUser), true);
    assert.equal(canWriteCanvas(privateOtherState, adminUser), true);
    // admin 在归档画布上也能写（与服务端 canWrite 一致）
    assert.equal(canWriteCanvas(archivedPublicState, adminUser), true);
  });

  it('5. server 态 + 普通用户 + 归档画布 → false（含 owner 也不能改归档）', () => {
    const archivedPrivateOwnedState: CanvasMetaState = {
      kind: 'server',
      meta: { visibility: 'private', owner_id: ownerUser.id, archived: true },
    };
    assert.equal(canWriteCanvas(archivedPublicState, ownerUser), false);
    assert.equal(canWriteCanvas(archivedPrivateOwnedState, ownerUser), false);
  });

  it('6. server 态 + 普通用户 + 公共画布（未归档）→ true', () => {
    assert.equal(canWriteCanvas(publicState, ownerUser), true);
    assert.equal(canWriteCanvas(publicState, otherUser), true);
  });

  it('7. server 态 + 普通用户 + 私有画布 → 只 owner 能写', () => {
    // owner 自己 → true
    assert.equal(canWriteCanvas(privateOwnedState, ownerUser), true);
    // 非 owner → false
    assert.equal(canWriteCanvas(privateOwnedState, otherUser), false);
    assert.equal(canWriteCanvas(privateOtherState, ownerUser), false);
  });
});
