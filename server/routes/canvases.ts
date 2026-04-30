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
import { optionalAuth, requireAuth } from '../middleware/auth.ts';
import { validateBody } from '../middleware/validate.ts';
import {
  CreateCanvasRequestSchema,
  ImportCanvasRequestSchema,
  PatchCanvasRequestSchema,
  SaveCanvasRequestSchema,
} from '../schemas/canvas.ts';
import {
  archiveCanvas,
  canRead,
  canWrite,
  createCanvas,
  getCanvasRow,
  listCanvasesForAdmin,
  listCanvasesForGuest,
  listCanvasesForUser,
  patchCanvasMeta,
  saveCanvas,
} from '../services/canvases.ts';
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
  const row = getCanvasRow(id);
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
      data: JSON.parse(row.data) as MultiCanvasProjectInput,
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

    // 权限：visibility=public 仅 admin（方案 §1.3）
    if (body.visibility === 'public' && user.role !== 'admin') {
      res.status(403).json({
        error: 'forbidden',
        message: 'only admin can create public canvas',
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
            : result.error === 'node_id_collision'
              ? 'node ID collision detected (server already has a node with this id)'
              : 'node meta inconsistency (a modified node has no record in nodes_meta)';
        res.status(409).json({
          error: result.error,
          currentVersion: result.currentVersion,
          message,
        });
        return;
      }
      res.json({ ok: true, version: result.version, merged: false });
    } catch (err) {
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

    archiveCanvas(id, req.user!);
    res.json({ ok: true });
  }
);
