// /api/canvases 路由
//
// 鉴权与权限：
// - GET /api/canvases (list)：可游客（仅看 public+is_public_to_guest）；登录看更多
// - GET /api/canvases/:id：按 canRead 判定
// - POST /api/canvases：登录用户可创建 private；public 仅 admin
// - PUT /api/canvases/:id：按 canWrite 判定
// - PATCH /api/canvases/:id：name/description owner（owner 自己改），is_public_to_guest/archived 仅 admin
// - DELETE /api/canvases/:id：归档（按 canWrite）
//
// 阶段 2 暂不实现 export/import（P2F 单独写）

import { Router, type Request, type Response } from 'express';
import { optionalAuth, requireAuth, requireFreshAdmin } from '../middleware/auth.ts';
import { validateBody } from '../middleware/validate.ts';
import {
  CreateCanvasRequestSchema,
  ImportCanvasRequestSchema,
  PatchCanvasRequestSchema,
  PublishCanvasRequestSchema,
  SaveCanvasRequestSchema,
  UnpublishCanvasRequestSchema,
} from '../schemas/canvas.ts';
import {
  archiveCanvas,
  canRead,
  canWrite,
  createCanvas,
  getCanvasFull,
  getCanvasRow,
  listCanvasesForAdmin,
  listCanvasesForGuest,
  listCanvasesForUser,
  patchCanvasMeta,
  publishCanvas,
  saveCanvas,
  unpublishCanvas,
} from '../services/canvases.ts';
import { DataIntegrityError } from '../services/merge/computeDelta.ts';
import { countActiveEditorsByCanvas } from '../services/heartbeats.ts';
import type { MultiCanvasProjectInput } from '../schemas/canvas.ts';

export const canvasesRouter: Router = Router();

// =====================================================================
// GET /api/canvases —— 列表
// =====================================================================

// =====================================================================
// POST /api/canvases/import —— 导入 JSON 创建 private 画布
// （路由顺序：必须在 /:id 之前，否则 :id 会拦截 'import' 字符串）
// =====================================================================

canvasesRouter.post(
  '/api/canvases/import',
  requireAuth,
  validateBody(ImportCanvasRequestSchema),
  (req: Request, res: Response) => {
    const body = req.body as import('../schemas/canvas.ts').ImportCanvasRequest;
    const user = req.user!;

    // 导入语义"接管所有权"：visibility 锁死 private、owner = 当前用户、
    // nodes_meta.creator_id 全部归当前用户（不保留原作者）—— 方案 §3.1 v4 修订
    try {
      const result = createCanvas({
        name: body.name ?? body.data.name,
        description: body.description,
        visibility: 'private',
        is_public_to_guest: false,
        data: body.data,
        user,
      });
      res.status(201).json({ id: result.id, version: result.version });
    } catch (err) {
      res.status(500).json({ error: 'import_failed', message: (err as Error).message });
    }
  }
);

// =====================================================================
// GET /api/canvases/:id/export —— 下载 JSON 文件
// （也必须在 GET /:id 之前；Express 5 实测会按声明顺序匹配）
// =====================================================================

