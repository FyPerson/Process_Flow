// canvas 业务服务层 —— 封装 DB 事务与权限规则
//
// 关键不变量（方案 §3.1 / §5.1 / §5.7）：
// - 创建画布必须**同事务**：插入 canvases + canvas_versions(v=1) + 为初始 data 中所有节点写 nodes_meta
// - 保存画布走"情况 1"路径（无并发）：baseVersion == currentVersion 才直接写；否则 409
//   完整合并算法（情况 2/3）留到方案 §7 阶段 5 再做
// - PUT 必须包在 BEGIN IMMEDIATE 事务里，避免两个并发 PUT 同时通过版本检查
// - nodes_meta 是节点元信息唯一可信源；服务端在保存前用它重写 canvases.data 中的元字段

import type { Database as DatabaseType } from 'better-sqlite3';
import { getDb } from '../db/index.ts';
import type { MultiCanvasProjectInput } from '../schemas/canvas.ts';
import type { UserPublic } from '../types/user.ts';
import { computeDelta, DataIntegrityError } from './merge/computeDelta.ts';
import { tryMerge } from './merge/tryMerge.ts';
import type { Conflict, MergeReport, MultiCanvasProjectShape } from './merge/types.ts';
import { logConflictResolution } from './conflict_logs.ts';
import {
  asProjectShape,
  PermissionError,
  rewriteNodesFromMeta,
  syncNodesMetaFromDeltaB,
  validateDeltaBPermissions,
} from './canvases-merge-helpers.ts';

export type Visibility = 'public' | 'private';

export interface CanvasRow {
  id: number;
  name: string;
  description: string | null;
  visibility: Visibility;
  is_public_to_guest: number;
  owner_id: number | null;
  data: string; // JSON
  version: number;
  created_by: number;
  created_at: number;
  updated_by: number;
  updated_at: number;
  archived: number;
  // P3G：发布元信息（migration 0003）
  published_at: number | null;
  published_by: number | null;
  published_note: string | null;
  unpublished_at: number | null;
  unpublished_by: number | null;
}

export interface CanvasListItem {
  id: number;
  name: string;
  description: string | null;
  visibility: Visibility;
  is_public_to_guest: boolean;
  owner_id: number | null;
  version: number;
  created_by: number;
  created_at: number;
  updated_by: number;
  updated_at: number;
  archived: boolean;
  published_at: number | null;
  published_by: number | null;
  published_note: string | null;
  unpublished_at: number | null;
  unpublished_by: number | null;
  // 2026-05-08 用户需求：CanvasSwitcher 显示创建者昵称作前缀
  // - LEFT JOIN users 取 creator 昵称；users 软删时 row 仍存在（fallback 到 username）
  // - 数据完整性兜底：created_by 指向不存在的 user 时（理论上不应发生）这两字段为 null
  creator_username: string | null;
  creator_nickname: string | null;
  // 阶段 4 P4C：列表页"X 人在编辑"角标；route 层注入（route 拿不到 user 时为 0）
  // 该字段不在 toListItem service 里产生，由 GET /api/canvases route 批量注入
  activeEditors?: number;
}

/** SELECT 查询用的扩展行类型：base CanvasRow + JOIN 来的 creator 昵称字段 */
interface CanvasRowWithCreator extends CanvasRow {
  creator_username: string | null;
  creator_nickname: string | null;
}

/** SELECT 列表的标准列（base + LEFT JOIN creator）。所有 listCanvases* 复用 */
const LIST_SELECT = `
  c.*,
  u.username AS creator_username,
  u.nickname AS creator_nickname
`;
const LIST_FROM = `FROM canvases c LEFT JOIN users u ON u.id = c.created_by`;

function toListItem(row: CanvasRowWithCreator): CanvasListItem {
  // creator 昵称空字符串 fallback 到 username（与 toAdminResponse / toPublic 同口径）
  const creatorNickname =
    row.creator_nickname !== null && row.creator_nickname.length > 0
      ? row.creator_nickname
      : row.creator_username;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    is_public_to_guest: row.is_public_to_guest === 1,
    owner_id: row.owner_id,
    version: row.version,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    archived: row.archived === 1,
    published_at: row.published_at,
    published_by: row.published_by,
    published_note: row.published_note,
    unpublished_at: row.unpublished_at,
    unpublished_by: row.unpublished_by,
    creator_username: row.creator_username,
    creator_nickname: creatorNickname,
  };
}

// =====================================================================
// 列表
// =====================================================================

/** 游客可见：仅 public + is_public_to_guest=1 + 未归档 */
export function listCanvasesForGuest(): CanvasListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT ${LIST_SELECT} ${LIST_FROM}
       WHERE c.visibility = 'public' AND c.is_public_to_guest = 1 AND c.archived = 0
       ORDER BY c.updated_at DESC`
    )
    .all() as CanvasRowWithCreator[];
  return rows.map(toListItem);
}

/** 登录用户可见：所有 public（无论 guest 标记）+ 自己 owner 的 private + 未归档 */
export function listCanvasesForUser(userId: number): CanvasListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT ${LIST_SELECT} ${LIST_FROM}
       WHERE c.archived = 0
         AND (c.visibility = 'public' OR (c.visibility = 'private' AND c.owner_id = ?))
       ORDER BY c.updated_at DESC`
    )
    .all(userId) as CanvasRowWithCreator[];
  return rows.map(toListItem);
}

