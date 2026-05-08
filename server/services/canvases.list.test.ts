// listCanvases* JOIN users 取 creator_nickname / creator_username 单测
// 2026-05-08 用户需求：CanvasSwitcher 显示创建者昵称作 private 画布前缀
//
// 覆盖：
// 1. listCanvasesForUser 返回 creator_nickname（自己 owner 的 private）
// 2. listCanvasesForUser 返回 creator_nickname（public 画布，admin 创建）
// 3. listCanvasesForAdmin 返回所有画布的 creator_nickname（admin 视角看别人 private）
// 4. listCanvasesForGuest 返回 creator_nickname（仅 public + guest 标记）
// 5. creator nickname 为空字符串时 fallback 到 username
// 6. created_by 指向软删用户 — LEFT JOIN 仍能取到 username（软删保留行）
// 7. created_by 指向不存在用户（理论不会，防御）— creator_username 为 null

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

import { setDbForTesting } from '../db/index.ts';
import {
  listCanvasesForGuest,
  listCanvasesForUser,
  listCanvasesForAdmin,
} from './canvases.ts';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

let db: DatabaseType;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  setDbForTesting(db);
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

function insertUser(id: number, username: string, nickname: string, role: 'admin' | 'user' = 'user'): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, nickname, created_at, updated_at)
     VALUES (?, ?, 'hash', ?, ?, ?, ?)`,
  ).run(id, username, role, nickname, now, now);
}

function insertCanvas(input: {
  id: number;
  name: string;
  visibility: 'public' | 'private';
  is_public_to_guest?: 0 | 1;
  owner_id: number | null;
  created_by: number;
}): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO canvases
       (id, name, description, visibility, is_public_to_guest, owner_id, data, version,
        created_by, created_at, updated_by, updated_at, archived)
     VALUES (?, ?, NULL, ?, ?, ?, '{}', 1, ?, ?, ?, ?, 0)`,
  ).run(
    input.id, input.name, input.visibility, input.is_public_to_guest ?? 0,
    input.owner_id, input.created_by, now, input.created_by, now,
  );
}

describe('listCanvases* — creator nickname JOIN', () => {
  // -------- 1. listCanvasesForUser 自己 private --------
  it('1. listCanvasesForUser 返回自己 private 画布的 creator_nickname', () => {
    insertUser(1, 'alice', '艾莉丝');
    insertCanvas({ id: 100, name: 'alice 私有', visibility: 'private', owner_id: 1, created_by: 1 });
    const list = listCanvasesForUser(1);
    assert.equal(list.length, 1);
    assert.equal(list[0].creator_username, 'alice');
    assert.equal(list[0].creator_nickname, '艾莉丝');
  });

  // -------- 2. listCanvasesForUser public（admin 创建）--------
  it('2. listCanvasesForUser 返回 public 画布的 creator_nickname（admin 创建）', () => {
    insertUser(1, 'admin', '系统管理员', 'admin');
    insertUser(2, 'alice', '艾莉丝');
    insertCanvas({ id: 100, name: '公共画布', visibility: 'public', owner_id: null, created_by: 1 });
    const list = listCanvasesForUser(2);
    assert.equal(list.length, 1);
    assert.equal(list[0].creator_username, 'admin');
    assert.equal(list[0].creator_nickname, '系统管理员');
  });

  // -------- 3. listCanvasesForAdmin 看别人 private --------
  it('3. listCanvasesForAdmin 看到所有画布含 creator_nickname', () => {
    insertUser(1, 'admin', '管理员', 'admin');
    insertUser(2, 'alice', '艾莉丝');
    insertUser(3, 'bob', '老王');
    insertCanvas({ id: 100, name: 'admin 公共', visibility: 'public', owner_id: null, created_by: 1 });
    insertCanvas({ id: 101, name: 'alice 私有', visibility: 'private', owner_id: 2, created_by: 2 });
    insertCanvas({ id: 102, name: 'bob 私有', visibility: 'private', owner_id: 3, created_by: 3 });
    const list = listCanvasesForAdmin();
    assert.equal(list.length, 3);
    const byId = new Map(list.map((c) => [c.id, c]));
    assert.equal(byId.get(100)!.creator_nickname, '管理员');
    assert.equal(byId.get(101)!.creator_nickname, '艾莉丝');
    assert.equal(byId.get(102)!.creator_nickname, '老王');
  });

  // -------- 4. listCanvasesForGuest --------
  it('4. listCanvasesForGuest 返回 creator_nickname（仅 guest 可见 public）', () => {
    insertUser(1, 'admin', '管理员', 'admin');
    insertCanvas({ id: 100, name: '游客画布', visibility: 'public', is_public_to_guest: 1, owner_id: null, created_by: 1 });
    insertCanvas({ id: 101, name: '非游客 public', visibility: 'public', is_public_to_guest: 0, owner_id: null, created_by: 1 });
    const list = listCanvasesForGuest();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 100);
    assert.equal(list[0].creator_nickname, '管理员');
  });

  // -------- 5. nickname 空字符串 fallback 到 username --------
  it('5. nickname 空字符串 → fallback 到 username', () => {
    insertUser(1, 'noname', '');  // 空 nickname（migration 0006 默认值）
    insertCanvas({ id: 100, name: 'noname 画布', visibility: 'private', owner_id: 1, created_by: 1 });
    const list = listCanvasesForUser(1);
    assert.equal(list[0].creator_username, 'noname');
    assert.equal(list[0].creator_nickname, 'noname', 'empty nickname should fallback to username');
  });

  // -------- 6. 软删用户仍能取到 nickname（保留行）--------
  it('6. 软删用户保留 row → creator_nickname 仍可取', () => {
    insertUser(1, 'alice', '艾莉丝');
    insertCanvas({ id: 100, name: '软删者画布', visibility: 'private', owner_id: 1, created_by: 1 });
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), 1);
    // listCanvasesForAdmin（看到所有人画布）
    const list = listCanvasesForAdmin();
    assert.equal(list.length, 1);
    assert.equal(list[0].creator_username, 'alice');
    assert.equal(list[0].creator_nickname, '艾莉丝', 'soft-deleted user nickname still available via LEFT JOIN');
  });

  // -------- 7. created_by 指向不存在的 user → null（防御性）--------
  it('7. LEFT JOIN 兜底：created_by 指向不存在用户 → creator_username/nickname 为 null', () => {
    // 直接 INSERT 一个画布，created_by 指向不存在的 user_id（关闭外键临时绕过约束）
    db.pragma('foreign_keys = OFF');
    insertCanvas({ id: 100, name: '孤儿画布', visibility: 'public', owner_id: null, created_by: 999 });
    db.pragma('foreign_keys = ON');
    const list = listCanvasesForAdmin();
    assert.equal(list.length, 1);
    assert.equal(list[0].creator_username, null);
    assert.equal(list[0].creator_nickname, null);
  });
});