canvasesRouter.get(
  '/api/canvases/:id/export',
  optionalAuth,
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const row = getCanvasRow(id);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!canRead(row, req.user ?? null)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    // data 是 JSON 字符串，直接发出
    // 文件名：{name}-v{version}.json，去掉文件名里不安全的字符
    const safeName = row.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    const filename = `${safeName || 'canvas'}-v${row.version}.json`;
    // RFC 5987 filename* 支持中文，filename 给降级方案
    const encoded = encodeURIComponent(filename);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="canvas-${row.id}.json"; filename*=UTF-8''${encoded}`
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(row.data);
  }
);

canvasesRouter.get('/api/canvases', optionalAuth, (req: Request, res: Response) => {
  const user = req.user;
  let list;
  if (!user) {
    list = listCanvasesForGuest();
  } else if (user.role === 'admin') {
    list = listCanvasesForAdmin();
  } else {
    list = listCanvasesForUser(user.id);
  }

  // 阶段 4 P4C：批量注入"X 人在编辑"角标数据（codex P4 二审 #6 简化）
  // 服务端单一时钟源（判断点 6）：90s 内 last_seen_at 算活跃；客户端只展示
  // SQL 层一次性排除自己（excludeUserId）—— 比 route 层二次查 + 扣减更清晰
  if (user) {
    const countsByCanvas = countActiveEditorsByCanvas({
      canvasIds: list.map((c) => c.id),
      excludeUserId: user.id,
    });
    list = list.map((c) => ({
      ...c,
      activeEditors: countsByCanvas.get(c.id) ?? 0,
    }));
  } else {
    list = list.map((c) => ({ ...c, activeEditors: 0 }));
  }

  res.json({ canvases: list });
});

// =====================================================================
// GET /api/canvases/:id —— 单画布
// =====================================================================

canvasesRouter.get('/api/canvases/:id', optionalAuth, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  // P3C codex 必修 1：用 hydrate 版本读，从 nodes_meta + users JOIN 注入
  // is_deprecated / deprecated_by / deprecated_at / deprecated_by_username
  const row = getCanvasFull(id);
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (!canRead(row, req.user ?? null)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  res.json({
    canvas: {
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
      data: row.hydratedData as MultiCanvasProjectInput,
    },
  });
});

// =====================================================================
// POST /api/canvases —— 创建（登录用户：private；admin：可 public）
// =====================================================================

canvasesRouter.post(
  '/api/canvases',
  requireAuth,
  validateBody(CreateCanvasRequestSchema),
  (req: Request, res: Response) => {
    const body = req.body as import('../schemas/canvas.ts').CreateCanvasRequest;
    const user = req.user!;

    // P3G 规则 1（[01-取舍审查](../../docs/规划/codex审查记录/阶段3/P3G/01-取舍审查-P3G-公共画布发布治理.md)）：
    // public 只能由 admin 通过 publish 端点产生；POST /api/canvases 的 visibility=public
    // 路径**强制**关闭。schema 保留字段（避免破坏前端类型），route 强制必须 private。
    // 即使是 admin 也走"先创建 private → publish 升级"。
    if (body.visibility !== 'private') {
      res.status(403).json({
        error: 'forbidden',
        message: 'POST /api/canvases only accepts visibility=private; use POST /api/canvases/:id/publish to create public',
      });
      return;
    }

    try {
      const result = createCanvas({
        name: body.name,
        description: body.description,
        visibility: body.visibility,
        is_public_to_guest: body.is_public_to_guest,
        data: body.data,
        user,
      });
      res.status(201).json({ id: result.id, version: result.version });
    } catch (err) {
      res.status(500).json({ error: 'create_failed', message: (err as Error).message });
    }
  }
);

// =====================================================================
// PUT /api/canvases/:id —— 保存（情况 1）
// =====================================================================

canvasesRouter.put(
  '/api/canvases/:id',
  requireAuth,
  validateBody(SaveCanvasRequestSchema),
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    const row = getCanvasRow(id);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!canWrite(row, req.user ?? null)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const body = req.body as import('../schemas/canvas.ts').SaveCanvasRequest;
    try {
      const result = saveCanvas({
        id,
        baseVersion: body.baseVersion,
        data: body.data,
        user: req.user!,
      });
      if (!result.ok) {
        // 多种 §5.7 错误：409（version 冲突 / ID 撞车 / meta 缺失）/ 403（越权改/删别人节点）
        if (result.status === 403) {
          res.status(403).json({
            error: result.error,
            message: result.message,
            currentVersion: result.currentVersion,
          });
          return;
        }
        // 409 系列
        const message =
          result.error === 'conflict'
            ? 'canvas was modified by another user; reload and retry'
            : result.error === 'base_version_expired'
              ? 'base version snapshot expired; please reload to get the latest version'
              : result.error === 'node_id_collision'
                ? 'node ID collision detected (server already has a node with this id)'
                : 'node meta inconsistency (a modified node has no record in nodes_meta)';
        // conflicts 字段在 Day 2 起被填充（detectNodeConflicts/detectEdgeConflicts 输出）
        // Day 1 stub 阶段始终为空
        const conflicts =
          result.error === 'conflict' && 'conflicts' in result ? result.conflicts : undefined;
        res.status(409).json({
          error: result.error,
          currentVersion: result.currentVersion,
          message,
          ...(conflicts ? { conflicts } : {}),
        });
        return;
      }
      // 阶段 5 Day 3 起：merged=true 时返 mergedData + mergedFromVersion 给客户端做状态替换（GATE-1）
      if (result.merged) {
        res.json({
          ok: true,
          version: result.version,
          merged: true,
          mergedData: result.mergedData,
          mergedFromVersion: result.mergedFromVersion,
          report: result.report,
        });
        return;
      }
      res.json({ ok: true, version: result.version, merged: false });
    } catch (err) {
      // 阶段 5 Day 2 D5 决策：DataIntegrityError 走独立 500 错误码 data_integrity_error，
      // 与普通 save_failed 分开。前端可识别并提示用户"画布数据损坏需联系运维"。
      // 触发场景：computeDelta 入口的 assertProjectIntegrity 双向扫描发现重复 ID / null handle /
      // activeSheetId 不存在 / connector 跨 sheet / parentId 自引用或非 group 父等。
      // 生产 db 审计已通过 9 canvases + 27 versions 全过，正常路径不应触发。
      if (err instanceof DataIntegrityError) {
        res.status(500).json({ error: 'data_integrity_error', message: err.message });
        return;
      }
      res.status(500).json({ error: 'save_failed', message: (err as Error).message });
    }
  }
);

// =====================================================================
// PATCH /api/canvases/:id —— 改元信息
// =====================================================================

canvasesRouter.patch(
  '/api/canvases/:id',
  requireAuth,
  validateBody(PatchCanvasRequestSchema),
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    const row = getCanvasRow(id);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const user = req.user!;
    const body = req.body as import('../schemas/canvas.ts').PatchCanvasRequest;

    // 权限细分：
    // - is_public_to_guest / archived / owner_id: 仅 admin（方案 §1.3 / §9.4 / §9.5）
    // - name / description: 按 canWrite
    const adminOnlyChanges =
      body.is_public_to_guest !== undefined ||
      body.archived !== undefined ||
      body.owner_id !== undefined;
    if (adminOnlyChanges && user.role !== 'admin') {
      res.status(403).json({
        error: 'forbidden',
        message:
          'only admin can change is_public_to_guest / archived / owner_id',
      });
      return;
    }
    if (!canWrite(row, user)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    try {
      patchCanvasMeta({ id, patch: body, user });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'patch_failed', message: (err as Error).message });
    }
  }
);

// =====================================================================
// POST /api/canvases/:id/publish —— 发布画布为 public（P3G）
// 走 requireFreshAdmin（即时校验 admin 状态，避免被降权后旧 token 仍能发布）
// 详见 [01-取舍审查-P3G](../../docs/规划/codex审查记录/阶段3/P3G/01-取舍审查-P3G-公共画布发布治理.md)
// =====================================================================

canvasesRouter.post(
  '/api/canvases/:id/publish',
  requireFreshAdmin,
  validateBody(PublishCanvasRequestSchema),
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const body = req.body as import('../schemas/canvas.ts').PublishCanvasRequest;
    // schema 已通过 transform(trim).pipe(min(1).max(500)) 收敛 trim 语义
    // → body.published_note 一定是 trim 后的非空 1-500 字
    const result = publishCanvas({ id, note: body.published_note, user: req.user! });
    if (!result.ok) {
      const messages: Record<string, string> = {
        not_found: 'canvas not found',
        already_public: 'canvas is already public',
        archived_canvas: 'cannot publish archived canvas; restore it first',
      };
      res.status(result.status).json({
        error: result.error,
        message: messages[result.error] ?? result.error,
      });
      return;
    }
    res.json({ ok: true });
  }
);

// =====================================================================
// POST /api/canvases/:id/unpublish —— 撤回 public 画布为 private（P3G）
// 走 requireFreshAdmin
// =====================================================================

canvasesRouter.post(
  '/api/canvases/:id/unpublish',
  requireFreshAdmin,
  validateBody(UnpublishCanvasRequestSchema),
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const result = unpublishCanvas({ id, user: req.user! });
    if (!result.ok) {
      const messages: Record<string, string> = {
        not_found: 'canvas not found',
        already_private: 'canvas is already private',
        archived_canvas: 'cannot unpublish archived canvas',
      };
      res.status(result.status).json({
        error: result.error,
        message: messages[result.error] ?? result.error,
      });
      return;
    }
    res.json({ ok: true });
  }
);

// =====================================================================
// DELETE /api/canvases/:id —— 归档（软删）
// =====================================================================

canvasesRouter.delete(
  '/api/canvases/:id',
  requireAuth,
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    const row = getCanvasRow(id);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!canWrite(row, req.user ?? null)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    // 公共画布软删仅 admin（与 publish/unpublish 同口径）—— 防止普通用户误删全员可见画布
    if (row.visibility === 'public' && req.user!.role !== 'admin') {
      res.status(403).json({
        error: 'forbidden_delete_public_canvas',
        message: '只有管理员可以归档公共画布；普通用户请用"标废弃"代替',
      });
      return;
    }

    archiveCanvas(id, req.user!);
    res.json({ ok: true });
  }
);
