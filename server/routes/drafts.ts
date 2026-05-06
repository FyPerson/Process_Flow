// /api/canvases/:cid/draft 路由（阶段 4 P4B，方案 §4.6）
//
// 鉴权：requireAuth（游客无草稿语义）
// 权限：canRead（看不到的画布也不该能存草稿）
// 三个端点：
//   GET    /api/canvases/:cid/draft  → 取当前用户对该画布的草稿；404 表示无草稿
//   PUT    /api/canvases/:cid/draft  → 上传/覆盖草稿；413 too large / 429 quota / 400 invalid
//   DELETE /api/canvases/:cid/draft  → 幂等删除（不存在也返 ok）
//
// 错误码语义（判断点 7 + 隐含约束）：
// - 413 + error="draft_too_large"：单画布草稿 > 2MB
// - 429 + error="draft_quota_exceeded"：用户草稿数 >= 200
// - 400 + error="draft_corrupted"：data 不是合法 JSON（保留：当前不做内部 schema 校验，
//   客户端 PUT 时已经 JSON.stringify 过；如未来加 schema 校验在此返）
//
// 注意：PUT body 含完整 JSON 字符串，可能逼近 2MB；express.json 全局已 limit=2mb

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.ts';
import { validateBody } from '../middleware/validate.ts';
import { PutDraftRequestSchema } from '../schemas/draft.ts';
import { canRead, getCanvasRow } from '../services/canvases.ts';
import { deleteDraft, getDraft, putDraft } from '../services/drafts.ts';

export const draftsRouter: Router = Router();

function parseCanvasId(req: Request, res: Response): number | null {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid <= 0) {
    res.status(400).json({ error: 'invalid_id' });
    return null;
  }
  return cid;
}

function checkCanvasReadable(cid: number, req: Request, res: Response): boolean {
  const row = getCanvasRow(cid);
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return false;
  }
  if (!canRead(row, req.user ?? null)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// =====================================================================
// GET /api/canvases/:cid/draft
// =====================================================================
draftsRouter.get(
  '/api/canvases/:cid/draft',
  requireAuth,
  (req: Request, res: Response) => {
    const cid = parseCanvasId(req, res);
    if (cid === null) return;
    if (!checkCanvasReadable(cid, req, res)) return;

    const user = req.user!;
    const draft = getDraft({ userId: user.id, canvasId: cid });
    if (!draft) {
      res.status(404).json({ error: 'no_draft' });
      return;
    }
    res.json({
      draft: {
        canvasId: draft.canvas_id,
        data: draft.data, // JSON 字符串原样返回；客户端 JSON.parse
        baseVersion: draft.base_version,
        savedAt: draft.saved_at,
      },
    });
  },
);

// =====================================================================
// PUT /api/canvases/:cid/draft
// =====================================================================
draftsRouter.put(
  '/api/canvases/:cid/draft',
  requireAuth,
  validateBody(PutDraftRequestSchema),
  (req: Request, res: Response) => {
    const cid = parseCanvasId(req, res);
    if (cid === null) return;
    if (!checkCanvasReadable(cid, req, res)) return;

    const user = req.user!;
    const body = req.body as import('../schemas/draft.ts').PutDraftRequest;

    // 校验顺序：
    // 1. 字节数（防 JSON.parse 大字符串 OOM 风险）→ 413 draft_too_large
    // 2. JSON 合法性（codex P4 二审 #8：不让脏数据入库导致恢复弹窗 console.warn 跳过）→ 400 draft_corrupted
    // 3. 配额检查 + upsert（service 层）→ 429 draft_quota_exceeded / 200 ok
    const dataBytes = Buffer.byteLength(body.data, 'utf-8');
    if (dataBytes > 2 * 1024 * 1024) {
      res.status(413).json({
        error: 'draft_too_large',
        message: `draft data exceeds 2MB limit (got ${dataBytes} bytes)`,
      });
      return;
    }
    try {
      JSON.parse(body.data);
    } catch {
      res.status(400).json({
        error: 'draft_corrupted',
        message: 'draft.data is not valid JSON',
      });
      return;
    }

    const result = putDraft({
      userId: user.id,
      canvasId: cid,
      data: body.data,
      baseVersion: body.baseVersion,
    });

    if (!result.ok) {
      res.status(result.status!).json({
        error: result.error,
        message: result.message,
      });
      return;
    }
    res.json({ ok: true, savedAt: result.savedAt });
  },
);

// =====================================================================
// DELETE /api/canvases/:cid/draft（幂等）
// =====================================================================
draftsRouter.delete(
  '/api/canvases/:cid/draft',
  requireAuth,
  (req: Request, res: Response) => {
    const cid = parseCanvasId(req, res);
    if (cid === null) return;
    if (!checkCanvasReadable(cid, req, res)) return;

    const user = req.user!;
    deleteDraft({ userId: user.id, canvasId: cid });
    res.json({ ok: true });
  },
);