/** admin：能看所有非归档 */
export function listCanvasesForAdmin(): CanvasListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT ${LIST_SELECT} ${LIST_FROM}
       WHERE c.archived = 0
       ORDER BY c.updated_at DESC`
    )
    .all() as CanvasRowWithCreator[];
  return rows.map(toListItem);
}

// =====================================================================
// 单画布读
// =====================================================================

/** 读单个画布；权限检查由 route 层做 */
export function getCanvasRow(id: number): CanvasRow | null {
  const row = getDb().prepare('SELECT * FROM canvases WHERE id = ?').get(id) as
    | CanvasRow
    | undefined;
  return row ?? null;
}

/**
 * 读单个画布并 hydrate 节点元信息（P3C codex 必修 1）。
 *
 * canvases.data 里只存了 is_deprecated（save rewrite 时写入），
 * 但前端 tooltip 需要 deprecated_by / deprecated_at / deprecated_by_username。
 * 这些字段以 nodes_meta + users JOIN 为准；GET 时一次性查出来 hydrate 进 data。
 *
 * 不修改 canvases.data 的 deprecated_by/at —— 它在 save rewrite 时已写入，
 * 但 username 是 view-only（用户改名后旧 data 里的 username 应该跟着变）。
 *
 * 未废弃节点：omit deprecated_by/at/username（schema 接受 omit）
 * 已废弃但历史 by/at 缺失：omit by/at/username
 * 已废弃且 by 用户已删除：保留 by + at，username = null（前端 fallback "用户 #N"）
 */
export function getCanvasFull(id: number): (CanvasRow & { hydratedData: unknown }) | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as
    | CanvasRow
    | undefined;
  if (!row) return null;

  // P3D-1 codex 必修 3：权威 hydrate —— 不仅 JOIN deprecated_by_username，还要
  // JOIN creator_username（creator_id），并从 nodes_meta hydrate
  // creator_id/created_at/updated_by/updated_at（之前依赖 storage 旧字段，可能 stale）。
  type MetaJoinRow = {
    sheet_id: string;
    node_id: string;
    creator_id: number;
    creator_username: string | null;
    created_at: number;
    updated_by: number;
    updated_at: number;
    is_deprecated: number;
    deprecated_by: number | null;
    deprecated_at: number | null;
    deprecated_by_username: string | null;
  };
  const metaRows = db
    .prepare(
      `SELECT m.sheet_id, m.node_id,
              m.creator_id, uc.username AS creator_username,
              m.created_at, m.updated_by, m.updated_at,
              m.is_deprecated,
              m.deprecated_by, m.deprecated_at,
              ud.username AS deprecated_by_username
       FROM nodes_meta m
       LEFT JOIN users uc ON uc.id = m.creator_id
       LEFT JOIN users ud ON ud.id = m.deprecated_by
       WHERE m.canvas_id = ?`
    )
    .all(id) as MetaJoinRow[];
  const metaIndex = new Map<string, MetaJoinRow>();
  for (const m of metaRows) {
    metaIndex.set(`${m.sheet_id}|${m.node_id}`, m);
  }

  // hydrate：data.sheets[].nodes[] 用 nodes_meta 为唯一可信源覆写元字段
  // 不论 storage 里残留什么 stale 元字段，输出时一律先剥后注入。
  const data = JSON.parse(row.data) as { sheets: StorageSheet[]; [key: string]: unknown };
  const hydratedSheets = data.sheets.map((sheet) => ({
    ...sheet,
    nodes: sheet.nodes.map((rawNode) => {
      // 先 strip 掉 storage 里可能存在的 stale 元字段
      const stripped = stripHydratedNodeMetaForCompareOrHydrate(rawNode);
      const node = stripped as StorageNode;
      const meta = metaIndex.get(`${sheet.id}|${(rawNode as StorageNode).id}`);
      // 没有 meta 行（理论上不该发生，0002 migration 兜底）→ 透传 strip 后节点
      if (!meta) return node;

      // 注入元信息（creator_id 必有；creator_username 可能 null = 用户已删）
      const out: StorageNode = {
        ...node,
        creator_id: meta.creator_id,
        created_at: meta.created_at,
        updated_by: meta.updated_by,
        updated_at: meta.updated_at,
        is_deprecated: !!meta.is_deprecated,
      };
      if (meta.creator_username !== null) out.creator_username = meta.creator_username;
      // 已废弃：注入 deprecated_by/at/username（meta 缺失的 omit）
      if (meta.is_deprecated) {
        if (meta.deprecated_by !== null) out.deprecated_by = meta.deprecated_by;
        if (meta.deprecated_at !== null) out.deprecated_at = meta.deprecated_at;
        if (meta.deprecated_by_username !== null) out.deprecated_by_username = meta.deprecated_by_username;
      }
      return out;
    }),
  }));
  const hydratedData = { ...data, sheets: hydratedSheets };
  return { ...row, hydratedData };
}

/** 当前用户能否查看此画布 */
export function canRead(row: CanvasRow, user: UserPublic | null): boolean {
  if (row.archived === 1) {
    // 归档画布只 admin 能看（§9.4）
    return user?.role === 'admin';
  }
  if (row.visibility === 'public') {
    if (user) return true;
    return row.is_public_to_guest === 1; // 游客需要勾选标记
  }
  // private: 只 owner / admin
  if (!user) return false;
  if (user.role === 'admin') return true;
  return row.owner_id === user.id;
}

/** 当前用户能否编辑此画布（写权限）*/
export function canWrite(row: CanvasRow, user: UserPublic | null): boolean {
  if (!user) return false; // 游客不能写
  if (row.archived === 1) return user.role === 'admin'; // 归档只 admin 能改
  if (row.visibility === 'public') return true; // 任何登录用户能编辑共有画布
  // private: 只 owner / admin
  if (user.role === 'admin') return true;
  return row.owner_id === user.id;
}

// =====================================================================
// 创建
// =====================================================================

export interface CreateCanvasInput {
  name: string;
  description?: string;
  visibility: Visibility;
  is_public_to_guest?: boolean;
  data: MultiCanvasProjectInput;
  user: UserPublic;
}

export interface CreateCanvasResult {
  id: number;
  version: 1;
}

/**
 * 创建画布（方案 §3.1 初始快照三步流程）：
 * 1. INSERT canvases（version=1）
 * 2. INSERT canvas_versions(version=1, data, ...) 写初始快照
 * 3. 为初始 data 中所有节点写 nodes_meta（creator_id = 当前用户）
 *
 * 全部包在事务里；任一步失败回滚。
 *
 * 权限：visibility='public' 仅 admin 能创建；'private' 任何登录用户。
 */
export function createCanvas(input: CreateCanvasInput): CreateCanvasResult {
  const db = getDb();
  const { name, description, visibility, is_public_to_guest, data, user } = input;
  const now = Date.now();

  // P3C codex 必修 3 + P3D-1 codex 必修 1：导入/另存为路径下 data.sheets[].nodes[] 可能带
  // is_deprecated=true 或客户端伪造的 creator/updated/deprecated 归属字段。
  // 必须重写 data 把元字段强制为服务端值，并相应同步 nodes_meta。
  //
  // strip 用 stripServerAttributionForSaveInput（保留 is_deprecated，strip 其他归属）：
  // - is_deprecated 是客户端的"标废弃信号"，必须保留以驱动后续 isDeprecated 判定
  // - 其他归属字段一律服务端独占，伪造无效
  const rewrittenSheets = data.sheets.map((sheet) => ({
    ...sheet,
    nodes: sheet.nodes.map((rawNode) => {
      const stripped = stripServerAttributionForSaveInput(rawNode);
      const isDeprecated = !!stripped.is_deprecated;
      return {
        ...stripped,
        creator_id: user.id,
        created_at: now,
        updated_by: user.id,
        updated_at: now,
        is_deprecated: isDeprecated,
        ...(isDeprecated ? { deprecated_by: user.id, deprecated_at: now } : {}),
      };
    }),
  }));
  const rewrittenData = { ...data, sheets: rewrittenSheets };
  const dataJson = JSON.stringify(rewrittenData);

  // owner_id：private 时为创建者；public 不绑定 owner
  const ownerId = visibility === 'private' ? user.id : null;

  // BEGIN IMMEDIATE 立即拿写锁，避免两个并发创建打架
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO canvases
           (name, description, visibility, is_public_to_guest, owner_id, data, version,
            created_by, created_at, updated_by, updated_at, archived)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0)`
      )
      .run(
        name,
        description ?? null,
        visibility,
        is_public_to_guest ? 1 : 0,
        ownerId,
        dataJson,
        user.id,
        now,
        user.id,
        now
      );
    const canvasId = Number(result.lastInsertRowid);

    // 初始版本快照
    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, 1, ?, ?, ?)`
    ).run(canvasId, dataJson, user.id, now);

    // 为初始 data 中所有节点写 nodes_meta（方案 §3.1 v4 修订关键步骤）
    // P3C codex 必修 3：is_deprecated=true 的节点要把 by/at 也写入，
    // 否则下次 GET hydrate 时 meta 是 false 会让 data 的废弃状态被覆盖。
    const insertMetaUndeprecated = db.prepare(
      `INSERT INTO nodes_meta
         (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
          is_deprecated, deprecated_by, deprecated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`
    );
    const insertMetaDeprecated = db.prepare(
      `INSERT INTO nodes_meta
         (canvas_id, sheet_id, node_id, creator_id, created_at, updated_by, updated_at,
          is_deprecated, deprecated_by, deprecated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    for (const sheet of rewrittenSheets) {
      for (const node of sheet.nodes) {
        // node.id 来自 ...rest 透传（rawNode 必有 id），TS 推不出来需双断言
        const nodeId = (node as unknown as { id: string }).id;
        if (node.is_deprecated) {
          insertMetaDeprecated.run(
            canvasId, sheet.id, nodeId, user.id, now, user.id, now, user.id, now
          );
        } else {
          insertMetaUndeprecated.run(
            canvasId, sheet.id, nodeId, user.id, now, user.id, now
          );
        }
      }
    }

    return canvasId;
  });

  // .immediate() 走 BEGIN IMMEDIATE（立即拿写锁），避免两个并发创建竞态
  const canvasId = tx.immediate();
  return { id: canvasId, version: 1 };
}

