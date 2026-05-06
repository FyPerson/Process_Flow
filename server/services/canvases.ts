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
  // 阶段 4 P4C：列表页"X 人在编辑"角标；route 层注入（route 拿不到 user 时为 0）
  // 该字段不在 toListItem service 里产生，由 GET /api/canvases route 批量注入
  activeEditors?: number;
}

function toListItem(row: CanvasRow): CanvasListItem {
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
  };
}

// =====================================================================
// 列表
// =====================================================================

/** 游客可见：仅 public + is_public_to_guest=1 + 未归档 */
export function listCanvasesForGuest(): CanvasListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM canvases
       WHERE visibility = 'public' AND is_public_to_guest = 1 AND archived = 0
       ORDER BY updated_at DESC`
    )
    .all() as CanvasRow[];
  return rows.map(toListItem);
}

/** 登录用户可见：所有 public（无论 guest 标记）+ 自己 owner 的 private + 未归档 */
export function listCanvasesForUser(userId: number): CanvasListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM canvases
       WHERE archived = 0
         AND (visibility = 'public' OR (visibility = 'private' AND owner_id = ?))
       ORDER BY updated_at DESC`
    )
    .all(userId) as CanvasRow[];
  return rows.map(toListItem);
}

/** admin：能看所有非归档 */
export function listCanvasesForAdmin(): CanvasListItem[] {
  const rows = getDb()
    .prepare(`SELECT * FROM canvases WHERE archived = 0 ORDER BY updated_at DESC`)
    .all() as CanvasRow[];
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
  | { ok: false; status: 409; error: 'conflict'; currentVersion: number }
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

/** key-order 无关的 deep equal，等价于 JSON 序列化语义：
 * - 跳过 value === undefined 的 key（JSON.stringify 会丢，必须忽略）
 * - 不依赖键插入顺序
 * - 仅支持 JSON-safe 值（原始 / 数组 / 普通对象）
 *
 * 这是 P2H 期间踩过的坑：JSON.stringify 比较对象时，两端 key 顺序可能不同（V8 引擎里
 * 字段添加顺序、解析顺序、property descriptor 都会影响）→ 同样语义的对象 stringify 结果
 * 字面不等 → 误判 modified。
 */
function deepEqualJsonShape(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualJsonShape(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // 收集"实际有值"（非 undefined）的 key
  const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (bo[k] === undefined) return false;
    if (!deepEqualJsonShape(ao[k], bo[k])) return false;
  }
  return true;
}

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

/** 节点 storage 内容比对 —— 用 key-order 无关的 deepEqual，避免误判 modified */
function nodeContentEquals(a: StorageNode, b: StorageNode): boolean {
  return deepEqualJsonShape(
    stripHydratedNodeMetaForCompareOrHydrate(a),
    stripHydratedNodeMetaForCompareOrHydrate(b)
  );
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
    // 2. 版本对齐
    if (row.version !== baseVersion) {
      return {
        ok: false,
        status: 409,
        error: 'conflict',
        currentVersion: row.version,
      };
    }

    // 3. 计算 deltaB（按 sheet+node 复合 ID）
    const baseData = JSON.parse(row.data) as { sheets: StorageSheet[] };
    const incomingData = data as unknown as { sheets: StorageSheet[] };

    // 索引：(sheetId|nodeId) → node
    const baseIndex = new Map<string, { sheetId: string; node: StorageNode }>();
    for (const sheet of baseData.sheets) {
      for (const node of sheet.nodes) {
        baseIndex.set(`${sheet.id}|${node.id}`, { sheetId: sheet.id, node });
      }
    }
    const incomingIndex = new Map<string, { sheetId: string; node: StorageNode }>();
    for (const sheet of incomingData.sheets) {
      for (const node of sheet.nodes) {
        incomingIndex.set(`${sheet.id}|${node.id}`, { sheetId: sheet.id, node });
      }
    }

    const added: Array<{ sheetId: string; node: StorageNode }> = [];
    const removed: Array<{ sheetId: string; node: StorageNode }> = [];
    // modified 增加 alsoDeprecated 标志：content 变 + 同时 is_deprecated false→true 的节点
    // 防止"用户同时改内容 + 标废弃"时 deprecated 信号被吞（codex 必修 #2）
    const modified: Array<{ sheetId: string; node: StorageNode; baseNode: StorageNode; alsoDeprecated: boolean }> = [];
    const deprecatedChanged: Array<{ sheetId: string; node: StorageNode; baseNode: StorageNode }> = [];

    for (const [key, { sheetId, node }] of incomingIndex) {
      const baseEntry = baseIndex.get(key);
      if (!baseEntry) {
        added.push({ sheetId, node });
      } else {
        const baseNode = baseEntry.node;
        const baseDep = !!baseNode.is_deprecated;
        const newDep = !!node.is_deprecated;
        const contentSame = nodeContentEquals(baseNode, node);
        if (contentSame && baseDep === newDep) {
          // 完全一样
          continue;
        }
        // 检查是否仅 is_deprecated 变化（content 没变 + dep false→true）
        if (contentSame && !baseDep && newDep) {
          deprecatedChanged.push({ sheetId, node, baseNode });
        } else {
          // content 变（可能也同时 dep 变）
          // alsoDeprecated: content 变了，但 dep 也从 false→true（content+deprecated 同步）
          const alsoDeprecated = !contentSame && !baseDep && newDep;
          modified.push({ sheetId, node, baseNode, alsoDeprecated });
        }
      }
    }
    for (const [key, { sheetId, node }] of baseIndex) {
      if (!incomingIndex.has(key)) {
        removed.push({ sheetId, node });
      }
    }

    // 4. 权限校验（§5.7）
    const isAdmin = user.role === 'admin';

    // 4.1 added：检查 nodes_meta 没记录（防 ID 撞车）
    const checkMeta = db.prepare(
      `SELECT creator_id FROM nodes_meta WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    for (const { sheetId, node } of added) {
      const existing = checkMeta.get(id, sheetId, node.id) as { creator_id: number } | undefined;
      if (existing) {
        // ID 撞车 —— 数据完整性问题
        return {
          ok: false,
          status: 409,
          error: 'node_id_collision',
          currentVersion: row.version,
        };
      }
    }

    // 4.2 modified：校验 creator == 当前用户 OR admin
    for (const { sheetId, node } of modified) {
      const meta = checkMeta.get(id, sheetId, node.id) as { creator_id: number } | undefined;
      if (!meta) {
        // 节点在 incoming 里有但 nodes_meta 没记录 —— 数据不一致
        return {
          ok: false,
          status: 409,
          error: 'node_meta_missing',
          currentVersion: row.version,
        };
      }
      if (meta.creator_id !== user.id && !isAdmin) {
        return {
          ok: false,
          status: 403,
          error: 'forbidden_modify_others_node',
          // 给 caller 一个能定位的信息
          message: `cannot modify node ${node.id} created by user ${meta.creator_id}`,
          currentVersion: row.version,
        };
      }
    }

    // 4.3 deprecated_changed：检 meta 缺失（codex 建议项）
    // 标废弃也是写操作，节点必须在 nodes_meta 里有记录
    for (const { sheetId, node } of deprecatedChanged) {
      const meta = checkMeta.get(id, sheetId, node.id) as { creator_id: number } | undefined;
      if (!meta) {
        return {
          ok: false,
          status: 409,
          error: 'node_meta_missing',
          currentVersion: row.version,
        };
      }
      // 不校验 creator —— 标废弃是公开权限
    }

    // 4.4 removed：按 visibility 区分（§5.7 修订）
    // - admin：任何画布都允许
    // - private 画布 owner：允许（私有空间，owner 想清理自己节点合理）
    // - 其他（public 普通用户 / 非 owner private 用户）：禁，必须用"标废弃"
    if (removed.length > 0) {
      const isPrivateOwner = row.visibility === 'private' && row.owner_id === user.id;
      if (!isAdmin && !isPrivateOwner) {
        return {
          ok: false,
          status: 403,
          error: 'forbidden_remove_node',
          message:
            row.visibility === 'public'
              ? `cannot remove ${removed.length} node(s) on public canvas; only admin can physically delete (use deprecate instead)`
              : `cannot remove ${removed.length} node(s); only admin or canvas owner can physically delete`,
          currentVersion: row.version,
        };
      }
    }

    // 4.4 deprecated_changed：任何登录用户都允许（公开权限）—— 不需校验

    // 5. 服务端从 nodes_meta 重写 incoming data 的元字段（防客户端篡改）
    //
    // P3C codex 必修 2（save rewrite 时序）：本次 deprecatedChanged / alsoDeprecated 的节点
    // 必须用 user.id + now 显式写 deprecated_by/at —— **不能读旧 meta**（旧 meta 是 null）。
    // 写顺序：rewrite → UPDATE canvases.data → UPDATE nodes_meta（步骤 8）。
    // 如果在 rewrite 之后再 UPDATE nodes_meta、再回头 hydrate，rewrite 拿到的 by/at 仍是 null。
    // 所以 rewrite 时直接用 user.id + now 即可（与步骤 8 写入的值一致）。
    //
    // 一次性查所有相关 nodes_meta
    const allMetaRows = db.prepare(
      `SELECT node_id, sheet_id, creator_id, created_at, updated_by, updated_at,
              is_deprecated, deprecated_by, deprecated_at
       FROM nodes_meta WHERE canvas_id=?`
    ).all(id) as NodeMetaRow[];
    const metaIndex = new Map<string, NodeMetaRow>();
    for (const m of allMetaRows) {
      metaIndex.set(`${m.sheet_id}|${m.node_id}`, m);
    }

    // P3C + P3D-1 codex 必修 1：strip 客户端伪造的所有服务端独占归属字段
    // （creator/updated/deprecated_by/at/username + creator_username）
    // 注：is_deprecated **不** strip —— save 流程依赖客户端传的 is_deprecated
    // 来判定 deprecated_changed / alsoDeprecated。
    // 见 stripServerAttributionForSaveInput 的 doc。

    // 逐节点重写
    const rewrittenSheets = incomingData.sheets.map((sheet) => ({
      ...sheet,
      nodes: sheet.nodes.map((rawNode) => {
        const node = stripServerAttributionForSaveInput(rawNode);
        const meta = metaIndex.get(`${sheet.id}|${node.id}`);
        if (!meta) {
          // added 节点。
          // P3C codex 必修 5：客户端可能直接传 is_deprecated=true（新建节点同时标废弃，
          // 例如导入数据 / 错误状态），此时 deprecated_by/at 必须由服务端写为 user.id+now。
          // nodes_meta 同步在步骤 8 处理。
          const isAddedDeprecated = !!node.is_deprecated;
          return {
            ...node,
            creator_id: user.id,
            created_at: now,
            updated_by: user.id,
            updated_at: now,
            is_deprecated: isAddedDeprecated,
            ...(isAddedDeprecated
              ? { deprecated_by: user.id, deprecated_at: now }
              : {}),
          };
        }
        // 已存在节点：creator/created_at 永远从表里读
        // updated_by/updated_at 在内容修改时更新（modified），标废弃不更新
        // is_deprecated：deprecated_changed 节点 + modified 节点的 alsoDeprecated 都设 true
        const modEntry = modified.find((m) => m.sheetId === sheet.id && m.node.id === node.id);
        const isModified = !!modEntry;
        const isDeprecatedChanged = deprecatedChanged.some(
          (d) => d.sheetId === sheet.id && d.node.id === node.id
        );
        const isDeprecatingNow = isDeprecatedChanged || (modEntry?.alsoDeprecated ?? false);
        const newDeprecated = isDeprecatingNow || !!meta.is_deprecated; // 已废弃节点保持已废弃

        // 废弃元信息：本次新废弃 → user.id+now；历史已废弃 → 从 meta 读；未废弃 → omit
        let deprecatedAttribution: {
          deprecated_by?: number;
          deprecated_at?: number;
        } = {};
        if (isDeprecatingNow) {
          deprecatedAttribution = { deprecated_by: user.id, deprecated_at: now };
        } else if (meta.is_deprecated && meta.deprecated_by !== null && meta.deprecated_at !== null) {
          deprecatedAttribution = {
            deprecated_by: meta.deprecated_by,
            deprecated_at: meta.deprecated_at,
          };
        }
        // 历史 is_deprecated=1 但 by/at 为 null（旧数据）→ omit by/at，前端 fallback "已废弃"

        return {
          ...node,
          creator_id: meta.creator_id,
          created_at: meta.created_at,
          updated_by: isModified ? user.id : meta.updated_by,
          updated_at: isModified ? now : meta.updated_at,
          is_deprecated: newDeprecated,
          ...deprecatedAttribution,
        };
      }),
    }));
    const rewrittenData = { ...incomingData, sheets: rewrittenSheets };
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

    // 8. 同步 nodes_meta —— 严格化版本
    // 8.1 added：INSERT
    // P3C codex 必修 5：added 节点若客户端传 is_deprecated=true（导入/迁移/错误状态），
    // INSERT 必须同事务把 is_deprecated/deprecated_by/at 一起写入，
    // 否则 nodes_meta 与 canvases.data 不一致（data 里 is_deprecated=true，meta 里 0）。
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
    for (const { sheetId, node } of added) {
      if (node.is_deprecated) {
        insertMetaDeprecated.run(id, sheetId, node.id, user.id, now, user.id, now, user.id, now);
      } else {
        insertMetaUndeprecated.run(id, sheetId, node.id, user.id, now, user.id, now);
      }
    }
    // 8.2 modified：UPDATE updated_by/updated_at
    // 如果 alsoDeprecated（content + deprecated 同时变化），同事务再 UPDATE is_deprecated
    const updateMetaModified = db.prepare(
      `UPDATE nodes_meta SET updated_by=?, updated_at=?
       WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    const updateMetaModifiedAndDeprecated = db.prepare(
      `UPDATE nodes_meta SET updated_by=?, updated_at=?,
                              is_deprecated=1, deprecated_by=?, deprecated_at=?
       WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    for (const { sheetId, node, alsoDeprecated } of modified) {
      if (alsoDeprecated) {
        updateMetaModifiedAndDeprecated.run(user.id, now, user.id, now, id, sheetId, node.id);
      } else {
        updateMetaModified.run(user.id, now, id, sheetId, node.id);
      }
    }
    // 8.3 deprecated_changed：UPDATE is_deprecated + deprecated_by/at（不动 updated_*）
    const updateMetaDeprecated = db.prepare(
      `UPDATE nodes_meta SET is_deprecated=1, deprecated_by=?, deprecated_at=?
       WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    for (const { sheetId, node } of deprecatedChanged) {
      updateMetaDeprecated.run(user.id, now, id, sheetId, node.id);
    }
    // 8.4 removed：DELETE annotations + nodes_meta（同事务）
    const deleteAnnotations = db.prepare(
      `DELETE FROM annotations WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    const deleteMeta = db.prepare(
      `DELETE FROM nodes_meta WHERE canvas_id=? AND sheet_id=? AND node_id=?`
    );
    for (const { sheetId, node } of removed) {
      deleteAnnotations.run(id, sheetId, node.id);
      deleteMeta.run(id, sheetId, node.id);
    }

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
