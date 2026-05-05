// /api/canvases/:cid/annotations + /api/annotations/:id 路由
//
// 鉴权与权限（方案 §4.4 / §1.4 P3E 一审产品规则）：
// - GET /api/canvases/:cid/annotations：仅 JWT（游客返 401，前端游客模式不发请求）
// - POST /api/canvases/:cid/annotations：JWT + 画布读权限 + 节点存在 + content/数量限制
// - PATCH /api/annotations/:id/resolve：JWT + 画布读权限 + 关闭权限（作者/节点 creator/admin）
// - PATCH /api/annotations/:id/reopen：同 resolve
//
// 关键安全约束：
// - 不能只看 annotation.id 操作；必须复核 canvas_id 对应画布的访问权（防跨画布越权）
// - 物理删除节点的批注理论不存在（§5.7 同事务清理已落地）

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.ts';
import { validateBody } from '../middleware/validate.ts';
import {
  CreateAnnotationRequestSchema,
  PositiveIntegerIdSchema,
} from '../schemas/annotation.ts';
import {
  canCloseAnnotation,
  checkNodeCapacity,
  createAnnotation,
  getAnnotationById,
  getNodeCreatorId,
  listAnnotationsByCanvas,
  nodeExistsInCanvas,
  reopenAnnotation,
  resolveAnnotation,
} from '../services/annotations.ts';
import { canRead, getCanvasRow } from '../services/canvases.ts';

export const annotationsRouter: Router = Router();

/** 解析正整数 path 参数，失败时直接 res.status(400) 并返回 null（caller 立刻 return） */
function parsePositiveIntegerParam(
  raw: unknown,
  res: Response,
  errorCode: string,
): number | null {
  const result = PositiveIntegerIdSchema.safeParse(raw);
  if (!result.success) {
    res.status(400).json({ error: errorCode });
    return null;
  }
  return result.data;
}

// =====================================================================
// GET /api/canvases/:cid/annotations —— 整画布列表
// =====================================================================
annotationsRouter.get(
  '/api/canvases/:cid/annotations',
  requireAuth, // 取舍 4：游客不可见批注（覆盖原 §4.4 "可游客"）
  (req: Request, res: Response) => {
    const canvasId = parsePositiveIntegerParam(req.params.cid, res, 'invalid_canvas_id');
    if (canvasId === null) return;
    const row = getCanvasRow(canvasId);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!canRead(row, req.user!)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const list = listAnnotationsByCanvas(canvasId);
    res.json({ annotations: list });
  },
);

// =====================================================================
// POST /api/canvases/:cid/annotations —— 创建批注
// =====================================================================
annotationsRouter.post(
  '/api/canvases/:cid/annotations',
  requireAuth,
  validateBody(CreateAnnotationRequestSchema),
  (req: Request, res: Response) => {
    const canvasId = parsePositiveIntegerParam(req.params.cid, res, 'invalid_canvas_id');
    if (canvasId === null) return;
    const body = req.body as import('../schemas/annotation.ts').CreateAnnotationRequest;
    const user = req.user!;

    const row = getCanvasRow(canvasId);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // 创建批注需要画布**读**权限（不需要写）；任何能看到画布的登录用户都能批注
    if (!canRead(row, user)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    // 节点存在性校验（含已标废弃节点）
    if (!nodeExistsInCanvas(row, body.sheetId, body.nodeId)) {
      res.status(404).json({
        error: 'node_not_found',
        message: '该节点在画布最新版本中不存在（可能已被物理删除或 sheetId/nodeId 错误）',
      });
      return;
    }

    // 容量限制（单节点 unresolved ≤ 100 / 全部 ≤ 500）
    const cap = checkNodeCapacity(canvasId, body.sheetId, body.nodeId);
    if (cap) {
      const message =
        cap.type === 'unresolved_limit'
          ? `该节点未解决批注已达上限 ${cap.max} 条，请先解决部分再继续`
          : `该节点批注总数已达上限 ${cap.max} 条`;
      res.status(409).json({ error: cap.type, current: cap.current, max: cap.max, message });
      return;
    }

    // body.content 已被 zod transform→trim 清洗过，直接入库
    const created = createAnnotation({
      canvasId,
      sheetId: body.sheetId,
      nodeId: body.nodeId,
      authorId: user.id,
      content: body.content,
    });
    res.status(201).json({ annotation: created });
  },
);

// =====================================================================
// PATCH /api/annotations/:id/resolve —— 标记 resolved
// =====================================================================
annotationsRouter.patch(
  '/api/annotations/:id/resolve',
  requireAuth,
  (req: Request, res: Response) => {
    handleClose(req, res, 'resolve');
  },
);

// =====================================================================
// PATCH /api/annotations/:id/reopen —— 重开
// =====================================================================
annotationsRouter.patch(
  '/api/annotations/:id/reopen',
  requireAuth,
  (req: Request, res: Response) => {
    handleClose(req, res, 'reopen');
  },
);

/** resolve / reopen 共用流程（权限校验 + 操作） */
function handleClose(req: Request, res: Response, action: 'resolve' | 'reopen'): void {
  const id = parsePositiveIntegerParam(req.params.id, res, 'invalid_id');
  if (id === null) return;
  const annotation = getAnnotationById(id);
  if (!annotation) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  // 必须复核画布访问权（不能只看 annotation.id）
  const canvasRow = getCanvasRow(annotation.canvas_id);
  if (!canvasRow) {
    // canvas 已删，annotation 应该被 ON DELETE CASCADE 清掉；fail-closed
    res.status(404).json({ error: 'canvas_not_found' });
    return;
  }
  const user = req.user!;
  if (!canRead(canvasRow, user)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  // 节点必须仍在 nodes_meta 中（物理删除会同事务清 annotations 但防御性）
  // 物理删除节点后 annotations 应已被清；若仍存在 + nodes_meta 缺失 → 数据不一致
  const creatorId = getNodeCreatorId(
    annotation.canvas_id,
    annotation.sheet_id,
    annotation.node_id,
  );
  if (creatorId === null) {
    res.status(404).json({
      error: 'node_meta_missing',
      message: '批注关联的节点元数据已不存在（可能数据不一致）',
    });
    return;
  }

  if (!canCloseAnnotation(annotation, user)) {
    res.status(403).json({
      error: 'forbidden_close_annotation',
      message: '仅批注作者、节点创建者或管理员可关闭/重开此批注',
    });
    return;
  }

  const updated = action === 'resolve' ? resolveAnnotation(id, user.id) : reopenAnnotation(id);
  if (!updated) {
    // 理论不会到这（getAnnotationById 已验存在）；fail-closed
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ annotation: updated });
}