// =====================================================================
// 保存（情况 1：无并发版；后续阶段 5 加合并算法）
// =====================================================================

export interface SaveCanvasInput {
  id: number;
  baseVersion: number;
  data: MultiCanvasProjectInput;
  user: UserPublic;
}

export type SaveCanvasResult =
  | { ok: true; version: number; merged: false }
  // 阶段 5 Day 2 阶段 C 起：合并成功路径（baseVersion < currentVersion，detector 全空，applyDelta ok:true）
  // mergedData 是 rewriteNodesFromMeta 后的版本，与主表持久化完全一致（codex 阶段 C 取舍审隐藏判断点 5）
  | { ok: true; version: number; merged: true; mergedData: MultiCanvasProjectShape;
      mergedFromVersion: number; report: MergeReport }
  // 情况 3：基础冲突 —— 阶段 C 起 conflicts 由 tryMerge 真实产出（detector 4 段 + applyDelta active_sheet_missing）
  | { ok: false; status: 409; error: 'conflict'; currentVersion: number; conflicts?: Conflict[] }
  // 阶段 5 D1 新增：客户端 baseVersion 太旧（canvas_versions 已被清理或从未存在）
  // → 客户端必须 GET 最新画布重载，drafts 仍保留
  | { ok: false; status: 409; error: 'base_version_expired'; currentVersion: number }
  | { ok: false; status: 409; error: 'node_id_collision'; currentVersion: number }
  | { ok: false; status: 409; error: 'node_meta_missing'; currentVersion: number }
  | { ok: false; status: 403; error: 'forbidden_modify_others_node'; message: string; currentVersion: number }
  // §5.7 修订：删除规则按画布 visibility 区分
  // - public：仅 admin 能删（普通用户对任何节点都禁删，含自己创建的，应使用"标废弃"）
  // - private：admin + owner 都能删
  | { ok: false; status: 403; error: 'forbidden_remove_node'; message: string; currentVersion: number };

