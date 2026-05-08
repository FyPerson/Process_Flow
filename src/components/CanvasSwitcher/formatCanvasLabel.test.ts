// formatCanvasLabel 单测（2026-05-08 用户需求 — CanvasSwitcher 前缀文案）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCanvasLabel } from './formatCanvasLabel';
import type { CanvasListItem } from '../../api/canvases';

function mkCanvas(overrides: Partial<CanvasListItem>): CanvasListItem {
  return {
    id: 1,
    name: 'test canvas',
    description: null,
    visibility: 'private',
    is_public_to_guest: false,
    owner_id: 1,
    version: 1,
    created_by: 1,
    created_at: 0,
    updated_by: 1,
    updated_at: 0,
    archived: false,
    published_at: null,
    published_by: null,
    published_note: null,
    unpublished_at: null,
    unpublished_by: null,
    creator_username: 'user01',
    creator_nickname: '老王',
    ...overrides,
  };
}

describe('formatCanvasLabel — CanvasSwitcher 前缀规则', () => {
  it('public 画布 → [公共画布] + 🌐', () => {
    const result = formatCanvasLabel({
      canvas: mkCanvas({ visibility: 'public', owner_id: null, name: '业务流程图' }),
      currentUserId: 5,
    });
    assert.equal(result.prefix, '[公共画布] ');
    assert.equal(result.icon, '🌐');
    assert.equal(result.name, '业务流程图');
  });

  it('private 画布 + 我是 owner → [个人] + 🔒', () => {
    const result = formatCanvasLabel({
      canvas: mkCanvas({ visibility: 'private', owner_id: 5, name: 'my canvas' }),
      currentUserId: 5,
    });
    assert.equal(result.prefix, '[个人] ');
    assert.equal(result.icon, '🔒');
  });

  it('private 画布 + 别人 owner（admin 看别人的）→ [老王的] + 🔒', () => {
    const result = formatCanvasLabel({
      canvas: mkCanvas({
        visibility: 'private',
        owner_id: 2,
        creator_username: 'user01',
        creator_nickname: '老王',
        name: 'alice 私有',
      }),
      currentUserId: 1,  // admin id
    });
    assert.equal(result.prefix, '[老王的] ');
    assert.equal(result.icon, '🔒');
  });

  it('private 画布 + 别人 owner + nickname 缺失 → fallback 到 username', () => {
    const result = formatCanvasLabel({
      canvas: mkCanvas({
        visibility: 'private',
        owner_id: 2,
        creator_username: 'user01',
        creator_nickname: null,
      }),
      currentUserId: 1,
    });
    assert.equal(result.prefix, '[user01的] ');
  });

  it('private 画布 + creator_username 也 null → fallback unknown', () => {
    const result = formatCanvasLabel({
      canvas: mkCanvas({
        visibility: 'private',
        owner_id: 2,
        creator_username: null,
        creator_nickname: null,
      }),
      currentUserId: 1,
    });
    assert.equal(result.prefix, '[unknown的] ');
  });

  it('游客（currentUserId=null）看 public → [公共画布]', () => {
    const result = formatCanvasLabel({
      canvas: mkCanvas({ visibility: 'public', owner_id: null }),
      currentUserId: null,
    });
    assert.equal(result.prefix, '[公共画布] ');
    assert.equal(result.icon, '🌐');
  });

  it('游客（currentUserId=null）即使遇到 private（理论不会出现在游客列表）→ 走"别人的"分支', () => {
    // 防御性测试：游客应该看不到 private，但如果 service 出错给了一条，
    // 也走"别人的"分支（不会被当成"自己的"误标 [个人]）
    const result = formatCanvasLabel({
      canvas: mkCanvas({
        visibility: 'private',
        owner_id: 5,
        creator_nickname: '老王',
      }),
      currentUserId: null,
    });
    assert.equal(result.prefix, '[老王的] ');
  });
});