/**
 * 保存画布（方案 §5.2 情况 1 + §5.7 节点级权限严格化）：
 * - baseVersion == currentVersion → 直接保存为 currentVersion+1
 * - 不一致 → 返回 409 让前端走"看对方版本/覆盖"路径
 *
 * 同事务内（§5.7 阶段 3 严格化版本）：
 * 1. SELECT 当前 version + data
 * 2. 比 baseVersion；不等返 409
 * 3. **计算 deltaB**：按 (sheet_id, node_id) 比对当前服务端 data vs incoming data
 *    · added: 新增节点（服务端没有）
 *    · removed: 物理删除节点（服务端有但客户端没有）
 *    · modified: 节点内容变了（不只是 is_deprecated）
 *    · deprecated_changed: 仅 is_deprecated false→true 的"标废弃"变化
 * 4. **权限校验**（按 §5.7 规则）：
 *    · added → INSERT nodes_meta，creator = 当前用户
 *    · modified → 校验 creator == 当前用户 OR admin；否则 403
 *    · deprecated_changed → 任何登录用户允许（标废弃是公开权限）
 *    · removed → 按 visibility 区分：public 仅 admin / private admin+owner；否则 403
 *      （§5.7 修订：private 画布仅 owner 能看见且能改，让 owner 能"清理"自己节点是合理的；
 *       public 画布所有人都能看，普通用户不能物理删除别人或自己的节点 —— 用"标废弃"代替）
 * 5. **重写 data 的节点元字段**：服务端从 nodes_meta 强制覆写客户端传的 creator/updated 等字段
 * 6. UPDATE canvases.data + version=v+1
 * 7. INSERT canvas_versions 新快照
 *
 * v2.1 阶段加完整合并算法（§5.6）
 */
type StorageNode = {
  id: string;
  creator_id?: number | null;
  creator_username?: string | null;
  created_at?: number | null;
  updated_by?: number | null;
  updated_at?: number | null;
  is_deprecated?: boolean;
  deprecated_by?: number | null;
  deprecated_at?: number | null;
  deprecated_by_username?: string | null;
  [key: string]: unknown;
};
type StorageSheet = { id: string; nodes: StorageNode[]; [key: string]: unknown };
type NodeMetaRow = {
  node_id: string;
  sheet_id: string;
  creator_id: number;
  created_at: number;
  updated_by: number;
  updated_at: number;
  is_deprecated: number;
  deprecated_by: number | null;
  deprecated_at: number | null;
};

// ============================================================
// P3D-1 codex 必修 1：拆分两个 strip helper
// ============================================================
//
// 不能用同一个 strip 函数兼顾"内容比对/hydrate"和"save 输入清理"两个场景：
// - 内容比对 + GET hydrate 时：要 strip 所有元字段
//   （creator_id/created_at/updated_by/updated_at/is_deprecated/deprecated_*
//   /creator_username/deprecated_by_username），因为这些都该以 nodes_meta
//   为准，不应进入 content diff，hydrate 输出也要先剥后注入。
// - save 输入清理（saveCanvas/createCanvas rewrite 前）时：要 strip
//   creator/updated/deprecated_by/at/username 但保留 is_deprecated，因为
//   saveCanvas 的 deltaB 计算依赖客户端传 is_deprecated 来判定
//   false to true 的"标废弃"动作（P3C 已实现的核心信号），strip 掉它会
//   让标废弃功能整个回归。
//
// 命名：
// - stripHydratedNodeMetaForCompareOrHydrate：所有 meta 都 strip
// - stripServerAttributionForSaveInput：保留 is_deprecated，strip 其他归属

/** 用于 hydrate 输出 + content 比对：strip 所有 meta（含 is_deprecated） */
function stripHydratedNodeMetaForCompareOrHydrate(n: StorageNode): Record<string, unknown> {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    creator_id,
    creator_username,
    created_at,
    updated_by,
    updated_at,
    is_deprecated,
    deprecated_by,
    deprecated_at,
    deprecated_by_username,
    ...rest
  } = n;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return rest;
}

/** 用于 save/create 输入清理：strip 服务端独占的归属字段，**保留 is_deprecated**
 *
 * 关键不变量：is_deprecated 是客户端 → 服务端的"标废弃信号"，必须保留以驱动 deltaB；
 * 但 deprecated_by/at/username + creator/updated 全是服务端独占，客户端伪造无效。 */
function stripServerAttributionForSaveInput(n: StorageNode): StorageNode {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    creator_id,
    creator_username,
    created_at,
    updated_by,
    updated_at,
    deprecated_by,
    deprecated_at,
    deprecated_by_username,
    ...rest
  } = n;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return rest as StorageNode;
}

export function saveCanvas(input: SaveCanvasInput): SaveCanvasResult {
  const db = getDb();
  const { id, baseVersion, data, user } = input;
  const now = Date.now();

  const tx = db.transaction((): SaveCanvasResult => {
    // 1. 取当前画布（version + data + visibility + owner_id）
    // §5.7 修订：visibility/owner_id 用于 removed 规则区分（private owner 能删 / public 仅 admin）
    const row = db.prepare(
      'SELECT version, data, visibility, owner_id FROM canvases WHERE id = ?'
    ).get(id) as
      | { version: number; data: string; visibility: Visibility; owner_id: number | null }
      | undefined;
    if (!row) {
      throw new Error('canvas_not_found');
    }
    // 2. 版本分支（阶段 5 Day 1 改造）
    //
    // - baseVersion > currentVersion：客户端伪造（不可能从 GET 拿到比当前还新的版本）→ 409 conflict
    // - baseVersion === currentVersion：情况 1 无并发 → 走原有快速路径（直接写）
    // - baseVersion < currentVersion：情况 2/3 有并发 → 走合并算法（Day 2 实现）
    //
    // Day 1 阶段：合并路径仅做"取 baseData → 找不到则返 base_version_expired；
    // 找到则返 conflict 等同情况 3 stub"。Day 2 起接入 detectNodeConflicts /
    // detectEdgeConflicts / applyDelta，转为真合并 / 真冲突两分支。
    if (baseVersion > row.version) {
      return {
        ok: false,
        status: 409,
        error: 'conflict',
        currentVersion: row.version,
      };
    }
    if (baseVersion < row.version) {
      // 情况 2/3：取 baseData 走合并算法（阶段 5 Day 2 阶段 C 接入）
      //
      // 实施流程（取舍审 10-阶段C-取舍审-saveCanvas接合并.md 已固化）：
      //  1. SELECT baseSnapshot —— 找不到 → base_version_expired
      //  2. SELECT canvas_versions(version=row.version) JOIN users 取 currentVersionAuthor
      //     （codex 修订：不能用 canvases.updated_by，元信息 PATCH/publish 会改脏；只有 canvas_versions.saved_by
      //     才是当前 data version 的真实保存者）
      //  3. 三方 asProjectShape + saveCanvas 独立 computeDelta(baseData, incomingData) 拿 deltaB
      //     （codex high 风险吸收：tryMerge 内部也会 computeDelta 一次但不外传，避免 deltaB 漂移破坏 G4）
      //  4. validateDeltaBPermissions —— 先权限（403/409 节点级先于 409 合并冲突；medium 风险吸收）
      //  5. tryMerge —— ok:false 透传 conflicts；ok:true 拿 mergedData + report
      //  6. ok:true → metaIndex + rewriteNodesFromMeta(mergedData, deltaB, ...) → UPDATE + INSERT version + syncMeta
      //  7. DataIntegrityError 不 catch，让事务回滚后透传给 route 层映射 500 + 'data_integrity_error'
      // 取当前版本保存者（Day 3 取舍审 medium 风险吸收 + 隐藏判断 #2：
      // 提到 baseSnapshot 检查之前，让 base_version_expired 路径也能拿 user_a_id 写 conflict_logs；
      // codex 修订 #2 #3：用 canvas_versions.saved_by 不用 canvases.updated_by）
      const currentVersionAuthor = db
        .prepare(
          `SELECT cv.saved_by AS userId, u.username AS username
             FROM canvas_versions cv
             LEFT JOIN users u ON u.id = cv.saved_by
            WHERE cv.canvas_id = ? AND cv.version = ?`
        )
        .get(id, row.version) as
        | { userId: number; username: string | null }
        | undefined;
      if (!currentVersionAuthor) {
        // canvas_versions(version=row.version) 缺失 —— canvas_versions.saved_by NOT NULL（migration 0001）
        // 同事务 saveCanvas/createCanvas 都会写 version。此处缺失说明 DB 损坏（手工修 / 迁移漏写）
        // 不静默 fallback，按 DataIntegrityError 抛让 route 层映射 500
        throw new DataIntegrityError(
          `canvas ${id} current version ${row.version} missing in canvas_versions`,
          `saveCanvas merge path`
        );
      }

      // 取 baseVersion 快照（在 currentVersionAuthor 之后，让 base_version_expired 路径已能拿 user_a_id）
      const baseSnapshot = db
        .prepare(
          'SELECT data FROM canvas_versions WHERE canvas_id = ? AND version = ?'
        )
        .get(id, baseVersion) as { data: string } | undefined;
      if (!baseSnapshot) {
        // canvas_versions 找不到 baseVersion 快照（被清理 / 从未存在）
        // → 客户端必须 GET 重载（drafts 保留）
        // Day 3 D-2：写 conflict_logs（无 debugDelta —— 没 baseSnapshot 不能 computeDelta）
        logConflictResolution(db, {
          canvasId: id,
          userAId: currentVersionAuthor.userId,
          userBId: user.id,
          baseVersion,
          currentVersion: row.version,
          resolution: 'base_version_expired',
        });
        return {
          ok: false,
          status: 409,
          error: 'base_version_expired',
          currentVersion: row.version,
        };
      }

      // 三方数据 parse（不预 strip — codex 判断点 1：computeDelta 内部已 strip）
      const baseProject = asProjectShape(JSON.parse(baseSnapshot.data));
      const currentProject = asProjectShape(JSON.parse(row.data));
      const incomingProject = asProjectShape(data);

      // saveCanvas 独立持有 deltaB（codex high 风险吸收：tryMerge 内部 deltaB 不外传，避免漂移）
      const deltaB = computeDelta(baseProject, incomingProject);

      // 先权限（codex medium 风险吸收：403/409 节点级先于 409 合并冲突）
      try {
        validateDeltaBPermissions(db, id, deltaB, user, row.visibility, row.owner_id);
      } catch (e) {
        if (e instanceof PermissionError) {
          if (e.code === 'node_id_collision') {
            return { ok: false, status: 409, error: 'node_id_collision', currentVersion: row.version };
          }
          if (e.code === 'node_meta_missing') {
            return { ok: false, status: 409, error: 'node_meta_missing', currentVersion: row.version };
          }
          if (e.code === 'forbidden_modify_others_node') {
            return {
              ok: false,
              status: 403,
              error: 'forbidden_modify_others_node',
              message: e.detail ?? e.message,
              currentVersion: row.version,
            };
          }
          // forbidden_remove_node
          return {
            ok: false,
            status: 403,
            error: 'forbidden_remove_node',
            message: e.detail ?? e.message,
            currentVersion: row.version,
          };
        }
        throw e;
      }

      // 调 tryMerge（includeDebugDelta=true — Day 3 取舍审判断点 10：与 conflict_logs.details 链路对齐）
      // mergeResult.debugDelta 含 deltaA/deltaB（tryMerge 内部 computeDelta×2）；conflict_logs 写入路径序列化使用
      const mergeResult = tryMerge({
        baseData: baseProject,
        currentData: currentProject,
        incomingData: incomingProject,
        ctx: {
          userA: currentVersionAuthor.userId,
          userB: user.id,
          visibility: row.visibility,
        },
        currentVersion: row.version,
        mergedFromUserId: currentVersionAuthor.userId,
        mergedFromUsername: currentVersionAuthor.username,
        includeDebugDelta: true,
      });

      if (!mergeResult.ok) {
        // 真冲突（detector 4 段 + applyDelta active_sheet_missing 透传）
        // codex 隐藏判断点 7 + 9：error='conflict' + conflicts 数组；不携带 warnings
        // Day 3 D-2：写 conflict_logs（含 debugDelta —— tryMerge includeDebugDelta=true 已开）
        logConflictResolution(db, {
          canvasId: id,
          userAId: currentVersionAuthor.userId,
          userBId: user.id,
          baseVersion,
          currentVersion: row.version,
          resolution: 'conflict',
          conflicts: mergeResult.conflicts,
          debugDelta: mergeResult.debugDelta,
        });
        return {
          ok: false,
          status: 409,
          error: 'conflict',
          currentVersion: row.version,
          conflicts: mergeResult.conflicts,
        };
      }

      // 合并成功 → rewrite + 写主表 + 写版本 + sync meta（与快速路径同款顺序）
      const allMetaRows = db.prepare(
        `SELECT node_id, sheet_id, creator_id, created_at, updated_by, updated_at,
                is_deprecated, deprecated_by, deprecated_at
         FROM nodes_meta WHERE canvas_id=?`
      ).all(id) as NodeMetaRow[];
      const metaIndex = new Map<string, NodeMetaRow>();
      for (const m of allMetaRows) {
        metaIndex.set(`${m.sheet_id}|${m.node_id}`, m);
      }
      // codex 判断点 10：rewrite(mergedData, deltaB, ...) — 用 deltaB 驱动归属写入；与快速路径一致
      const rewrittenData = rewriteNodesFromMeta(
        mergeResult.mergedData,
        deltaB,
        metaIndex,
        user,
        now
      );
      const dataJson = JSON.stringify(rewrittenData);
      const newVersion = row.version + 1;

      db.prepare(
        `UPDATE canvases
           SET data = ?, version = ?, updated_by = ?, updated_at = ?
         WHERE id = ?`
      ).run(dataJson, newVersion, user.id, now, id);

      // codex 判断点 11：saved_by = user.id (B 触发保存)；A 单独记 mergeReport.mergedFromUserId
      db.prepare(
        `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, newVersion, dataJson, user.id, now);

      // codex 隐藏判断点 8：合并成功路径必须复用 syncNodesMetaFromDeltaB（B 删 sheet 时 annotations 同事务清理）
      syncNodesMetaFromDeltaB(db, id, deltaB, user, now);

      // Day 3 D-2：写 conflict_logs auto_merged（含 report + debugDelta）
      logConflictResolution(db, {
        canvasId: id,
        userAId: currentVersionAuthor.userId,
        userBId: user.id,
        baseVersion,
        currentVersion: row.version,
        resolution: 'auto_merged',
        report: mergeResult.report,
        debugDelta: mergeResult.debugDelta,
      });

      return {
        ok: true,
        version: newVersion,
        merged: true,
        mergedData: rewrittenData,
        mergedFromVersion: row.version,
        report: mergeResult.report,
      };
    }
    // baseVersion === row.version：情况 1，走快速路径
    //
    // 阶段 5 Day 2 重构（D5 helper 提取）：
    // - 数组 delta（added/removed/modified/deprecatedChanged）改用 Day 1 computeDelta 输出 Delta 形态
    // - 副作用提取为 helpers：validateDeltaBPermissions / rewriteNodesFromMeta / syncNodesMetaFromDeltaB
    // - 分支 2（合并路径）将复用同一组 helper，避免两套副作用漂移
    //
    // 注：computeDelta 入口先调 assertProjectIntegrity 双向，可能抛 DataIntegrityError；
    // 当前情况 1 入口不应触发（DB baseData 已通过早先 schema 校验，incoming 也已通过 schema）。
    // saveCanvas **不**捕获 DataIntegrityError —— 让它直接向上传播给 caller（routes/canvases.ts PUT），
    // 由 route 层统一映射 500 + data_integrity_error（与普通 save_failed 区分）。
    const baseProject = asProjectShape(JSON.parse(row.data));
    const incomingProject = asProjectShape(data);
    const deltaB = computeDelta(baseProject, incomingProject);

    // 4. 权限校验（§5.7）—— 复用 helper（validateDeltaBPermissions）
    // helper 抛 PermissionError，本函数 catch 后映射到 SaveCanvasResult 错误码
    try {
      validateDeltaBPermissions(db, id, deltaB, user, row.visibility, row.owner_id);
    } catch (e) {
      if (e instanceof PermissionError) {
        if (e.code === 'node_id_collision') {
          return { ok: false, status: 409, error: 'node_id_collision', currentVersion: row.version };
        }
        if (e.code === 'node_meta_missing') {
          return { ok: false, status: 409, error: 'node_meta_missing', currentVersion: row.version };
        }
        if (e.code === 'forbidden_modify_others_node') {
          return {
            ok: false,
            status: 403,
            error: 'forbidden_modify_others_node',
            message: e.detail ?? e.message,
            currentVersion: row.version,
          };
        }
        // forbidden_remove_node
        return {
          ok: false,
          status: 403,
          error: 'forbidden_remove_node',
          message: e.detail ?? e.message,
          currentVersion: row.version,
        };
      }
      throw e;
    }

    // 5. 服务端从 nodes_meta 重写 incoming data 的元字段（防客户端篡改）—— 复用 helper
    //
    // 写顺序保持：rewrite → UPDATE canvases.data → 同步 nodes_meta（步骤 8）。
    // rewrite 时本次 deprecatedChanged/alsoDeprecated 的节点直接用 user.id+now 写 deprecated_by/at
    // （不能读旧 meta，旧 meta 是 null）。
    const allMetaRows = db.prepare(
      `SELECT node_id, sheet_id, creator_id, created_at, updated_by, updated_at,
              is_deprecated, deprecated_by, deprecated_at
       FROM nodes_meta WHERE canvas_id=?`
    ).all(id) as NodeMetaRow[];
    const metaIndex = new Map<string, NodeMetaRow>();
    for (const m of allMetaRows) {
      metaIndex.set(`${m.sheet_id}|${m.node_id}`, m);
    }
    const rewrittenData = rewriteNodesFromMeta(incomingProject, deltaB, metaIndex, user, now);
    const dataJson = JSON.stringify(rewrittenData);

    const newVersion = row.version + 1;

    // 6. 写主表
    db.prepare(
      `UPDATE canvases
         SET data = ?, version = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(dataJson, newVersion, user.id, now, id);

    // 7. 追加版本快照
    db.prepare(
      `INSERT INTO canvas_versions (canvas_id, version, data, saved_by, saved_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, newVersion, dataJson, user.id, now);

    // 8. 同步 nodes_meta + 删除被物删节点的 annotations —— 复用 helper
    syncNodesMetaFromDeltaB(db, id, deltaB, user, now);

    return { ok: true, version: newVersion, merged: false };
  });

  return tx.immediate();
}

// =====================================================================
// PATCH 元信息
// =====================================================================

export interface PatchCanvasInput {
  id: number;
  patch: {
    name?: string;
    description?: string;
    is_public_to_guest?: boolean;
    archived?: boolean;
    owner_id?: number | null;
  };
  user: UserPublic;
}

export function patchCanvasMeta(input: PatchCanvasInput): void {
  const db = getDb();
  const { id, patch, user } = input;
  const now = Date.now();

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    vals.push(patch.description);
  }
  if (patch.is_public_to_guest !== undefined) {
    sets.push('is_public_to_guest = ?');
    vals.push(patch.is_public_to_guest ? 1 : 0);
  }
  if (patch.archived !== undefined) {
    sets.push('archived = ?');
    vals.push(patch.archived ? 1 : 0);
  }
  if (patch.owner_id !== undefined) {
    sets.push('owner_id = ?');
    vals.push(patch.owner_id);
  }

  if (sets.length === 0) return; // no-op patch

  sets.push('updated_by = ?', 'updated_at = ?');
  vals.push(user.id, now);
  vals.push(id);

  db.prepare(`UPDATE canvases SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

// =====================================================================
// DELETE（归档）
// =====================================================================

/** 软删（archived=1）。彻底物理删需 admin 在管理后台另行操作（§9.4） */
export function archiveCanvas(id: number, user: UserPublic): void {
  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE canvases SET archived = 1, updated_by = ?, updated_at = ? WHERE id = ?`
    )
    .run(user.id, now, id);
}

// =====================================================================
// P3G 公共画布发布有摩擦治理
// =====================================================================
//
// 规则文档：[01-取舍审查-P3G](../../docs/规划/codex审查记录/阶段3/P3G/01-取舍审查-P3G-公共画布发布治理.md)
//
// 核心不变量：
// - publish 仅允许 visibility='private' && archived=0；状态错返 already_public/archived_canvas
// - unpublish 仅允许 visibility='public' && archived=0；状态错返 already_private/archived_canvas
// - publish/unpublish 都**不动 owner_id**（codex 审 #1：保留发布前归属，避免悄悄夺权）
// - publish 默认 is_public_to_guest=0（codex 审 #8：避免发布同时误开游客）
// - 历史 public 已在 migration 0003 回填 published_*，前端不需要兜底"无发布记录"分支

export type PublishCanvasResult =
  | { ok: true }
  | { ok: false; status: 409; error: 'already_public' | 'archived_canvas' }
  | { ok: false; status: 404; error: 'not_found' };

export type UnpublishCanvasResult =
  | { ok: true }
  | { ok: false; status: 409; error: 'already_private' | 'archived_canvas' }
  | { ok: false; status: 404; error: 'not_found' };

/**
 * 发布画布（private → public）。
 *
 * 单事务：BEGIN IMMEDIATE 拿写锁 → SELECT 当前态校验 → UPDATE。
 * 不使用 nodes_meta / canvas_versions（发布只改元信息不改 data）。
 *
 * publish 后：visibility='public' / published_at=now / published_by=user.id /
 *   published_note=note / is_public_to_guest=0（强制重置，admin 后续单独 PATCH 勾选）/
 *   updated_by=user.id / updated_at=now
 * 不动：owner_id / data / version / unpublished_at / unpublished_by
 *   （unpublished_* 保留，作为"上一次撤回"的历史；下一次 publish 不清空它）
 */
export function publishCanvas(input: {
  id: number;
  note: string;
  user: UserPublic;
}): PublishCanvasResult {
  const db = getDb();
  const { id, note, user } = input;
  const now = Date.now();

  const tx = db.transaction((): PublishCanvasResult => {
    const row = db
      .prepare('SELECT visibility, archived FROM canvases WHERE id = ?')
      .get(id) as { visibility: Visibility; archived: number } | undefined;
    if (!row) {
      return { ok: false, status: 404, error: 'not_found' };
    }
    if (row.archived === 1) {
      return { ok: false, status: 409, error: 'archived_canvas' };
    }
    if (row.visibility === 'public') {
      return { ok: false, status: 409, error: 'already_public' };
    }
    db.prepare(
      `UPDATE canvases
         SET visibility = 'public',
             is_public_to_guest = 0,
             published_at = ?,
             published_by = ?,
             published_note = ?,
             updated_by = ?,
             updated_at = ?
       WHERE id = ?`
    ).run(now, user.id, note, user.id, now, id);
    return { ok: true };
  });

  return tx.immediate();
}

/**
 * 撤回画布（public → private）。
 *
 * 单事务：BEGIN IMMEDIATE → SELECT 当前态校验 → UPDATE。
 *
 * unpublish 后：visibility='private' / unpublished_at=now / unpublished_by=user.id /
 *   updated_by=user.id / updated_at=now
 * 不动：owner_id（codex 审 #1：保留发布前归属，避免悄悄夺权——若原本是普通用户的私有画布
 *   被 admin 发布后撤回，原 owner 仍能看到）/ published_at/by/note（"最近一次发布"语义保留）/
 *   is_public_to_guest（保留旧值即可，下次 publish 时会被强制重置为 0）
 */
export function unpublishCanvas(input: {
  id: number;
  user: UserPublic;
}): UnpublishCanvasResult {
  const db = getDb();
  const { id, user } = input;
  const now = Date.now();

  const tx = db.transaction((): UnpublishCanvasResult => {
    const row = db
      .prepare('SELECT visibility, archived FROM canvases WHERE id = ?')
      .get(id) as { visibility: Visibility; archived: number } | undefined;
    if (!row) {
      return { ok: false, status: 404, error: 'not_found' };
    }
    if (row.archived === 1) {
      return { ok: false, status: 409, error: 'archived_canvas' };
    }
    if (row.visibility === 'private') {
      return { ok: false, status: 409, error: 'already_private' };
    }
    db.prepare(
      `UPDATE canvases
         SET visibility = 'private',
             unpublished_at = ?,
             unpublished_by = ?,
             updated_by = ?,
             updated_at = ?
       WHERE id = ?`
    ).run(now, user.id, user.id, now, id);
    return { ok: true };
  });

  return tx.immediate();
}
